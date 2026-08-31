# airTouch — Gyro + Android TV AirMouse

iPhone gyro demo + Android TV Air Mouse (phone as air remote).

## Pages
- `index.html` — iPhone gyro demo (alpha/beta/gamma, rotationRate, 3D cube). Standalone sensor test.
- `tv.html` — TV Receiver. Show on Android TV browser. Displays 4-digit room code + QR + virtual cursor + mock launcher.
- `airmouse.html` — Phone Remote. Gyro air mouse / Touchpad / D-Pad + Back/Home/Vol. Connect via same room code.

## Quick Start (LAN & Tunnel)

1. Install: `npm install` (in `airTouch/`)
2. Run unified server: `node relay.js` → `http://0.0.0.0:7888` + `ws://0.0.0.0:7888` (serves static + WS on same port for tunnel)
3. TV: open `http://<server-ip>:7888/tv.html` (Android TV browser). Note 4-digit code + QR.
4. Phone: open `http://<server-ip>:7888/airmouse.html?room=CODE` (or scan QR), `Connect` → `Enable Gyro` → Allow → tilt to move.

Both devices use same `ws(s)://<host>:7888` automatically. **Tunnel fix (this was your bug):** forward **only `7888`** via `cloudflared tunnel --url http://localhost:7888` / `ngrok http 7888`. Then phone/TV both use `wss://<tunnel-host>` (same as page, no `:7889`). Old two-port setup (`7888 static + 7889 WS`) fails on tunnel + HTTPS (mixed-content + unreachable `ws://...:7889`).

Tunnel example:
```
cloudflared tunnel --url http://localhost:7888
# TV: https://xxx.trycloudflare.com/tv.html
# Phone: scan QR -> https://xxx.trycloudflare.com/airmouse.html?room=CODE&relay=wss://xxx.trycloudflare.com
```

## iPhone Gyro Permission
Requires HTTPS or localhost + user gesture. If denied: Settings → Safari → Motion & Orientation Access → ON, reload.

## Architecture
Phone `airmouse.html` (gyro `rotationRate` + orientation deltas + touchpad) → WebSocket `relay.js` (room broadcast) → TV `tv.html` (cursor + virtual clicks). For system-wide Android TV control, build an APK with WebSocket client + `AccessibilityService` to inject `MotionEvent`/`KeyEvent` (web-only mode controls only the browser page).

## Ports
- `7888` unified (static + WebSocket relay) — **use this for tunnel**. No separate `7889` needed (old doc).

## Deploy
- GitHub Pages / Vercel for static (`index.html`, `tv.html`, `airmouse.html`) + host `relay.js` on Render/Fly.io/Raspberry Pi, set `?relay=wss://your-relay`.
- Pure local: run both servers on a laptop on same WiFi as TV + phone.

## Global Mouse (system-wide on Android TV)

Browser `tv.html` only moves the *virtual cursor inside the page*. For **global system cursor** (control launcher, Netflix, any app):

**Option A — No APK, immediate (recommended for test):**
```bash
pip install websocket-client
# TV: Settings → Developer options → enable ADB over network (or adb tcpip 5555)
adb connect 192.168.1.20:5555
python3 android-tv/adb-bridge.py --relay wss://pottery-bikes-wheel-partly.trycloudflare.com --room 5576 --tv-ip 192.168.1.20
# Keep this running on a laptop/Raspberry Pi on same WiFi as TV
# Phone: https://.../airmouse.html?room=5576 → moves real TV pointer, click = tap
```

**Option B — Native APK (no laptop needed):**
1. Open `android-tv/` in Android Studio → Build APK
2. `adb connect <tv-ip>:5555 && adb install app-debug.apk`
3. TV Settings → Accessibility → AirMouse → ON → Open AirMouse app → enter `wss://...` + `5576` → Start
4. Phone same `airmouse.html` now drives *system* cursor via `AccessibilityService.dispatchGesture`.

Both reuse the same relay/room — phone unchanged.
