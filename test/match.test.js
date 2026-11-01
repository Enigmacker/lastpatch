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
