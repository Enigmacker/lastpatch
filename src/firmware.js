'use strict';

// Installed vs latest firmware. Parses vendor version strings, compares
// them, and finds the latest version a manufacturer publishes for a model
// (data/firmware.json). When the latest version is not known, the result
// says so: a device is never reported as up to date without it.

const fs = require('node:fs');
const path = require('node:path');
const { findDevice, canonicalVendor } = require('./match');

const DATA_FILE = path.join(__dirname, '..', 'data', 'firmware.json');

let cache = null;
function loadFirmware(file = DATA_FILE) {
  if (file === DATA_FILE && cache) return cache;
  let rows = [];
  try {
    rows = JSON.parse(fs.readFileSync(file, 'utf8')).firmware || [];
  } catch {
    rows = [];
  }
  if (file === DATA_FILE) cache = rows;
  return rows;
}

// Parse a version string into numbers that can be compared.
//   AVM:     "154.07.57" (hardware prefix + FRITZ!OS 7.57), "07.57", "7.57", "FRITZ!OS 8.03"
//   generic: "V1.1.0 Build 20230512 rel.123" -> [1,1,0] + extra [20230512, 123]
//            "1.0.4.126_10.1.12"             -> [1,0,4,126] + extra [10,1,12]
// Returns { raw, parts, extra } or null when no number is found.
function parseVersion(raw, vendor) {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (!text) return null;
  // The first dotted number sequence is the version proper.
  const m = text.match(/(\d+(?:\.\d+)*)/);
  if (!m) return null;
  let parts = m[1].split('.').map(Number);
  const rest = text.slice(m.index + m[0].length);
  const extra = (rest.match(/\d+/g) || []).map(Number);

  const avm = canonicalVendor(vendor) === 'avm' || /fritz/i.test(text);
  // AVM prefixes the version with a hardware number of three digits
  // ("154.07.57" on a FRITZ!Box 7590): FRITZ!OS 7.57.
  if (avm && /^\d{3}\.\d{2}\.\d{2}$/.test(m[1])) {
    parts = parts.slice(1);
  }
  return { raw: text, parts, extra };
}

function cmpArrays(a, b) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

// -1 when a is older than b, 0 when equal, 1 when newer, null when either
// cannot be parsed. Build numbers and suffixes only count when both
// versions have them.
function compareVersions(a, b, vendor) {
  const pa = typeof a === 'object' && a ? a : parseVersion(a, vendor);
  const pb = typeof b === 'object' && b ? b : parseVersion(b, vendor);
  if (!pa || !pb) return null;
  const main = cmpArrays(pa.parts, pb.parts);
  if (main !== 0) return main;
  if (pa.extra.length && pb.extra.length) return cmpArrays(pa.extra, pb.extra);
  return 0;
}

// Rows of data/firmware.json for a device description ("AVM FRITZ!Box 7590",
// optionally with a hardware version). Prefers the requested region, then
// rows without a region restriction.
function latestRows(rows, query, { region } = {}) {
  const { matches, hwVersion } = findDevice(rows, query);
  let found = matches.map((m) => m.row);
  if (hwVersion) {
    const exact = matches.filter((m) => m.hw === true).map((m) => m.row);
    if (exact.length) found = exact;
  }
  if (region && found.length > 1) {
    const local = found.filter((r) => r.region === String(region).toUpperCase());
    if (local.length) found = local;
  }
  return { rows: found, hwVersion };
}

// Compare an installed version with the latest published one.
// `latest` is a list of candidate rows (several when the hardware version or
// the market is not known). Returns
//   { installed, latest, latest_release_date, vendor, source_url, upToDate, behind, note }
// upToDate is true or false only when the latest version is known without
// ambiguity and both versions can be read; otherwise null.
function checkFirmware(installed, latest, { lab = false, oem = null } = {}) {
  const rows = (latest || []).filter(Boolean);
  const out = {
    installed: installed == null || installed === '' ? null : String(installed),
    latest: null,
    latest_release_date: null,
    vendor: rows[0] ? rows[0].vendor : null,
    source_url: null,
    upToDate: null,
    behind: null,
    note: null,
  };
  const notes = [];
  if (lab) notes.push('a lab (beta) version is installed');
  if (oem && !/^avm$/i.test(oem)) {
    notes.push(`firmware branded for "${oem}" (an internet provider box): updates may come from the provider, not from the manufacturer`);
  }

  if (!rows.length) {
    out.behind = 'latest version not known: the manufacturer\'s latest firmware for this model is not in the dataset';
    out.note = notes.join('; ') || null;
    return out;
  }
  // Several candidates with different latest versions: cannot decide.
  const distinct = [...new Set(rows.map((r) => r.latest_version))];
  if (distinct.length > 1) {
    out.behind = `latest version depends on the hardware version or market (${rows
      .map((r) => `${r.hw_version || 'first version'}${r.region ? ` ${r.region}` : ''}: ${r.latest_version}`)
      .join('; ')}): add the hardware version from the label`;
    out.note = notes.join('; ') || null;
    return out;
  }
  const row = rows[0];
  out.latest = row.latest_version;
  out.latest_release_date = row.release_date || null;
  out.source_url = row.source_url;

  if (!out.installed) {
    out.behind = 'installed version not known';
  } else {
    const c = compareVersions(out.installed, row.latest_version, row.vendor);
    if (c === null) {
      out.behind = `installed version "${out.installed}" could not be compared`;
    } else if (c < 0) {
      out.upToDate = false;
      out.behind = `an update is available: installed ${out.installed} is older than ${row.latest_version}` +
        (row.release_date ? `, published ${row.release_date}` : '');
    } else if (c === 0) {
      out.upToDate = true;
    } else {
      out.upToDate = true;
      notes.push('the installed version is newer than the latest one recorded (a beta version, or the dataset is behind)');
    }
  }
  out.note = notes.join('; ') || null;
  return out;
}

// One plain sentence for the terminal.
function describeFirmware(f) {
  const latest = f.latest
    ? `latest published by ${f.vendor || 'the manufacturer'}: ${f.latest}${f.latest_release_date ? ` (${f.latest_release_date})` : ''}`
    : null;
  const installed = f.installed ? `installed: ${f.installed}` : 'installed: not known';
  let verdict;
  if (f.upToDate === true) verdict = 'up to date';
  else if (f.upToDate === false) verdict = 'an update is available';
  else verdict = f.behind || 'cannot tell';
  const head = [latest, installed].filter(Boolean).join('; ');
  return `${head}: ${verdict}${f.note ? ` (${f.note})` : ''}`;
}

module.exports = {
  DATA_FILE,
  loadFirmware,
  parseVersion,
  compareVersions,
  latestRows,
  checkFirmware,
  describeFirmware,
};
