# Security Policy

## Reporting a vulnerability

Please do not open a public issue for security problems. Use GitHub's private vulnerability reporting ("Report a vulnerability" in the Security tab of this repository). You will get an acknowledgement within 7 days.

## Scope

- The `lastpatch` command-line tool, in particular the LAN scanner (`src/discover.js`), which parses data sent by devices on your network.
- The build script that ingests raw dataset files.

## Design notes

- The scanner is read-only and needs no admin rights. It connects to TCP port 80 across the local subnet (at most a /22, never larger networks), reads the system neighbour table, sends SSDP and mDNS discovery queries, and fetches device description files and admin page titles over HTTP(S) **only from private (RFC 1918 / link-local) addresses**, with size and time limits. It never sends credentials.
- TLS certificate checks are disabled only when reading an admin page title, because home devices use self-signed certificates; no data is sent to those pages.
- No data leaves your machine, except the one-time download of the public IEEE MAC registry (`lastpatch update-oui`). The tool has no telemetry.
- Only scan networks you own or administer.

## Wrong dates

An incorrect end-of-support date is a data error, not a vulnerability: open a regular issue with a link to the official manufacturer source.
