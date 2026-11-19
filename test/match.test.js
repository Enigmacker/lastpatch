'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { findDevice, computeStatus, extractHwVersion, canonicalVendor } = require('../src/match');
const { parseDescription, isPrivateHost } = require('../src/ssdp');

const fixture = [
  { vendor: 'TP-Link', model: 'Archer AX55', hw_version: 'V1', support_end: '2027-12-31', support_end_raw: '31/12/2027 or later*', end_is_minimum: true },
  { vendor: 'TP-Link', model: 'Archer AX55 Pro', hw_version: 'V1', support_end: '2028-12-31', support_end_raw: '31/12/2028' },
  { vendor: 'TP-Link', model: 'Tapo C200', hw_version: 'V1, V2, V3', support_end: '2027-07-11', support_end_raw: '11/7/2027' },
  { vendor: 'TP-Link', model: 'Tapo C200', hw_version: 'V3.20, V5', support_end: '2028-12-31', support_end_raw: '31/12/2028 or later*', end_is_minimum: true },
  { vendor: 'AVM', model: 'FRITZ!Box 7490', hw_version: null, support_end: null, support_end_raw: 'already end of support (no date given)' },
  { vendor: 'Synology', model: 'DS918+', hw_version: null, support_end: '2025-06-30', support_end_raw: '2025-06' },
];

const today = new Date('2026-11-01T12:00:00Z');

test('vendor aliases', () => {
  assert.strictEqual(canonicalVendor('TP-LINK Technologies'), 'tp-link');
  assert.strictEqual(canonicalVendor('FRITZ!Box 7590'), 'avm');
  assert.strictEqual(canonicalVendor('unknown brand'), null);
});

test('hardware version extraction', () => {
  assert.strictEqual(extractHwVersion('Tapo C200 v3'), 'V3');
  assert.strictEqual(extractHwVersion('Archer AX55 Ver: 1.0'), 'V1.0');
  assert.strictEqual(extractHwVersion('Archer AX55'), null);
  // A "Ver: 1.0" label matches a "V1" row
  assert.strictEqual(findDevice(fixture, 'TP-Link Archer AX55 Ver: 1.0').matches.length, 1);
});

test('longest model wins (AX55 Pro is not AX55)', () => {
  const { matches } = findDevice(fixture, 'TP-Link Archer AX55 Pro');
  assert.strictEqual(matches.length, 1);
  assert.strictEqual(matches[0].row.model, 'Archer AX55 Pro');
});

test('hardware version narrows the result', () => {
  const all = findDevice(fixture, 'TP-Link Tapo C200').matches;
  assert.strictEqual(all.length, 2);
  const v5 = findDevice(fixture, 'Tapo C200 V5').matches;
  assert.strictEqual(v5.length, 1);
  assert.strictEqual(v5[0].row.support_end, '2028-12-31');
});

test('FRITZ!Box spelling variants', () => {
  assert.strictEqual(findDevice(fixture, 'Fritzbox 7490').matches.length, 1);
  assert.strictEqual(findDevice(fixture, 'AVM FRITZ!Box 7490').matches.length, 1);
});

test('status computation', () => {
  assert.strictEqual(computeStatus(fixture[0], today), 'supported'); // 425 days left
  assert.strictEqual(computeStatus(fixture[2], today), 'expiring'); // 252 days left
  assert.strictEqual(computeStatus(fixture[1], today), 'supported');
  assert.strictEqual(computeStatus(fixture[4], today), 'expired');
  assert.strictEqual(computeStatus(fixture[5], today), 'expired');
  assert.strictEqual(computeStatus({ support_end: null, support_end_raw: '' }, today), 'unknown');
});

test('series name may be omitted by the device', () => {
  const rows = [{ vendor: 'Netgear', model: 'Nighthawk RAX70', support_end: null, support_end_raw: 'x' }];
  assert.strictEqual(findDevice(rows, 'NETGEAR RAX70').matches.length, 1);
  assert.strictEqual(findDevice(rows, 'NETGEAR RAX7').matches.length, 0);
  const dl = [{ vendor: 'D-Link', model: 'EAGLE PRO AI M30', support_end: null, support_end_raw: 'x' }];
  assert.strictEqual(findDevice(dl, 'D-Link M30').matches.length, 1);
  assert.strictEqual(findDevice(dl, 'D-Link M300').matches.length, 0);
});

