'use strict';

// Nmap expert mode, tested on saved Nmap XML reports and a fake runner:
// Nmap is never started here and nothing sends a packet.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const nmap = require('../src/nmap');
const { identify } = require('../src/discover');
const { scanReport } = require('../src/cli');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', 'nmap', name), 'utf8');

const devices = [
  { vendor: 'TP-Link', model: 'Archer AX55', hw_version: 'V1', support_end: '2029-12-31', support_end_raw: 'x', region: 'UK' },
  { vendor: 'Synology', model: 'DS920+', hw_version: null, support_end: '2028-10-31', support_end_raw: 'x', region: 'global' },
  { vendor: 'AVM', model: 'FRITZ!Box 7490', hw_version: null, support_end: '2025-10-01', end_is_minimum: true, support_end_raw: 'x', region: 'EU' },
  { vendor: 'Amcrest', model: 'IP2M-841', hw_version: null, support_end: null, support_end_raw: 'no date', region: 'UK' },
  { vendor: 'Hikvision', model: 'DS-2CD2032-I', hw_version: null, support_end: null, support_end_raw: 'no date', region: 'global' },
  { vendor: 'Netgear', model: 'R7000', hw_version: null, support_end: '2026-07-15', support_end_raw: 'x', region: 'UK' },
];

const blankHost = (ip, extra = {}) => ({ ip, mac: null, macVendor: null, randomMac: false, note: null, upnp: [], mdns: null, http: null, firmware: null, exposed: [], ...extra });

// ------------------------------------------------------------ private-range guard

test('private-range guard: only private ranges of /22 or smaller', () => {
  for (const ok of ['192.168.1.0/24', '10.20.30.0/24', '172.16.0.0/22', '172.31.255.0/24', '169.254.10.0/24', '192.168.1.7/32']) {
    assert.ok(nmap.isPrivateCidr(ok), ok);
  }
  for (const bad of ['8.8.8.0/24', '172.32.0.0/24', '192.169.0.0/24', '100.64.0.0/24', '10.0.0.0/8', '192.168.0.0/16',
    '192.168.1.5/24', '192.168.1.0', 'scanme.nmap.org', '192.168.1.0/24 -oN /tmp/x', '-iL', '::1/128', '256.1.1.0/24']) {
    assert.ok(!nmap.isPrivateCidr(bad), bad);
  }
});

test('buildArgs refuses any non-private target and never adds a shell', () => {
  assert.throws(() => nmap.buildArgs(['192.168.1.0/24', '8.8.8.0/24']), /refused: 8\.8\.8\.0\/24/);
  assert.throws(() => nmap.buildArgs([]), /no target/);
  const args = nmap.buildArgs(['192.168.1.0/24'], { osDetection: true, exclude: ['192.168.1.10', '1.2.3.4', 'x;rm'] });
  assert.ok(Array.isArray(args));
  for (const a of ['-sV', '--version-light', '-O', '--osscan-limit', '-T3', '-n', '-oX', '-']) assert.ok(args.includes(a), a);
  assert.deepStrictEqual(args.slice(args.indexOf('--exclude'), args.indexOf('--exclude') + 2), ['--exclude', '192.168.1.10']);
  assert.strictEqual(args[args.length - 1], '192.168.1.0/24');
  const noOs = nmap.buildArgs(['192.168.1.0/24']);
  assert.ok(!noOs.includes('-O') && !noOs.includes('--osscan-limit'));
});

test('localTargets: the subnets the sweep covers, without our own address', () => {
  const { targets, exclude } = nmap.localTargets([{ address: '192.168.1.10', base: 0xc0a80100, size: 256 }]);
  assert.deepStrictEqual(targets, ['192.168.1.0/24']);
  assert.deepStrictEqual(exclude, ['192.168.1.10']);
});

// ------------------------------------------------------------ parsing

