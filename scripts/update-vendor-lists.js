#!/usr/bin/env node
'use strict';

// Refresh the vendor lists that are published as complete, machine-readable
// tables, so they can be mirrored without reading pages by hand:
//
//   node scripts/update-vendor-lists.js [qnap] [linksys]
//
//   - QNAP: the JSON feed behind https://www.qnap.com/en/product/status
//     ("Technical Support and Security Updates" column), NAS, routers and
//     switches. Writes raw/qnap-status.json.
//   - Linksys: the table behind https://www.linksys.com/pages/linksys-product-end-of-life,
//     shipped in the site's productTable.js. One row per model, hardware
//     version and market, with the earliest "End of Support" date of its
//     SKUs. Writes raw/linksys-eol.json.
//
// Only rows with an end date, or marked end-of-life by the vendor, are kept.
// A list that cannot be fetched is left as it was. Run scripts/build.js
// afterwards.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const UA = 'lastpatch-vendor-lists (+https://github.com/Enigmacker/lastpatch)';
const today = () => new Date().toISOString().slice(0, 10);

const lastDayOfMonth = (y, m) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

// ---------------------------------------------------------------- QNAP

const QNAP_PAGE = 'https://www.qnap.com/en/product/status';
const QNAP_API = 'https://www.qnap.com/api/v1/product/status?locale=en';
const QNAP_LINES = { 1: 'nas', 5: 'switch', 16: 'router' };

/** Rows for the dataset from the QNAP product status feed. */
function qnapRows(feed, retrieved = today()) {
  const list = feed?.results?.modelList || [];
  const rows = [];
  for (const m of list) {
    const category = QNAP_LINES[m.product_line_id];
    if (!category) continue;
    const value = String(m.eol_detail?.technical_support_and_security_updates || '').trim();
    let end = null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) end = value;
    else if (/^\d{4}-\d{2}$/.test(value)) end = lastDayOfMonth(Number(value.slice(0, 4)), Number(value.slice(5, 7)));
    else if (value !== 'EOL') continue; // Active, Full, N/A, per-OS dates: no single end date
    rows.push({
      vendor: 'QNAP',
      model: m.display_name || m.name,
      hw_version: null,
      category,
      support_end: end,
      support_end_raw: `Technical Support and Security Updates: ${value}`,
      end_is_minimum: false,
      status_source: 'vendor_lifecycle_page',
      source_url: QNAP_PAGE,
      source_title: 'QNAP Product Support Status (Hardware)',
      source_date: retrieved,
      region: 'global',
    });
  }
  return rows.sort((a, b) => a.model.localeCompare(b.model));
}

// ------------------------------------------------------------- Linksys

const LINKSYS_PAGE = 'https://www.linksys.com/pages/linksys-product-end-of-life';
const LINKSYS_TABLE = 'https://www.linksys.com/cdn/shop/t/6/assets/productTable.js';

const LINKSYS_REGIONS = {
  USA: 'US',
  'USA and Canada': 'US',
  Canada: 'CA',
  UK: 'UK',
  Europe: 'EU',
  'Europe, UK, Middle East and Africa': 'EMEA',
  'Europe, UK and Middle East': 'EMEA',
  'UK and Middle East': 'EMEA',
  'Middle East': 'EMEA',
  Asia: 'APAC',
  'Australia and New Zealand': 'APAC',
  'Hong Kong': 'HK',
  'Latin America and South America': 'LATAM',
  LATAM: 'LATAM',
};

