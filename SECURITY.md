# Security Policy

## Reporting a vulnerability

Please do not open a public issue for security problems. Use GitHub's private vulnerability reporting ("Report a vulnerability" in the Security tab of this repository). You will get an acknowledgement within 7 days.

## Scope

- The `lastpatch` command-line tool, in particular the LAN scanner (`src/discover.js`), which parses data sent by devices on your network.
- The build script that ingests raw dataset files.

## Design notes

- The scanner is read-only. It sends SSDP discovery requests and fetches device description files over HTTP **only from private (RFC 1918 / link-local) addresses**, with size and time limits.
- No data leaves your machine. The tool has no telemetry.

## Wrong dates

An incorrect end-of-support date is a data error, not a vulnerability: open a regular issue with a link to the official manufacturer source.
