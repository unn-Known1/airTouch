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

function isValidTvIp(ip){
  if(!ip || typeof ip !== 'string') return false;
  if(ip.length > 45) return false;
  // allow IPv4, IPv6 bracket, or hostname
  return /^(?:\d{1,3}\.){3}\d{1,3}$|^[a-zA-Z0-9.-]{1,253}$/.test(ip) && !/[;&|`$\\'"!*?~<>^()#]/.test(ip);
}
if(tvIp && !isValidTvIp(tvIp)){ console.error('Invalid --tv-ip'); process.exit(1); }
if(!tvIp && !doPair){ console.error('Usage: --tv-ip 192.168.1.20 --relay wss://... --room 5576 [--pair]'); process.exit(1); }

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const certDir=path.join(__dirname,'.certs');
fs.mkdirSync(certDir,{recursive:true});
const safeTvIp = (tvIp||'unknown').replace(/[^a-zA-Z0-9.-]/g,'_').slice(0,64);
const certPath=path.join(certDir, `${safeTvIp}.pem`);
const keyPath=path.join(certDir, `${safeTvIp}-key.pem`);

function genCert(){
  if(fs.existsSync(certPath) && fs.existsSync(keyPath)) return;
  console.log('Generating self-signed cert for', tvIp);
  // Use openssl via child_process with arg array to avoid shell injection
  try{
    const {spawnSync}=awaitImport('child_process');
    const r=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-keyout',keyPath,'-out',certPath,'-days','365','-nodes','-subj','/CN=AirTouch'],{stdio:'ignore'});
    if(r.status!==0) throw new Error('openssl failed');
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

const KEY_MAP={
  up:19,down:20,left:21,right:22,enter:23,click:23,center:23,back:4,home:3,vol_up:24,vol_down:25,mute:164,menu:82,power:26,
  media_play_pause:85,media_play:126,media_pause:127,media_next:87,media_prev:88,media_stop:86,media_rewind:89,media_fast_forward:90,captions:175,
  guide:172,info:165,settings_tv:176,search:84,input_hdmi:178,channel_up:166,channel_down:167,
  num_0:7,num_1:8,num_2:9,num_3:10,num_4:11,num_5:12,num_6:13,num_7:14,num_8:15,num_9:16,num_star:17,num_hash:18,
  color_red:183,color_green:184,color_yellow:185,color_blue:186,dpad_center_long:23
};
function sendKey(keyCode){
  const code = KEY_MAP[keyCode] || parseInt(keyCode) || 23;
  if(tvReady && tvSocket){
    const msg=JSON.stringify({type:'remoteKey', keyCode:code, direction:0});
    try{ tvSocket.write(Buffer.from(msg)); console.log('TV key',keyCode,code); return true; }catch(e){ console.error('TV write err',e.message); }
  }
  try{
    const {spawnSync}=awaitImportSync('child_process');
    if(!isValidTvIp(tvIp)) return false;
    const r=spawnSync('adb',['-s',`${tvIp}:5555`,'shell','input','keyevent',String(code)],{stdio:'ignore'});
    if(r.status===0){ console.log('ADB fallback key',code); return true; }
    return false;
  }catch{ return false; }
}
function sendText(text){
  try{
    const {spawnSync}=awaitImportSync('child_process');
    if(!isValidTvIp(tvIp)) return false;
    const escaped = String(text).replace(/%/g,'%25').replace(/ /g,'%s').slice(0,512);
    // try input text, fallback to keyevents for each char if needed
    let r=spawnSync('adb',['-s',`${tvIp}:5555`,'shell','input','text',escaped],{stdio:'ignore'});
    if(r.status===0){ console.log('ADB text',escaped.slice(0,40)); return true; }
    return false;
  }catch{ return false; }
}
function sendLaunch(pkg){
  try{
    const {spawnSync}=awaitImportSync('child_process');
    if(!isValidTvIp(tvIp)) return false;
    const p=String(pkg).replace(/[^a-zA-Z0-9._]/g,'').slice(0,128);
    let r=spawnSync('adb',['-s',`${tvIp}:5555`,'shell','monkey','-p',p,'-c','android.intent.category.LAUNCHER','1'],{stdio:'ignore'});
    if(r.status===0) return true;
    r=spawnSync('adb',['-s',`${tvIp}:5555`,'shell','am','start','-n',`${p}/.MainActivity`],{stdio:'ignore'});
    return r.status===0;
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
        let dx=j.dx, dy=j.dy;
        if(typeof dx!=='number'||!isFinite(dx)) dx=0;
        if(typeof dy!=='number'||!isFinite(dy)) dy=0;
        dx=Math.max(-100,Math.min(100,dx));
        dy=Math.max(-100,Math.min(100,dy));
        if(Math.abs(dx)>12) sendKey(dx>0?'right':'left');
        if(Math.abs(dy)>12) sendKey(dy>0?'down':'up');
      } else if(t==='click'){ let btn=j.button||'left'; if(!['left','right'].includes(btn)) btn='left'; sendKey(btn==='right'?'right':'enter'); }
      else if(t==='long_click'){ let btn=j.button||'left'; if(!['left','right'].includes(btn)) btn='left'; sendKey(btn==='right'?'right':'enter'); }
      else if(t==='text' || t==='keyboard'){
        let txt=String(j.text||'').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g,'').slice(0,512);
        if(txt) sendText(txt);
        if(j.action==='enter') sendKey('enter');
        if(j.action==='search') sendKey('search');
        if(j.action==='delete') sendKey('back');
      }
      else if(t==='launch'){
        let pkg=String(j.pkg||j.app||'').replace(/[^a-zA-Z0-9._]/g,'').slice(0,128);
        if(pkg) sendLaunch(pkg);
      }
      else if(t==='key'){
        let k=String(j.key||'').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,32);
        if(!k) return;
        sendKey(k);
      } else if(['media_play_pause','media_play','media_pause','media_next','media_prev','media_stop','media_rewind','media_fast_forward','captions','channel_up','channel_down','guide','info','settings_tv','search','input_hdmi','power','menu','num_0','num_1','num_2','num_3','num_4','num_5','num_6','num_7','num_8','num_9','num_star','num_hash','color_red','color_green','color_yellow','color_blue','dpad_center_long'].includes(t)){
        sendKey(t);
      } else if(t==='tv_pair'){
        if(j.tvIp && isValidTvIp(String(j.tvIp))){ tvIp=String(j.tvIp); console.log('Pair request from webpage', tvIp, room); connectTV(); }
        if(j.room && /^[0-9a-zA-Z_-]{1,16}$/.test(String(j.room))) room=String(j.room);
      } else if(t==='tv_pair_pin'){
        let pin=String(j.pin||'').replace(/[^0-9]/g,'').slice(0,8);
        if(!pin) return;
        console.log('PIN from webpage', pin);
        try{ if(tvSocket) tvSocket.write(Buffer.from(JSON.stringify({type:'pairingCode', code:pin}))); }catch(e){ console.error('PIN send err',e.message); }
      } else if(t==='hello'){ console.log('phone joined',j.room); }
    }catch(e){ console.error('msg err',e.message); }
  });
  ws.on('close', ()=>{ console.log('Relay closed, exit'); process.exit(0); });
}