/** Device type from Linksys's own product description; null for accessories. */
function linksysCategory(description) {
  const d = description.toUpperCase();
  if (/MESH|VELOP|NODE/.test(d)) return 'mesh';
  if (/EXTENDER|RANGE/.test(d)) return 'repeater';
  if (/MODEM/.test(d)) return 'modem';
  if (/ROUTER|GATEWAY/.test(d)) return 'router';
  if (/SWITCH/.test(d)) return 'switch';
  if (/ACCESS POINT/.test(d)) return 'other';
  if (/CAMERA/.test(d)) return 'camera';
  return null;
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function linksysDate(s) {
  const m = String(s).match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

const cellText = (html) => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

/** Rows of the Linksys table: [sku, description, model, region, phase, eol, eos]. */
function linksysTable(source) {
  const rows = [];
  for (const tr of String(source).matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const cells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => cellText(c[1]));
    if (cells.length >= 7) rows.push(cells.slice(0, 7));
  }
  return rows;
}

/** One dataset row per model, hardware version and market. */
function linksysRows(table, retrieved = today()) {
  const groups = new Map();
  for (const [sku, description, model, regionName, phase, eol, eos] of table) {
    const category = linksysCategory(description);
    const region = LINKSYS_REGIONS[regionName];
    const end = linksysDate(eos);
    if (!category || !region || !end || !model) continue;
    // "EA7500V3-ME" is hardware version 3 of the EA7500.
    const hw = (sku.toUpperCase().match(new RegExp(`^${model.toUpperCase().replace(/[^A-Z0-9]/g, '')}V(\\d+)`)) || [])[1];
    const key = `${model}|${hw || ''}|${region}`;
    const g = groups.get(key) || { model, hw: hw ? `V${hw}` : null, region, category, end, skus: [], eol: linksysDate(eol) };
    // Several SKUs of one model in one market: the earliest end applies to
    // at least one of them, so it is the safe date to show.
    if (end < g.end) g.end = end;
    g.skus.push(sku);
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => ({
      vendor: 'Linksys',
      model: g.model,
      hw_version: g.hw,
      category: g.category,
      support_end: g.end,
      support_end_raw: `End of Support Date (earliest of SKUs ${g.skus.join(', ')}): ${g.end}${g.eol ? `; End of Life Date: ${g.eol}` : ''}`,
      end_is_minimum: false,
      status_source: 'vendor_eol_page',
      source_url: LINKSYS_PAGE,
      source_title: 'Linksys Product End of Life',
      source_date: retrieved,
      region: g.region,
    }))
    .sort((a, b) => `${a.model}|${a.region}`.localeCompare(`${b.model}|${b.region}`));
}

// ---------------------------------------------------------------- main

async function get(url, as = 'text') {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return as === 'json' ? res.json() : res.text();
}

function write(file, rows) {
  const target = path.join(ROOT, 'raw', file);
  const next = `${JSON.stringify(rows, null, 1)}\n`;
  // source_date changes every run: compare without it.
  const strip = (s) => s.replace(/"source_date": "[^"]*"/g, '');
  let prev = '';
  try { prev = fs.readFileSync(target, 'utf8'); } catch { /* new file */ }
  if (strip(prev) === strip(next)) return console.log(`${file}: unchanged (${rows.length} rows)`);
  fs.writeFileSync(target, next);
  console.log(`${file}: ${rows.length} rows written`);
}

async function main() {
  const which = process.argv.slice(2);
  const want = (name) => !which.length || which.includes(name);
  let failed = 0;
  if (want('qnap')) {
    try { write('qnap-status.json', qnapRows(await get(QNAP_API, 'json'))); } catch (e) { failed++; console.error(`QNAP: ${e.message}`); }
  }
  if (want('linksys')) {
    try {
      // The table file sits in the theme folder; find its current address
      // on the page, falling back to the known one.
      let url = LINKSYS_TABLE;
      try {
        const page = await get(LINKSYS_PAGE);
        const m = page.match(/(?:https:)?\/\/[^"'\s]*\/productTable\.js[^"'\s]*/);
        if (m) url = m[0].startsWith('//') ? `https:${m[0]}` : m[0];
      } catch { /* use the known address */ }
      const rows = linksysRows(linksysTable(await get(url)));
      if (rows.length < 100) throw new Error(`only ${rows.length} rows parsed, table format may have changed`);
      write('linksys-eol.json', rows);
    } catch (e) { failed++; console.error(`Linksys: ${e.message}`); }
  }
  process.exitCode = failed ? 1 : 0;
}

if (require.main === module) main();

module.exports = { qnapRows, linksysTable, linksysRows, linksysCategory, linksysDate };
