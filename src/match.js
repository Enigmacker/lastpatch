'use strict';

// Matching a device description (from a user query or from UPnP discovery)
// against the dataset, and computing its support status.

const VENDOR_ALIASES = {
  'tp-link': ['tp-link', 'tplink', 'tp link', 'tapo', 'deco'],
  netgear: ['netgear', 'nighthawk', 'orbi'],
  'd-link': ['d-link', 'dlink', 'd link'],
  avm: ['avm', 'fritz', 'fritz!box', 'fritzbox', 'fritz!'],
  asus: ['asus', 'asustek', 'zenwifi'],
  linksys: ['linksys', 'velop'],
  synology: ['synology'],
  qnap: ['qnap'],
  reolink: ['reolink'],
  ezviz: ['ezviz'],
  arlo: ['arlo'],
  netatmo: ['netatmo'],
  ring: ['ring'],
  ubiquiti: ['ubiquiti', 'unifi', 'ubnt', 'amplifi'],
  // Amazon brands first, so "Amazon eero Pro 6" is read as eero.
  eero: ['eero'],
  blink: ['blink', 'immedia'],
  amazon: ['amazon', 'echo', 'fire tv'],
  google: ['google', 'nest', 'chromecast'],
  mercusys: ['mercusys'],
  tenda: ['tenda'],
  zyxel: ['zyxel'],
  draytek: ['draytek', 'vigor'],
  devolo: ['devolo'],
  huawei: ['huawei'],
  xiaomi: ['xiaomi', 'mi router'],
  wd: ['wd', 'western digital', 'my cloud', 'mycloud'],
  asustor: ['asustor'],
  terramaster: ['terramaster', 'terra master'],
  eufy: ['eufy', 'anker'],
  wyze: ['wyze'],
  'philips hue': ['philips hue', 'hue bridge', 'signify', 'philips lighting'],
  hikvision: ['hikvision', 'hik-connect', 'hikconnect'],
  imou: ['imou', 'dahua'],
  swann: ['swann'],
  yale: ['yale'],
  sonos: ['sonos'],
  'gl.inet': ['gl.inet', 'gl-inet', 'glinet', 'gl inet'],
  cudy: ['cudy'],
  teltonika: ['teltonika'],
  keenetic: ['keenetic'],
  'aruba instant on': ['aruba instant on', 'instant on', 'aruba'],
  cisco: ['cisco', 'meraki', 'linksys business'],
  lorex: ['lorex'],
  logitech: ['logitech', 'logi circle'],
  simplisafe: ['simplisafe'],
  foscam: ['foscam'],
  amcrest: ['amcrest'],
  canary: ['canary'],
  tado: ['tado', 'tado°'],
  bosch: ['bosch'],
  nuki: ['nuki'],
  shelly: ['shelly', 'allterco'],
  ikea: ['ikea', 'dirigera', 'tradfri', 'trådfri'],
  hive: ['hive', 'centrica'],
  somfy: ['somfy'],
  sonoff: ['sonoff', 'itead', 'ewelink'],
  aqara: ['aqara', 'lumi united'],
  switchbot: ['switchbot', 'wonderlabs'],
  samsung: ['samsung', 'smartthings'],
};

const DAY_MS = 24 * 60 * 60 * 1000;

// Marketing series names that devices often omit when they report their model.
const SERIES = /^(nighthawk|orbi|eagle pro ai|zenwifi|velop|deco|tapo|archer|vigor|eufycam|my cloud)\s+/i;

function tokens(s) {
  return String(s || '').toLowerCase().replace(/fritz!\s*/g, 'fritz').split(/[^a-z0-9]+/).filter(Boolean);
}

// True when the tokens of `needle` appear consecutively in `haystack`.
function hasTokenRun(haystack, needle) {
  const h = tokens(haystack);
  const n = tokens(needle);
  if (!n.length) return false;
  for (let i = 0; i + n.length <= h.length; i++) {
    if (n.every((t, j) => h[i + j] === t)) return true;
  }
  return false;
}

function stripSeries(model) {
  return String(model || '').replace(SERIES, '');
}

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/fritz!\s*/g, 'fritz')
    .replace(/[^a-z0-9]+/g, '');
}

function canonicalVendor(text) {
  const t = String(text || '').toLowerCase();
  // Whole-word match: "ring" must not match "Engineering".
  const word = (a) => new RegExp(`(^|[^a-z0-9])${a.replace(/[.*+?^${}()|[\]\\!]/g, '\\$&')}(?=$|[^a-z0-9])`).test(t);
  for (const [vendor, aliases] of Object.entries(VENDOR_ALIASES)) {
    if (aliases.some(word)) return vendor;
  }
  return null;
}

