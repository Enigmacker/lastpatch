'use strict';

// Optional expert mode: run a locally installed Nmap against the local
// subnet(s) the scan already covers, read its XML report, and use what it
// finds (MAC vendor, CPE names, service banners, OS fingerprint) to identify
// more devices.
//
// Nmap is an external program the user installs; it is never bundled or
// downloaded. It is started without a shell, with its arguments as an array,
// a time limit and a size limit on its output. Only private ranges are ever
// passed to it, and the options are conservative: host discovery, light
// service detection on the 100 most common ports, OS detection when allowed.
//
// What Nmap reports is treated with care. A model read from a probed service
// banner or a hardware CPE, agreeing with the MAC vendor, counts as an
// identification. Anything from the OS fingerprint is a guess: it is shown
// as "possible match", never as a result.

const { execFile } = require('node:child_process');
const { localSubnets, normalizeMac, isRandomMac } = require('./neighbors');
const { isPrivateHost } = require('./lan');
const { findDevice, canonicalVendor, sameMaker, hasTokenRun, stripSeries } = require('./match');

const MAX_XML_BYTES = 32 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const MIN_PREFIX = 22; // same limit as the sweep: never more than 1,024 addresses
const MAX_DEPTH = 32;
const MAX_ELEMENTS = 500000;

const INSTALL_HINT = [
  'Nmap was not found, so expert mode is skipped and the normal scan continues.',
  'To use --nmap, install Nmap from https://nmap.org/download',
  '  (Debian/Ubuntu: sudo apt install nmap; Fedora: sudo dnf install nmap; macOS: brew install nmap;',
  '   Windows: the installer from nmap.org), or give its location with --nmap-path <file>.',
].join('\n');

// ---------------------------------------------------------------- ranges

const PRIVATE_RANGES = [
  ['10.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['169.254.0.0', 16],
];

function ipToInt(ip) {
  const parts = String(ip).split('.');
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)) return null;
  return parts.reduce((acc, o) => acc * 256 + Number(o), 0);
}

function intToIp(n) {
  return [Math.floor(n / 16777216) % 256, Math.floor(n / 65536) % 256, Math.floor(n / 256) % 256, n % 256].join('.');
}

function maskOf(bits) {
  return bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
}

/**
 * True only for an IPv4 range "a.b.c.d/nn" that lies entirely inside a
 * private or link-local block and holds at most 1,024 addresses.
 */
function isPrivateCidr(cidr) {
  const m = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(String(cidr));
  if (!m) return false;
  const base = ipToInt(m[1]);
  const bits = Number(m[2]);
  if (base === null || bits < MIN_PREFIX || bits > 32) return false;
  if (((base & maskOf(bits)) >>> 0) !== base) return false; // host bits set
  return PRIVATE_RANGES.some(([net, len]) => bits >= len && ((base & maskOf(len)) >>> 0) === ipToInt(net));
}

/** The CIDR ranges of the local subnets the normal scan sweeps. */
function localTargets(subnets = localSubnets()) {
  const targets = [];
  const exclude = [];
  for (const s of subnets) {
    const cidr = `${intToIp(s.base)}/${32 - Math.log2(s.size)}`;
    if (!targets.includes(cidr)) targets.push(cidr);
    if (s.address && ipToInt(s.address) !== null) exclude.push(s.address); // not ourselves
  }
  return { targets, exclude };
}

/** Split targets into the ones Nmap may scan and the refused ones. */
function guardTargets(targets) {
  const allowed = [];
  const refused = [];
  for (const t of targets) (isPrivateCidr(t) ? allowed : refused).push(t);
  return { allowed, refused };
}

// ---------------------------------------------------------------- command

/** Arguments for Nmap, as an array (never through a shell). */
function buildArgs(targets, { osDetection = false, exclude = [] } = {}) {
  const { allowed, refused } = guardTargets(targets);
  if (refused.length || !allowed.length) {
    throw new Error(`Nmap only scans private local ranges (/${MIN_PREFIX} at most); refused: ${refused.join(', ') || 'no target'}`);
  }
  const args = ['-sV', '--version-light'];
  if (osDetection) args.push('-O', '--osscan-limit');
  args.push(
    '-T3', '--top-ports', '100', '--max-retries', '2', '--host-timeout', '120s',
    '-n', // no reverse DNS lookups: nothing is asked of outside resolvers
    '-oX', '-', '--no-stylesheet',
  );
  const ex = exclude.filter((ip) => ipToInt(ip) !== null && isPrivateHost(ip));
  if (ex.length) args.push('--exclude', ex.join(','));
  args.push(...allowed);
  return args;
}

