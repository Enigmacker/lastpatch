'use strict';

// Discovery parsers and identification, tested on captured/constructed data.
// No network access: nothing here sends a packet.

const test = require('node:test');
const assert = require('node:assert');
const { parseNeighbors, normalizeMac, isRandomMac, hostsOf, localSubnets } = require('../src/neighbors');
const { parseOui, parseTsv, vendorOf, loadOui } = require('../src/oui');
const { extractTitle, extractRealm } = require('../src/httpprobe');
const mdns = require('../src/mdns');
const { identify, candidates } = require('../src/discover');
const { canonicalVendor } = require('../src/match');

test('neighbour table: Linux /proc/net/arp', () => {
  const t = parseNeighbors(`IP address       HW type     Flags       HW address            Mask     Device
192.168.1.1      0x1         0x2         50:c7:bf:aa:bb:cc     *        wlan0
192.168.1.40     0x1         0x0         00:00:00:00:00:00     *        wlan0
192.168.1.23     0x1         0x2         3c:a6:2f:11:22:33     *        wlan0`);
  assert.deepStrictEqual([...t], [['192.168.1.1', '50:c7:bf:aa:bb:cc'], ['192.168.1.23', '3c:a6:2f:11:22:33']]);
});

test('neighbour table: ip neigh', () => {
  const t = parseNeighbors(`192.168.1.1 dev wlan0 lladdr 50:c7:bf:aa:bb:cc REACHABLE
192.168.1.50 dev wlan0  FAILED
fe80::1 dev wlan0 lladdr 50:c7:bf:aa:bb:cc router STALE`);
  assert.deepStrictEqual([...t], [['192.168.1.1', '50:c7:bf:aa:bb:cc']]);
});

test('neighbour table: macOS arp -an pads short octets', () => {
  const t = parseNeighbors(`? (192.168.178.1) at 3c:a6:2f:1:2:3 on en0 ifscope [ethernet]
? (192.168.178.20) at (incomplete) on en0 ifscope [ethernet]
? (224.0.0.251) at 1:0:5e:0:0:fb on en0 ifscope permanent [ethernet]`);
  assert.deepStrictEqual([...t], [['192.168.178.1', '3c:a6:2f:01:02:03']]);
});

test('neighbour table: Windows arp -a', () => {
  const t = parseNeighbors(`
Interface: 192.168.1.10 --- 0x7
  Internet Address      Physical Address      Type
  192.168.1.1           50-c7-bf-aa-bb-cc     dynamic
  192.168.1.255         ff-ff-ff-ff-ff-ff     static
  224.0.0.22            01-00-5e-00-00-16     static`);
  assert.deepStrictEqual([...t], [['192.168.1.1', '50:c7:bf:aa:bb:cc']]);
});

test('MAC helpers', () => {
  assert.strictEqual(normalizeMac('50-C7-BF-AA-BB-CC'), '50:c7:bf:aa:bb:cc');
  assert.strictEqual(normalizeMac('not a mac'), null);
  assert.ok(isRandomMac('da:a1:19:00:00:01')); // locally administered
  assert.ok(!isRandomMac('50:c7:bf:aa:bb:cc'));
});

test('subnet sweep list stays inside the local /24', () => {
  const [s] = localSubnets({ eth0: [{ family: 'IPv4', internal: false, address: '192.168.1.10', netmask: '255.255.255.0', cidr: '192.168.1.10/24' }] });
  const hosts = hostsOf(s);
  assert.strictEqual(hosts.length, 253); // .1 to .254 minus our own address
  assert.ok(!hosts.includes('192.168.1.10') && !hosts.includes('192.168.1.0') && !hosts.includes('192.168.1.255'));
  // Large networks are not swept.
  assert.strictEqual(localSubnets({ eth0: [{ family: 'IPv4', internal: false, address: '10.0.0.5', netmask: '255.0.0.0', cidr: '10.0.0.5/8' }] }).length, 0);
});

