#!/usr/bin/env node
'use strict';

// Refresh the vendor lists that are published as complete, machine-readable
// tables, so they can be mirrored without reading pages by hand:
//
//   node scripts/update-vendor-lists.js [qnap] [linksys] [watchguard] [meraki] [sonicwall] [brother] [epson]
//
//   - QNAP: the JSON feed behind https://www.qnap.com/en/product/status
//     ("Technical Support and Security Updates" column), NAS, routers and
//     switches. Writes raw/qnap-status.json.
//   - Linksys: the table behind https://www.linksys.com/pages/linksys-product-end-of-life,
//     shipped in the site's productTable.js. One row per model, hardware
//     version and market, with the earliest "End of Support" date of its
//     SKUs. Writes raw/linksys-eol.json.
//   - WatchGuard: the End of Life Policy page (Firebox, XTM, access points;
//     "End of Life (EOL)" column). Writes raw/watchguard-eol.json.
//   - Meraki: the "End-of-Life (EOL) Products and Dates" page (MR, MS, MX, Z,
//     MG, MV, MT hardware; "End-of-Support Date"). Accessories, licences and
//     Meraki Go (listed from another page) are left out. Writes raw/meraki-eol.json.
//   - SonicWall: the product life cycle tables (TZ, NSA, NSsp, SMA, SonicWave;
//     "End Of Support"). Writes raw/sonicwall-eol.json.
//   - Brother: the "Software Security Updates Guarantee" PDFs (printers and
//     scanners, label and mobile printers; Europe and Australia). Models in
//     the "2008-1-1 ~ 2025-12-31" block are dated 31 December 2025, the latest
//     possible end. Needs pdftotext (poppler-utils). Writes raw/brother-eol.json.
//   - Epson: the Epson Australia security support periods PDF (minimum dates).
//     Needs pdftotext. Writes raw/epson-au.json.
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


// ------------------------------------------------- shared table helpers

const MONTH_NAMES = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** "01 Mar 2027", "Mar 28, 2030", "July 26 2027", "2026-08-01" -> ISO date, or null. */
function anyDate(s) {
  const t = String(s).replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return t;
  const mon = (w) => MONTHS[w.slice(0, 3).toLowerCase()] || MONTH_NAMES[w.toLowerCase()];
  m = t.match(/^(\d{1,2}) ([A-Za-z]+) (\d{4})$/);
  if (m && mon(m[2])) return iso(m[3], mon(m[2]), m[1]);
  m = t.match(/^([A-Za-z]+) (\d{1,2}) (\d{4})$/);
  if (m && mon(m[1])) return iso(m[3], mon(m[1]), m[2]);
  return null;
}

