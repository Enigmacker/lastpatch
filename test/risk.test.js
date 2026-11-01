'use strict';

// Exploited vulnerabilities, Internet exposure and confidence levels.
// Fixtures only: no network access.

const test = require('node:test');
const assert = require('node:assert');
const kev = require('../src/kev');
const igd = require('../src/igd');
const { parseServices } = require('../src/ssdp');
const { identify } = require('../src/discover');
const { scanReport } = require('../src/cli');

const entries = {
  vulnerabilities: [
    { cveID: 'CVE-1', vendorProject: 'TP-Link', product: 'Multiple Routers', vulnerabilityName: 'x',
      shortDescription: 'TP-Link TL-WR940N V2/V4, TL-WR841N V8/V10, and TL-WR740N V1/V2 contain a command injection.', knownRansomwareCampaignUse: 'Unknown' },
    { cveID: 'CVE-2', vendorProject: 'TP-Link', product: 'TL-WR841N', vulnerabilityName: 'y',
      shortDescription: 'TP-Link TL-WR841N contains an authentication bypass.', knownRansomwareCampaignUse: 'Known' },
    { cveID: 'CVE-3', vendorProject: 'D-Link', product: 'DIR-859 Router', vulnerabilityName: 'z',
      shortDescription: 'D-Link DIR-859 router contains a command execution vulnerability.', knownRansomwareCampaignUse: 'Unknown' },
    { cveID: 'CVE-4', vendorProject: 'TP-Link', product: 'Archer C50 Firmware', vulnerabilityName: 'w',
      shortDescription: 'TP-Link Archer C50 has a flaw.', knownRansomwareCampaignUse: 'Unknown' },
  ],
};

const row = (model, hw) => ({ vendor: 'TP-Link', model, hw_version: hw, support_end: '2020-01-01', support_end_raw: 'x', region: 'UK' });

test('KEV: hardware versions named by CISA are respected', () => {
  assert.deepStrictEqual(kev.listedVersions(entries.vulnerabilities[0].shortDescription, 'TL-WR841N'), ['V8', 'V10']);
  assert.ok(kev.appliesTo(entries.vulnerabilities[0], row('TL-WR841N', 'V10')));
  assert.ok(!kev.appliesTo(entries.vulnerabilities[0], row('TL-WR841N', 'V14')));
  // No version given by CISA: applies to every version.
  assert.ok(kev.appliesTo(entries.vulnerabilities[1], row('TL-WR841N', 'V14')));
  // Unknown hardware version: shown, the user checks the label.
  assert.ok(kev.appliesTo(entries.vulnerabilities[0], row('TL-WR841N', null)));
});

test('KEV: whole model names only, same vendor only', () => {
  assert.ok(!kev.appliesTo(entries.vulnerabilities[3], row('Archer C5', 'V2'))); // C5 is not C50
  assert.ok(kev.appliesTo(entries.vulnerabilities[3], row('Archer C50', 'V6')));
  const dlinkRow = { ...row('TL-WR841N', null), vendor: 'D-Link' };
  assert.ok(!kev.appliesTo(entries.vulnerabilities[1], dlinkRow));
});

test('KEV: models missing from the dataset', () => {
  assert.deepStrictEqual(kev.forQuery('D-Link DIR-859', entries).map((e) => e.cveID), ['CVE-3']);
  assert.deepStrictEqual(kev.forQuery('D-Link DIR-85', entries), []);
  assert.deepStrictEqual(kev.forQuery('TP-Link Multiple Routers', entries), []); // generic product names never match
});

test('KEV: indexer caches per hardware version', () => {
  const of = kev.indexer(entries);
  assert.deepStrictEqual(of(row('TL-WR841N', 'V8')).map((e) => e.cveID), ['CVE-1', 'CVE-2']);
  assert.deepStrictEqual(of(row('TL-WR841N', 'V14')).map((e) => e.cveID), ['CVE-2']);
});

test('KEV: shipped catalogue extract is well formed', () => {
  const data = kev.loadKev();
  assert.ok(data && Array.isArray(data.vulnerabilities) && data.vulnerabilities.length > 0);
  for (const v of data.vulnerabilities) assert.match(v.cveID, /^CVE-\d{4}-\d+$/);
});

