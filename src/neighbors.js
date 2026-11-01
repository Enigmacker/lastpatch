'use strict';

// List the devices present on the local network without admin rights:
// 1. a light TCP sweep of the local subnet(s) fills the system neighbour
//    (ARP) table and tells us which hosts answer on HTTP(S);
// 2. the neighbour table gives each host's MAC address.

const net = require('node:net');
const os = require('node:os');
const fs = require('node:fs');
const { execFile } = require('node:child_process');

const MAX_HOSTS = 1024; // never sweep more than a /22

function ipToInt(ip) {
  return ip.split('.').reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}

function intToIp(n) {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

// Local IPv4 subnets of the active, non-internal interfaces.
function localSubnets(interfaces = os.networkInterfaces()) {
  const subnets = [];
  for (const addrs of Object.values(interfaces)) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal) continue;
      const bits = Number(String(a.cidr || '').split('/')[1]) ||
        a.netmask.split('.').reduce((n, o) => n + (Number(o).toString(2).match(/1/g) || []).length, 0);
      const size = 2 ** (32 - bits);
      if (size > MAX_HOSTS) continue; // too large to sweep politely
      const base = ipToInt(a.address) & ~(size - 1) >>> 0;
      subnets.push({ address: a.address, base: base >>> 0, size });
    }
  }
  return subnets;
}

function hostsOf(subnet) {
  const hosts = [];
  for (let i = 1; i < subnet.size - 1; i++) {
    const ip = intToIp((subnet.base + i) >>> 0);
    if (ip !== subnet.address) hosts.push(ip);
  }
  return hosts;
}

function probePort(ip, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: ip, port });
    const done = (open) => { socket.destroy(); resolve(open); };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

// Connect to ports 80 and 443 on every host of the local subnets. Returns the hosts
// with an open web server. Side effect wanted: the OS learns every MAC.
async function sweep({ timeoutMs = 400, concurrency = 64, subnets = localSubnets() } = {}) {
  const queue = subnets.flatMap(hostsOf);
  const web = new Set();
  async function worker() {
    while (queue.length) {
      const ip = queue.shift();
      const [h80, h443] = await Promise.all([probePort(ip, 80, timeoutMs), probePort(ip, 443, timeoutMs)]);
      if (h80 || h443) web.add(ip);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return web;
}

function normalizeMac(mac) {
  const parts = String(mac).toLowerCase().split(/[:-]/);
  if (parts.length !== 6) return null;
  const norm = parts.map((p) => p.padStart(2, '0')).join(':');
  if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(norm)) return null;
  if (norm === '00:00:00:00:00:00' || norm === 'ff:ff:ff:ff:ff:ff') return null;
  return norm;
}

// Parsers for the neighbour table formats of Linux, macOS/BSD and Windows.
function parseNeighbors(text) {
  const out = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    let m;
    let ip;
    let mac;
    if ((m = line.match(/^(\d+\.\d+\.\d+\.\d+)\s+0x\w+\s+0x(\w+)\s+([0-9a-f:]{17})/i))) {
      // /proc/net/arp: flags 0x0 means incomplete
      if (m[2] === '0') continue;
      [, ip, , mac] = m;
    } else if ((m = line.match(/^(\d+\.\d+\.\d+\.\d+)\s.*\blladdr\s+([0-9a-f:]+)/i))) {
      // ip neigh: "192.168.1.1 dev wlan0 lladdr aa:bb:.. REACHABLE"
      if (/FAILED|INCOMPLETE/.test(line)) continue;
      [, ip, mac] = m;
    } else if ((m = line.match(/\((\d+\.\d+\.\d+\.\d+)\)\s+at\s+([0-9a-f:]+)/i))) {
      // macOS / BSD: "? (192.168.1.1) at 0:11:22:33:44:55 on en0 ..."
      [, ip, mac] = m;
    } else if ((m = line.match(/^\s*(\d+\.\d+\.\d+\.\d+)\s+([0-9a-f]{2}(?:-[0-9a-f]{2}){5})\s+\w+/i))) {
      // Windows: "  192.168.1.1     00-11-22-33-44-55     dynamic"
      [, ip, mac] = m;
    } else {
      continue;
    }
    const norm = normalizeMac(mac);
    if (!norm) continue;
    if (/^(224|239|255)\./.test(ip) || ip.endsWith('.255')) continue; // multicast/broadcast
    out.set(ip, norm);
  }
  return out;
}

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 5000, windowsHide: true }, (err, stdout) => resolve(err ? '' : stdout));
  });
}

async function readNeighborTable(platform = process.platform) {
  if (platform === 'linux') {
    try { return parseNeighbors(fs.readFileSync('/proc/net/arp', 'utf8')); } catch { /* fall through */ }
    return parseNeighbors(await run('ip', ['neigh']));
  }
  if (platform === 'win32') return parseNeighbors(await run('arp', ['-a']));
  return parseNeighbors(await run('arp', ['-an']));
}

// A MAC with the "locally administered" bit is random (phones, privacy
// mode): it says nothing about the manufacturer.
function isRandomMac(mac) {
  return (parseInt(mac.slice(0, 2), 16) & 2) === 2;
}

module.exports = {
  sweep, readNeighborTable, parseNeighbors, normalizeMac, isRandomMac, localSubnets, hostsOf,
};
