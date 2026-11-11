'use strict';

// Installed vs latest firmware: version parsing and comparison, the parsers
// of the files devices publish on the LAN, and the AVM download server
// parsers. Fixtures only: nothing here sends a packet.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const fw = require('../src/firmware');
const probe = require('../src/fwprobe');
const { parseDescription } = require('../src/ssdp');
const upd = require('../scripts/update-firmware');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', 'firmware', name), 'utf8');

test('version parsing: AVM formats', () => {
  assert.deepStrictEqual(fw.parseVersion('154.07.57', 'AVM').parts, [7, 57]);
  assert.deepStrictEqual(fw.parseVersion('07.57', 'AVM').parts, [7, 57]);
  assert.deepStrictEqual(fw.parseVersion('7.57', 'AVM').parts, [7, 57]);
  assert.deepStrictEqual(fw.parseVersion('FRITZ!OS 8.03').parts, [8, 3]);
  assert.deepStrictEqual(fw.parseVersion('08.03', 'AVM').parts, [8, 3]);
  const lab = fw.parseVersion('256.08.20-118013', 'AVM');
  assert.deepStrictEqual(lab.parts, [8, 20]);
  assert.deepStrictEqual(lab.extra, [118013]);
  // Without the AVM context, three-part versions are kept whole.
  assert.deepStrictEqual(fw.parseVersion('154.07.57').parts, [154, 7, 57]);
});

test('version parsing: generic vendor strings', () => {
  const tp = fw.parseVersion('V1.1.0 Build 20230512 rel.123');
  assert.deepStrictEqual(tp.parts, [1, 1, 0]);
  assert.deepStrictEqual(tp.extra, [20230512, 123]);
  const ng = fw.parseVersion('V1.0.4.126_10.1.12');
  assert.deepStrictEqual(ng.parts, [1, 0, 4, 126]);
  assert.deepStrictEqual(ng.extra, [10, 1, 12]);
  assert.strictEqual(fw.parseVersion(''), null);
  assert.strictEqual(fw.parseVersion('unknown'), null);
  assert.strictEqual(fw.parseVersion(null), null);
});

test('version comparison', () => {
  assert.strictEqual(fw.compareVersions('154.07.57', '8.51', 'AVM'), -1);
  assert.strictEqual(fw.compareVersions('154.08.51', '8.51', 'AVM'), 0);
  assert.strictEqual(fw.compareVersions('08.03', '8.3', 'AVM'), 0);
  assert.strictEqual(fw.compareVersions('8.03', '7.62', 'AVM'), 1);
  assert.strictEqual(fw.compareVersions('7.62', '7.57', 'AVM'), 1);
  assert.strictEqual(fw.compareVersions('1.0.4.126_10.1.12', '1.0.4.130_10.1.14'), -1);
  assert.strictEqual(fw.compareVersions('V1.0.4.126', '1.0.4.126_10.1.12'), 0); // build only on one side
  assert.strictEqual(fw.compareVersions('1.2', '1.2.0'), 0);
  assert.strictEqual(fw.compareVersions('V1.1.0 Build 20230512 rel.123', 'V1.1.0 Build 20240101 rel.9'), -1);
  assert.strictEqual(fw.compareVersions('1.10.0', '1.9.9'), 1); // numeric, not text
  assert.strictEqual(fw.compareVersions('n/a', '1.0'), null);
});

const rows = [
  { vendor: 'AVM', model: 'FRITZ!Box 7590', hw_version: null, region: 'DE', latest_version: '8.51', release_date: '2026-11-09', source_url: 'https://download.avm.de/fritzbox/fritzbox-7590/deutschland/fritz.os/', retrieved: '2026-11-11' },
  { vendor: 'AVM', model: 'FRITZ!Box 7590 AX', hw_version: null, region: 'DE', latest_version: '8.51', release_date: null, source_url: 'https://download.avm.de/fritzbox/fritzbox-7590-ax/deutschland/fritz.os/', retrieved: '2026-11-11' },
  { vendor: 'AVM', model: 'FRITZ!Box 6820', hw_version: null, region: 'DE', latest_version: '7.57', release_date: null, source_url: 'https://x/1', retrieved: '2026-11-11' },
  { vendor: 'AVM', model: 'FRITZ!Box 6820', hw_version: 'V3', region: 'DE', latest_version: '8.20', release_date: null, source_url: 'https://x/3', retrieved: '2026-11-11' },
];

