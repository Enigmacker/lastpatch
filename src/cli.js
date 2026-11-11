#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { findDevice, computeStatus, daysLeft, extractHwVersion } = require('./match');
const { collect, identify, label } = require('./discover');
const { updateOui } = require('./oui');
const kev = require('./kev');
const fw = require('./firmware');

const exploitsOf = kev.indexer();

const DATA_FILE = path.join(__dirname, '..', 'data', 'devices.json');

const USAGE = `lastpatch - is your device still getting security updates?

Usage:
  lastpatch check "<vendor> <model> [hw version]"   look up one device
  lastpatch check "<model>" --firmware <version>     also compare the installed firmware with the latest published
  lastpatch scan [--timeout <ms>] [--no-sweep]       find and check the devices on your LAN
  lastpatch update-oui                               refresh the IEEE MAC vendor registry (optional)
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
    if (a === '--json' || a === '--expired' || a === '--no-sweep') args[a.slice(2)] = true;
    else if (a.startsWith('--')) args[a.slice(2)] = argv[++i];
    else args._.push(a);
  }
  return args;
}

// How much the date can be trusted, in plain words.
function confidence(row, status) {
  if (row.support_end && !row.end_is_minimum) return 'official end date';
  if (row.support_end) return 'minimum guaranteed by the vendor (support may continue)';
  if (status === 'expired') return 'vendor states support has ended (no date given)';
  return 'no date published by the vendor';
}

function kevSummary(e) {
  return {
    cve: e.cveID,
    name: e.vulnerabilityName,
    description: e.shortDescription,
    added: e.dateAdded,
    ransomware: e.knownRansomwareCampaignUse === 'Known',
  };
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
    confidence: confidence(row, status),
    source_url: row.source_url,
    exploited: exploitsOf(row).map(kevSummary),
  };
}

function printExploited(list, status) {
  if (!list.length) return;
  console.log(`    ACTIVELY EXPLOITED: ${list.length} vulnerability(ies) in the CISA KEV catalogue`);
  for (const e of list) {
    console.log(`      ${e.cve}${e.ransomware ? ' (used by ransomware)' : ''}: ${e.description}`);
  }
  if (status === 'expired') {
    console.log('      This device gets no more fixes: replace it, or at least keep it off the Internet.');
  } else if (status === 'unknown') {
    console.log('      Check whether your device still receives updates (see the CISA note above); if not, replace it.');
  } else {
    console.log('      Install the latest firmware, and compare the hardware versions named above with the label under the device.');
  }
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
  console.log(`    basis  : ${r.confidence}`);
  console.log(`    source : ${r.source_url} [${r.region}]`);
  printExploited(r.exploited, r.status);
}

// Firmware block for a device: the installed version (given or read on the
// LAN) against the latest version the manufacturer publishes.
function firmwareBlock(query, installed, region, extra = {}) {
  const { rows } = fw.latestRows(fw.loadFirmware(), query, { region });
  return fw.checkFirmware(installed, rows, extra);
}

function printFirmware(f) {
  if (!f) return;
  const from = f.read_from ? ` [read from the device: ${f.read_from}]` : '';
  console.log(`    firmware: ${fw.describeFirmware(f)}${from}`);
  if (f.source_url) console.log(`              ${f.source_url}`);
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
    exploited_unlisted: matches.length ? [] : kev.forQuery(query).map(kevSummary),
    needs_hw_version:
      !hwVersion && matches.length > 1 && new Set(matches.map((m) => m.row.support_end)).size > 1,
    results: matches.map((m) => describe(m.row, warn)),
  };
}

function printLookup(res) {
  if (!res.found) {
    console.log(`  "${res.query}": not in the dataset yet.`);
    if (res.exploited_unlisted && res.exploited_unlisted.length) {
      printExploited(res.exploited_unlisted, 'unknown');
    }
    printFirmware(res.firmware);
    return;
  }
  res.results.forEach(printResult);
  printFirmware(res.firmware);
  if (res.needs_hw_version) {
    console.log('  Several hardware versions have different dates: check the label under the device (e.g. "Ver: 3.0").');
  }
}

// Installed firmware of a scanned host, compared with the latest published
// for the identified model (or the model named by the device itself).
function scanFirmware(r, matches, region) {
  const f = r.host.firmware;
  if (!f || !f.version) return null;
  const row = matches[0] && matches[0].row;
  const hw = r.hwVersion ? ` ${r.hwVersion}` : '';
  const query = row ? `${row.vendor} ${row.model}${hw}` : f.model ? `${r.host.macVendor || ''} ${f.model}`.trim() : null;
  const block = query
    ? firmwareBlock(query, f.version, region, { lab: f.lab, oem: f.oem })
    : fw.checkFirmware(f.version, [], { lab: f.lab, oem: f.oem });
  return { ...block, read_from: f.source };
}

function scanReport(identified, warn, region) {
  return identified.map((r) => {
    let matches = r.matches;
    if (region) {
      const local = matches.filter((m) => m.row.region === region.toUpperCase() || m.row.region === 'global');
      if (local.length) matches = local;
    }
    return {
      ip: r.host.ip,
      mac: r.host.mac,
      mac_vendor: r.host.macVendor,
      name: label(r.host) || null,
      identified_via: r.via,
      query: r.query,
      needs_hw_version: !r.hwVersion && new Set(matches.map((m) => m.row.hw_version)).size > 1 &&
        new Set(matches.map((m) => m.row.support_end)).size > 1,
      results: matches.map((m) => describe(m.row, warn)),
      exploited_unlisted: matches.length || !r.query ? [] : kev.forQuery(r.query).map(kevSummary),
      firmware: scanFirmware(r, matches, region),
      exposed: (r.host.exposed || []).map((m) => ({
        external_port: m.externalPort, protocol: m.protocol, internal_port: m.internalPort,
        description: m.description, remote_host: m.remoteHost || null,
      })),
    };
  });
}

function printExposure(list) {
  if (!list.length) return;
  console.log(`  REACHABLE FROM THE INTERNET (port forward opened on the router via UPnP):`);
  for (const m of list) {
    const desc = m.description ? ` "${m.description}"` : '';
    console.log(`    ${m.protocol} external port ${m.external_port} -> port ${m.internal_port}${desc}`);
  }
}

function printScan(report) {
  const known = report.filter((r) => r.results.length);
  const exposed = report.filter((r) => r.exposed.length);
  console.log(`${report.length} device(s) found on your network, ${known.length} identified in the dataset.`);
  if (exposed.length) console.log(`${exposed.length} device(s) reachable from the Internet through router port forwards.`);
  console.log('');
  for (const r of report) {
    const who = [r.mac_vendor, r.name].filter(Boolean).join(' - ') || 'unknown device';
    console.log(`${r.ip}  ${who}`);
    printExposure(r.exposed);
    if (r.results.length) {
      console.log(`  identified via ${r.identified_via}`);
      printLookup({ query: r.query, found: true, needs_hw_version: r.needs_hw_version, results: r.results });
      printFirmware(r.firmware);
    } else if (r.query) {
      console.log(`  model not found in the dataset (seen as "${r.query}")`);
      if (r.exploited_unlisted.length) printExploited(r.exploited_unlisted, 'unknown');
      printFirmware(r.firmware);
    } else {
      console.log('  model not announced: check it with "lastpatch check <vendor> <model>"');
      printFirmware(r.firmware);
    }
    console.log('');
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const warn = args.warn ? Number(args.warn) : 365;
  const cmd = args._[0];
  const devices = loadDevices();
  let anyExpired = false;

  if (cmd === 'check' && args._[1]) {
    const query = args._.slice(1).join(' ');
    const res = lookup(devices, query, warn, args.region);
    if ('firmware' in args) {
      if (!args.firmware || args.firmware === true) throw new Error('--firmware needs a version, e.g. --firmware 7.57');
      // Look the latest version up under the dataset's own model name when found.
      const best = res.results[0];
      const hw = extractHwVersion(query);
      const q = best ? `${best.vendor} ${best.model}${hw ? ` ${hw}` : ''}` : query;
      res.firmware = firmwareBlock(q, args.firmware, args.region);
    }
    anyExpired = res.results.some((r) => r.status === 'expired');
    if (args.json) console.log(JSON.stringify(res, null, 2));
    else printLookup(res);
  } else if (cmd === 'scan') {
    const hosts = await collect({ timeoutMs: Number(args.timeout) || 3000, sweep: !args['no-sweep'] });
    const report = scanReport(identify(hosts, devices), warn, args.region);
    anyExpired = report.some((r) => r.results.some((x) => x.status === 'expired'));
    if (args.json) console.log(JSON.stringify(report, null, 2));
    else printScan(report);
  } else if (cmd === 'update-oui') {
    const { file, entries } = await updateOui();
    console.log(`IEEE registry saved: ${entries} manufacturers (${file})`);
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

if (require.main === module) main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});

module.exports = { scanReport, firmwareBlock };