test('IEEE OUI registry', () => {
  const table = parseOui(`Registry,Assignment,Organization Name,Organization Address
MA-L,50C7BF,"TP-LINK TECHNOLOGIES CO.,LTD.","Building 24 (floors 1,3,4,5) and 28 (floors1-4), Shenzhen"
MA-L,3CA62F,AVM Audiovisuelles Marketing und Computersysteme GmbH,Alt-Moabit 95 Berlin  DE 10559`);
  assert.strictEqual(vendorOf('50:c7:bf:aa:bb:cc', table), 'TP-LINK TECHNOLOGIES CO.,LTD.');
  assert.strictEqual(canonicalVendor(vendorOf('3c:a6:2f:01:02:03', table)), 'avm');
  assert.strictEqual(vendorOf('00:11:22:33:44:55', table), null);
});

test('bundled registry: longest prefix wins', () => {
  const t = parseTsv('001BC5\tIEEE Registration Authority\n001BC5001\tSmall Vendor Ltd\nnot a line\n');
  assert.strictEqual(vendorOf('00:1b:c5:00:12:34', t), 'Small Vendor Ltd');
  assert.strictEqual(vendorOf('00:1b:c5:99:12:34', t), 'IEEE Registration Authority');
  const shipped = loadOui();
  assert.ok(shipped && shipped.size > 40000);
  assert.strictEqual(canonicalVendor(vendorOf('50:c7:bf:00:00:01', shipped)), 'tp-link');
});

test('vendor names match whole words only', () => {
  assert.strictEqual(canonicalVendor('Acme Engineering Ltd'), null); // not "Ring"
  assert.strictEqual(canonicalVendor('Ring LLC'), 'ring');
  assert.strictEqual(canonicalVendor('Decoder Systems'), null); // not "Deco"
  assert.strictEqual(canonicalVendor('FRITZ!Box 7590'), 'avm');
});

test('admin login realm', () => {
  assert.strictEqual(extractRealm({ 'www-authenticate': 'Basic realm="TP-LINK Archer C7"' }), 'TP-LINK Archer C7');
  assert.strictEqual(extractRealm({}), null);
});

test('identify: login realm', () => {
  const rows = [{ vendor: 'TP-Link', model: 'Archer C7', hw_version: null, support_end: '2020-01-01', support_end_raw: 'x', region: 'UK' }];
  const host = { ip: '192.168.0.1', mac: null, macVendor: null, upnp: [], mdns: null, http: { title: 'Login', realm: 'TP-LINK Archer C7', server: null } };
  const [r] = identify([host], rows);
  assert.strictEqual(r.via, 'admin login prompt');
});

test('admin page title', () => {
  assert.strictEqual(extractTitle('<html><head><title>\n  Archer AX55 \n</title></head></html>'), 'Archer AX55');
  assert.strictEqual(extractTitle('<TITLE>Synology&amp;DiskStation&nbsp;&quot;x&quot;</TITLE>'), 'Synology&DiskStation "x"');
  assert.strictEqual(extractTitle('<html>no title</html>'), null);
});

// Build a DNS response the way a NAS would answer a DNS-SD query.
function rr(nameBuf, type, rdata) {
  const fixed = Buffer.alloc(10);
  fixed.writeUInt16BE(type, 0);
  fixed.writeUInt16BE(0x8001, 2);
  fixed.writeUInt32BE(120, 4);
  fixed.writeUInt16BE(rdata.length, 8);
  return Buffer.concat([nameBuf, fixed, rdata]);
}
function txt(pairs) {
  return Buffer.concat(pairs.map((p) => Buffer.concat([Buffer.from([Buffer.byteLength(p)]), Buffer.from(p)])));
}

