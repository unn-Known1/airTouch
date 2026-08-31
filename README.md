# airTouch

iPhone Gyro Demo — Access iPhone gyroscope / motion sensors on a webpage.

## Features
- Requests `DeviceOrientationEvent` + `DeviceMotionEvent` permissions (iOS 13+)
- Live alpha/beta/gamma + rotationRate + acceleration
- 3D cube preview mirroring device orientation
- Works over HTTPS (required for iOS)

## Usage
1. Serve over HTTPS (GitHub Pages, Vercel, or tunnel)
2. Open in Safari on iPhone
3. Tap `Enable Gyro / Motion` → Allow
4. Move/rotate device

> Requires Secure Context (https:// or localhost). If you denied once: Settings → Safari → Motion & Orientation Access → ON.
