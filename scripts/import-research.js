#!/usr/bin/env node
'use strict';

// Imports rows collected from official vendor sources (one JSON array per
// research batch) into raw/, applying the cleanup rules decided on review:
//   node scripts/import-research.js <batch.json> <raw/name.json>
// Rules are vendor-specific and documented below; everything else is copied
// as is and validated later by scripts/build.js.

const fs = require('node:fs');

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: import-research.js <batch.json> <raw/name.json>');
  process.exit(1);
}
const rows = JSON.parse(fs.readFileSync(input, 'utf8'));

// Market suffixes in Linksys SKUs: "EA6100-CA" is the EA6100 sold in Canada.
const LINKSYS_MARKET = new Set(['CA', 'EU', 'UK', 'CN', 'HK', 'AU', 'KR', 'SG', 'JP', 'MX', 'ID', 'AH', 'AP', 'EK', 'ME', 'AR', 'EC', 'KE', 'JPN', 'TW', 'NZ', 'RU', 'BR', 'IN']);

const out = [];
const dropped = [];
for (const r of rows) {
  const row = { ...r };

  // Amazon help pages: cite the canonical help address (same node id) rather
  // than the survey host the page was read from.
  if (/digprjsurvey\.amazon\./.test(row.source_url)) {
    const host = /amazon\.co\.uk/.test(row.source_url) ? 'www.amazon.co.uk' : 'www.amazon.com';
    const node = (row.source_url.match(/node\/([A-Z0-9]+)/) || [])[1];
    if (node) row.source_url = `https://${host}/gp/help/customer/display.html?nodeId=${node}`;
  }

  // Ring: model names without the brand, as in the rest of the dataset.
  // Same for brands whose sources repeat the brand in the model name.
  if (['Ring', 'Netatmo', 'Nuki', 'Hive'].includes(row.vendor)) row.model = row.model.replace(new RegExp(`^${row.vendor}\\s+`), '');

  // Netgear Australia writes "11/01/2029" for an "earliest possible" end:
  // month first (an older copy of the same table showed "08/01/2029", so the
  // rolling date moves by months), i.e. 1 November 2029, a minimum.
  if (row.vendor === 'Netgear' && row.region === 'AU' && /11\/01\/2029/.test(row.support_end_raw)) row.end_is_minimum = true;

  // Synology RT1900ac: the life-cycle policy ends SRM 1.2 in June 2023, but
  // the product status page still lists security updates. Left out until
  // Synology's two pages agree.
  if (row.vendor === 'Synology' && /RT1900ac/i.test(row.model)) { dropped.push(row); continue; }

  // Arlo VMC4072: its UK statement names the model only as the pattern
  // "VMY4X7XY", so the date is not tied to this model explicitly.
  if (row.vendor === 'Arlo' && /VMC4072/.test(row.model)) { dropped.push(row); continue; }

  // Keenetic: security fixes are guaranteed until the end of the "Limited
  // updates" phase (at least 4 years after release). The "Support
  // discontinuation no earlier than" date, one year later by Keenetic's own
  // definition (5 years after launch), only says when updates may stop.
  if (row.vendor === 'Keenetic' && /^[A-Z][a-z]+ \d{4}$/.test(row.support_end_raw)) {
    const [month, year] = row.support_end_raw.split(' ');
    const limitedYear = Number(year) - 1;
    const d = new Date(Date.UTC(limitedYear, new Date(`${month} 1, 2000`).getMonth() + 1, 0));
    row.support_end = d.toISOString().slice(0, 10);
    row.support_end_raw = `Limited updates (security updates) until at least ${month} ${limitedYear}; support discontinuation no earlier than ${month} ${year}`;
    row.end_is_minimum = true;
  }

  // Nuki statements give "defined" and "extended minimum" support periods:
  // minimum guarantees, so a passed date means the promise ran out.
  if (row.vendor === 'Nuki') row.end_is_minimum = true;

  // Netgear consumer EOS list: one brand spelling for the whole dataset.
  if (row.vendor === 'NETGEAR') row.vendor = 'Netgear';
  // Standalone Orbi routers and satellites were given the latest date of
  // their series' kits, an inference rather than a Netgear value. Left out.
  if (row.vendor === 'Netgear' && /netgear\.com\/about\/eos/.test(row.source_url) && /^(RBR20|RBR50|RBR750|RBS40|RBS50)$/.test(row.model)) { dropped.push(row); continue; }
  // QNAP: only TS-253D was read twice; the other dates come from one run
  // that also returned unrelated models. Left out until checked in a browser.
  if (row.vendor === 'QNAP' && /qnap\.com\/en\/product\/status/.test(row.source_url) && row.model !== 'TS-253D') { dropped.push(row); continue; }

  // Tenda EOL Center: the bare date is the "End of service date" column.
  if (row.vendor === 'Tenda' && /^\d{4}-\d{2}-\d{2}$/.test(row.support_end_raw)) {
    row.support_end_raw = `End of service date: ${row.support_end_raw}`;
  }

  // Linksys: one row per SKU in the source; keep the base model when the
  // suffix only names a market, so each model has one page.
  if (row.vendor === 'Linksys') {
    const m = row.model.match(/^([A-Z0-9]+)-([A-Z]{2,3})$/);
    if (m && LINKSYS_MARKET.has(m[2])) {
      row.source_title = `${row.source_title || 'Linksys product end of life'} (SKU ${row.model})`;
      row.model = m[1];
    }
  }

  out.push(row);
}

fs.writeFileSync(output, `${JSON.stringify(out, null, 1)}\n`);
console.log(`${input}: ${out.length} rows written to ${output}, ${dropped.length} dropped`);
