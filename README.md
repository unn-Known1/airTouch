# AirTouch — Gyro Air Mouse for TV & Laptop

Phone as gyro air mouse. **No install — just open on any device.** Dark TV-optimized UI, PeerJS P2P + WSS relay fallback, unified multitab.

**Live (GitHub Pages):** https://unn-known1.github.io/airTouch/ — open same URL on TV/laptop (TV tab) and phone (Remote tab) with same `CODE`.

**Tunnel (local dev):** https://pottery-bikes-wheel-partly.trycloudflare.com/?room=5576

## Pages
- `index.html` — **Unified** multitab: **Remote (Phone)** • **TV Receiver** • **Sensors** (alpha/beta/gamma + 3D cube). Single URL, `?mode=tv|remote|sensors` + `?room=CODE` + `?relay=`. Dark TV mode default (`#0F0F1A` / neon `#818CF8` / `#00E6A0`), light via `prefers-color-scheme`. Soft UI Evolution, Outfit/Work Sans, 4.5:1 contrast, 44px targets, keyboard + `aria-live`.
- `tv.html` / `airmouse.html` — legacy standalone (kept for back-compat)
- `relay.js` — unified static + WS relay on `7888` (single port for tunnel). Also builds to `https://unn-known1.github.io/airTouch/` via PeerJS (no relay needed).
- `android-tv/` — `adb-bridge.py` (no APK) + `APK` via `AccessibilityService` for **global system cursor**
- `bridge-npx/` — `npx airtouch-bridge --relay wss://... --room 5576` → laptop global cursor (pyautogui/xdotool/robotjs fallback)
- `laptop-bridge.py` — Python alternative for laptop global

## Quick Start (no install)

1. **TV/laptop:** open `https://unn-known1.github.io/airTouch/?mode=tv` → note 4-digit `CODE` + QR (PeerJS P2P, no relay)
2. **Phone:** scan QR or open `https://unn-known1.github.io/airTouch/?room=CODE&mode=remote` → `Connect` → `Enable Gyro` → Allow → tilt / swipe

Both on same `CODE` → TV arrow follows. Works offline* via P2P (signaling needs internet).

## Quick Start (local relay & tunnel)

```bash
npm install --prefix airTouch
node airTouch/relay.js  # http://0.0.0.0:7888 + ws://0.0.0.0:7888
# tunnel only 7888 (single port, wss same host)
cloudflared tunnel --url http://localhost:7888
# TV: https://xxx.trycloudflare.com/tv.html?room=5576
# Phone: https://xxx.trycloudflare.com/airmouse.html?room=5576 (or unified)
# or unified: https://xxx.trycloudflare.com/?room=5576&mode=tv|remote
```

No separate `:7889` — old two-port fails on HTTPS (mixed-content).

## iPhone Gyro Permission
Requires `https://` or `localhost` + user gesture. If denied: `Settings → Safari → Motion & Orientation Access → ON`, reload. Auto-calibrates after 250ms, re-centers on stillness; `Invert X` default ON, `Invert Y` toggle, `Sensitivity` 0.5–4.

## Architecture
`airmouse (rotationRate + orientation + touchpad)` → `relay.js` (room broadcast) **or** `PeerJS DataChannel` (github.io) → `tv.html`/`index.html TV tab` (virtual cursor via `place()` + `highlight()`). Web-only = in-page cursor. For system-wide, use below.

## Global System Cursor

**Laptop (one-click, no pip):**
```bash
git clone https://github.com/unn-Known1/airTouch.git
cd airTouch/bridge-npx && npm install
npx airtouch-bridge --relay wss://pottery-bikes-wheel-partly.trycloudflare.com --room 5576
# or Python: python3 laptop-bridge.py --relay wss://... --room 5576
```

**Android TV — Option A (no APK, immediate):**
```bash
pip install websocket-client
adb connect 192.168.1.20:5555  # TV: Developer options → ADB over network
python3 android-tv/adb-bridge.py --relay wss://... --room 5576 --tv-ip 192.168.1.20
```

**Android TV — Option B (APK, no laptop):**
```bash
# Open android-tv/ in Android Studio → Build APK
adb connect <tv-ip>:5555 && adb install app-debug.apk
# TV: Settings → Accessibility → AirMouse ON → open app → wss://... + 5576 → Start
```

## Design System
Soft UI Evolution • Real-Time / Operations • `design-system/airtouch/MASTER.md` (indigo `#4F46E5`→ `#818CF8` dark / accent `#047857`→ `#00E6A0` dark, `Outfit`/`Work Sans`, shadows `sm/md/lg`). Pre-delivery: no emoji, `cursor-pointer`, 150-300ms, 4.5:1, focus-visible, `prefers-reduced-motion`, 375/768/1024/1440.

## Ports & Deploy
- `7888` unified (static + WS) — use for tunnel. GitHub Pages serves static via PeerJS; self-host relay on Render/Fly if needed with `?relay=wss://your-relay`.

## License
MIT
