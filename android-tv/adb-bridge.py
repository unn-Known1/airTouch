#!/usr/bin/env python3
"""
Global AirMouse -> Android TV via ADB
Connects to relay as tv-bridge, receives move/click/key from phone, injects via `adb shell input`.

Usage:
  pip install websocket-client
  # Enable ADB over network on TV: Settings -> Developer options -> USB debugging -> ADB over network (or `adb tcpip 5555`)
  python3 adb-bridge.py --relay wss://pottery-bikes-wheel-partly.trycloudflare.com --room 5576 --tv-ip 192.168.1.20

Then phone: https://<tunnel>/airmouse.html?room=5576
"""
import argparse, json, time, subprocess, shlex, sys
try:
    import websocket
except ImportError:
    print("pip install websocket-client"); sys.exit(1)

parser = argparse.ArgumentParser()
parser.add_argument("--relay", default="ws://localhost:7888", help="relay url without ?room, e.g. wss://xxx.trycloudflare.com or ws://192.168.1.5:7888")
parser.add_argument("--room", required=True)
parser.add_argument("--tv-ip", required=True, help="Android TV IP")
parser.add_argument("--adb-port", default="5555")
parser.add_argument("--sens", type=float, default=1.0, help="extra sensitivity multiplier")
args = parser.parse_args()

relay = args.relay.rstrip("/")
url = f"{relay}?room={args.room}&role=tv-bridge"
tv = f"{args.tv_ip}:{args.adb_port}"

def adb(*cmd):
    full = ["adb", "-s", tv] + list(cmd)
    print("ADB:", " ".join(full))
    try:
        subprocess.run(full, timeout=2, check=False)
    except Exception as e:
        print("ADB err", e)

# connect adb
print(f"Connecting ADB to {tv}...")
subprocess.run(["adb", "connect", tv], timeout=5)
# get screen size for clamping
try:
    out = subprocess.check_output(["adb", "-s", tv, "shell", "wm", "size"], timeout=3).decode()
    # e.g. Physical size: 1920x1080
    import re
    m=re.search(r"(\d+)x(\d+)", out)
    W,H = map(int, m.groups()) if m else (1920,1080)
except: W,H = 1920,1080
print(f"TV size {W}x{H}")

# cursor state
x,y = W//2, H//2
def clamp(v, lo, hi): return max(lo, min(hi, v))

def on_message(ws, msg):
    global x,y
    try:
        data=json.loads(msg)
        t=data.get("type")
        if t=="move":
            dx=(data.get("dx",0) or 0)*args.sens
            dy=(data.get("dy",0) or 0)*args.sens
            x=clamp(x+dx, 0, W-1)
            y=clamp(y+dy, 0, H-1)
            # use input motionevent via swipe with 0 duration or mouse via `input swipe`
            # Android `input motionevent` not available on all TVs, fallback to `input swipe x y x y 10` to move
            # For true hover, we use `input mouse` if available, else tap simulation
            # Here we use `input motionevent` hidden API if present, else `input swipe`
            # Simpler: `input mouse` is not standard, so we do `input tap` for click but for move we use `input swipe` trick
            # Workaround: use `adb shell input motionevent` via `sendevent` is device-specific, so we approximate with `input swipe x y x y 0`
            # Many Android TV builds support `input mouse` via `adb shell input mouse <x> <y>` (hover)
            # Try `input motionevent` first
            adb("shell", "input", "motionevent", str(int(x)), str(int(y)), "0")  # may fail silently
            # fallback: set pointer via `settings` not needed
            # For visibility, also try `input swipe`
            # adb("shell", f"input swipe {int(x)} {int(y)} {int(x)} {int(y)} 1")
            print(f"move -> {int(x)},{int(y)} dx={dx:.1f} dy={dy:.1f}")
        elif t=="click":
            adb("shell", "input", "tap", str(int(x)), str(int(y)))
            print(f"click {int(x)},{int(y)}")
        elif t=="key":
            k=data.get("key")
            mapping={"back":"BACK","home":"HOME","menu":"MENU","power":"POWER","vol_up":"VOLUME_UP","vol_down":"VOLUME_DOWN","mute":"VOLUME_MUTE"}
            code=mapping.get(k, k.upper() if k else "BACK")
            # try keyevent
            keycodes={"BACK":4,"HOME":3,"MENU":82,"POWER":26,"VOLUME_UP":24,"VOLUME_DOWN":25,"VOLUME_MUTE":164}
            kc=keycodes.get(code, 4)
            adb("shell", "input", "keyevent", str(kc))
            print(f"key {k} -> {kc}")
        elif t in ("up","down","left","right"):
            kc={"up":19,"down":20,"left":21,"right":22}[t]
            adb("shell", "input", "keyevent", str(kc))
        elif t=="center":
            x,y=W//2,H//2
            adb("shell", "input", "motionevent", str(x), str(y), "0")
        elif t=="hello":
            print("phone joined", data.get("room"))
    except Exception as e:
        print("msg err", e, msg[:200] if 'msg' in locals() else "")

def on_open(ws):
    print(f"Connected to relay {url} as tv-bridge, listening...")
    ws.send(json.dumps({"type":"hello","role":"tv-bridge","room":args.room}))

def on_error(ws, e): print("WS error", e)
def on_close(ws, c, m): print("WS closed", c, m, "reconnect in 2s"); time.sleep(2); ws.run_forever()

print(f"WS {url}")
ws = websocket.WebSocketApp(url, on_open=on_open, on_message=on_message, on_error=on_error, on_close=on_close)
ws.run_forever()
