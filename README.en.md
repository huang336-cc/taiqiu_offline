# Ultraman Billiards · Chinese Offline Edition

<p align="center"><a href="README.md"><b>中文</b></a> | <b>English</b></p>

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Platform](https://img.shields.io/badge/platform-Android%205.0%2B-brightgreen.svg)](#download)
[![Permissions](https://img.shields.io/badge/Permissions-0-success.svg)](#privacy)

A fully Chinese, fully offline, ad-free Android billiards game. Built on three.js with a realistic physics engine and a built-in local AI opponent. **Requests no system permissions at all.**

<p align="center">
  <img src="docs/screenshots/menu-home.jpg" alt="Main Menu" width="48%" />
</p>
<p align="center"><em>Main Menu: game mode selection, opponent difficulty, appearance customization</em></p>

<p align="center">
  <img src="docs/screenshots/android-topview.jpg" alt="Android Gameplay · Top View" width="48%" />
  <img src="docs/screenshots/android-cueview.jpg" alt="Android Gameplay · Cue View" width="48%" />
</p>
<p align="center"><em>Android gameplay: top view (left) and cue view (right)</em></p>

> **Derivative Work Notice**
> This project is a **derivative work** of the open-source project [tailuge/billiards](https://github.com/tailuge/billiards),
> modified on **August 3, 2026**.
> The original project is copyrighted by tailuge and its contributors, and is licensed under the GNU GPL v3.0.
> This derivative work is likewise released under **GPL-3.0**.

---

## Download

**Online Play Page**: <https://a8bf01e5f1e8b47ce.bj9.agentos-app.net/>

No installation needed — **play online** right in your browser, or download the latest APK directly from that page.

You can also download the latest APK from [Releases](../../releases/latest).

Installation instructions and FAQs can be found in [`docs/安装与使用说明.md`](docs/安装与使用说明.md).

---

## Features

| | |
|---|---|
| **Fully Offline** | No networking, no account, no ads, no in-app purchases, no telemetry |
| **Zero Permissions** | `AndroidManifest.xml` declares no `uses-permission`; verify yourself with `aapt2 dump badging` |
| **All Chinese** | Menus, gameplay, settings, foul prompts, and results text fully localized |
| **Realistic Physics** | Inherits the original project's ball collision, spin (English), cushion rebound, and friction models |
| **Local AI** | Two difficulty levels (Steady / Aggressive), all computed locally |
| **Adjustable Quality** | Six-tier LOD graphics system with automatic device performance detection; runs smoothly even on low-end devices |
| **Game Modes** | Nine-ball, Snooker, Three-cushion Billiards, Practice mode |

---

## Credits & Acknowledgements

| Project | [tailuge/billiards](https://github.com/tailuge/billiards) |
|---|---|
| Author | tailuge |
| License | GNU General Public License v3.0 |
| Baseline Version | 0.3.1 |

The **physics engine, rendering pipeline, rule adjudication, and local AI opponent** of this project all come from the original project above.
The realistic ball collision, spin, cushion rebound, and friction models are the original author's work. Thanks to tailuge and all contributors.

The full open-source notice, modification list, and third-party component list can be found in [`开源声明.md`](开源声明.md).

---

## Major Changes

**Chinese Localization** — Menus, gameplay instructions, settings, operation guide, shot buttons, scoreboard, foul reasons,
win/loss results, and snooker ball names are all localized; added a centralized text module `src/utils/i18n.ts`.

**Removed Networking** — Removed the WebSocket multiplayer lobby and message relay (including the `@tailuge/messaging` dependency),
score uploads, telemetry, crash reporting, Google Fonts external links, share links, position export, and the online analysis panel.

**Mobile Adaptation** — Added a six-tier LOD graphics system (render resolution / anti-aliasing / ball geometry precision),
automatic device performance detection, notched-screen safe-area adaptation, landscape layout optimization, and vibration feedback on pots and collisions.

**New Features** — Chinese main menu, built-in operation guide page, built-in game settings panel (synced in real time between menu and in-game),
and an in-app open-source license & credits page.

**Android Wrapper** — Native Android WebView shell that requests no system permissions.

---

## Privacy

This app collects no data because it **has no ability** to collect any:

- No `INTERNET` permission is declared, so the process cannot make any network requests
- No storage, location, phone, camera, or any other permissions are declared
- All resources (three.js, models, sounds) are packaged inside the APK with zero external links at runtime

You can enable airplane mode right after installation and keep playing.

---

## Directory Structure

```
billiards-cn/          Game engine
  src/                 TypeScript source
  dist/                Build output (open menu.html in a browser to try it)
  webpack.config.js    Bundling configuration
  LICENSE              Full GPL-3.0 license text

billiards-apk/         Android wrapper
  AndroidManifest.xml  App manifest (zero permissions)
  src/                 MainActivity.java
  res/                 Icons and string resources
  build-apk.sh         One-click build script

docs/                  Installation and release notes
开源声明.md             GPL-3.0 derivative notice and third-party component list
```

---

## Building

### Frontend

```bash
cd billiards-cn
yarn install
node_modules/.bin/tsc --noEmit      # type check
node_modules/.bin/webpack           # bundle to dist/
```

The output is `index.js`, `three_core.js`, `three_module.js`, `three_examples.js` under `dist/`.
Open `dist/menu.html` directly in a browser to try it — no server required.

### Android APK

No Gradle dependency; uses the low-level Android SDK toolchain. Requires `platforms/android-34`, `build-tools/34.0.0`, and JDK:

```bash
export ANDROID_SDK=/path/to/android-sdk
cd billiards-apk
./build-apk.sh
```

The script runs `aapt2 compile` → `aapt2 link` → `javac` → `d8` → `zipalign` → `apksigner` in sequence,
then automatically verifies the signature and prints the permission list (which should be empty). If no `release.keystore` exists in the directory, the script auto-generates a self-signed debug key.

> **Build Pitfall**: `aapt2 link` must explicitly pass `--min-sdk-version 21 --target-sdk-version 34`.
> Otherwise aapt2 silently appends `WRITE_EXTERNAL_STORAGE`, `READ_PHONE_STATE`,
> and `READ_EXTERNAL_STORAGE` under legacy compatibility rules, breaking the zero-permission promise.

---

## License

This project is released under the **GNU General Public License v3.0**, consistent with the original project.
The full license text is in [`LICENSE`](LICENSE), or visit <https://www.gnu.org/licenses/gpl-3.0.html>.

You are free to run, study, modify, and redistribute this project, provided that redistribution follows the same GPL-3.0 terms
and provides the corresponding complete source code.

This program is provided without any warranty; use it at your own risk.
