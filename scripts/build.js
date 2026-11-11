#!/usr/bin/env node
'use strict';

// Merge raw collected rows (raw/*.json) into data/devices.json.
// Rejects rows without a source URL or with malformed dates, removes
// duplicates, and reports what was dropped.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const RAW_DIR = path.join(ROOT, 'raw');
const OUT = path.join(ROOT, 'data', 'devices.json');
const RETRIEVED = process.argv[2] || new Date().toISOString().slice(0, 10);

const CATEGORIES = new Set(['router', 'mesh', 'repeater', 'modem', 'camera', 'doorbell', 'nas', 'switch', 'iot', 'other']);
const SOURCES = new Set(['psti', 'vendor_eol_page', 'vendor_lifecycle_page']);

function validDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Normalise obvious typos in hardware versions ("5" -> "V5", "VV5.20" -> "V5.20").
// Dates are never touched: support_end_raw keeps the source text.
function cleanHw(hw) {
  if (!hw) return null;
  return String(hw)
    .split(',')
    .map((v) => v.trim().replace(/^V+/i, 'V').replace(/^(\d)/, 'V$1'))
    .join(', ');
}

const rejected = [];
const conflicts = [];
const seen = new Map();

// Vendor lists mirrored in full by scripts/update-vendor-lists.js replace
// rows copied by hand from the same page.
const FULL_LISTS = ['qnap-status.json', 'linksys-eol.json'].filter((f) => fs.existsSync(path.join(RAW_DIR, f)));
const mirrored = new Set(
  FULL_LISTS.flatMap((f) => JSON.parse(fs.readFileSync(path.join(RAW_DIR, f), 'utf8')).map((r) => r.source_url)),
);
let superseded = 0;

for (const file of fs.readdirSync(RAW_DIR).filter((f) => f.endsWith('.json')).sort()) {
  const rows = JSON.parse(fs.readFileSync(path.join(RAW_DIR, file), 'utf8'));
  for (const r of rows) {
    if (r.notes !== undefined && !r.model) continue; // notes element
    if (!FULL_LISTS.includes(file) && mirrored.has(r.source_url)) { superseded++; continue; }
    const why = [];
    if (!r.vendor || !r.model) why.push('missing vendor/model');
    if (!r.source_url || !/^https?:\/\//.test(r.source_url)) why.push('missing source_url');
    if (r.support_end !== null && !validDate(r.support_end)) why.push(`bad date ${r.support_end}`);
    if (!r.support_end_raw) why.push('missing support_end_raw');
    if (why.length) { rejected.push({ file, model: r.model, why }); continue; }

    const row = {
      vendor: r.vendor.trim(),
      model: r.model.trim(),
      hw_version: cleanHw(r.hw_version),
      category: CATEGORIES.has(r.category) ? r.category : 'other',
      support_end: r.support_end,
      support_end_raw: String(r.support_end_raw).trim(),
      end_is_minimum: !!r.end_is_minimum,
      status_source: SOURCES.has(r.status_source) ? r.status_source : 'vendor_eol_page',
      source_url: r.source_url.trim(),
      source_title: r.source_title || null,
      source_date: r.source_date || null,
      region: /^(global|EU|EMEA|APAC|LATAM|[A-Z]{2})$/.test(r.region || '') ? r.region : 'global',
      retrieved: RETRIEVED,
    };
    const key = [row.vendor, row.model, row.hw_version, row.region].join('|').toLowerCase();
    const prev = seen.get(key);
    if (!prev) { seen.set(key, row); continue; }
    // On duplicates keep the most recent source document; when the same
    // document gives two dates, keep the earlier one (the cautious choice).
    const newer = String(row.source_date || '') > String(prev.source_date || '');
    const sameDoc = String(row.source_date || '') === String(prev.source_date || '');
    if (sameDoc && row.support_end_raw !== prev.support_end_raw) {
      conflicts.push(`${row.vendor} ${row.model} ${row.hw_version || ''}: "${prev.support_end_raw}" vs "${row.support_end_raw}"`);
      if (row.support_end && (!prev.support_end || row.support_end < prev.support_end)) seen.set(key, row);
    } else if (newer) {
      seen.set(key, row);
    }
  }
}

const devices = [...seen.values()].sort((a, b) =>
  a.vendor.localeCompare(b.vendor) || a.model.localeCompare(b.model, undefined, { numeric: true }) ||
  String(a.hw_version).localeCompare(String(b.hw_version))
);

fs.writeFileSync(OUT, JSON.stringify({
  version: '0.4.4',
  generated: RETRIEVED,
  license: 'ODbL-1.0',
  devices,
}, null, 2) + '\n');

console.log(`${devices.length} rows written to data/devices.json`);
if (superseded) console.log(`${superseded} hand-copied rows replaced by full vendor lists (${FULL_LISTS.join(', ')})`);
if (conflicts.length) {
  console.log(`${conflicts.length} conflicting dates in a source (earlier date kept):`);
  for (const c of conflicts) console.log(`  ${c}`);
}
if (rejected.length) {
  console.log(`${rejected.length} rows rejected:`);
  for (const r of rejected) console.log(`  ${r.file} ${r.model}: ${r.why.join(', ')}`);
}
