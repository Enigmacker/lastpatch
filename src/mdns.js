'use strict';

// mDNS / DNS-SD discovery (Bonjour). Many NAS, printers, cameras and smart
// home devices announce their model in TXT records. Read-only: one query,
// then we listen. No dependency: minimal DNS encoder/decoder.

const dgram = require('node:dgram');

const MDNS_ADDR = '224.0.0.251';
const MDNS_PORT = 5353;
const TYPE = { A: 1, PTR: 12, TXT: 16, SRV: 33 };

const SERVICE_TYPES = [
  '_services._dns-sd._udp.local',
  '_http._tcp.local',
  '_device-info._tcp.local',
  '_smb._tcp.local',
  '_ipp._tcp.local',
  '_printer._tcp.local',
  '_airplay._tcp.local',
  '_googlecast._tcp.local',
  '_hap._tcp.local',
  '_rtsp._tcp.local',
  '_workstation._tcp.local',
];

// TXT keys that carry a model name, by convention.
const MODEL_KEYS = ['model', 'md', 'mdl', 'usb_mdl', 'product', 'ty', 'modelname', 'model_name'];

function encodeName(name) {
  const parts = name.split('.').filter(Boolean).map((label) => {
    const b = Buffer.from(label, 'utf8');
    return Buffer.concat([Buffer.from([b.length]), b]);
  });
  return Buffer.concat([...parts, Buffer.from([0])]);
}

function buildQuery(names = SERVICE_TYPES) {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(names.length, 4); // QDCOUNT
  const questions = names.map((n) => {
    const tail = Buffer.alloc(4);
    tail.writeUInt16BE(TYPE.PTR, 0);
    tail.writeUInt16BE(0x8001, 2); // class IN, unicast response requested (QU)
    return Buffer.concat([encodeName(n), tail]);
  });
  return Buffer.concat([header, ...questions]);
}

function readName(buf, offset, depth = 0) {
  const labels = [];
  let pos = offset;
  let jumped = false;
  let end = offset;
  while (pos < buf.length) {
    const len = buf[pos];
    if (len === 0) { if (!jumped) end = pos + 1; break; }
    if ((len & 0xc0) === 0xc0) {
      if (depth > 10 || pos + 1 >= buf.length) throw new Error('bad name');
      const ptr = ((len & 0x3f) << 8) | buf[pos + 1];
      if (!jumped) end = pos + 2;
      const rest = readName(buf, ptr, depth + 1);
      labels.push(rest.name);
      jumped = true;
      break;
    }
    if (pos + 1 + len > buf.length) throw new Error('bad label');
    labels.push(buf.toString('utf8', pos + 1, pos + 1 + len));
    pos += 1 + len;
  }
  return { name: labels.filter(Boolean).join('.'), end };
}

function parseTxt(buf, start, length) {
  const kv = {};
  let pos = start;
  while (pos < start + length) {
    const len = buf[pos];
    const s = buf.toString('utf8', pos + 1, pos + 1 + len);
    const eq = s.indexOf('=');
    if (eq > 0) kv[s.slice(0, eq).toLowerCase()] = s.slice(eq + 1);
    pos += 1 + len;
  }
  return kv;
}

// Returns all resource records of a DNS message (answers + additionals).
function parseMessage(buf) {
  const records = [];
  const qd = buf.readUInt16BE(4);
  const total = buf.readUInt16BE(6) + buf.readUInt16BE(8) + buf.readUInt16BE(10);
  let pos = 12;
  for (let i = 0; i < qd; i++) pos = readName(buf, pos).end + 4;
  for (let i = 0; i < total && pos < buf.length; i++) {
    const { name, end } = readName(buf, pos);
    const type = buf.readUInt16BE(end);
    const rdlen = buf.readUInt16BE(end + 8);
    const rdata = end + 10;
    const rec = { name, type };
    if (type === TYPE.A && rdlen === 4) rec.ip = [...buf.subarray(rdata, rdata + 4)].join('.');
    else if (type === TYPE.PTR) rec.target = readName(buf, rdata).name;
    else if (type === TYPE.SRV) rec.target = readName(buf, rdata + 6).name;
    else if (type === TYPE.TXT) rec.txt = parseTxt(buf, rdata, rdlen);
    records.push(rec);
    pos = rdata + rdlen;
  }
  return records;
}

// Group records by IP: { ip, names, services, txt, model }
function summarize(records, fromIp = new Map()) {
  const aByHost = new Map();
  const srvByInstance = new Map();
  for (const r of records) {
    if (r.type === TYPE.A) aByHost.set(r.name.toLowerCase(), r.ip);
    if (r.type === TYPE.SRV) srvByInstance.set(r.name.toLowerCase(), r.target.toLowerCase());
  }
  const devices = new Map();
  const dev = (ip) => {
    if (!devices.has(ip)) devices.set(ip, { ip, names: new Set(), services: new Set(), txt: {} });
    return devices.get(ip);
  };
  for (const r of records) {
    const key = r.name.toLowerCase();
    const ip = aByHost.get(key) || aByHost.get(srvByInstance.get(key)) || fromIp.get(r) || null;
    if (!ip) continue;
    const d = dev(ip);
    if (r.type === TYPE.SRV || r.type === TYPE.TXT) {
      const instance = r.name.split('._')[0];
      if (instance) d.names.add(instance);
      const service = r.name.match(/(_[^.]+\._(?:tcp|udp))/);
      if (service) d.services.add(service[1]);
    }
    if (r.type === TYPE.TXT) Object.assign(d.txt, r.txt);
  }
  return [...devices.values()].map((d) => {
    const modelKey = MODEL_KEYS.find((k) => d.txt[k]);
    return {
      ip: d.ip,
      names: [...d.names],
      services: [...d.services],
      model: modelKey ? d.txt[modelKey] : null,
      txt: d.txt,
    };
  });
}

function browse({ timeoutMs = 3000 } = {}) {
  return new Promise((resolve) => {
    const records = [];
    const fromIp = new Map();
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const finish = () => {
      try { socket.close(); } catch { /* already closed */ }
      resolve(summarize(records, fromIp));
    };
    socket.on('message', (msg, rinfo) => {
      try {
        for (const r of parseMessage(msg)) {
          // Records without an A record are attributed to the sender.
          fromIp.set(r, rinfo.address);
          records.push(r);
        }
      } catch { /* ignore malformed packets */ }
    });
    socket.on('error', finish);
    socket.bind(0, () => {
      socket.send(buildQuery(), MDNS_PORT, MDNS_ADDR);
      setTimeout(finish, timeoutMs);
    });
  });
}

module.exports = { browse, buildQuery, parseMessage, summarize, encodeName, TYPE };