test('latest version lookup: model, hardware version', () => {
  assert.strictEqual(fw.latestRows(rows, 'AVM FRITZ!Box 7590').rows[0].model, 'FRITZ!Box 7590');
  assert.strictEqual(fw.latestRows(rows, 'Fritzbox 7590 AX').rows[0].model, 'FRITZ!Box 7590 AX');
  assert.strictEqual(fw.latestRows(rows, 'FRITZ!Box 6820').rows.length, 2);
  const v3 = fw.latestRows(rows, 'FRITZ!Box 6820 v3').rows;
  assert.deepStrictEqual(v3.map((r) => r.latest_version), ['8.20']);
  assert.strictEqual(fw.latestRows(rows, 'FRITZ!Box 7560').rows.length, 0);
});

test('check: an update is available', () => {
  const f = fw.checkFirmware('154.07.57', fw.latestRows(rows, 'FRITZ!Box 7590').rows);
  assert.strictEqual(f.upToDate, false);
  assert.strictEqual(f.latest, '8.51');
  assert.strictEqual(f.latest_release_date, '2026-11-09');
  assert.match(f.behind, /older than 8\.51, published 2026-11-09/);
  assert.strictEqual(fw.describeFirmware(f).split(':')[0], 'latest published by AVM');
  assert.match(fw.describeFirmware(f), /latest published by AVM: 8\.51 \(2026-11-09\); installed: 154\.07\.57: an update is available/);
});

test('check: up to date, and newer than recorded', () => {
  const same = fw.checkFirmware('08.51', fw.latestRows(rows, 'FRITZ!Box 7590 AX').rows);
  assert.strictEqual(same.upToDate, true);
  assert.strictEqual(same.behind, null);
  const newer = fw.checkFirmware('8.60', fw.latestRows(rows, 'FRITZ!Box 7590').rows);
  assert.strictEqual(newer.upToDate, true);
  assert.match(newer.note, /newer than the latest one recorded/);
});

test('check: never "up to date" when the latest version is unknown or ambiguous', () => {
  const unknown = fw.checkFirmware('7.29', []);
  assert.strictEqual(unknown.upToDate, null);
  assert.strictEqual(unknown.latest, null);
  assert.match(unknown.behind, /latest version not known/);
  assert.match(fw.describeFirmware(unknown), /installed: 7\.29: latest version not known/);

  const ambiguous = fw.checkFirmware('8.20', fw.latestRows(rows, 'FRITZ!Box 6820').rows);
  assert.strictEqual(ambiguous.upToDate, null);
  assert.match(ambiguous.behind, /hardware version/);

  const unreadable = fw.checkFirmware('beta', fw.latestRows(rows, 'FRITZ!Box 7590').rows);
  assert.strictEqual(unreadable.upToDate, null);
  const missing = fw.checkFirmware(null, fw.latestRows(rows, 'FRITZ!Box 7590').rows);
  assert.strictEqual(missing.upToDate, null);
});

test('check: lab versions and provider-branded boxes are flagged', () => {
  const f = fw.checkFirmware('256.08.20-118013', fw.latestRows(rows, 'FRITZ!Box 7590').rows, { lab: true, oem: '1und1' });
  assert.strictEqual(f.upToDate, false);
  assert.match(f.note, /lab \(beta\)/);
  assert.match(f.note, /internet provider/);
});

test('bundled firmware data is well formed', () => {
  const data = JSON.parse(fs.readFileSync(fw.DATA_FILE, 'utf8'));
  const devices = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'devices.json'), 'utf8')).devices;
  const models = new Set(devices.map((d) => `${d.vendor}|${d.model}`));
  const allowed = ['vendor', 'model', 'hw_version', 'region', 'latest_version', 'release_date', 'source_url', 'retrieved'];
  assert.ok(data.firmware.length >= 5);
  for (const r of data.firmware) {
    assert.deepStrictEqual(Object.keys(r).sort(), [...allowed].sort());
    assert.ok(models.has(`${r.vendor}|${r.model}`), `${r.model} is not a dataset model`);
    assert.ok(fw.parseVersion(r.latest_version, r.vendor), r.latest_version);
    assert.ok(r.release_date === null || /^\d{4}-\d{2}-\d{2}$/.test(r.release_date));
    assert.match(r.source_url, /^https:\/\/download\.avm\.de\//); // official sources only
  }
});

// LAN parsers

