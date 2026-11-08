# Attribution

Halo 1.1.15 is a personal interface and release. It is **based on VoCat**.

- Upstream project: [MengMengCode/VoCat](https://github.com/MengMengCode/VoCat)
- Synced through: VoCat v0.3.42 (`eba11d5`)
- Copyright: Copyright (c) 2026 Vocat Project Authors
- License: [Vocat Research & Evaluation License](LICENSE)

Halo does not replace VoCat and is not an official Vocat product. The Vocat name and marks stay with the original authors.

## What this branch changes

- Halo name and icon (so this build is not presented as official VoCat)
- A different web UI and a user-selectable accent color
- Local preview helpers
- Bugfix for Vodafone UK MT SMS, sent upstream as [VoCat#39](https://github.com/MengMengCode/VoCat/pull/39)
- Halo phone page, call history/recording, ePDG probe UI, radio triad, diagnostics pack

The modem control, IMS / WiFi Calling, SMS, eSIM, proxy and notification foundations come from VoCat; this branch additionally integrates the optional CellBridge call bridge described below. Halo 1.1.15 includes VoCat v0.3.42 (`eba11d5`).

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

The optional Android phone line talks to [AirSIM](https://github.com/kai-wu-cortex/AirSIM)'s Standalone Android app over its local pairing and VoWLAN protocols, so an Android phone can place and answer calls and send and receive texts for Halo. Halo plays the part of AirSIM's iPhone client on the local network; it does not include AirSIM's Android, iOS or Relay code, and it does not use AirSIM's cloud Relay.

- Upstream project: [kai-wu-cortex/AirSIM](https://github.com/kai-wu-cortex/AirSIM)
- Protocol reference commit: `1855e435aa1e207e6939c525c3feea4bba09ee2b`
- Required Notice: Copyright 2026 AirSIM contributors. AirSIM is licensed under the PolyForm Noncommercial License 1.0.0. Commercial use requires separate written permission from the copyright holder.
- License text: [LICENSES/airsim-PolyForm-Noncommercial-1.0.0.txt](LICENSES/airsim-PolyForm-Noncommercial-1.0.0.txt)
- Path: `internal/airsim`
- AirSIM's names and logos are not used to suggest that Halo is endorsed by the AirSIM project.
