#!/usr/bin/env node
'use strict';

// Regenerate data/oui.tsv (MAC prefix -> organisation) from the IEEE
// MA-L, MA-M and MA-S registries as packaged by the "oui-data" npm package (BSD-2-Clause).
// Usage: npm install --no-save oui-data && node scripts/update-oui.js

const fs = require('node:fs');
const path = require('node:path');

const registry = require('oui-data');
const lines = Object.entries(registry)
  .filter(([prefix]) => /^[0-9A-F]{6}([0-9A-F]|[0-9A-F]{3})?$/i.test(prefix))
  .map(([prefix, org]) => `${prefix.toUpperCase()}\t${String(org).split('\n')[0].trim()}`)
  .sort();

const out = path.join(__dirname, '..', 'data', 'oui.tsv');
fs.writeFileSync(out, lines.join('\n') + '\n');
console.log(`${lines.length} prefixes written to data/oui.tsv`);
