# Attribution

Halo 1.2.0 is a personal interface and release. It is **based on VoCat**.

- Upstream project: [MengMengCode/VoCat](https://github.com/MengMengCode/VoCat)
- Synced through: VoCat v0.3.42
- Copyright: Copyright (c) 2026 Vocat Project Authors
- License: [Vocat Research & Evaluation License](LICENSE)

Halo does not replace VoCat and is not an official Vocat product. The Vocat name and marks stay with the original authors.

## What this branch changes

- Halo name and icon (so this build is not presented as official VoCat). The 1.2.0 icon is Halo's own artwork.
- A different web UI and a user-selectable accent color
- Local preview helpers
- Bugfix for Vodafone UK MT SMS, sent upstream as [VoCat#39](https://github.com/MengMengCode/VoCat/pull/39)
- Halo phone page, call history/recording, ePDG probe UI, radio triad, diagnostics pack
- Browser call audio (AudioWorklet, jitter buffer, band-limited resampling) and a paced ALSA uplink
- AirSIM handset support for iPhone, an Android phone line, and a WireGuard VPS relay
- NAS installer and the CellBridge update channel

Everything else — modem control, IMS / WiFi Calling, SMS, eSIM, proxy, notifications — comes from VoCat. Halo 1.2.0 includes upstream changes through VoCat v0.3.42.

## CellBridge

The optional call bridge adapts CellBridge under the MIT license. It does not replace the Vocat Research & Evaluation License that covers Halo and VoCat.

- Upstream project: [mccding/CellBridge](https://github.com/mccding/CellBridge)
- Upstream commit: `2ee9d6b05d8a4391f782e6ce8a6d23ef57015fda`
- Copyright: Copyright (c) 2026 CellBridge contributors
- License text: [LICENSES/cellbridge-MIT.txt](LICENSES/cellbridge-MIT.txt)
- Adapted paths: `internal/cellbridge/cellular`, `internal/cellbridge/sip`, `internal/cellbridge/qdc507`, `internal/cellbridge/voice`
- The QDC507 vendor voice payload is not part of this MIT copy. Deployments supply that file separately and check its hash.
- Deployment notes: [docs/CellBridge.zh-CN.md](docs/CellBridge.zh-CN.md)

## AirSIM

Two optional features speak [AirSIM](https://github.com/kai-wu-cortex/AirSIM)'s pairing, VoWLAN and Relay protocols:

- **Android phone line** (`/android`): Halo plays the part of AirSIM's iPhone client, so an Android phone running the AirSIM Standalone app can place and answer calls and send and receive texts for Halo.
- **iPhone handset** (`/iphone`): Halo plays the part of AirSIM's Android agent, so AirSIM's iPhone app can use Halo's lines. In cloud mode Halo talks to the Relay server the iPhone registered at pairing time.

Halo reimplements these protocols from their published description and source. It does not include AirSIM's Android, iOS or Relay code.

- Upstream project: [kai-wu-cortex/AirSIM](https://github.com/kai-wu-cortex/AirSIM)
- Protocol reference commit: `1855e435aa1e207e6939c525c3feea4bba09ee2b`
- Required Notice: Copyright 2026 AirSIM contributors. AirSIM is licensed under the PolyForm Noncommercial License 1.0.0. Commercial use requires separate written permission from the copyright holder.
- License text: [LICENSES/airsim-PolyForm-Noncommercial-1.0.0.txt](LICENSES/airsim-PolyForm-Noncommercial-1.0.0.txt)
- Paths: `internal/airsim`, `internal/server/airsim*.go`
- AirSIM's names and logos are not used to suggest that Halo is endorsed by the AirSIM project.

## MaVo

The QDC507 module-side voice runtime (`mavo-pcm-bridge.armv7`, `qdc507_aprv3.ko`, `qdc507_voice.ko`) comes from [moluncn/mavo](https://github.com/moluncn/mavo) `Resources/ModuleVoice` at commit `0443dfdaf8aec086fd76ba2ee9152fd908114524`. These files are not in this repository; the installer downloads them from that commit and checks their SHA-256.

## quectel-qmi-go

Native Qualcomm QMI support uses [iniwex5/quectel-qmi-go](https://github.com/iniwex5/quectel-qmi-go) v0.6.0 under the MIT license ([LICENSES/quectel-qmi-go-MIT.txt](LICENSES/quectel-qmi-go-MIT.txt)).

## Thanks

Halo exists because these people published their work: the Vocat Project Authors (MengMengCode), the CellBridge contributors (mccding), the AirSIM contributors (kai-wu-cortex), moluncn for MaVo, and iniwex5 for quectel-qmi-go. Thank you. Halo also builds on WireGuard, Go, React, Vite, Tailwind CSS, Fluent UI System Icons, Apache ECharts, modernc SQLite and the other open-source libraries listed in `go.mod` and `web/package.json`.
