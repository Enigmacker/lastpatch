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
  if (row.vendor === 'Ring') row.model = row.model.replace(/^Ring\s+/, '');

  // Netgear Australia: every date reads "11/01/2029", ambiguous between
  // 11 January and 1 November, and looks like a rolling minimum. Not used.
  if (row.vendor === 'Netgear' && row.region === 'AU' && /11\/01\/2029/.test(row.support_end_raw)) { dropped.push(row); continue; }

  // Synology RT1900ac: the life-cycle policy ends SRM 1.2 in June 2023, but
  // the product status page still lists security updates. Left out until
  // Synology's two pages agree.
  if (row.vendor === 'Synology' && /RT1900ac/i.test(row.model)) { dropped.push(row); continue; }

  // Arlo VMC4072: its UK statement names the model only as the pattern
  // "VMY4X7XY", so the date is not tied to this model explicitly.
  if (row.vendor === 'Arlo' && /VMC4072/.test(row.model)) { dropped.push(row); continue; }

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