test('mDNS: query packet and response parsing (with name compression)', () => {
  const q = mdns.buildQuery(['_http._tcp.local']);
  assert.strictEqual(q.readUInt16BE(4), 1);
  assert.strictEqual(q.readUInt16BE(q.length - 2), 0x8001); // QU bit set

  const header = Buffer.alloc(12);
  header.writeUInt16BE(0x8400, 2); // response, authoritative
  header.writeUInt16BE(1, 6); // 1 answer
  header.writeUInt16BE(3, 10); // 3 additionals
  const instance = mdns.encodeName('nas._http._tcp.local');
  const instanceOffset = 12;
  const ptrName = mdns.encodeName('_http._tcp.local');
  // PTR answer: _http._tcp.local -> pointer to the instance name written in rdata
  const answers = [];
  const ptrRdata = instance;
  const ptr = rr(ptrName, mdns.TYPE.PTR, ptrRdata);
  answers.push(ptr);
  // The instance name inside the PTR rdata starts after header + ptrName + 10 bytes.
  const instanceAt = instanceOffset + ptrName.length + 10;
  const pointer = Buffer.from([0xc0 | (instanceAt >> 8), instanceAt & 0xff]);
  const srvRdata = Buffer.concat([Buffer.from([0, 0, 0, 0, 0, 80]), mdns.encodeName('nas.local')]);
  answers.push(rr(pointer, mdns.TYPE.SRV, srvRdata));
  answers.push(rr(pointer, mdns.TYPE.TXT, txt(['vendor=Synology', 'model=DS920+', 'version=7.2'])));
  answers.push(rr(mdns.encodeName('nas.local'), mdns.TYPE.A, Buffer.from([192, 168, 1, 23])));
  const packet = Buffer.concat([header, ...answers]);

  const records = mdns.parseMessage(packet);
  assert.strictEqual(records.length, 4);
  assert.strictEqual(records[1].name, 'nas._http._tcp.local');
  const [dev] = mdns.summarize(records);
  assert.strictEqual(dev.ip, '192.168.1.23');
  assert.strictEqual(dev.model, 'DS920+');
  assert.deepStrictEqual(dev.names, ['nas']);
  assert.deepStrictEqual(dev.services, ['_http._tcp']);
});

test('mDNS: malformed packets throw instead of looping', () => {
  const bad = Buffer.alloc(14);
  bad.writeUInt16BE(1, 6);
  bad[12] = 0xc0; bad[13] = 12; // pointer to itself
  assert.throws(() => mdns.parseMessage(bad));
});

const devices = [
  { vendor: 'TP-Link', model: 'Archer AX55', hw_version: 'V1', support_end: '2029-12-31', support_end_raw: 'x', region: 'UK' },
  { vendor: 'Synology', model: 'DS920+', hw_version: null, support_end: '2028-10-31', support_end_raw: 'x', region: 'global' },
  { vendor: 'Ring', model: 'Indoor Cam (1st Gen)', hw_version: null, support_end: '2027-12-31', support_end_raw: 'x', region: 'UK' },
];

test('identify: web page title plus MAC vendor', () => {
  const host = { ip: '192.168.1.1', mac: '50:c7:bf:aa:bb:cc', macVendor: 'TP-LINK TECHNOLOGIES CO.,LTD.', upnp: [], mdns: null, http: { title: 'Archer AX55', server: null } };
  const [r] = identify([host], devices);
  assert.strictEqual(r.via, 'web page title');
  assert.strictEqual(r.matches[0].row.model, 'Archer AX55');
});

test('identify: mDNS model', () => {
  const host = { ip: '192.168.1.23', mac: null, macVendor: 'Synology Incorporated', upnp: [], mdns: { names: ['nas'], services: [], model: 'DS920+', txt: {} }, http: null };
  const [r] = identify([host], devices);
  assert.strictEqual(r.via, 'mDNS');
});

test('identify: a match from another vendor than the MAC is rejected', () => {
  const host = { ip: '192.168.1.9', mac: null, macVendor: 'Synology Incorporated', upnp: [], mdns: null, http: { title: 'TP-Link Archer AX55 setup', server: null } };
  const [r] = identify([host], devices);
  assert.strictEqual(r.matches.length, 0);
});

test('identify: nothing announced', () => {
  const host = { ip: '192.168.1.50', mac: 'da:a1:19:00:00:01', macVendor: null, upnp: [], mdns: null, http: null };
  assert.deepStrictEqual(candidates(host), []);
  const [r] = identify([host], devices);
  assert.strictEqual(r.query, null);
});

test('scan report shape', () => {
  const { scanReport } = require('../src/cli');
  const host = { ip: '192.168.1.1', mac: '50:c7:bf:aa:bb:cc', macVendor: 'TP-LINK TECHNOLOGIES CO.,LTD.', upnp: [], mdns: null, http: { title: 'Archer AX55 V1', server: null } };
  const [r] = scanReport(identify([host], devices), 365);
  assert.strictEqual(r.identified_via, 'web page title');
  assert.strictEqual(r.results[0].status, 'supported');
});