function exec(execImpl, file, args, opts) {
  return new Promise((resolve) => {
    execImpl(file, args, { windowsHide: true, encoding: 'utf8', ...opts }, (err, stdout, stderr) => {
      resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

/** Version of the Nmap at `nmapPath`, or null when it cannot be run. */
async function findNmap(nmapPath = 'nmap', execImpl = execFile) {
  const { err, stdout } = await exec(execImpl, nmapPath, ['--version'], { timeout: 10000, maxBuffer: 64 * 1024 });
  if (err) return null;
  const m = /Nmap version (\S+)/i.exec(stdout);
  return m ? { path: nmapPath, version: m[1] } : null;
}

/** True when this process can run OS detection (root on Unix); null when unknown. */
function hasRawPrivileges(platform = process.platform) {
  if (platform === 'win32') return null; // decided by trying, see runNmap
  return typeof process.getuid === 'function' && process.getuid() === 0;
}

const NEEDS_ROOT = /requires root privileges|root privileges|must be root|You requested a scan type which requires/i;

/**
 * Run Nmap on the local subnets. Never throws: problems end up in `notes`.
 * Returns { ran, version, osDetection, targets, hosts, notes, truncated }.
 */
async function runNmap({
  nmapPath = 'nmap', subnets, timeoutMs = DEFAULT_TIMEOUT_MS, execImpl = execFile,
  privileged = hasRawPrivileges(),
} = {}) {
  const out = { ran: false, version: null, osDetection: false, targets: [], hosts: [], notes: [], truncated: false };
  const found = await findNmap(nmapPath, execImpl);
  if (!found) {
    out.notes.push(nmapPath === 'nmap' ? INSTALL_HINT : `Nmap could not be run from "${nmapPath}".\n${INSTALL_HINT}`);
    return out;
  }
  out.version = found.version;

  const { targets, exclude } = localTargets(subnets);
  const { allowed, refused } = guardTargets(targets);
  for (const r of refused) out.notes.push(`Nmap: ${r} is not a private range of /${MIN_PREFIX} or smaller, not scanned.`);
  if (!allowed.length) {
    out.notes.push('Nmap: no local private subnet to scan (only /22 or smaller private networks are scanned).');
    return out;
  }
  out.targets = allowed;

  let osDetection = privileged !== false;
  if (privileged === false) {
    out.notes.push('Nmap: OS detection (-O) needs root or administrator rights; running service detection (-sV) only. ' +
      'MAC addresses are also only reported with those rights.');
  }
  let res = await exec(execImpl, nmapPath, buildArgs(allowed, { osDetection, exclude }), { timeout: timeoutMs, maxBuffer: MAX_XML_BYTES });
  if (osDetection && res.err && NEEDS_ROOT.test(res.stderr)) {
    osDetection = false;
    out.notes.push('Nmap: OS detection (-O) needs administrator rights; running service detection (-sV) only.');
    res = await exec(execImpl, nmapPath, buildArgs(allowed, { osDetection, exclude }), { timeout: timeoutMs, maxBuffer: MAX_XML_BYTES });
  }
  out.osDetection = osDetection;
  if (res.err) {
    if (res.err.killed || res.err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
      out.truncated = true;
      out.notes.push('Nmap: stopped (time or size limit reached); only the hosts it had finished are used.');
    } else if (!res.stdout.includes('<host')) {
      out.notes.push(`Nmap failed: ${(res.stderr.trim().split('\n').pop() || res.err.message).slice(0, 300)}`);
      return out;
    }
  }
  try {
    out.hosts = parseNmapXml(res.stdout);
    out.ran = true;
  } catch (e) {
    out.notes.push(`Nmap: its report could not be read (${e.message}).`);
  }
  return out;
}

// ---------------------------------------------------------------- XML

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return ENTITIES[e.toLowerCase()] ?? all; // no other (external) entity is ever expanded
  });
}

function parseAttrs(text) {
  const attrs = Object.create(null);
  const re = /([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(text))) attrs[m[1]] = decodeEntities(m[2] !== undefined ? m[2] : m[3]);
  return attrs;
}

/**
 * Minimal, non-validating XML reader for Nmap reports: elements, attributes
 * and text. No DTD, no entity definitions, no external references. A cut-off
 * document is read up to where it stops; elements left open are marked so.
 */
function parseXml(text) {
  const src = String(text);
  if (Buffer.byteLength(src) > MAX_XML_BYTES) throw new Error('report too large');
  const root = { name: '#root', attrs: {}, children: [], text: '', closed: true };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<![^>]*>|<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[^\s=>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  let last = 0;
  let count = 0;
  let m;
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1];
    if (m.index > last) top.text += decodeEntities(src.slice(last, m.index));
    last = re.lastIndex;
    if (m[1] !== undefined) { top.text += m[1]; continue; }
    if (!m[3]) continue; // comment, processing instruction, DOCTYPE
    if (m[2] === '/') {
      // Close the nearest open element of that name; ignore stray end tags.
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].name === m[3]) {
          stack[i].closed = true;
          stack.length = i;
          break;
        }
      }
      continue;
    }
    if (++count > MAX_ELEMENTS) throw new Error('too many elements');
    const el = { name: m[3], attrs: parseAttrs(m[4] || ''), children: [], text: '', closed: Boolean(m[5]) };
    top.children.push(el);
    if (!m[5]) {
      if (stack.length > MAX_DEPTH) throw new Error('nesting too deep');
      stack.push(el);
    }
  }
  return root;
}

