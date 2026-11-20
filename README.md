# LastPatch

**Is your router, camera or NAS still getting security updates?**

Devices that no longer receive patches stay vulnerable forever, and nothing tells you when yours reaches that point. LastPatch is an open dataset of **official** end-of-support dates for home network devices, plus a small command-line tool that looks up a model or scans your local network.

Every row cites the manufacturer document it comes from. No date is guessed: when a vendor publishes no date, the device is reported as `unknown`.

Browse the data on **[getlastpatch.com](https://getlastpatch.com)** (English, French, German, Spanish, Italian, Portuguese), or download it: [`data/devices.json`](https://raw.githubusercontent.com/Enigmacker/lastpatch/main/data/devices.json) (ODbL).

## Quick start

Node.js 20 or later, no dependencies. Run it straight from GitHub, without installing anything:

```bash
npx github:Enigmacker/lastpatch check "FRITZ!Box 7490"
```

or from a clone of this repository, with `node src/cli.js` in place of `lastpatch` (`npm install -g .` also works where global installs are allowed):

```bash
lastpatch check "FRITZ!Box 7490"
lastpatch check "Tapo C200 V3"          # add the hardware version from the label when you know it
lastpatch scan                          # find UPnP devices on your network and check them
lastpatch list --expiring 180           # models whose support ends within 180 days
lastpatch check "FRITZ!Box 7590" --firmware 7.57   # is the installed firmware the latest one?
```

```
  AVM FRITZ!Box 7490
    status : NO LONGER SUPPORTED (guaranteed period is over; the vendor may still ship occasional fixes)
    ends   : 2025-10-01 or later
    basis  : minimum guaranteed by the vendor (support may continue)
    source : https://fritz.com/pages/status-produktunterstuetzung [EU]
```

Each result says how far the date can be trusted (`basis`): an official end date, a minimum guaranteed by the vendor, a vendor statement without a date, or no date published.

### Actively exploited vulnerabilities

Results also list the vulnerabilities of the model that attackers are known to exploit, from the [CISA Known Exploited Vulnerabilities catalogue](https://www.cisa.gov/known-exploited-vulnerabilities-catalog) (extract in `data/kev.json`, refreshed weekly). A device that is both unsupported and actively exploited should be replaced first. When CISA names the affected hardware versions, other versions of the model are not flagged. Models that are not in the dataset yet are still checked against the catalogue.

```
  "D-Link DIR-859": not in the dataset yet.
    ACTIVELY EXPLOITED: 2 vulnerability(ies) in the CISA KEV catalogue
      CVE-2019-17621: D-Link DIR-859 router contains a command execution vulnerability ...
```

### Is the installed firmware up to date?

A supported device only helps if its updates are installed. `--firmware <version>` compares the version installed on the device (shown in its admin page) with the latest version the manufacturer publishes:

```
$ lastpatch check "FRITZ!Box 7590" --firmware 7.57
  ...
    firmware: latest published by AVM: 8.51 (2026-11-09); installed: 7.57: an update is available
              https://download.avm.de/fritzbox/fritzbox-7590/deutschland/fritz.os/
```

Versions are compared as numbers ("154.07.57" on a FRITZ!Box is FRITZ!OS 7.57; "V1.0.4.126_10.1.12" on a NETGEAR router is 1.0.4.126). When the latest version of a model is not in `data/firmware.json`, or depends on a hardware version you did not give, the answer is "latest version not known" (`upToDate: null` in JSON), never "up to date".

Options: `--json` for machine-readable output, `--warn <days>` to change the "ending soon" window (default 365), `--region <cc>` to prefer dates published for a given market. Exit code `2` means at least one device is past its end of support, so the tool can be used in scripts.

## What the scan does

`lastpatch scan` combines five read-only techniques, needs no admin rights and installs nothing:

| Step | What it finds |
|---|---|
| Light sweep of your local subnet (TCP port 80, /22 at most), then the system neighbour table | every device present and its MAC address |
| MAC vendor lookup in the IEEE registries (copy included) | the manufacturer, even when the device announces nothing |
| UPnP / SSDP | manufacturer and model on routers, NAS, media devices |
| mDNS / DNS-SD (Bonjour) | device name and model on NAS, printers, cameras, smart home |
| Title and login prompt of the device's web admin page (HTTP, then HTTPS) | the model, on many routers and NAS |
| Port forwards opened on the router through UPnP (read-only query) | the devices reachable from the Internet |
| Firmware information files: `jason_boxinfo.xml` and the TR-064 description (FRITZ!Box), `currentsetting.htm` (NETGEAR), `firmwareVersion` / `softwareVersion` in UPnP descriptions | the installed firmware version, compared with the latest published |

A copy of the IEEE MAC registries ships with the tool; `lastpatch update-oui` optionally refreshes it from the IEEE website. Every probe contacts private addresses only, sends no credentials, and nothing leaves your network. Only scan networks you own or administer.

Some devices only give their model after a login, which the scan never attempts. For GL.iNet routers on firmware 4.x, the scan asks for the first step of the login (the "challenge", which involves no password) to confirm it is one, and says so; read the model on the label and run `lastpatch check`. Phones, tablets and computers usually join Wi-Fi with a private, randomised MAC address: the scan reports them as such, since the maker cannot be read from that address.

The installed firmware is read only from files these devices publish without a password; no login is tried, and the serial number they also contain is not kept. Most other brands do not publish their version this way, so the scan shows it for FRITZ!Box and NETGEAR routers, and for devices whose UPnP description includes it.

Devices that announce nothing (no UPnP, Bonjour or web page) are listed with "model not announced": read the model on the label and check it with `lastpatch check`.

## The dataset

`data/devices.json` (schema in `data/schema.json`), version 0.6.0, retrieved 2026-11-19: 11,500 rows (9,794 models) from 95 brands, now including smartphones and tablets.

| Vendor | Rows | Source |
|---|---|---|
| TP-Link | 1,354 | UK PSTI statement of compliance (full document) |
| Dahua | 1,120 | Dahua product end-of-life policy, milestone list (UK site, updated 27 October 2025): IP and PTZ cameras, recorders, door entry, switches, alarms |
| D-Link | 473 | US legacy product list; security announcements; US end-of-support notices; UK PSTI statements |
| Netgear | 375 | End of Service list (consumer Nighthawk, Orbi, extenders, cable modems; searched model by model); Australian EOS page (minimum dates); NETGEAR for Business EOL list; UK PSTI statements |
| Zyxel | 368 | Service-provider end-of-life list; UK PSTI page; archived EOL list; end-of-life page |
| EZVIZ | 311 | EZVIZ EOL product list (Europe, firmware update end dates) |
| Linksys | 1,244 | Linksys product end-of-life page (per market, checked against the full table); end-of-life article |
| QNAP | 239 | QNAP product support status (full table, mirrored); UK PSTI statements |
| Synology | 152 | Software life cycle policy (DSM, SRM, cameras, BeeStation); DSM 6.2 end-of-life announcement |
| Brother | 654 | Brother Software Security Updates Guarantee (January 2026, mirrored weekly): printers, scanners, label and mobile printers, Europe and Australia; models whose support ended between 2008 and 2025 are dated 31 December 2025 |
| Epson | 248 | Epson Australia security support periods (5 March 2026): printers, scanners, label and receipt printers, projectors; minimum dates |
| Canon | 171 | Canon UK PSTI statements: inkjet and laser printers, cameras, camcorders, PTZ cameras, photo printers |
| Samsung | 137 | Samsung Australia statements of compliance: 2023 to 2025 TVs, projectors, monitors, soundbars, Galaxy Buds, Watch, Ring and Fit |
| Tenda | 136 | Tenda EOL Center ("End of service date") |
| Mercusys | 127 | UK PSTI statement of compliance (full document) |
| eufy | 113 | Anker UK PSTI table (cameras, doorbells, HomeBase, locks) |
| Arlo | 102 | Arlo end-of-life page; UK and Australian statements of compliance |
| ASUS | 100 | UK PSTI support-period list; Singapore lifecycle list; phone product support list (ROG Phone, Zenfone: "security updates through" a year, read as 31 December of that year) |
| Ring | 85 | Ring device software security updates pages (UK, US); UK PSTI statements |
| DrayTek | 84 | DrayTek UK product lifecycle and end-of-life pages |
| Lorex | 76 | Lorex UK PSTI end-of-life table |
| Amazon (Echo, Fire TV) | 73 | Amazon device software security updates pages (UK, US) |
| AVM (FRITZ!) | 62 | FRITZ! product support status page |
| SonicWall | 76 | SonicWall product life cycle tables: TZ, NSA and NSsp firewalls, SMA remote access, SonicWave access points (End Of Support) |
| GL.iNet | 53 | GL.iNet discontinued products page; end-of-life notices; UK PSTI support period page |
| Teltonika | 52 | Teltonika EOL products page |
| Asustor | 51 | ADM end-of-support notices and product status table |
| WatchGuard | 118 | WatchGuard end-of-life policy: Firebox, XTM and access points |
| Grandstream | 109 | Grandstream UK PSTI statement of compliance (April 2026): routers, access points, switches, ATAs, VoIP gateways, IP PBXs, door access systems |
| Roborock | 49 | Roborock software security support policy (robot vacuums, wet and dry vacuums, lawn mowers; listed by model code) |
| Hive | 48 | Hive UK PSTI statement (October 2026); Hive product news |
| WD (My Cloud) | 46 | WD product life cycle policy; My Cloud OS 3 end-of-support notice |
| Bose | 37 | Bose UK security statement and table (minimum support dates) |
| Genexis | 31 | Genexis UK product support (PSTI): fibre boxes and Wi-Fi |
| Hikvision | 45 | Hikvision security support timeline for the iDS-2CD7x camera series (2 April 2026) |
| Google (Nest, Google Wifi, Pixel) | 78 | Google guaranteed software update periods page; Pixel update policy (5 or 7 years from the month the phone first went on sale on the US Google Store, per Google's availability table; Pixel 5a and earlier no longer updated) |
| Xiaomi (incl. Redmi, POCO) | 249 | Xiaomi end-of-life product list for routers and smart home (no dates); Xiaomi Security Center software support list for phones and tablets (security update end date per model) |
| Sonos | 29 | Sonos UK PSTI statement of compliance (speakers, soundbars, subwoofers, amplifiers, headphones; minimum dates) |
| EE | 26 | EE product support document (October 2026): broadband hubs, 4G/5G routers, Wi-Fi discs and extenders, TV boxes; minimum period from the sales start |
| iRobot (Roomba) | 20 | iRobot UK PSTI statements (one per regulatory model; minimum dates) |
| Keenetic | 34 | Keenetic warranty and support periods page of each model |
| Ubiquiti | 29 | Ubiquiti legacy products list (no dates) |
| Drayton (Wiser, Digistat) | 28 | Drayton security support policy and UK PSTI statements |
| Belkin (Wemo) | 27 | Belkin "Wemo support ending" page (cloud, app and support end on 31 January 2026) |
| Worcester Bosch | 21 | Worcester Bosch defined support periods for connectable products (UK PSTI): EasyControl, Connect-Key, boiler controls, gateways |
| Reolink | 406 | UK PSTI statements (all eleven product groups: cameras, kits, recorders and hubs, doorbells, PoE switches) |
| Cisco (RV, WAP, 250/350/350X/CBS350 switches, Meraki, Meraki Go) | 199 | Cisco end-of-life notices (End of Vulnerability/Security Support, or End of SW Maintenance Releases for switches); Meraki end-of-life products and dates (MR access points, MS switches, MX and Z security appliances, MG cellular gateways, MV cameras, MT sensors) |
| Aqara | 18 | UK PSTI statements |
| Blink | 18 | Blink device software security updates page |
| Bosch Smart Home | 17 | Bosch Smart Home software and security updates page |
| eero | 17 | eero software security updates page |
| Shelly | 17 | UK PSTI statements (newer devices only) |
| Netatmo, Yale, Philips Hue, Wyze | 16 | UK PSTI statements; end-of-support pages |
| devolo | 15 | UK PSTI statements |
| Nuki | 15 | UK PSTI statements |
| TerraMaster | 11 | TerraMaster end-of-support announcements |
| Edimax | 8 | Edimax end-of-support announcement |
| Nooie | 7 | Nooie security updates page (no dates) |
| Marstek | 13 | Marstek UK PSTI page (home batteries and inverters) |
| Nintendo | 7 | Nintendo UK product security update information (Switch, Switch 2, docks, Alarmo; at least 23 September 2028) |
| tado° | 6 | UK PSTI statements |
| TalkTalk | 6 | TalkTalk product cyber security page (routers, Wi-Fi hub, TV boxes) |
| Integra | 9 | Integra UK PSTI page (AV receivers and amplifiers) |
| Levoit | 5 | Levoit UK PSTI page (smart air purifiers) |
| geo (Green Energy Options) | 3 | geo UK PSTI statement (smart energy displays) |
| NVIDIA | 1 | NVIDIA UK PSTI statement (SHIELD TV) |
| Samsung SmartThings | 2 | SmartThings hub retirement notice |
| Apple (iPhone, iPad) | 64 | Apple UK PSTI statements of compliance (minimum 5 years from the first supply date given in each statement; product names from Apple's model identification pages) |
| OPPO | 43 | OPPO UK PSTI statements (phones and tablets; statements whose file holds another model's statement are left out) |
| Motorola | 39 | Motorola UK PSTI statements (security update period, month only) |
| Samsung (Galaxy phones) | 9 | Samsung UK PSTI statements published by Three (end of support date) |
| Fairphone | 5 | Fairphone software support page |
| HMD (HMD and Nokia phones) | 84 | HMD Security and Maintenance Updates page ("No guaranteed Security Patch updates after", month only, read as the last day of the month; rows HMD marks "Estimated" are left out) |
| OnePlus | 44 | OnePlus UK PSTI statements (phones, tablets, watches and earbuds; defined support period end date) |
| realme | 14 | realme UK product security update period table (end date of period) |
| Sony (PlayStation, TV, audio, cameras, Xperia) | 472 | PlayStation UK PSTI page (PS5, PS4, controllers, Portal, headsets; minimum, April 2027); Sony UK "How long will my Sony product receive security updates?" (TVs, projectors, players, sound bars, headphones, speakers, Walkman, car audio, cameras and Xperia phones; "No security update" models listed as not updated) |
| Microsoft Surface | 60 | Microsoft Learn, Surface driver and firmware lifecycle (end-of-servicing date) |
| Vivotek | 297 | Vivotek end-of-life product list (cameras, recorders, switches; no dates, no longer updated) |
| Ricoh | 76 | Ricoh support periods for MFPs and printers (Cyber Resilience Act page, month only); PSTI pages for projectors and portable monitor |
| Panasonic | 120 | Panasonic UK PSTI statements for TVs (2021 to 2025 ranges with a dated period) |
| Konica Minolta | 57 | Konica Minolta UK PSTI statement (bizhub, until 31 August 2030) |
| Lexmark | 48 | Lexmark UK PSTI firmware support statement (series) |
| Palo Alto Networks | 47 | Palo Alto Networks hardware end-of-life dates (firewalls, Panorama, ION) |
| Kyocera | 41 | Kyocera UK PSTI page (ECOSYS printers and MFPs) |
| Sharp | 32 | Sharp UK PSTI statements (one per TV series) |
| Xerox | 30 | Xerox security bulletin XRX24-009 (UK PSTI support periods) |
| BT | 21 | BT Product Support document (April 2026): hubs, Wi-Fi discs, TV boxes, extenders; minimum period from the sales start |
| Roku | 9 | Roku product security page (security update periods) |
| Dyson | 7 | Dyson statements of compliance (Australia) |
| Ninja, Shark | 6 | SharkNinja UK product security update support list |
| Virgin Media, YouFibre | 4 | Sagemcom UK PSTI statements (Hub 5, Hub 5x, WiFi Pod, YouMesh Pro) |

Each row records the date exactly as written (`support_end_raw`), whether it is a minimum guarantee (`end_is_minimum`, for "or later" / "at least"), the hardware version it applies to, the market (`region`) and the source URL.

### Known limits

- **Hardware versions matter.** The same model can have different dates per hardware revision (e.g. Tapo C200 V3 vs V5). Check the label under the device.
- **Sources sometimes contradict themselves.** When one document gives two dates for the same model and hardware version, the earlier date is kept and the build reports the conflict.
- **Dates differ by market.** ASUS publishes different dates in the UK and Singapore for the same model. Rows are never merged across regions.
- **Some vendors publish no usable date.** Netgear UK statements only say support ends at "End of Service"; D-Link UK statements say "2 years" without a start date; Swann, Imou, Logitech, SimpliSafe, Foscam, Amcrest, IKEA, Somfy, SONOFF, SwitchBot, Cudy and Aruba Instant On publish no per-model dates (some give only rules such as "three years after purchase"). Hikvision publishes a date for one camera series only, Philips Hue and Danfoss only a period with no start date ("invoice date + 5 years"), and Peplink states that it does not end-of-life its products. Xiaomi and Ubiquiti only list products that no longer get updates, without dates.
- **Minimum guarantees run out.** Google, Amazon, ASUS and others promise updates "until at least" a date. Once it has passed, the device is shown as no longer supported, with a note that updates may still come.
- **Keenetic** pages give three dates; the dataset uses the end of "Limited updates", the last phase in which security updates are promised, not the later "support discontinuation" date.
- **Tenda's "End of service date"** is often a day after its end of sale. Tenda's UK PSTI page promises security support for 3 years after end of life in the UK, without a per-model table, so UK units may be supported longer.
- **Recent NAS models have no dates yet.** Synology gives dates per DSM version, and models on DSM 7.2 or later have no announced end. QNAP and Asustor mark many current models as active, without an end date.
- **ISP boxes are out of scope.** Routers supplied by internet providers (Livebox, Freebox, Bbox, SFR Box, etc.) are updated and replaced by the provider, which publishes no end-of-support date.
- **Professional ranges are included when the date is official.** Dahua's list covers its whole catalogue; only network devices (cameras, recorders, door entry, switches, alarms) are kept.

### Latest firmware

`data/firmware.json` (schema in `data/firmware-schema.json`) lists the latest firmware version each manufacturer publishes for a model: `vendor`, `model` (as written in `devices.json`), `hw_version`, `region`, `latest_version`, `release_date`, `source_url`, `retrieved`. Only official download servers are used.

| Vendor | Rows | Source |
|---|---|---|
| AVM (FRITZ!Box) | 9 | AVM download server (`download.avm.de/fritzbox/<model>/deutschland/fritz.os/`): the version of the image file, the release date from the release notes (`info_de.txt`, `info_en.txt`) when they describe that same version |

The AVM rows are refreshed every week from AVM's download server.

Limits of the firmware check:

- **Vendors covered:** AVM FRITZ!Box only for the latest version. FRITZ!Repeater and Mesh sets are not covered yet. The installed version is read on FRITZ!Box and NETGEAR routers and on devices whose UPnP description includes it; for other brands, give it with `--firmware`.
- **Release notes can lag behind.** On 2026-11-11 AVM served FRITZ!OS 8.51 for the 7590 AX while its release notes still described 8.25, and the English notes of the 7590 also still described 8.25. The version is then taken from the image file and the release date is left empty.
- **Markets differ.** Rows come from AVM's German folder (`region: DE`), falling back to the international one. Provider-branded boxes (e.g. 1&1, Vodafone) are updated by the provider on its own schedule; the scan flags them.
- **Lab (beta) versions** are flagged, and an installed version newer than the recorded one is reported as up to date with a note.

## Keeping the dataset current

Every official source the dataset cites is checked again every week, and the changes are reviewed by hand before the rows are updated. Sources that cannot be read automatically are checked in a browser. Mirrored vendor lists (QNAP, Linksys, WatchGuard, Meraki, SonicWall, Brother, Epson) and the CISA exploited vulnerabilities extract are refreshed the same way.

## Website

[getlastpatch.com](https://getlastpatch.com) presents this dataset in English, French, German, Spanish, Italian and Portuguese, with one page per model, brand and device type. It is a service offered by Securissima, Ireland. Its source is kept in a separate repository; it reads `data/` and `src/` from this repository at build time and is rebuilt every day.

## Using the data

`data/devices.json` holds one row per model, hardware version and market. The fields are described in `data/schema.json`; the most useful are:

| Field | Meaning |
|---|---|
| `vendor`, `model`, `hw_version` | the device as the manufacturer writes it |
| `support_end` | last day of security updates (ISO date), or `null` when the vendor gives none |
| `support_end_raw` | the date or sentence exactly as published |
| `end_is_minimum` | `true` when the vendor promises "at least" until that date |
| `region` | the market the document applies to (`global`, `EU`, `UK`, `US`, …) |
| `source_url`, `source_title` | the manufacturer document |

### History of published dates

`data/history.json` (schema in `data/history-schema.json`) keeps every end date the dataset has published, so you can see when a manufacturer changed a support period. There is one entry per row key (`vendor`, `model`, `hw_version`, `region`, matched without regard to case), with its `dates` in order:

| Field | Meaning |
|---|---|
| `support_end`, `support_end_raw` | the end date and the source text when it was first seen |
| `first_seen`, `last_seen` | the dataset `generated` dates of the first and latest builds that had this date (not the date the manufacturer published it) |
| `source_url` | the source cited when it was first seen |
| `shortened` | `true` when this date is earlier than one published before it for the same key; the key itself has `shortened: true` when any of its dates is |
| `correction`, `note` | set by hand when a change comes from how the dataset reads the source, not from the manufacturer; a correction is never flagged as shortened |

`npm run build:data` updates the file: a changed date is appended and an unchanged one extended. Nothing is deleted, and rows that leave `devices.json` keep their history. The history starts with the first published dataset (1 November 2026); dates a manufacturer changed before a row was collected are not known.

Under the UK PSTI regime, a manufacturer may extend the published support period of a product but not shorten it (Product Security and Telecommunications Infrastructure (Security Requirements for Relevant Connectable Products) Regulations 2023, Schedule 1, paragraph 3(6)). The rule covers products sold in the UK; the flag is computed for every region. A `shortened` flag is a pointer to check against the manufacturer's document, not a finding: the dataset may have been wrong before.

The data is under the Open Database License: reuse is free, including commercially, as long as you credit LastPatch (with a link to getlastpatch.com or this repository) and share any database you derive from it under the same license.

## Contributing data

Found a wrong date or a missing manufacturer document? [Open an issue](https://github.com/Enigmacker/lastpatch/issues) with a link to the official page. Only manufacturer documents are accepted: no forums, retailers or press articles.

To add rows yourself, put them in a file in `raw/` (same fields as above), then run `npm run build:data` and `npm test`. Rows without a source URL or with a malformed date are rejected.

## Roadmap

- More vendors, device types and markets, from official sources only.
- Installed vs latest firmware for more vendors.
- Desktop apps and a browser extension.

## License

- Code: MIT (see `LICENSE`).
- Exploited vulnerabilities extract (`data/kev.json`): CISA KEV catalogue, a U.S. Government work in the public domain.
- MAC vendor table (`data/oui.tsv`): public IEEE MA-L/MA-M/MA-S registries, as packaged by the `oui-data` npm package (BSD-2-Clause); regenerate with `npm run update:oui`.
- Datasets (`data/devices.json`, `data/history.json`, `data/firmware.json`): Open Database License (ODbL) 1.0 (see `data/LICENSE`). You may reuse it, including commercially, but you must attribute LastPatch and share any database you derive from it under the same license.
