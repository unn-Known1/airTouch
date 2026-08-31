# airTouch — Gyro + Android TV AirMouse

iPhone gyro demo + Android TV Air Mouse (phone as air remote).

## Pages
- `index.html` — iPhone gyro demo (alpha/beta/gamma, rotationRate, 3D cube). Standalone sensor test.
- `tv.html` — TV Receiver. Show on Android TV browser. Displays 4-digit room code + QR + virtual cursor + mock launcher.
- `airmouse.html` — Phone Remote. Gyro air mouse / Touchpad / D-Pad + Back/Home/Vol. Connect via same room code.

## Quick Start (LAN)

1. Install relay deps: `npm install` (in `airTouch/`)
2. Run relay: `node relay.js` → `ws://0.0.0.0:7889` (or `npm run relay`)
3. Run static server: `python3 -m http.server 7888 --directory .`  (already running on :7888)
4. TV: open `http://<server-ip>:7888/tv.html` (Android TV browser). Note 4-digit code.
5. Phone: open `http://<server-ip>:7888/airmouse.html?room=CODE` (or scan QR), tap Connect → Enable Gyro → Allow → tilt to move cursor.

Both devices must reach the relay (`ws://<server-ip>:7889`). Keep them on same WiFi.

## iPhone Gyro Permission
Requires HTTPS or localhost + user gesture. If denied: Settings → Safari → Motion & Orientation Access → ON, reload.

## Architecture
Phone `airmouse.html` (gyro `rotationRate` + orientation deltas + touchpad) → WebSocket `relay.js` (room broadcast) → TV `tv.html` (cursor + virtual clicks). For system-wide Android TV control, build an APK with WebSocket client + `AccessibilityService` to inject `MotionEvent`/`KeyEvent` (web-only mode controls only the browser page).

## Ports
- `7888` static (tv/airmouse/index)
- `7889` WebSocket relay

## Deploy
- GitHub Pages / Vercel for static (`index.html`, `tv.html`, `airmouse.html`) + host `relay.js` on Render/Fly.io/Raspberry Pi, set `?relay=wss://your-relay`.
- Pure local: run both servers on a laptop on same WiFi as TV + phone.