test('parse: privileged report (MAC, services, CPEs, OS)', () => {
  const hosts = nmap.parseNmapXml(fixture('privileged.xml'));
  assert.deepStrictEqual(hosts.map((h) => h.ip), ['192.168.1.1', '192.168.1.23', '192.168.1.60', '192.168.1.77']); // down host left out
  const [router, nas, cam, phone] = hosts;
  assert.strictEqual(router.mac, '50:c7:bf:aa:bb:cc');
  assert.strictEqual(router.macVendor, 'TP-Link Technologies');
  assert.deepStrictEqual(router.services.map((s) => s.port), [22, 53, 80]); // filtered port left out
  assert.deepStrictEqual(router.services[2].cpes, ['cpe:/h:tp-link:archer_ax55']);
  assert.strictEqual(router.services[2].devicetype, 'WAP');
  assert.strictEqual(router.os[0].name, 'Linux 4.15 - 5.8');
  assert.strictEqual(router.os[0].accuracy, 96);
  assert.strictEqual(nas.services[3].extrainfo, 'model: DS920+');
  assert.deepStrictEqual(cam.os.map((o) => o.accuracy), [88, 87]);
  assert.strictEqual(phone.macVendor, null); // randomised MAC: no vendor
});

test('parse: unprivileged report cut off by the time limit, public address dropped', () => {
  const hosts = nmap.parseNmapXml(fixture('unprivileged-cut.xml'));
  assert.deepStrictEqual(hosts.map((h) => h.ip), ['10.0.0.1']); // 8.8.8.8 refused, 10.0.0.5 incomplete
  assert.strictEqual(hosts[0].mac, null);
  assert.strictEqual(hosts[0].services[0].product, 'AVM FRITZ!Box 7490 http config & admin'); // entity decoded
});

test('parse: hostile or broken input', () => {
  assert.throws(() => nmap.parseNmapXml('<html><body>hello</body></html>'), /not an Nmap XML report/);
  // Entity definitions are never expanded.
  const xxe = '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><nmaprun><host><status state="up"/>' +
    '<address addr="192.168.1.2" addrtype="ipv4"/><ports><port protocol="tcp" portid="80"><state state="open"/>' +
    '<service name="http" product="&e;" method="probed" conf="10"/></port></ports></host></nmaprun>';
  const [h] = nmap.parseNmapXml(xxe);
  assert.strictEqual(h.services[0].product, '&e;');
  const deep = `<nmaprun>${'<a>'.repeat(100)}</nmaprun>`;
  assert.throws(() => nmap.parseXml(deep), /too deep/);
});

test('CPE parsing', () => {
  assert.deepStrictEqual(nmap.parseCpe('cpe:/h:tp-link:archer_ax55'), { part: 'h', vendor: 'tp-link', product: 'archer ax55', version: '' });
  assert.deepStrictEqual(nmap.parseCpe('cpe:/o:synology:diskstation_manager:7'), { part: 'o', vendor: 'synology', product: 'diskstation manager', version: '7' });
  assert.strictEqual(nmap.parseCpe('cpe:/h:synology:ds920%2b').product, 'ds920+');
  assert.strictEqual(nmap.parseCpe('not a cpe'), null);
});

// ------------------------------------------------------------ mapping

test('mapping: hardware CPE from a probed service is an identification', () => {
  const [router] = nmap.parseNmapXml(fixture('privileged.xml'));
  const { best, guesses } = nmap.matchNmapHost(router, devices, router.macVendor);
  assert.strictEqual(best.matches[0].row.model, 'Archer AX55');
  assert.match(best.via, /^Nmap service detection \(80\/tcp, hardware CPE\)$/);
  assert.strictEqual(best.hwVersion, null); // Nmap cannot read the label
  assert.deepStrictEqual(guesses, []);
});

test('mapping: banner model with the MAC vendor', () => {
  const [, nas] = nmap.parseNmapXml(fixture('privileged.xml'));
  const { best } = nmap.matchNmapHost(nas, devices, nas.macVendor);
  assert.strictEqual(best.matches[0].row.model, 'DS920+');
  assert.match(best.via, /5001\/tcp banner/);
});

test('mapping: OS fingerprint is only a weak guess, and must agree with the MAC vendor', () => {
  const [, , cam] = nmap.parseNmapXml(fixture('privileged.xml'));
  const { best, guesses } = nmap.matchNmapHost(cam, devices, cam.macVendor);
  assert.strictEqual(best, null);
  assert.deepStrictEqual(guesses.map((g) => `${g.vendor} ${g.model} ${g.confidence}`), ['Amcrest IP2M-841 weak']); // Hikvision rejected
  assert.match(guesses[0].via, /OS fingerprint/);
});

test('mapping: a service matched from the port table only (not probed) stays a guess', () => {
  const [box] = nmap.parseNmapXml(fixture('unprivileged-cut.xml'));
  const { best, guesses } = nmap.matchNmapHost(box, devices, null);
  assert.strictEqual(best.matches[0].row.model, 'FRITZ!Box 7490');
  assert.deepStrictEqual(guesses.map((g) => g.model), ['R7000']);
});

