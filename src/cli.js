#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { findDevice, computeStatus, daysLeft } = require('./match');
const { discover } = require('./discover');

const DATA_FILE = path.join(__dirname, '..', 'data', 'devices.json');

const USAGE = `lastpatch - is your device still getting security updates?

Usage:
  lastpatch check "<vendor> <model> [hw version]"   look up one device
  lastpatch scan [--timeout <ms>]                    discover devices on your LAN (UPnP)
  lastpatch list [--vendor <name>] [--expiring <days>] [--expired]
Options:
  --json        machine-readable output
  --warn <days> days before end of support to flag as "expiring" (default 365)
  --region <cc> prefer dates published for this market (e.g. UK, EU, SG); dates can differ by region

Exit codes: 0 ok, 1 usage/error, 2 at least one device is past end of support.`;

const LABELS = {
  expired: 'NO LONGER SUPPORTED',
  expiring: 'SUPPORT ENDING SOON',
  supported: 'supported',
  unknown: 'unknown',
};

function loadDevices() {
  const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  return raw.devices;
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json' || a === '--expired') args[a.slice(2)] = true;
    else if (a.startsWith('--')) args[a.slice(2)] = argv[++i];
    else args._.push(a);
  }
  return args;
}

function describe(row, warn) {
  const status = computeStatus(row, new Date(), warn);
  const left = daysLeft(row);
  return {
    vendor: row.vendor,
    model: row.model,
    hw_version: row.hw_version || null,
    status,
    support_end: row.support_end,
    support_end_raw: row.support_end_raw,
    end_is_minimum: !!row.end_is_minimum,
    days_left: left,
    region: row.region,
    source_url: row.source_url,
  };
}

function printResult(r) {
  const hw = r.hw_version ? ` (${r.hw_version})` : '';
  const end = r.support_end
    ? `${r.support_end}${r.end_is_minimum ? ' or later' : ''}`
    : r.support_end_raw || 'no date published';
  console.log(`  ${r.vendor} ${r.model}${hw}`);
  const note = r.status === 'expired' && r.end_is_minimum
    ? ' (guaranteed period is over; the vendor may still ship occasional fixes)'
    : '';
  console.log(`    status : ${LABELS[r.status]}${note}`);
  console.log(`    ends   : ${end}${r.days_left != null && r.days_left >= 0 ? ` (${r.days_left} days left)` : ''}`);
  console.log(`    source : ${r.source_url} [${r.region}]`);
}

function lookup(devices, query, warn, region) {
  let { matches, hwVersion } = findDevice(devices, query);
  if (region) {
    const local = matches.filter((m) => m.row.region === region.toUpperCase() || m.row.region === 'global');
    if (local.length) matches = local;
  }
  return {
    query,
    found: matches.length > 0,
    needs_hw_version:
      !hwVersion && matches.length > 1 && new Set(matches.map((m) => m.row.support_end)).size > 1,
    results: matches.map((m) => describe(m.row, warn)),
  };
}

function printLookup(res) {
  if (!res.found) {
    console.log(`  "${res.query}": not in the dataset yet.`);
    return;
  }
  res.results.forEach(printResult);
  if (res.needs_hw_version) {
    console.log('  Several hardware versions have different dates: check the label under the device (e.g. "Ver: 3.0").');
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const warn = args.warn ? Number(args.warn) : 365;
  const cmd = args._[0];
  const devices = loadDevices();
  let anyExpired = false;

  if (cmd === 'check' && args._[1]) {
    const res = lookup(devices, args._.slice(1).join(' '), warn, args.region);
    anyExpired = res.results.some((r) => r.status === 'expired');
    if (args.json) console.log(JSON.stringify(res, null, 2));
    else printLookup(res);
  } else if (cmd === 'scan') {
    const found = await discover({ timeoutMs: Number(args.timeout) || 3000 });
    const report = found.map((d) => {
      const query = [d.manufacturer, d.modelName, d.modelNumber].filter(Boolean).join(' ');
      return { device: d, ...lookup(devices, query, warn, args.region) };
    });
    anyExpired = report.some((r) => r.results.some((x) => x.status === 'expired'));
    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`${found.length} UPnP device(s) answered on your network.\n`);
      for (const r of report) {
        console.log(`${r.device.ip}  ${r.device.friendlyName || ''} [${r.query || 'no model info'}]`);
        printLookup(r);
        console.log('');
      }
      console.log('Devices with UPnP disabled do not appear here; check them with "lastpatch check".');
    }
  } else if (cmd === 'list') {
    let rows = devices.map((d) => describe(d, warn));
    if (args.vendor) rows = rows.filter((r) => r.vendor.toLowerCase().includes(args.vendor.toLowerCase()));
    if (args.expired) rows = rows.filter((r) => r.status === 'expired');
    if (args.expiring) {
      const d = Number(args.expiring);
      rows = rows.filter((r) => r.days_left != null && r.days_left >= 0 && r.days_left <= d);
    }
    if (args.json) console.log(JSON.stringify(rows, null, 2));
    else rows.forEach(printResult);
  } else {
    console.log(USAGE);
    process.exitCode = 1;
    return;
  }
  if (anyExpired) process.exitCode = 2;
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