const kids = (el, name) => (el ? el.children.filter((c) => c.name === name) : []);
const kid = (el, name) => kids(el, name)[0] || null;

function cpesOf(el) {
  return kids(el, 'cpe').map((c) => c.text.trim()).filter((c) => /^cpe:\/[aho]:/i.test(c));
}

/** Hosts of an Nmap XML report (only complete, "up", private-address hosts). */
function parseNmapXml(xml) {
  const root = parseXml(xml);
  const run = kid(root, 'nmaprun');
  if (!run) throw new Error('not an Nmap XML report');
  const hosts = [];
  for (const h of kids(run, 'host')) {
    if (!h.closed) continue; // cut off by the time or size limit
    const status = kid(h, 'status');
    if (status && status.attrs.state !== 'up') continue;
    let ip = null;
    let mac = null;
    let macVendor = null;
    for (const a of kids(h, 'address')) {
      if (a.attrs.addrtype === 'ipv4') ip = a.attrs.addr;
      if (a.attrs.addrtype === 'mac') {
        mac = normalizeMac(a.attrs.addr || '');
        macVendor = a.attrs.vendor || null;
      }
    }
    if (!ip || !isPrivateHost(ip)) continue; // defence in depth: never keep a public address
    const services = [];
    for (const p of kids(kid(h, 'ports'), 'port')) {
      const state = kid(p, 'state');
      if (!state || state.attrs.state !== 'open') continue;
      const s = kid(p, 'service');
      const a = s ? s.attrs : {};
      services.push({
        port: Number(p.attrs.portid),
        protocol: p.attrs.protocol || 'tcp',
        name: a.name || null,
        product: a.product || null,
        version: a.version || null,
        extrainfo: a.extrainfo || null,
        devicetype: a.devicetype || null,
        ostype: a.ostype || null,
        method: a.method || null,
        conf: a.conf != null ? Number(a.conf) : null,
        cpes: cpesOf(s),
      });
    }
    const os = [];
    for (const om of kids(kid(h, 'os'), 'osmatch')) {
      os.push({
        name: om.attrs.name || '',
        accuracy: Number(om.attrs.accuracy) || 0,
        classes: kids(om, 'osclass').map((c) => ({
          type: c.attrs.type || null,
          vendor: c.attrs.vendor || null,
          family: c.attrs.osfamily || null,
          gen: c.attrs.osgen || null,
          accuracy: Number(c.attrs.accuracy) || 0,
          cpes: cpesOf(c),
        })),
      });
    }
    os.sort((a, b) => b.accuracy - a.accuracy);
    hosts.push({ ip, mac, macVendor: mac && isRandomMac(mac) ? null : macVendor, services, os });
  }
  return hosts;
}

// ---------------------------------------------------------------- mapping

function parseCpe(cpe) {
  const m = /^cpe:\/([aho]):([^:]*)(?::([^:]*))?(?::([^:]*))?/i.exec(String(cpe).trim());
  if (!m) return null;
  const part = (s) => {
    let v = s || '';
    try { v = decodeURIComponent(v); } catch { /* keep as is */ }
    return v.replace(/_/g, ' ').trim();
  };
  return { part: m[1].toLowerCase(), vendor: part(m[2]), product: part(m[3]), version: part(m[4]) };
}

