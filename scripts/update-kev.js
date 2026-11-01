#!/usr/bin/env node
'use strict';

// Refresh data/kev.json from the CISA Known Exploited Vulnerabilities
// catalogue, keeping only the vendors covered by the dataset.
//
//   node scripts/update-kev.js            download from CISA
//   node scripts/update-kev.js file.json [origin-url]  use a local copy of the catalogue

const fs = require('node:fs');
const path = require('node:path');
const { canonicalVendor } = require('../src/match');

const OUT = path.join(__dirname, '..', 'data', 'kev.json');
const SOURCES = [
  'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json',
  'https://raw.githubusercontent.com/cisagov/kev-data/main/known_exploited_vulnerabilities.json',
];

async function download() {
  let lastError;
  for (const url of SOURCES) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60000), headers: { 'User-Agent': 'lastpatch' } });
      if (res.ok) return { url, catalog: await res.json() };
      lastError = new Error(`${url}: HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

function filter(catalog) {
  return (catalog.vulnerabilities || [])
    .filter((v) => canonicalVendor(v.vendorProject))
    .map((v) => ({
      cveID: v.cveID,
      vendorProject: v.vendorProject,
      product: v.product,
      vulnerabilityName: v.vulnerabilityName,
      dateAdded: v.dateAdded,
      shortDescription: v.shortDescription,
      requiredAction: v.requiredAction,
      knownRansomwareCampaignUse: v.knownRansomwareCampaignUse,
    }))
    .sort((a, b) => a.cveID.localeCompare(b.cveID));
}

async function main() {
  const local = process.argv[2];
  const { url, catalog } = local
    ? { url: process.argv[3] || `local file ${path.basename(local)}`, catalog: JSON.parse(fs.readFileSync(local, 'utf8')) }
    : await download();
  const vulnerabilities = filter(catalog);
  const out = {
    source: 'CISA Known Exploited Vulnerabilities Catalog',
    source_url: SOURCES[0],
    fetched_from: url,
    catalogVersion: catalog.catalogVersion || null,
    dateReleased: catalog.dateReleased || null,
    license: 'Public domain (U.S. Government work); see https://www.cisa.gov/known-exploited-vulnerabilities-catalog',
    vulnerabilities,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
  console.log(`${vulnerabilities.length} vulnerabilities kept out of ${(catalog.vulnerabilities || []).length} (catalog ${out.catalogVersion})`);
}

if (require.main === module) main().catch((err) => { console.error(err.message); process.exitCode = 1; });

module.exports = { filter };