test('FRITZ!Box jason_boxinfo.xml', () => {
  const box = probe.parseJasonBoxinfo(fixture('jason_boxinfo.xml'));
  assert.deepStrictEqual(box, { model: 'FRITZ!Box 7590', version: '154.07.57', lab: false, oem: 'avm' });
  assert.ok(!('serial' in box));
  const lab = probe.parseJasonBoxinfo(fixture('jason_boxinfo_lab_oem.xml'));
  assert.strictEqual(lab.lab, true);
  assert.strictEqual(lab.oem, '1und1');
  assert.strictEqual(probe.parseJasonBoxinfo('<html>404</html>'), null);
});

test('FRITZ!Box TR-064 description', () => {
  const tr = probe.parseTr64Desc(fixture('tr64desc.xml'));
  assert.strictEqual(tr.model, 'FRITZ!Box 6660 Cable');
  assert.strictEqual(tr.version, '275.08.03');
  assert.strictEqual(fw.compareVersions(tr.version, '8.03', 'AVM'), 0);
  // Without <Display>, the version is rebuilt from its parts.
  const noDisplay = probe.parseTr64Desc('<systemVersion><HW>X</HW><Major>154</Major><Minor>7</Minor><Patch>57</Patch></systemVersion>');
  assert.strictEqual(noDisplay.version, '154.07.57');
  assert.strictEqual(probe.parseTr64Desc('<root/>'), null);
});

test('NETGEAR currentsetting.htm, with any line separator', () => {
  assert.deepStrictEqual(probe.parseCurrentSetting(fixture('currentsetting.htm')),
    { model: 'RAX120', version: 'V1.0.4.126_10.1.12', lab: false, oem: null });
  const cr = probe.parseCurrentSetting('Firmware=V1.0.0.58\rRegionTag=WNR3500L_NA\rRegion=us\rModel=WNR3500L\r');
  assert.strictEqual(cr.model, 'WNR3500L');
  assert.strictEqual(cr.version, 'V1.0.0.58');
  const glued = probe.parseCurrentSetting('Firmware=V1.0.9.88_10.2.88RegionTag=R7000_NARegion=usModel=R7000InternetConnectionStatus=Up');
  assert.strictEqual(glued.version, 'V1.0.9.88_10.2.88');
  assert.strictEqual(glued.model, 'R7000');
  assert.strictEqual(probe.parseCurrentSetting('<html>login</html>'), null);
});

test('UPnP description: firmwareVersion / softwareVersion, never modelNumber', () => {
  const xml = `<root><device><manufacturer>Example</manufacturer><modelName>Cam 1</modelName>
    <modelNumber>2.0</modelNumber><firmwareVersion>3.4.5</firmwareVersion></device></root>`;
  const d = parseDescription(xml, 'http://192.168.1.30:49152/desc.xml');
  assert.strictEqual(d.firmwareVersion, '3.4.5');
  assert.deepStrictEqual(probe.fromUpnp([d]), { version: '3.4.5', source: 'UPnP firmwareVersion' });
  const sw = parseDescription('<root><device><modelNumber>9.9</modelNumber><softwareVersion>83.1-61240</softwareVersion></device></root>', 'http://192.168.1.31/d.xml');
  assert.deepStrictEqual(probe.fromUpnp([sw]), { version: '83.1-61240', source: 'UPnP softwareVersion' });
  const none = parseDescription('<root><device><modelNumber>9.9</modelNumber></device></root>', 'http://192.168.1.32/d.xml');
  assert.strictEqual(probe.fromUpnp([none]), null);
});

// readFirmware with a fake fetch that records every URL.
function fakeFetch(files) {
  const asked = [];
  const fn = async (url) => {
    asked.push(url);
    return url in files ? { status: 200, headers: {}, body: files[url] } : { status: 404, headers: {}, body: '' };
  };
  fn.asked = asked;
  return fn;
}

test('readFirmware: FRITZ!Box via jason_boxinfo, then TR-064', async () => {
  const host = { ip: '192.168.178.1', macVendor: 'AVM Audiovisuelles Marketing und Computersysteme GmbH', upnp: [], http: { title: 'FRITZ!Box' } };
  const f1 = fakeFetch({ 'http://192.168.178.1/jason_boxinfo.xml': fixture('jason_boxinfo.xml') });
  const a = await probe.readFirmware(host, { fetch: f1 });
  assert.strictEqual(a.version, '154.07.57');
  assert.strictEqual(a.source, 'jason_boxinfo.xml');
  assert.deepStrictEqual(f1.asked, ['http://192.168.178.1/jason_boxinfo.xml']);

  const f2 = fakeFetch({ 'http://192.168.178.1:49000/tr64desc.xml': fixture('tr64desc.xml') });
  const b = await probe.readFirmware(host, { fetch: f2 });
  assert.strictEqual(b.source, 'TR-064 description');
  assert.strictEqual(b.version, '275.08.03');
});

