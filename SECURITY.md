# Security Policy

## Supported Versions
| Version | Supported |
|---------|-----------|
| main    | ✓ |

## Reporting a Vulnerability
Please report vulnerabilities via GitHub Security Advisories or email the maintainer. Do not open public issues for sensitive reports.

## Security Hardening (this repo)

### Relay (`relay.js`)
- Static serving allowlist (`/`, `/index.html`, `/tv.html`, `/airmouse.html`, `/manifest.json`, `/sw.js`) — all other paths 404, prevents leaking `relay.js`, `.git/`, `android-tv/` source.
- Path traversal protection via `path.resolve` + `path.relative` and `startsWith(ROOT + sep)`.
- Security headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy: same-origin`.
- WebSocket: `maxPayload 16KB`, `perMessageDeflate: false`, per-IP connection limit (20), per-socket rate limit (60 msg/s), `MAX_ROOMS 5000`, room/role strict allowlist, `ALLOWED_TYPES` validation, `dx/dy` clamped to ±100 and finite check, malformed JSON dropped (no broadcast).
- Room codes are ephemeral 4-digit + 16-char sanitized; brute-force is possible (10k space) — for sensitive use deploy with `?room=<long-random>` or add HMAC secret in front of relay.

### Clients
- `index.html` QR fallback uses `textContent` (no `innerHTML` injection), all `dx/dy` validated finite and clamped.
- `bridge-npx` and `remote-bridge` use `spawnSync` with arg arrays (no shell interpolation), `btn` and `tvIp` validated via allowlists/regex, `openssl` and `adb` invoked without shell.

### Android APK
- Permissions: `INTERNET` + `ACCESS_NETWORK_STATE` + `BIND_ACCESSIBILITY_SERVICE` only.
- `minSdk 24` (Android 7.0) — `dispatchGesture` requires API 24.
- `AirMouseService` clamps moves to ±100 and checks `isFinite`.
- No data collection; WebSocket only to user-configured `relay`.

### Recommendations for Production
- Put relay behind reverse proxy with TLS, rate-limit at edge, and firewall `7888` to LAN only if not public.
- Rotate `relay` tunnel domains (Cloudflare `trycloudflare.com` is ephemeral).
- Sign release APKs; publish `sha256` checksums via GitHub Releases (workflow does this).