test('SKU in parentheses', () => {
  const rows = [
    { vendor: 'Arlo', model: 'Arlo Pro 2 (VMC4030P)', support_end: '2025-01-01', support_end_raw: 'x' },
    { vendor: 'Arlo', model: 'Arlo Pro (VMC4030)', support_end: '2023-07-01', support_end_raw: 'x' },
  ];
  assert.strictEqual(findDevice(rows, 'Arlo Pro 2').matches[0].row.model, 'Arlo Pro 2 (VMC4030P)');
  assert.strictEqual(findDevice(rows, 'Arlo VMC4030').matches[0].row.model, 'Arlo Pro (VMC4030)');
  assert.strictEqual(findDevice(rows, 'Arlo VMC4030').matches.length, 1);
});

test('unknown device', () => {
  assert.strictEqual(findDevice(fixture, 'Netgear RAX50').matches.length, 0);
});

test('UPnP description parsing', () => {
  const xml = '<root><device><friendlyName>Living room</friendlyName><manufacturer>AVM Berlin</manufacturer><modelName>FRITZ!Box 7490</modelName></device></root>';
  const d = parseDescription(xml, 'http://192.168.178.1:49000/tr64desc.xml');
  assert.strictEqual(d.ip, '192.168.178.1');
  assert.strictEqual(d.modelName, 'FRITZ!Box 7490');
  assert.strictEqual(findDevice(fixture, `${d.manufacturer} ${d.modelName}`).matches.length, 1);
});

test('only LAN addresses are fetched', () => {
  assert.ok(isPrivateHost('192.168.1.1'));
  assert.ok(isPrivateHost('10.0.0.2'));
  assert.ok(isPrivateHost('172.20.1.1'));
  assert.ok(!isPrivateHost('172.32.0.1'));
  assert.ok(!isPrivateHost('8.8.8.8'));
});

test('brands of one company are accepted against each other\'s MAC vendor', () => {
  const { sameMaker, canonicalVendor } = require('../src/match');
  assert.equal(canonicalVendor('Amazon eero Pro 6'), 'eero');
  assert.equal(canonicalVendor('Amazon Technologies Inc.'), 'amazon');
  assert.ok(sameMaker('amazon', 'ring'));
  assert.ok(sameMaker('tp-link', 'mercusys'));
  assert.ok(!sameMaker('netgear', 'tp-link'));
});

test('a fuller name wins over a shorter one from another maker', () => {
  const rows = [
    { vendor: 'Ring', model: 'Floodlight Cam', hw_version: null },
    { vendor: 'eufy', model: 'Floodlight Cam E340(T8425)', hw_version: null },
  ];
  assert.strictEqual(findDevice(rows, 'Floodlight Cam E340').matches[0].row.vendor, 'eufy');
  assert.strictEqual(findDevice(rows, 'Ring Floodlight Cam').matches[0].row.vendor, 'Ring');
});

test('a model code shared by several products gives suggestions, not a result', () => {
  const rows = [
    { vendor: 'eufy', model: 'Floodlight Cam E340(T8425)', hw_version: null },
    { vendor: 'eufy', model: 'Video Doorbell E340 with Chime(T8214)', hw_version: null },
    { vendor: 'eufy', model: 'eufy Video Doorbell E340 with chime(E8214)', hw_version: null },
    { vendor: 'eufy', model: 'Solo Cam S340(T8170)', hw_version: null },
  ];
  const r = findDevice(rows, 'eufy E340');
  assert.strictEqual(r.matches.length, 0);
  assert.deepStrictEqual(r.suggestions, [
    'eufy Floodlight Cam E340(T8425)',
    'eufy Video Doorbell E340 with Chime(T8214)',
    'eufy Video Doorbell E340 with chime(E8214)',
  ]);
  assert.deepStrictEqual(findDevice(rows, 'E340').suggestions, []); // no maker given
});