test('mapping: nothing is looked up without a maker, and no partial model names', () => {
  const host = { ip: '192.168.1.5', mac: null, macVendor: null, os: [],
    services: [{ port: 80, protocol: 'tcp', product: 'R7000 http config', method: 'probed', conf: 10, cpes: [] }] };
  assert.deepStrictEqual(nmap.nmapCandidates(host, null), []);
  const partial = { ...host, services: [{ port: 80, protocol: 'tcp', product: 'Netgear R70001 http config', method: 'probed', conf: 10, cpes: [] }] };
  const { best, guesses } = nmap.matchNmapHost(partial, devices, null);
  assert.strictEqual(best, null);
  assert.deepStrictEqual(guesses, []);
  // Version words in a banner are not taken as a hardware version.
  const versioned = { ...host, services: [{ port: 80, protocol: 'tcp', product: 'TP-LINK Archer AX55 httpd v2.0', method: 'probed', conf: 10, cpes: [] }] };
  assert.strictEqual(nmap.matchNmapHost(versioned, devices, null).best.matches[0].row.hw_version, 'V1');
});

// ------------------------------------------------------------ merge

test('merge: by IP, then by MAC; new hosts are added and marked', () => {
  const scanned = [
    blankHost('192.168.1.1', { mac: '50:c7:bf:aa:bb:cc', macVendor: 'TP-LINK TECHNOLOGIES CO.,LTD.', http: { title: 'Login', realm: null } }),
    blankHost('192.168.1.200', { mac: '00:11:32:01:02:03', macVendor: 'Synology Incorporated' }), // same MAC, other IP in the table
    blankHost('192.168.1.150'),
  ];
  const merged = nmap.mergeHosts(scanned, nmap.parseNmapXml(fixture('privileged.xml')));
  assert.deepStrictEqual(merged.map((h) => `${h.ip} ${h.seenBy.join('+')}`), [
    '192.168.1.1 lan scan+nmap',
    '192.168.1.60 nmap',
    '192.168.1.77 nmap',
    '192.168.1.150 lan scan',
    '192.168.1.200 lan scan+nmap',
  ]);
  assert.strictEqual(merged[0].macVendor, 'TP-LINK TECHNOLOGIES CO.,LTD.'); // the scan's vendor is kept
  assert.strictEqual(merged[1].macVendor, 'Amcrest Technologies'); // filled from Nmap
  assert.strictEqual(merged[2].randomMac, true);
  assert.strictEqual(merged[4].nmap.ip, '192.168.1.23');
  assert.strictEqual(scanned[0].nmap, undefined); // input left untouched
});

test('merge and report: methods marked, weak guesses kept out of the results', () => {
  const scanned = [
    blankHost('192.168.1.1', { mac: '50:c7:bf:aa:bb:cc', macVendor: 'TP-LINK TECHNOLOGIES CO.,LTD.' }),
    blankHost('192.168.1.23', { mac: '00:11:32:01:02:03', macVendor: 'Synology Incorporated', mdns: { names: ['nas'], services: [], model: 'DS920+', txt: {} } }),
  ];
  const hosts = nmap.mergeHosts(scanned, nmap.parseNmapXml(fixture('privileged.xml')));
  const report = scanReport(nmap.applyNmap(identify(hosts, devices), devices), 365);
  const by = Object.fromEntries(report.map((r) => [r.ip, r]));

  assert.match(by['192.168.1.1'].identified_via, /^Nmap service detection/);
  assert.strictEqual(by['192.168.1.1'].results[0].model, 'Archer AX55');
  assert.deepStrictEqual(by['192.168.1.1'].discovered_by, ['lan scan', 'nmap']);
  assert.strictEqual(by['192.168.1.1'].nmap.device_type, 'WAP');
  assert.strictEqual(by['192.168.1.1'].nmap.os.guess, true);

  assert.strictEqual(by['192.168.1.23'].identified_via, 'mDNS'); // the normal scan's answer wins
  assert.deepStrictEqual(by['192.168.1.23'].nmap.possible_matches, []);

  const cam = by['192.168.1.60'];
  assert.deepStrictEqual(cam.discovered_by, ['nmap']);
  assert.deepStrictEqual(cam.results, []);
  assert.strictEqual(cam.identified_via, null);
  assert.strictEqual(cam.nmap.possible_matches[0].model, 'IP2M-841');

  const lines = [];
  nmap.printNmap(cam, (l) => lines.push(l));
  assert.ok(lines.includes('  found by Nmap only'));
  assert.ok(lines.some((l) => /possible match, NOT confirmed .*Amcrest IP2M-841/.test(l)));
});

