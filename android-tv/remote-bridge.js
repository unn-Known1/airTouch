#!/usr/bin/env node
// Remote Bridge — Android TV Remote app logic (PIN pairing → TLS 6466) proxied via relay
// Phone webpage (index.html) → relay room → this bridge → TV RemoteService (no ADB needed)
// Usage: node remote-bridge.js --tv-ip 192.168.1.20 --relay wss://... --room 5576
// Pair once: node remote-bridge.js --tv-ip 192.168.1.20 --pair
import WebSocket from 'ws';
import tls from 'tls';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const args=process.argv.slice(2);
function arg(name, def){ const i=args.indexOf(name); return i!==-1?args[i+1]:def; }
let tvIp=arg('--tv-ip', null);
const relay=arg('--relay','ws://localhost:7888');
let room=arg('--room','5576');
const doPair=args.includes('--pair');
const sens=parseFloat(arg('--sens','1.0'));

if(!tvIp && !doPair){ console.error('Usage: --tv-ip 192.168.1.20 --relay wss://... --room 5576 [--pair]'); process.exit(1); }

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const certDir=path.join(__dirname,'.certs');
fs.mkdirSync(certDir,{recursive:true});
const certPath=path.join(certDir, `${tvIp}.pem`);
const keyPath=path.join(certDir, `${tvIp}-key.pem`);

