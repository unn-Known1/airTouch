#!/usr/bin/env node
import WebSocket from 'ws';
import { execSync, spawnSync } from 'child_process';
import os from 'os';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const args = process.argv.slice(2);
function getArg(name, def){ const i=args.indexOf(name); return i!==-1 ? args[i+1] : def; }
const relay = getArg('--relay', 'ws://localhost:7888');
const room = getArg('--room', null);
const sens = parseFloat(getArg('--sens','1.0'));
if(!room){ console.error('Usage: airtouch-bridge --relay wss://... --room 5576 [--sens 1.2]'); process.exit(1); }

let backend='none', W=1920, H=1080, x=W/2, y=H/2;
let moveFn, clickFn, scrollFn;
function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }

// try robotjs (optional)
try{
  const robot = require('robotjs');
  const sz=robot.getScreenSize(); W=sz.width; H=sz.height; x=W/2; y=H/2;
  moveFn=(dx,dy)=>{ x=clamp(x+dx,0,W-1); y=clamp(y+dy,0,H-1); robot.moveMouse(Math.round(x),Math.round(y)); };
  clickFn=(btn='left')=> robot.mouseClick(btn);
  scrollFn=(dy)=> robot.scrollMouse(0, Math.round(dy*2));
  backend='robotjs';
  console.log(`backend robotjs ${W}x${H}`);
}catch(e){}

if(!moveFn){
  try{
    execSync('python3 -c "import pyautogui"',{stdio:'ignore'});
    const out=execSync('python3 -c "import pyautogui; w,h=pyautogui.size(); print(f\'{w} {h}\')"').toString().trim().split(' ');
    W=parseInt(out[0])||1920; H=parseInt(out[1])||1080; x=W/2; y=H/2;
    // use spawnSync with args to avoid shell injection
    moveFn=(dx,dy)=>{ x=clamp(x+dx,0,W-1); y=clamp(y+dy,0,H-1); spawnSync('python3',['-c',`import pyautogui; pyautogui.moveTo(${Math.round(x)},${Math.round(y)})`]); };
    clickFn=(btn='left')=> {
      const safe = (btn==='right'||btn==='middle'||btn==='left') ? btn : 'left';
      spawnSync('python3',['-c',`import pyautogui; pyautogui.click(button='${safe}')`]);
    };
    scrollFn=(dy)=> {
      const n = Number.isFinite(dy) ? Math.trunc(dy) : 0;
      spawnSync('python3',['-c',`import pyautogui; pyautogui.scroll(${n})`]);
    };
    backend='pyautogui';
    console.log(`backend pyautogui ${W}x${H}`);
  }catch(e){}
}
if(!moveFn && os.platform()==='linux'){
  try{ execSync('which xdotool',{stdio:'ignore'}); 
    try{ const out=execSync('xdotool getdisplaygeometry').toString().trim().split(' '); W=parseInt(out[0])||1920; H=parseInt(out[1])||1080; }catch{}
    x=W/2; y=H/2;
    moveFn=(dx,dy)=>{ x=clamp(x+dx,0,W-1); y=clamp(y+dy,0,H-1); spawnSync('xdotool',['mousemove','--sync', String(Math.round(x)), String(Math.round(y))]); };
    clickFn=(btn='left')=> spawnSync('xdotool',['click', btn==='right'?'3':'1']);
    scrollFn=(dy)=> spawnSync('xdotool',['click', dy>0?'4':'5']);
    backend='xdotool';
    console.log(`backend xdotool ${W}x${H} (sudo apt install xdotool)`);
  }catch{}
}
if(!moveFn && os.platform()==='darwin'){
  try{ execSync('which cliclick',{stdio:'ignore'}); 
    moveFn=(dx,dy)=>{ x=clamp(x+dx,0,W-1); y=clamp(y+dy,0,H-1); spawnSync('cliclick',['m:'+Math.round(x)+','+Math.round(y)]); };
    clickFn=(btn='left')=> spawnSync('cliclick',[btn==='right'?'rc:.,.':'c:.,.']);
    backend='cliclick';
    console.log(`backend cliclick`);
  }catch{
    moveFn=(dx,dy)=>{ x=clamp(x+dx,0,W-1); y=clamp(y+dy,0,H-1); try{ execSync(`osascript -e 'tell application "System Events" to set p to {${Math.round(x)}, ${Math.round(y)}}'`);}catch{} };
    backend='osascript';
  }
}
if(!moveFn && os.platform()==='win32'){
  moveFn=(dx,dy)=>{ x=clamp(x+dx,0,W-1); y=clamp(y+dy,0,H-1);
    try{
      const px=Math.round(x), py=Math.round(y);
      spawnSync('powershell.exe',['-NoProfile','-Command',`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${px},${py})`]);
    }catch{}
  };
  clickFn=()=> { try{ spawnSync('powershell.exe',['-NoProfile','-Command',`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')`]); }catch{} };
  backend='powershell';
}
if(!moveFn){ console.error('No mouse backend. Install: pip install pyautogui | npm i robotjs | linux: sudo apt install xdotool | mac: brew install cliclick'); process.exit(1); }

const url = `${relay.replace(/\/$/,'')}?room=${room}&role=laptop-bridge`;
console.log(`Connecting ${url} [${backend}] sens=${sens} cursor ${Math.round(x)},${Math.round(y)}`);
const ws = new WebSocket(url);
ws.on('open', ()=>{ console.log('Connected'); ws.send(JSON.stringify({type:'hello', role:'laptop-bridge', room})); });
ws.on('message', (data)=>{
  try{
    const j=JSON.parse(data.toString());
    const t=j.type;
    if(t==='move'){
      let dx=j.dx, dy=j.dy;
      if(typeof dx!=='number'||!isFinite(dx)) dx=0;
      if(typeof dy!=='number'||!isFinite(dy)) dy=0;
      dx=Math.max(-100,Math.min(100,dx))*sens;
      dy=Math.max(-100,Math.min(100,dy))*sens;
      moveFn(dx,dy);
    }
    else if(t==='click'){
      let btn=j.button||'left';
      if(!['left','right','middle'].includes(btn)) btn='left';
      clickFn(btn); console.log('click '+btn);
    }
    else if(t==='scroll'){
      let dy=j.dy;
      if(typeof dy!=='number'||!isFinite(dy)) dy=0;
      dy=Math.max(-100,Math.min(100,dy));
      try{ scrollFn(dy);}catch{}
    }
    else if(t==='hello'){ console.log('phone joined',j.room); }
  }catch(e){ console.error('msg err',e.message); }
});
ws.on('close', ()=>{ console.log('closed'); process.exit(0); });
ws.on('error', e=> console.error('ws error',e.message));
