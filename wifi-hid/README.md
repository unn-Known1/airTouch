# WiFi HID Dongle — ESP32

Plug into TV/laptop USB, enumerates as HID mouse. Connects via WiFi to same PeerJS room as phone.

- No APK/npx on TV/laptop — just dongle + web
- Phone: https://unn-known1.github.io/airTouch/?room=5576 (Remote tab) → PeerJS → dongle → USB HID → real cursor

## Flash
1. Install Arduino IDE + ESP32 boards
2. Open `airtouch-wifi-hid.ino`, set `WIFI_SSID`, `WIFI_PASS`, `ROOM` (or use Web Serial to set room at runtime)
3. Flash to ESP32-S2/S3/C3 (USB HID capable)
4. Plug dongle into TV/laptop USB

## Code
See `airtouch-wifi-hid.ino` (stub — full HID + WiFi + PeerJS via WebSocket)