const description = `<?xml version="1.0"?><root><URLBase>http://192.168.1.1:5000/</URLBase><device>
<deviceList><device><serviceList>
<service><serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType><controlURL>/ctl/IPConn</controlURL></service>
<service><serviceType>urn:schemas-upnp-org:service:Layer3Forwarding:1</serviceType><controlURL>/ctl/L3F</controlURL></service>
</serviceList></device></deviceList></device></root>`;

function soapEntry(i) {
  const list = [
    { ext: 8080, proto: 'TCP', client: '192.168.1.23', port: 80, desc: 'NAS web' },
    { ext: 554, proto: 'TCP', client: '192.168.1.40', port: 554, desc: 'camera RTSP' },
  ];
  const e = list[i];
  if (!e) return { status: 500, body: '<s:Envelope><s:Body><s:Fault><detail><UPnPError><errorCode>713</errorCode><errorDescription>SpecifiedArrayIndexInvalid</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>' };
  return {
    status: 200,
    body: '<s:Envelope><s:Body><u:GetGenericPortMappingEntryResponse xmlns:u="urn:schemas-upnp-org:service:WANIPConnection:1">' +
      `<NewRemoteHost></NewRemoteHost><NewExternalPort>${e.ext}</NewExternalPort><NewProtocol>${e.proto}</NewProtocol>` +
      `<NewInternalPort>${e.port}</NewInternalPort><NewInternalClient>${e.client}</NewInternalClient><NewEnabled>1</NewEnabled>` +
      `<NewPortMappingDescription>${e.desc}</NewPortMappingDescription><NewLeaseDuration>0</NewLeaseDuration>` +
      '</u:GetGenericPortMappingEntryResponse></s:Body></s:Envelope>',
  };
}

test('UPnP services with absolute control URLs', () => {
  const s = parseServices(description, 'http://192.168.1.1:5000/rootDesc.xml');
  assert.deepStrictEqual(s[0], { serviceType: 'urn:schemas-upnp-org:service:WANIPConnection:1', controlURL: 'http://192.168.1.1:5000/ctl/IPConn' });
});

test('router port forwards are read until the router says there are no more', async () => {
  const sent = [];
  const requester = async (url, serviceType, body) => {
    sent.push({ url, body });
    return soapEntry(Number(body.match(/<NewPortMappingIndex>(\d+)</)[1]));
  };
  const services = parseServices(description, 'http://192.168.1.1:5000/rootDesc.xml');
  const maps = await igd.portMappings([{ ip: '192.168.1.1', services }], { requester });
  assert.strictEqual(maps.length, 2);
  assert.deepStrictEqual(maps.map((m) => [m.externalPort, m.internalClient]), [[8080, '192.168.1.23'], [554, '192.168.1.40']]);
  assert.strictEqual(sent.length, 3); // two entries, then the end-of-list error
  assert.ok(sent.every((s) => /GetGenericPortMappingEntry/.test(s.body))); // read-only action only
  assert.ok(!sent.some((s) => /AddPortMapping|DeletePortMapping/.test(s.body)));
});

test('scan report: exposure, exploited vulnerabilities and confidence', () => {
  const devices = [
    { vendor: 'TP-Link', model: 'TL-WR841N', hw_version: 'V8', support_end: '2023-01-01', support_end_raw: '1/1/2023', end_is_minimum: false, region: 'UK', source_url: 'https://x' },
    { vendor: 'AVM', model: 'FRITZ!Box 7590', hw_version: null, support_end: '2029-10-01', support_end_raw: '01.10.2029', end_is_minimum: true, region: 'EU', source_url: 'https://y' },
  ];
  const hosts = [
    { ip: '192.168.1.2', mac: null, macVendor: null, upnp: [], mdns: null, http: { title: 'TL-WR841N', realm: null }, exposed: [{ externalPort: 8080, protocol: 'TCP', internalPort: 80, description: 'admin', enabled: true }] },
    { ip: '192.168.178.1', mac: null, macVendor: null, upnp: [{ manufacturer: 'AVM', modelName: 'FRITZ!Box 7590' }], mdns: null, http: null, exposed: [] },
  ];
  const report = scanReport(identify(hosts, devices), 365);
  assert.strictEqual(report[0].exposed[0].external_port, 8080);
  assert.strictEqual(report[0].results[0].status, 'expired');
  assert.strictEqual(report[0].results[0].confidence, 'official end date');
  assert.strictEqual(report[1].results[0].confidence, 'minimum guaranteed by the vendor (support may continue)');
});
