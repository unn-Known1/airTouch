# AirMouse Global — Android TV APK

System-wide cursor via AccessibilityService + WebSocket relay.

## Build
1. Open `android-tv/` in Android Studio (Giraffe+)
2. Sync Gradle (requires `com.squareup.okhttp3:okhttp:4.12.0`)
3. Build → APK → installs on TV

## Install on TV
```bash
adb connect <tv-ip>:5555
adb install android-tv/app/build/outputs/apk/debug/app-debug.apk
```
On TV: Settings → Accessibility → AirMouse → ON (grant). 
Then open AirMouse app, enter `relay` (e.g. `wss://xxx.trycloudflare.com`) + `room 5576` → Start.

Phone keeps using `https://xxx/airmouse.html?room=5576` — now moves *system* cursor, not just browser.

## How it works
App connects as `role=tv-global` to `relay.js`, receives `{type:"move",dx,dy}`, translates to `dispatchGesture` (AccessibilityService) for hover/move, `click` via tap gesture, keys via `performGlobalAction` / `injectKeyEvent` (via `Instrumentation` fallback).

Fallback if not accessibility: can also use `adb shell` bridge (`adb-bridge.py`) without APK — run that on a laptop/Raspberry Pi on same LAN as TV.