// Version words in banners ("httpd v2.0") must not be read as a hardware
// version: Nmap does not see the label under the device.
function stripHw(text) {
  return String(text || '').replace(/\b(?:v|ver\.?|version|hw)\s*:?\s*\d+(?:\.\d+)*\b/gi, ' ').replace(/\s+/g, ' ').trim();
}

function withVendor(text, vendorHint) {
  const t = stripHw(text);
  if (!t) return null;
  if (canonicalVendor(t)) return t;
  if (vendorHint && canonicalVendor(vendorHint)) return `${vendorHint} ${t}`;
  return null; // no maker named anywhere: too vague to look up
}

/**
 * Descriptions Nmap gives of a host, with how much they can be trusted:
 * "strong" for a probed service banner (confidence 8 or more) or a hardware
 * CPE from a probed service, "weak" for everything from the OS fingerprint.
 */
function nmapCandidates(nh, vendorHint) {
  const out = [];
  const add = (via, text, strength, accuracy = null, hint = vendorHint) => {
    const query = withVendor(text, hint);
    if (query && !out.some((c) => c.query === query && c.strength === strength)) out.push({ via, query, strength, accuracy });
  };
  for (const s of nh.services) {
    const probed = s.method === 'probed' && (s.conf == null || s.conf >= 8);
    for (const c of s.cpes.map(parseCpe).filter((x) => x && x.part === 'h' && x.product)) {
      add(`Nmap service detection (${s.port}/${s.protocol}, hardware CPE)`, `${c.vendor} ${c.product}`, probed ? 'strong' : 'weak');
    }
    if (s.product) {
      const via = `Nmap service detection (${s.port}/${s.protocol} banner)`;
      if (s.extrainfo) add(via, `${s.product} ${s.extrainfo}`, probed ? 'strong' : 'weak');
      add(via, s.product, probed ? 'strong' : 'weak');
    }
  }
  for (const om of nh.os) {
    for (const c of om.classes) {
      for (const p of c.cpes.map(parseCpe).filter((x) => x && x.product)) {
        if (p.part === 'h') add(`Nmap OS fingerprint (hardware CPE, ${c.accuracy || om.accuracy}%)`, `${p.vendor} ${p.product}`, 'weak', c.accuracy || om.accuracy);
      }
    }
    // The OS name is only looked up when it names a maker itself.
    add(`Nmap OS fingerprint (${om.accuracy}%)`, om.name, 'weak', om.accuracy, null);
  }
  return out;
}

// The model must be named as whole words in the description, not just
// found inside a longer string ("C7" inside "C750").
function modelNamed(query, model) {
  if (hasTokenRun(query, model) || hasTokenRun(query, stripSeries(model))) return true;
  const name = String(model).replace(/\s*\([^)]*\)/g, '').trim();
  if (name && /\d/.test(name) && hasTokenRun(query, name)) return true;
  return [...String(model).matchAll(/\(([^)]*)\)/g)]
    .flatMap((m) => m[1].split(/\s+and\s+|[,/]/))
    .map((c) => c.trim())
    .some((c) => /\d/.test(c) && c.length >= 4 && hasTokenRun(query, c));
}

/** Match Nmap's descriptions of a host against the dataset. */
function matchNmapHost(nh, devices, macVendor) {
  const macV = canonicalVendor(macVendor);
  let best = null;
  const guesses = [];
  for (const c of nmapCandidates(nh, macVendor)) {
    const res = findDevice(devices, c.query);
    if (!res.matches.length) continue;
    const row = res.matches[0].row;
    if (macV && !sameMaker(canonicalVendor(row.vendor), macV)) continue; // disagrees with the MAC vendor
    // A model not named as whole words is noise, not even a guess.
    if (!modelNamed(c.query, row.model)) continue;
    const strength = c.strength;
    if (strength === 'strong' && !best) {
      best = { via: c.via, query: c.query, matches: res.matches, hwVersion: null };
    } else if (strength === 'weak' && !guesses.some((g) => g.vendor === row.vendor && g.model === row.model)) {
      guesses.push({ vendor: row.vendor, model: row.model, via: c.via, seen_as: c.query, accuracy: c.accuracy, confidence: 'weak' });
    }
  }
  return { best, guesses };
}

// ---------------------------------------------------------------- merge

function emptyHost(ip) {
  return { ip, mac: null, macVendor: null, randomMac: false, note: null, upnp: [], mdns: null, http: null, firmware: null, exposed: [] };
}