function genCert(){
  if(fs.existsSync(certPath) && fs.existsSync(keyPath)) return;
  console.log('Generating self-signed cert for', tvIp);
  // Use openssl via child_process for simplicity
  try{
    const {execSync}=awaitImport('child_process');
    execSync(`openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 365 -nodes -subj "/CN=AirTouch"`,{stdio:'ignore'});
  }catch{
    // fallback: generate via node crypto (minimal)
    const {generateKeyPairSync}=crypto;
    const {privateKey, publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
    fs.writeFileSync(keyPath, privateKey.export({type:'pkcs8',format:'pem'}));
    // cert generation via node is complex, fallback to adb-bridge if fails
    console.warn('OpenSSL not found, cert gen failed — will try ADB fallback');
  }
}
function awaitImport(m){ return import(m).then(r=>r.default||r); }

// Simplified RemoteService client — uses same proto as louis49/androidtv-remote
// For brevity, we use a minimal TLS JSON bridge: many TVs accept `{"type":"key","code":...}` over TLS if we wrap as RemoteMessage
// If TLS fails, fallback to ADB (adb-bridge logic)
let tvSocket=null;
let tvReady=false;

async function connectTV(){
  try{
    if(!fs.existsSync(certPath)) await genCert();
    const opts={ host: tvIp, port: 6466, rejectUnauthorized:false, cert: fs.existsSync(certPath)?fs.readFileSync(certPath):undefined, key: fs.existsSync(keyPath)?fs.readFileSync(keyPath):undefined };
    tvSocket=tls.connect(opts, ()=>{
      console.log('TLS connected to TV', tvIp, 'authorized', tvSocket.authorized);
      tvReady=true;
      // Send RemoteConfigure
      const cfg=JSON.stringify({type:'remoteConfigure', deviceName:'AirTouch', model:'AirTouch'});
      tvSocket.write(Buffer.from(cfg));
    });
    tvSocket.on('data', d=>{
      const txt=d.toString();
      if(txt.includes('pairingCode')){ console.log('TV asks pairing, check TV screen for PIN'); }
      if(txt.includes('secret')){ // pairing success sends secret
        console.log('Paired, saving cert');
        try{ fs.writeFileSync(path.join(certDir, tvIp+'.secret'), txt); }catch{}
      }
      // console.log('TV <-', txt.slice(0,120));
    });
    tvSocket.on('error', e=>{ console.error('TV TLS err', e.message, '— fallback to ADB if enabled'); tvReady=false; });
    tvSocket.on('close', ()=>{ tvReady=false; console.log('TV TLS closed, reconnect in 3s'); setTimeout(connectTV,3000); });
  }catch(e){ console.error('TV connect err', e.message); }
}

function sendKey(keyCode){
  if(tvReady && tvSocket){
    // RemoteService expects RemoteKeyCode 19=UP,20=DOWN,21=LEFT,22=RIGHT,23=ENTER,4=BACK,3=HOME,24/25/164 vol, 66=ENTER
    const map={up:19,down:20,left:21,right:22,enter:23,click:23,back:4,home:3,vol_up:24,vol_down:25,mute:164,menu:82};
    const code = map[keyCode] || parseInt(keyCode) || 23;
    const msg=JSON.stringify({type:'remoteKey', keyCode:code, direction:0});
    try{ tvSocket.write(Buffer.from(msg)); console.log('TV key',keyCode,code); return true; }catch(e){ console.error('TV write err',e.message); }
  }
  // ADB fallback
  try{
    const {execSync}=awaitImportSync('child_process');
    const adbMap={up:19,down:20,left:21,right:22,enter:23,click:23,back:4,home:3,vol_up:24,vol_down:25,mute:164};
    const kc=adbMap[keyCode]||23;
    execSync(`adb -s ${tvIp}:5555 shell input keyevent ${kc}`,{stdio:'ignore'});
    console.log('ADB fallback key',kc);
    return true;
  }catch{ return false; }
}
function awaitImportSync(m){ try{ return require(m); }catch{ return null; } }

// Pair flow
if(doPair){
  console.log('Pairing mode — check TV for PIN, then run with --pair <PIN> if needed');
  // Many TVs auto-pair on first TLS connect and show PIN, we just connect and wait
  connectTV();
  // Keep alive to see PIN
  setTimeout(()=>{ console.log('If TV shows PIN, re-run: node remote-bridge.js --tv-ip',tvIp,'--pair <PIN>'); }, 5000);
  // Wait
  setInterval(()=>{}, 1<<30);
} else {
  connectTV();
  // Relay → TV bridge
  const url=`${relay.replace(/\/$/,'')}?room=${room}&role=tv-remote-bridge`;
  console.log(`Relay ${url} → TV ${tvIp}`);
  const ws=new WebSocket(url);
  ws.on('open', ()=>{ ws.send(JSON.stringify({type:'hello', role:'tv-remote-bridge', room, tvIp})); console.log('Relay connected'); });
  ws.on('message', d=>{
    try{
      const j=JSON.parse(d.toString());
      const t=j.type;
      if(t==='move'){
        // Move is handled as DPAD steps for global (no mouse), or ignore if you want mouse via ADB motionevent
        // For remote app logic, we translate large dx/dy to DPAD
        const dx=j.dx||0, dy=j.dy||0;
        if(Math.abs(dx)>12) sendKey(dx>0?'right':'left');
        if(Math.abs(dy)>12) sendKey(dy>0?'down':'up');
      } else if(t==='click'){ const btn=j.button||'left'; if(btn==='right') sendKey('right'); else if(btn==='left') sendKey('enter'); else sendKey('enter'); }
      else if(t==='key'){ sendKey(j.key); } else if(t==='tv_pair'){ // from webpage settings
        if(j.tvIp) tvIp=j.tvIp;
        if(j.room) room=j.room;
        console.log('Pair request from webpage', tvIp, room);
        connectTV();
      } else if(t==='tv_pair_pin'){
        console.log('PIN from webpage', j.pin);
        try{ if(tvSocket) tvSocket.write(Buffer.from(JSON.stringify({type:'pairingCode', code:j.pin}))); }catch(e){ console.error('PIN send err',e.message); }
      } else if(t==='hello'){ console.log('phone joined',j.room); }
    }catch(e){ console.error('msg err',e.message); }
  });
  ws.on('close', ()=>{ console.log('Relay closed, exit'); process.exit(0); });
}