test('report without expert mode keeps its shape', () => {
  const [r] = scanReport(identify([blankHost('192.168.1.9')], devices), 365);
  assert.ok(!('discovered_by' in r) && !('nmap' in r));
});

// ------------------------------------------------------------ running (fake runner)

function fakeExec(handler) {
  const calls = [];
  const impl = (file, args, opts, cb) => {
    calls.push({ file, args, opts });
    const r = handler(args, calls.length);
    setImmediate(() => cb(r.err || null, r.stdout || '', r.stderr || ''));
  };
  return { impl, calls };
}

const subnets = [{ address: '192.168.1.10', base: 0xc0a80100, size: 256 }];

test('run: Nmap missing -> install hint, nothing scanned', async () => {
  const { impl, calls } = fakeExec(() => ({ err: Object.assign(new Error('spawn nmap ENOENT'), { code: 'ENOENT' }) }));
  const out = await nmap.runNmap({ execImpl: impl, subnets, privileged: true });
  assert.strictEqual(out.ran, false);
  assert.match(out.notes[0], /Nmap was not found.*\n.*nmap\.org\/download/);
  assert.strictEqual(calls.length, 1);
});

test('run: without root, service detection only, and says so', async () => {
  const { impl, calls } = fakeExec((args) => (args[0] === '--version'
    ? { stdout: 'Nmap version 7.94 ( https://nmap.org )\n' }
    : { stdout: fixture('privileged.xml') }));
  const out = await nmap.runNmap({ execImpl: impl, subnets, privileged: false, timeoutMs: 5000 });
  assert.strictEqual(out.ran, true);
  assert.strictEqual(out.version, '7.94');
  assert.strictEqual(out.osDetection, false);
  assert.ok(!calls[1].args.includes('-O'));
  assert.strictEqual(calls[1].opts.timeout, 5000);
  assert.ok(calls[1].opts.maxBuffer > 0);
  assert.ok(!calls[1].opts.shell);
  assert.match(out.notes.join('\n'), /needs root or administrator rights/);
  assert.deepStrictEqual(out.targets, ['192.168.1.0/24']);
  assert.strictEqual(out.hosts.length, 4);
});

test('run: OS detection refused by Nmap -> retried with -sV only', async () => {
  const { impl, calls } = fakeExec((args) => {
    if (args[0] === '--version') return { stdout: 'Nmap version 7.95\n' };
    if (args.includes('-O')) return { err: new Error('exit 1'), stderr: 'TCP/IP fingerprinting (for OS scan) requires root privileges.\nQUITTING!\n' };
    return { stdout: fixture('privileged.xml') };
  });
  const out = await nmap.runNmap({ execImpl: impl, subnets, privileged: null });
  assert.strictEqual(calls.length, 3);
  assert.strictEqual(out.osDetection, false);
  assert.strictEqual(out.ran, true);
  assert.match(out.notes.join('\n'), /service detection \(-sV\) only/);
});

test('run: time limit -> finished hosts only', async () => {
  const { impl } = fakeExec((args) => (args[0] === '--version'
    ? { stdout: 'Nmap version 7.94\n' }
    : { err: Object.assign(new Error('killed'), { killed: true, signal: 'SIGTERM' }), stdout: fixture('unprivileged-cut.xml') }));
  const out = await nmap.runNmap({ execImpl: impl, subnets, privileged: true });
  assert.strictEqual(out.truncated, true);
  assert.deepStrictEqual(out.hosts.map((h) => h.ip), ['10.0.0.1']);
});

test('run: no private local subnet -> Nmap is not started', async () => {
  const { impl, calls } = fakeExec(() => ({ stdout: 'Nmap version 7.94\n' }));
  const out = await nmap.runNmap({ execImpl: impl, subnets: [{ address: '203.0.113.5', base: 0xcb007100, size: 256 }], privileged: true });
  assert.strictEqual(out.ran, false);
  assert.strictEqual(calls.length, 1); // only --version
  assert.match(out.notes.join('\n'), /203\.0\.113\.0\/24 is not a private range/);
});