function ipSort(a, b) {
  return (ipToInt(a.ip) ?? 0) - (ipToInt(b.ip) ?? 0);
}

/**
 * Merge Nmap hosts into the hosts of the normal scan, matched by IP address,
 * then MAC address. Each host keeps its Nmap findings in `host.nmap` and the
 * methods that saw it in `host.seenBy`.
 */
function mergeHosts(hosts, nmapHosts) {
  const list = hosts.map((h) => ({ ...h, seenBy: h.seenBy || ['lan scan'] }));
  for (const nh of nmapHosts) {
    let h = list.find((x) => x.ip === nh.ip) || (nh.mac && list.find((x) => x.mac && x.mac === nh.mac));
    if (!h) {
      h = { ...emptyHost(nh.ip), seenBy: [] };
      list.push(h);
    }
    if (!h.seenBy.includes('nmap')) h.seenBy = [...h.seenBy, 'nmap'];
    if (!h.mac && nh.mac) {
      h.mac = nh.mac;
      h.randomMac = isRandomMac(nh.mac);
    }
    if (!h.macVendor && !h.randomMac && nh.macVendor) h.macVendor = nh.macVendor;
    h.nmap = nh;
  }
  return list.sort(ipSort);
}

/**
 * After the normal identification: identify with Nmap the hosts nothing else
 * identified, and list Nmap's weak guesses separately. Mutates and returns
 * the identified list.
 */
function applyNmap(identified, devices) {
  for (const r of identified) {
    const nh = r.host.nmap;
    if (!nh) continue;
    const { best, guesses } = matchNmapHost(nh, devices, r.host.macVendor);
    if (!r.matches.length && best) Object.assign(r, best);
    nh.guesses = r.matches.length
      ? guesses.filter((g) => !r.matches.some((m) => m.row.vendor === g.vendor && m.row.model === g.model))
      : guesses;
  }
  return identified;
}

// ---------------------------------------------------------------- output

function osSummary(nh) {
  const om = nh.os[0];
  return om ? { name: om.name, accuracy: om.accuracy, guess: true } : null;
}

function deviceType(nh) {
  const fromService = nh.services.map((s) => s.devicetype).find(Boolean);
  if (fromService) return fromService;
  const om = nh.os[0];
  return om && om.classes[0] ? om.classes[0].type : null;
}

/** Extra JSON fields of a scan report entry in expert mode. */
function reportFields(r) {
  const h = r.host;
  if (!h.seenBy) return {};
  const nh = h.nmap;
  return {
    discovered_by: h.seenBy,
    nmap: nh ? {
      os: osSummary(nh),
      device_type: deviceType(nh),
      services: nh.services.map((s) => ({
        port: s.port, protocol: s.protocol, name: s.name, product: s.product, version: s.version, cpes: s.cpes,
      })),
      possible_matches: nh.guesses || [],
    } : null,
  };
}

function printNmap(r, print = console.log) {
  if (!r.nmap) return;
  const n = r.nmap;
  if (r.discovered_by && r.discovered_by.length === 1 && r.discovered_by[0] === 'nmap') print('  found by Nmap only');
  const bits = [];
  if (n.device_type) bits.push(`device type: ${n.device_type}`);
  if (n.os) bits.push(`OS guess: ${n.os.name} (${n.os.accuracy}%)`);
  if (bits.length) print(`  Nmap: ${bits.join('; ')}`);
  if (n.services.length) {
    const open = n.services.map((s) => {
      const what = [s.product, s.version].filter(Boolean).join(' ');
      return `${s.port}/${s.protocol}${s.name ? ` ${s.name}` : ''}${what ? ` (${what})` : ''}`;
    });
    print(`  Nmap open ports: ${open.join(', ')}`);
  }
  for (const g of n.possible_matches) {
    print(`  possible match, NOT confirmed (weak guess from ${g.via}): ${g.vendor} ${g.model}`);
    print(`    read the model on the label, then: lastpatch check "${g.vendor} ${g.model}"`);
  }
}

module.exports = {
  INSTALL_HINT,
  isPrivateCidr,
  localTargets,
  guardTargets,
  buildArgs,
  findNmap,
  hasRawPrivileges,
  runNmap,
  parseXml,
  parseNmapXml,
  parseCpe,
  nmapCandidates,
  matchNmapHost,
  mergeHosts,
  applyNmap,
  reportFields,
  printNmap,
};