// Brands made by the same company often share network card makers (MAC
// prefixes): a Ring doorbell shows an Amazon MAC, a Mercusys router a TP-Link one.
const FAMILIES = [
  ['amazon', 'ring', 'blink', 'eero'],
  ['google'],
  ['tp-link', 'mercusys'],
  ['hikvision', 'ezviz'],
  ['imou'],
];

/** True when two canonical vendors may be the same maker. */
function sameMaker(a, b) {
  if (!a || !b || a === b) return true;
  return FAMILIES.some((f) => f.includes(a) && f.includes(b));
}

// Extract a hardware version like "V3", "v1.2", "Rev. B" from free text.
function extractHwVersion(text) {
  const m = String(text || '').match(/\b(?:v|ver\.?|version|hw)\s*:?\s*(\d+(?:\.\d+)*)\b/i);
  return m ? `V${m[1]}` : null;
}

// "V1.0" on a label means "V1" in vendor lists; "V3.20" stays distinct.
function normalizeHw(v) {
  return normalize(String(v).replace(/(\d)\.0\b/g, '$1'));
}

function hwMatches(rowHw, queryHw) {
  if (!rowHw || !queryHw) return null; // unknown
  const versions = String(rowHw)
    .split(/[,/]|\band\b/i)
    .map(normalizeHw)
    .filter(Boolean);
  return versions.includes(normalizeHw(queryHw));
}

function computeStatus(row, today = new Date(), warnDays = 365) {
  if (!row.support_end) {
    if (/already|no longer|end of (support|life)|\bEOL\b/i.test(row.support_end_raw || '')) {
      return 'expired';
    }
    return 'unknown';
  }
  const end = new Date(`${row.support_end}T23:59:59Z`);
  const daysLeft = Math.floor((end - today) / DAY_MS);
  if (daysLeft < 0) return 'expired';
  if (daysLeft <= warnDays) return 'expiring';
  return 'supported';
}

function daysLeft(row, today = new Date()) {
  if (!row.support_end) return null;
  const end = new Date(`${row.support_end}T23:59:59Z`);
  return Math.floor((end - today) / DAY_MS);
}

// Find dataset rows for a free-text device description.
// Returns { matches: [{row, hw}], hwVersion, vendor } sorted best first.
function findDevice(devices, query) {
  const vendor = canonicalVendor(query);
  const hwVersion = extractHwVersion(query);
  const q = normalize(query);

  const scored = [];
  for (const row of devices) {
    if (vendor && canonicalVendor(row.vendor) !== vendor) continue;
    const model = normalize(row.model);
    if (!model) continue;
    let score = 0;
    const core = normalize(stripSeries(row.model));
    if (q === model || q === normalize(row.vendor) + model) score = 100;
    else if (q.includes(model)) score = 50 + model.length; // longest model wins
    // Fallback without the marketing series name ("Nighthawk RAX70" vs "RAX70").
    else if (core.length >= 3 && /\d/.test(core) && core !== model && hasTokenRun(query, stripSeries(row.model))) {
      score = 30 + core.length;
    }
    // Names with a SKU in parentheses: "Arlo Pro 2 (VMC4030P)" matches
    // "Arlo Pro 2" or "VMC4030P".
    if (score === 0 && /\(/.test(row.model)) {
      const name = row.model.replace(/\s*\([^)]*\)/g, '').trim();
      const codes = [...row.model.matchAll(/\(([^)]*)\)/g)]
        .flatMap((m) => m[1].split(/\s+and\s+|[,/]/))
        .map((c) => c.trim())
        .filter((c) => /\d/.test(c) && c.length >= 4);
      if (name && /\d/.test(name) && hasTokenRun(query, name)) score = 40 + name.length;
      else if (codes.some((c) => hasTokenRun(query, c))) score = 40;
    }
    if (score === 0) continue;
    const hw = hwMatches(row.hw_version, hwVersion);
    if (hw === false) continue; // explicit mismatch on hardware version
    if (hw === true) score += 20;
    scored.push({ row, score, hw });
  }
  scored.sort((a, b) => b.score - a.score);

  // Keep only the best model (several rows may remain: one per hw version).
  const best = scored.length ? normalize(scored[0].row.model) : null;
  const matches = scored.filter((s) => normalize(s.row.model) === best);
  return { matches, hwVersion, vendor };
}

module.exports = {
  normalize,
  canonicalVendor,
  sameMaker,
  extractHwVersion,
  computeStatus,
  daysLeft,
  findDevice,
  hasTokenRun,
  stripSeries,
};
