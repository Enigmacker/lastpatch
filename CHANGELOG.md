# Changelog

## 0.2.0 - 2026-11-01

- Dataset: 338 devices from 13 vendors. Added NAS (Synology, QNAP) and cameras / smart home (Reolink, EZVIZ, Arlo, Ring, Netatmo).
- Matching: model names with a SKU in parentheses now match on the name or the SKU.
- ASUS UK dates are recorded as minimum guarantees, as stated on the vendor's current support page.
- CI: unit tests, dataset integrity check, and reproducible dataset build.

## 0.1.0 - 2026-11-01

- First prototype: 228 routers, mesh systems and Tapo cameras (TP-Link, AVM, ASUS, Linksys, Netgear, D-Link), each with its official source.
- `lastpatch check`, `scan` (SSDP/UPnP) and `list` commands, JSON output, exit code 2 when a device is past end of support.