/** Rows of every HTML table: arrays of cell texts (notes in <em>/<i>/<small> dropped). */
function htmlTableRows(html) {
  const rows = [];
  for (const tr of String(html).matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) =>
      cellText(c[1].replace(/<(em|i|small|sup)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>/gi, ' ').replace(/&nbsp;|&#160;|\u00a0/g, ' ')).replace(/&#39;|&rsquo;/g, "'"));
    if (cells.length) rows.push(cells);
  }
  return rows;
}

const row = (o) => ({ hw_version: null, end_is_minimum: false, source_date: null, ...o });

// ---------------------------------------------------------- WatchGuard

const WATCHGUARD_PAGE = 'https://www.watchguard.com/wgrd-trust-center/end-of-life-policy';

/** Firebox, XTM and access point rows of the WatchGuard End of Life Policy page. */
function watchguardRows(html) {
  const out = [];
  for (const cells of htmlTableRows(html)) {
    if (cells.length < 3) continue;
    let name = cells[0].replace(/\s+/g, ' ').trim();
    const eol = anyDate(cells[2].replace(/\*/g, ''));
    if (!eol || !anyDate(cells[1])) continue;
    name = name.replace(/^WatchGuard (AP\d)/, '$1');
    if (!/^(Firebox (T|M)\d|Firebox X (Peak|Core|Edge) |Firebox SOHO 6|XTM \d|AP\d)/.test(name)) continue;
    if (/Series|Non-RP/.test(name)) continue;
    out.push(row({
      vendor: 'WatchGuard', model: name, category: name.startsWith('AP') ? 'other' : 'router',
      support_end: eol, support_end_raw: `End of Life (EOL): ${cells[2].replace(/\*/g, '').trim()}`,
      status_source: 'vendor_eol_page', source_url: WATCHGUARD_PAGE,
      source_title: 'WatchGuard End of Life Policy: product life cycle milestones', region: 'global',
    }));
  }
  return dedupe(out);
}

// -------------------------------------------------------------- Meraki

const MERAKI_PAGE = 'https://documentation.meraki.com/Platform_Management/Product_Information/End-of-Life_Notices/Meraki_End-of-Life_(EOL)_Products_and_Dates';
const MERAKI_CATEGORY = { MS: 'switch', MR: 'other', MX: 'router', Z: 'router', MG: 'modem', MV: 'camera', MT: 'iot', MC: 'other' };

/** Meraki hardware rows ("End-of-Support Date"); accessories, licences and Meraki Go left out. */
function merakiRows(html) {
  const out = [];
  for (const cells of htmlTableRows(html)) {
    if (cells.length < 4) continue;
    const end = anyDate(cells[3]);
    if (!end) continue;
    // "Z1-HW (US, UK, EU, AU)": the market list is not part of the name.
    const product = cells[0].replace(/\s+/g, ' ').replace(/\s*\((?:[A-Z]{2}, )*[A-Z]{2}\)$/, '').trim();
    // Antennas, mounts, power supplies and other accessories, even when they name the access points they fit.
    if (/^(MA-|AC-|ANT|GA-|LIC-)|\(For |power supplies|Module/i.test(product)) continue;
    // "MR36, MR36H, MR44, MR46, MR46E and Accessories", "MX64-HW, MX64W-HW", "MS210 Series".
    const names = /Series$|^MV Gen \d Cameras$/.test(product) ? [product.replace(/(\S)Series$/, '$1 Series').replace(/  +/g, ' ')]
      : product.replace(/ and Accessories$/i, '').split(/,\s*/).map((n) => n.trim());
    for (let n of names) {
      // Regional variants (-NA, -WW) share the model page; where their dates
      // differ, the build keeps the earlier one.
      n = n.replace(/-HW(?=$|-)/, '').replace(/-(NA|WW)$/, '');
      const prefix = (n.match(/^(MS|MR|MX|MG|MV|MT|MC|Z)(\d| Gen)/) || [])[1];
      if (!prefix) continue;
      out.push(row({
        vendor: 'Cisco', model: `Meraki ${n}`, category: MERAKI_CATEGORY[prefix],
        support_end: end, support_end_raw: `End-of-Support Date: ${cells[3]}`,
        status_source: 'vendor_eol_page', source_url: MERAKI_PAGE,
        source_title: 'Meraki End-of-Life (EOL) Products and Dates', region: 'global',
      }));
    }
  }
  return dedupe(out);
}

// ----------------------------------------------------------- SonicWall

const SONICWALL_BASE = 'https://www.sonicwall.com/support/product-lifecycle-tables/';
const SONICWALL_PAGES = [
  { path: 'tz-series/hardware', series: 'TZ Series', category: 'router', name: (m) => (/^TZ/.test(m) ? m : `TZ ${m.replace(/^SOHOW$/, 'SOHO W')}`) },
  { path: 'nsa-series/hardware', series: 'NSA Series', category: 'router', name: (m) => (/^NS/i.test(m) ? m : (/^\d650$|^9[246]50$/.test(m) ? `NSa ${m}` : `NSA ${m}`)) },
  { path: 'nssp-series/hardware', series: 'NSsp Series', category: 'router', name: (m) => m },
  { path: 'secure-mobile-access-100-series/hardware', series: 'Secure Mobile Access 100 Series', category: 'other', name: (m) => m },
  { path: 'sonicwave-series/hardware', series: 'SonicWave Series', category: 'other', name: (m) => (/^SonicWave/.test(m) ? m : `SonicWave ${m}`) },
];

/** Rows of one SonicWall life cycle table: Model | LOD | ARM | LRM | 1 Year LOD | End Of Support. */
function sonicwallRows(html, page) {
  const out = [];
  for (const cells of htmlTableRows(html)) {
    if (cells.length < 6) continue;
    const eos = anyDate(cells[5]);
    if (!eos || !cells[0] || /^Model$/i.test(cells[0])) continue;
    const lrm = anyDate(cells[3]);
    out.push(row({
      vendor: 'SonicWall', model: page.name(cells[0].trim()), category: page.category,
      support_end: eos, support_end_raw: `End Of Support: ${eos}${lrm ? ` (Limited Retirement Mode, critical fixes only, from ${lrm})` : ''}`,
      status_source: 'vendor_lifecycle_page', source_url: SONICWALL_BASE + page.path,
      source_title: `SonicWall Product Life Cycle Tables: ${page.series} hardware`, region: 'global',
    }));
  }
  return out;
}

// ------------------------------------------------------------- Brother

const BROTHER_LISTS = [
  { url: 'https://support.brother.com/g/s/id/security/SupportDeviceList_PS_Europe.pdf', region: 'EU', title: 'printers and scanners (Europe)' },
  { url: 'https://support.brother.com/g/s/id/security/SupportDeviceList_PS_Australia.pdf', region: 'AU', title: 'printers and scanners (Australia)' },
  { url: 'https://support.brother.com/g/s/es/security/SupportDeviceList_LM_Europe.pdf', region: 'EU', title: 'label and mobile printers (Europe)' },
  { url: 'https://support.brother.com/g/s/es/security/SupportDeviceList_LM_Australia.pdf', region: 'AU', title: 'label and mobile printers (Australia)' },
];

/** Rows from the text of a Brother list: a date line, then the models it applies to. */
function brotherRows(text, list) {
  const out = [];
  let current = null;
  const tokens = String(text).replace(/(\d{4}-\d{1,2}-\d{1,2})\s*~\s*(\d{4}-\d{1,2}-\d{1,2})/g, ' PAST:$2 ').split(/\s+/);
  for (const t of tokens) {
    let m = t.match(/^PAST:(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) { current = { end: iso(m[1], m[2], m[3]), raw: `Software support discontinued in the period 2008-1-1 ~ ${m[1]}-${m[2]}-${m[3]}` }; continue; }
    m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) { current = { end: iso(m[1], m[2], m[3]), raw: `Software support (security fixes) discontinued as of ${t}` }; continue; }
    if (!current || !/^[A-Z]{2,4}-[A-Z]*\d[A-Z0-9-]*$/.test(t)) continue;
    out.push(row({
      vendor: 'Brother', model: t, category: 'other', support_end: current.end, support_end_raw: current.raw,
      status_source: 'vendor_lifecycle_page', source_url: list.url,
      source_title: `Brother Software Security Updates Guarantee: ${list.title}`, region: list.region,
    }));
  }
  return dedupe(out);
}

// --------------------------------------------------------------- Epson

const EPSON_PDF = 'https://www.epson.com.au/company/Epson-Support-Periods.pdf';

/** Rows from the text of the Epson Australia list: "<product> <d/mm/yyyy>" per line. */
function epsonRows(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const m = line.trim().match(/^([A-Z][A-Za-z0-9./() -]*?)\s+(\d{1,2})\/(\d{2})\/(\d{4})$/);
    if (!m) continue;
    const model = m[1].replace(/\s*\(?Derivative\)?/, '').replace(/[/ ]EAL$/, '').trim();
    if (!/\d/.test(model)) continue;
    out.push(row({
      vendor: 'Epson', model, category: 'other', support_end: iso(m[4], m[3], m[2]), end_is_minimum: true,
      support_end_raw: `${m[1].trim()}: security update end date ${m[2]}/${m[3]}/${m[4]} (minimum support period)`,
      status_source: 'vendor_lifecycle_page', source_url: EPSON_PDF,
      source_title: 'Epson Australia Security Support Periods', region: 'AU',
    }));
  }
  return dedupe(out);
}

/** One row per model and date (lists repeat some lines). */
function dedupe(rows) {
  const seen = new Set();
  return rows.filter((r) => {
    const k = `${r.model}|${r.support_end}|${r.source_url}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---------------------------------------------------------------- main

async function get(url, as = 'text') {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  if (as === 'json') return res.json();
  if (as === 'buffer') return Buffer.from(await res.arrayBuffer());
  return res.text();
}

/** Text of a PDF, through pdftotext (poppler-utils). */
async function pdfText(url) {
  const { execFileSync } = require('node:child_process');
  const os = require('node:os');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lastpatch-')), 'doc.pdf');
  fs.writeFileSync(file, await get(url, 'buffer'));
  return execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' });
}

/** Refuse a list that came back much smaller than expected (format change). */
function atLeast(rows, n, name) {
  if (rows.length < n) throw new Error(`${name}: only ${rows.length} rows parsed, the page format may have changed`);
  return rows;
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
  const jobs = {
    watchguard: async () => write('watchguard-eol.json', atLeast(watchguardRows(await get(WATCHGUARD_PAGE)), 80, 'WatchGuard')),
    meraki: async () => write('meraki-eol.json', atLeast(merakiRows(await get(MERAKI_PAGE)), 60, 'Meraki')),
    sonicwall: async () => {
      const rows = [];
      for (const page of SONICWALL_PAGES) rows.push(...sonicwallRows(await get(SONICWALL_BASE + page.path), page));
      write('sonicwall-eol.json', atLeast(rows, 50, 'SonicWall'));
    },
    brother: async () => {
      const rows = [];
      for (const list of BROTHER_LISTS) rows.push(...atLeast(brotherRows(await pdfText(list.url), list), 10, `Brother ${list.title}`));
      write('brother-eol.json', rows);
    },
    epson: async () => write('epson-au.json', atLeast(epsonRows(await pdfText(EPSON_PDF)), 150, 'Epson')),
  };
  for (const [name, job] of Object.entries(jobs)) {
    if (!want(name)) continue;
    try { await job(); } catch (e) { failed++; console.error(`${name}: ${e.message}`); }
  }
  process.exitCode = failed ? 1 : 0;
}

if (require.main === module) main();

module.exports = { qnapRows, linksysTable, linksysRows, linksysCategory, linksysDate, anyDate, htmlTableRows, watchguardRows, merakiRows, sonicwallRows, SONICWALL_PAGES, brotherRows, epsonRows };
