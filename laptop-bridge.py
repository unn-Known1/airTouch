#!/usr/bin/env python3
"""
Laptop Global Mouse Bridge — test AirMouse system-wide on your laptop
Moves real OS cursor via pyautogui (or pynput fallback)

Usage:
  pip install websocket-client pyautogui
  python3 laptop-bridge.py --relay wss://pottery-bikes-wheel-partly.trycloudflare.com --room 5576 --sens 1.2

Then phone: https://<tunnel>/airmouse.html?room=5576 → moves laptop cursor!

Controls: move, click, scroll, back/home/keys (maps to keyboard)
"""
import argparse, json, time, sys, subprocess
try:
    import websocket
except ImportError:
    print("pip install websocket-client"); sys.exit(1)

parser = argparse.ArgumentParser()
parser.add_argument("--relay", default="ws://localhost:7888")
parser.add_argument("--room", required=True)
parser.add_argument("--sens", type=float, default=1.0)
args = parser.parse_args()

# try pyautogui, fallback to pynput
mouse = None
mode = None
try:
    import pyautogui
    pyautogui.FAILSAFE=False
    W,H = pyautogui.size()
    x,y = W//2, H//2
    mode="pyautogui"
    def move(dx,dy):
        global x,y
        x+=dx; y+=dy
        x=max(0,min(W-1,x)); y=max(0,min(H-1,y))
        pyautogui.moveTo(int(x),int(y), duration=0)
    def click(): pyautogui.click()
    def scroll(dy): pyautogui.scroll(int(dy*10))
    def key(k):
        m={"back":"esc","home":"win","vol_up":"volumeup","vol_down":"volumedown","mute":"volumemute"}
        try: pyautogui.press(m.get(k,k))
        except: pass
    print(f"pyautogui {W}x{H} cursor {x},{y}")
except:
    try:
        from pynput.mouse import Controller, Button
        from pynput.keyboard import Controller as KCtrl, Key
        m=Controller(); k=KCtrl()
        # get screen size via tkinter fallback
        try:
            import tkinter as tk; r=tk.Tk(); W=r.winfo_screenwidth(); H=r.winfo_screenheight(); r.destroy()
        except: W,H=1920,1080
        x,y=W//2,H//2
        m.position=(x,y)
        mode="pynput"
        def move(dx,dy):
            global x,y
            x+=dx; y+=dy
            x=max(0,min(W-1,x)); y=max(0,min(H-1,y))
            m.position=(int(x),int(y))
        def click(): m.click(Button.left,1)
        def scroll(dy): m.scroll(0, int(dy))
        def key(k): pass
        print(f"pynput {W}x{H}")
    except Exception as e:
        print(f"No mouse lib: {e}\n pip install pyautogui  OR  pip install pynput"); sys.exit(1)

url=f"{args.relay.rstrip('/')}?room={args.room}&role=laptop-bridge"
print(f"WS {url} mode={mode}")

def on_message(ws, msg):
    try:
        d=json.loads(msg)
        t=d.get("type")
        if t=="move":
            dx=(d.get("dx",0) or 0)*args.sens
            dy=(d.get("dy",0) or 0)*args.sens
            move(dx,dy)
            print(f"move {dx:.1f},{dy:.1f} -> {int(x)},{int(y)}")
        elif t=="click": click(); print("click")
        elif t=="scroll": scroll(d.get("dy",0))
        elif t in ("up","down","left","right"): key(t)
        elif t=="key": key(d.get("key"))
        elif t=="hello": print("phone joined", d.get("room"))
    except Exception as e: print("err",e)

def on_open(ws): print("Connected as laptop-bridge"); ws.send(json.dumps({"type":"hello","role":"laptop-bridge","room":args.room}))
def on_error(ws,e): print("WS error",e)
def on_close(ws,c,m): print("WS closed",c,m)

ws=websocket.WebSocketApp(url, on_open=on_open, on_message=on_message, on_error=on_error, on_close=on_close)
ws.run_forever()