test('readFirmware: NETGEAR, UPnP fallback, and only private addresses', async () => {
  const ng = { ip: '192.168.1.1', macVendor: 'NETGEAR', upnp: [], http: { title: 'NETGEAR Router RAX120' } };
  const f = await probe.readFirmware(ng, { fetch: fakeFetch({ 'http://192.168.1.1/currentsetting.htm': fixture('currentsetting.htm') }) });
  assert.strictEqual(f.source, 'currentsetting.htm');
  assert.strictEqual(f.model, 'RAX120');

  const cam = { ip: '10.0.0.5', macVendor: null, upnp: [{ manufacturer: 'Example', firmwareVersion: '2.1' }], http: null };
  const none = fakeFetch({});
  const c = await probe.readFirmware(cam, { fetch: none });
  assert.strictEqual(c.version, '2.1');
  assert.deepStrictEqual(none.asked, []); // unknown vendor: no extra request

  const pub = fakeFetch({});
  assert.strictEqual(await probe.readFirmware({ ip: '8.8.8.8', macVendor: 'AVM', upnp: [], http: null }, { fetch: pub }), null);
  assert.deepStrictEqual(pub.asked, []);
});

test('scan report carries the firmware block', () => {
  const { scanReport } = require('../src/cli');
  const { identify } = require('../src/discover');
  const devices = [{ vendor: 'AVM', model: 'FRITZ!Box 7590', hw_version: null, support_end: '2029-10-01', support_end_raw: 'x', end_is_minimum: true, region: 'EU' }];
  const host = {
    ip: '192.168.178.1', mac: null, macVendor: 'AVM Audiovisuelles Marketing und Computersysteme GmbH', upnp: [], mdns: null,
    http: { title: 'FRITZ!Box', realm: null, server: null }, exposed: [],
    firmware: { version: '154.07.57', source: 'jason_boxinfo.xml', model: 'FRITZ!Box 7590', lab: false, oem: 'avm' },
  };
  const [r] = scanReport(identify([host], devices), 365);
  assert.strictEqual(r.identified_via, 'device info file (jason_boxinfo.xml)');
  assert.strictEqual(r.firmware.installed, '154.07.57');
  assert.strictEqual(r.firmware.read_from, 'jason_boxinfo.xml');
  assert.strictEqual(r.firmware.upToDate, false); // bundled data: 8.51
  // No firmware read: the block is null, not "up to date".
  const [r2] = scanReport(identify([{ ...host, firmware: null }], devices), 365);
  assert.strictEqual(r2.firmware, null);
});

// AVM download server

test('AVM folder names', () => {
  assert.strictEqual(upd.avmFolder('FRITZ!Box 7530 AX'), 'fritzbox-7530-ax');
  assert.strictEqual(upd.avmFolder('FRITZ!Box 6660 Cable'), 'fritzbox-6660-cable');
  assert.strictEqual(upd.avmFolder('FRITZ!Box DSL/Fiber 7-90'), 'fritzbox-dsl-fiber-7-90');
  assert.strictEqual(upd.avmFolder('FRITZ!Repeater 1200'), null);
  const targets = upd.avmTargets([
    { vendor: 'AVM', model: 'FRITZ!Box 6820' },
    { vendor: 'AVM', model: 'FRITZ!Box 7590' },
    { vendor: 'AVM', model: 'FRITZ!Repeater 600' },
    { vendor: 'TP-Link', model: 'Archer C7' },
  ]);
  assert.deepStrictEqual(targets.map((t) => `${t.folder}|${t.hw}`),
    ['fritzbox-6820-lte|null', 'fritzbox-6820-lte-v2|V2', 'fritzbox-6820-lte-v3|V3', 'fritzbox-6820-lte-v4|V4', 'fritzbox-7590|null']);
});

test('AVM directory listing and image file names', () => {
  const files = upd.parseListing(fixture('avm-listing.html'));
  assert.deepStrictEqual(files, ['FRITZ.Box_7590-08.51.image', 'info_de.txt', 'info_en.txt', 'update_info_de.txt', 'update_info_en.txt']);
  assert.strictEqual(upd.imageVersion('FRITZ.Box_7590-08.51.image'), '8.51');
  assert.strictEqual(upd.imageVersion('FRITZ.Box_Fon_WLAN_7390-06.88.image'), '6.88');
  assert.strictEqual(upd.imageVersion('FRITZ.Box_7490-07.62.image'), '7.62');
  assert.strictEqual(upd.imageVersion('info_de.txt'), null);
});

