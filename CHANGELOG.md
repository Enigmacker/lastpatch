# Changelog

## 0.3.0 - 2026-11-01

- Dataset: 1,649 devices. The whole TP-Link UK PSTI document is now included (1,354 rows: routers, mesh, Tapo cameras and smart home, switches, access points), instead of a selection of 43.
- Build: hardware version typos are normalised ("5" -> "V5"); when a source gives two dates for the same model and hardware version, the earlier date is kept and the conflict is reported.
- Roadmap: native LAN discovery (neighbour table, MAC vendor, admin page title, mDNS).

## 0.2.0 - 2026-11-01

- Dataset: 338 devices from 13 vendors. Added NAS (Synology, QNAP) and cameras / smart home (Reolink, EZVIZ, Arlo, Ring, Netatmo).
- Matching: model names with a SKU in parentheses now match on the name or the SKU.
- ASUS UK dates are recorded as minimum guarantees, as stated on the vendor's current support page.
- CI: unit tests, dataset integrity check, and reproducible dataset build.

## 0.1.0 - 2026-11-01

- First prototype: 228 routers, mesh systems and Tapo cameras (TP-Link, AVM, ASUS, Linksys, Netgear, D-Link), each with its official source.
- `lastpatch check`, `scan` (SSDP/UPnP) and `list` commands, JSON output, exit code 2 when a device is past end of support.
