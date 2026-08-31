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
            mapping={"back":4,"home":3,"menu":82,"power":26,"vol_up":24,"vol_down":25,"mute":164,"enter":23,"center":23,"up":19,"down":20,"left":21,"right":22,"dpad_center_long":23,
                     "media_play_pause":85,"media_play":126,"media_pause":127,"media_next":87,"media_prev":88,"media_stop":86,"media_rewind":89,"media_fast_forward":90,"captions":175,
                     "guide":172,"info":165,"settings_tv":176,"search":84,"input_hdmi":178,"channel_up":166,"channel_down":167,
                     "num_0":7,"num_1":8,"num_2":9,"num_3":10,"num_4":11,"num_5":12,"num_6":13,"num_7":14,"num_8":15,"num_9":16,"num_star":17,"num_hash":18,
                     "color_red":183,"color_green":184,"color_yellow":185,"color_blue":186}
            kc=mapping.get(k)
            if kc is None:
                # try generic android keycodes
                generic={"BACK":4,"HOME":3,"MENU":82,"POWER":26,"VOLUME_UP":24,"VOLUME_DOWN":25,"VOLUME_MUTE":164}
                kc=generic.get(k.upper() if k else "BACK", 4)
            if k=="dpad_center_long":
                # long press: use swipe duration
                adb("shell", "input", "swipe", str(int(x)), str(int(y)), str(int(x)), str(int(y)), "600")
                print(f"key {k} -> long press")
            else:
                adb("shell", "input", "keyevent", str(kc))
                print(f"key {k} -> {kc}")
        elif t in ("up","down","left","right","center","media_play_pause","media_play","media_pause","media_next","media_prev","media_stop","media_rewind","media_fast_forward","captions","channel_up","channel_down","guide","info","settings_tv","search","input_hdmi","power","menu","num_0","num_1","num_2","num_3","num_4","num_5","num_6","num_7","num_8","num_9","num_star","num_hash","color_red","color_green","color_yellow","color_blue","dpad_center_long"):
            kc={"up":19,"down":20,"left":21,"right":22,"center":23,"media_play_pause":85,"media_play":126,"media_pause":127,"media_next":87,"media_prev":88,"media_stop":86,"media_rewind":89,"media_fast_forward":90,"captions":175,"channel_up":166,"channel_down":167,"guide":172,"info":165,"settings_tv":176,"search":84,"input_hdmi":178,"power":26,"menu":82,"num_0":7,"num_1":8,"num_2":9,"num_3":10,"num_4":11,"num_5":12,"num_6":13,"num_7":14,"num_8":15,"num_9":16,"num_star":17,"num_hash":18,"color_red":183,"color_green":184,"color_yellow":185,"color_blue":186,"dpad_center_long":23}[t]
            if t=="dpad_center_long":
                adb("shell", "input", "swipe", str(int(x)), str(int(y)), str(int(x)), str(int(y)), "600")
            else:
                adb("shell", "input", "keyevent", str(kc))
        elif t in ("text","keyboard"):
            txt=str(data.get("text",""))[:512].replace("'","").replace('"',"")
            if txt:
                # escape spaces for input text
                esc=txt.replace("%","%25").replace(" ","%s")
                adb("shell", "input", "text", esc)
                print(f"text {txt[:40]}")
            act=data.get("action")
            if act=="enter": adb("shell", "input", "keyevent", "66")
            elif act=="search": adb("shell", "input", "keyevent", "84")
            elif act=="delete": adb("shell", "input", "keyevent", "67")
        elif t=="launch":
            pkg=str(data.get("pkg") or data.get("app") or "")[:128]
            if pkg:
                # try monkey launch
                adb("shell", "monkey", "-p", pkg, "-c", "android.intent.category.LAUNCHER", "1")
                print(f"launch {pkg}")
        elif t=="long_click":
            btn=data.get("button","left")
            dur=int(data.get("duration",600))
            adb("shell", "input", "swipe", str(int(x)), str(int(y)), str(int(x)), str(int(y)), str(max(300,min(2000,dur))))
            print(f"long_click {btn} {dur}ms")
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