test('AVM release note headers (German, English, legacy)', () => {
  assert.deepStrictEqual(upd.parseInfo(fixture('info_de.txt')), { product: 'FRITZ!Box 7590', version: '8.51', release_date: '2026-11-09' });
  assert.deepStrictEqual(upd.parseInfo(fixture('info_en_stale.txt')), { product: 'FRITZ!Box 7590', version: '8.25', release_date: '2026-03-26' });
  const legacy = upd.parseInfo('Product: FRITZ!Box 7490\nVersion: 113.07.57\nRelease-Date: 2023-09-12\n');
  assert.deepStrictEqual(legacy, { product: 'FRITZ!Box 7490', version: '7.57', release_date: '2023-09-12' });
  assert.strictEqual(upd.parseInfo('nothing here'), null);
  assert.strictEqual(upd.parseDate('31.02.2026'), null); // not a calendar date
  assert.strictEqual(upd.parseDate('13/13/2026'), null);
});

test('AVM: the image decides the version; a stale note gives no date', () => {
  const de = upd.parseInfo(fixture('info_de.txt'));
  const en = upd.parseInfo(fixture('info_en_stale.txt'));
  const ok = upd.pickLatest(['FRITZ.Box_7590-08.51.image'], [en, de]);
  assert.deepStrictEqual([ok.latest, ok.release_date], ['8.51', '2026-11-09']);
  const stale = upd.pickLatest(['FRITZ.Box_7590_AX-08.51.image'], [en]);
  assert.deepStrictEqual([stale.latest, stale.release_date], ['8.51', null]);
  assert.match(stale.warnings[0], /describe 8\.25, not 8\.51/);
  assert.strictEqual(upd.pickLatest([], []).latest, null);
});

test('AVM: full folder read with a fake server, and merge keeps old rows', async () => {
  const dir = 'https://download.avm.de/fritzbox/fritzbox-7590/deutschland/fritz.os/';
  const served = { [dir]: fixture('avm-listing.html'), [`${dir}info_de.txt`]: fixture('info_de.txt') };
  const asked = [];
  const fetchText = async (url) => { asked.push(url); return served[url] || null; };
  const { row } = await upd.avmRow({ model: 'FRITZ!Box 7590', folder: 'fritzbox-7590', hw: null }, fetchText, '2026-11-11');
  assert.deepStrictEqual(row, {
    vendor: 'AVM', model: 'FRITZ!Box 7590', hw_version: null, region: 'DE', latest_version: '8.51',
    release_date: '2026-11-09', source_url: dir, retrieved: '2026-11-11',
  });
  assert.deepStrictEqual(asked, [dir, `${dir}info_de.txt`]); // stops at the first matching note

  const merged = upd.merge([{ vendor: 'AVM', model: 'FRITZ!Box 7490', hw_version: null, latest_version: '7.62' },
    { vendor: 'AVM', model: 'FRITZ!Box 7590', hw_version: null, latest_version: '8.25' }], [row]);
  assert.deepStrictEqual(merged.map((r) => `${r.model} ${r.latest_version}`), ['FRITZ!Box 7490 7.62', 'FRITZ!Box 7590 8.51']);
});

test('GL.iNet 4.x: the login challenge identifies the firmware without a password', async () => {
  const seen = [];
  const fetch = async (url, opts) => {
    seen.push([url, opts.json]);
    return { status: 200, body: '{"id":1,"jsonrpc":"2.0","result":{"salt":"OmQ05MKx","hash-method":"sha256","alg":1,"nonce":"pQyXzFo2tJ5n2nZZH4B8TqLRt0vQ5X4Z"}}' };
  };
  const host = { ip: '192.168.8.1', macVendor: 'GL Technologies (Hong Kong) Limited', upnp: [], http: { title: null } };
  assert.match(await probe.probeNote(host, { fetch }), /GL\.iNet router, firmware 4\.x/);
  assert.deepStrictEqual(seen, [['http://192.168.8.1/rpc', { jsonrpc: '2.0', id: 1, method: 'challenge', params: { username: 'root' } }]]);
  assert.ok(!JSON.stringify(seen).includes('password'));
  // Other makers are not asked.
  assert.strictEqual(await probe.probeNote({ ...host, macVendor: 'Apple, Inc.' }, { fetch }), null);
  assert.strictEqual(seen.length, 1);
  assert.strictEqual(probe.isGlinetChallenge('403 Forbidden'), false);
});