test('Roomba and EE hubs are found by product name or label code', () => {
  const rows = [
    { vendor: 'iRobot', model: 'Roomba i7 (RVB-Y2)', hw_version: null },
    { vendor: 'iRobot', model: 'Roomba i8 (RVB-Y2)', hw_version: null },
    { vendor: 'EE', model: 'Smart Hub 7 Plus (SH35A, ERV46BE247B-H2-SA)', hw_version: null },
    { vendor: 'EE', model: 'Smart Hub (SH20A, GRV9517UAC34-2-A-SA)', hw_version: null },
  ];
  assert.strictEqual(findDevice(rows, 'Roomba i7').matches[0].row.model, 'Roomba i7 (RVB-Y2)');
  assert.strictEqual(findDevice(rows, 'EE Smart Hub 7 Plus').matches[0].row.model, 'Smart Hub 7 Plus (SH35A, ERV46BE247B-H2-SA)');
  assert.strictEqual(findDevice(rows, 'EE SH35A').matches[0].row.model, 'Smart Hub 7 Plus (SH35A, ERV46BE247B-H2-SA)');
});

test('brand words pick the right maker: Sharp Roku TV, BT hub, Kyocera ECOSYS', () => {
  assert.strictEqual(canonicalVendor('Sharp Roku TV 4K'), 'sharp');
  assert.strictEqual(canonicalVendor('Roku Express 4K'), 'roku');
  assert.strictEqual(canonicalVendor('BT Smart Hub 2'), 'bt');
  assert.strictEqual(canonicalVendor('ECOSYS P2235dn'), 'kyocera');
  assert.strictEqual(canonicalVendor('Virgin Media Hub 5'), 'virgin media');
  const rows = [{ vendor: 'BT', model: 'Smart Hub 2 (GRV9517UAC34-A-SA)', hw_version: null }, { vendor: 'EE', model: 'Smart Hub 2 (X)', hw_version: null }];
  assert.strictEqual(findDevice(rows, 'BT Smart Hub 2').matches[0].row.vendor, 'BT');
});

test('phones and tablets are found by name or model number', () => {
  const rows = [
    { vendor: 'Apple', model: 'iPhone 16 (A3287)', hw_version: null },
    { vendor: 'Apple', model: 'iPhone 16 Pro (A3293)', hw_version: null },
    { vendor: 'Google', model: 'Pixel 8', hw_version: null },
    { vendor: 'Google', model: 'Pixel 8 Pro', hw_version: null },
    { vendor: 'Samsung', model: 'Galaxy S24 (SM-S921B/DS)', hw_version: null },
  ];
  assert.strictEqual(findDevice(rows, 'iPhone 16 Pro').matches[0].row.model, 'iPhone 16 Pro (A3293)');
  assert.strictEqual(findDevice(rows, 'Apple A3287').matches[0].row.model, 'iPhone 16 (A3287)');
  assert.strictEqual(findDevice(rows, 'Google Pixel 8 Pro').matches[0].row.model, 'Pixel 8 Pro');
  assert.strictEqual(findDevice(rows, 'Galaxy S24').matches[0].row.model, 'Galaxy S24 (SM-S921B/DS)');
  assert.strictEqual(canonicalVendor('moto g55 5G'), 'motorola');
  assert.strictEqual(canonicalVendor('Redmi Note 13 Pro'), 'xiaomi');
  assert.strictEqual(canonicalVendor('POCO F6'), 'xiaomi');
  assert.strictEqual(canonicalVendor('Nokia G22'), 'hmd');
  assert.strictEqual(canonicalVendor('Xperia 1 V'), 'sony');
  assert.strictEqual(canonicalVendor('Zenfone 10'), 'asus');
  assert.strictEqual(canonicalVendor('Surface Pro 9'), 'microsoft');
  assert.strictEqual(canonicalVendor('OnePlus 12'), 'oneplus');
  const more = [{ vendor: 'HMD', model: 'Nokia G22', hw_version: null }, { vendor: 'Xiaomi', model: 'Redmi Note 13 Pro', hw_version: null }];
  assert.strictEqual(findDevice(more, 'Nokia G22').matches[0].row.vendor, 'HMD');
  assert.strictEqual(findDevice(more, 'Redmi Note 13 Pro').matches[0].row.model, 'Redmi Note 13 Pro');
});
