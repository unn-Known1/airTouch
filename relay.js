import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { URL } from 'url';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname);

const PORT = process.env.PORT || 7888;

// rooms: roomCode -> Set<ws>
const rooms = new Map();
const ipConnections = new Map(); // ip -> count
const MAX_CONN_PER_IP = 20;
const MAX_ROOMS = 5000;
const MAX_PAYLOAD = 16 * 1024;

function getRoom(code){
  if(!rooms.has(code)) {
    if(rooms.size >= MAX_ROOMS) return null;
    rooms.set(code, new Set());
  }
  return rooms.get(code);
}

const MIME = {
  '.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json',
  '.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon'
};

// Allowlist for static serving - prevents leaking source/config/.git
const ALLOWED_STATIC = new Set([
  '/', '/index.html', '/tv.html', '/airmouse.html',
  '/manifest.json', '/sw.js'
]);

function securityHeaders(res){
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
}

const server = createServer((req,res)=>{
  const url = new URL(req.url, 'http://localhost');
  securityHeaders(res);

  // health
  if(url.pathname === '/health'){
    res.writeHead(200, {
      'Content-Type':'application/json',
      'Access-Control-Allow-Origin':'*',
      'Cache-Control':'no-store'
    });
    res.end(JSON.stringify({ok:true, rooms: rooms.size, port: PORT}));
    return;
  }
  // websocket upgrade handled by wss
  if(req.headers.upgrade === 'websocket'){
    res.writeHead(426, {'Content-Type':'text/plain'});
    res.end('Upgrade Required - WS on same port');
    return;
  }

  // static allowlist
  let pathname = url.pathname;
  if(pathname === '/') pathname = '/index.html';
  if(!ALLOWED_STATIC.has(pathname) && !ALLOWED_STATIC.has(url.pathname)){
    res.writeHead(404, {'Content-Type':'text/plain', 'Cache-Control':'no-store'});
    res.end('Not found: '+pathname+'\nTry / , /tv.html , /airmouse.html');
    return;
  }

  // safe resolve with traversal protection
  const safePath = path.resolve(ROOT, '.' + pathname);
  const rel = path.relative(ROOT, safePath);
  if(rel.startsWith('..') || path.isAbsolute(rel) && rel.includes('..')){
    res.writeHead(403, {'Content-Type':'text/plain'});
    res.end('Forbidden');
    return;
  }
  if(!safePath.startsWith(ROOT + path.sep) && safePath !== ROOT){
    // also handle exact ROOT match
    if(!ALLOWED_STATIC.has(pathname)){
      res.writeHead(403, {'Content-Type':'text/plain'});
      res.end('Forbidden');
      return;
    }
  }

  let filePath = safePath;
  if(filePath === ROOT || filePath === ROOT + path.sep) filePath = path.join(ROOT, 'index.html');
  try{
    const stat = fs.statSync(filePath);
    if(stat.isDirectory()) filePath = path.join(filePath, 'index.html');
  }catch{}
  if(fs.existsSync(filePath) && fs.statSync(filePath).isFile()){
    // ensure file is under ROOT and allowlisted ext
    const resolved = path.resolve(filePath);
    if(!resolved.startsWith(ROOT + path.sep)){
      res.writeHead(403); res.end('Forbidden'); return;
    }
    const ext = path.extname(filePath).toLowerCase();
    if(!MIME[ext]){
      res.writeHead(403); res.end('Forbidden type'); return;
    }
    const mime = MIME[ext];
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control':'no-cache, no-store, must-revalidate',
      'Cross-Origin-Embedder-Policy':'unsafe-none'
    });
    fs.createReadStream(filePath).pipe(res);
    return;
  }
  res.writeHead(404, {'Content-Type':'text/plain', 'Cache-Control':'no-store'});
  res.end('Not found: '+pathname);
});

const wss = new WebSocketServer({
  server,
  maxPayload: MAX_PAYLOAD,
  perMessageDeflate: false,
  clientTracking: true
});

const ALLOWED_TYPES = new Set([
  'move','click','scroll','up','down','left','right','center','key','hello','peer_join',
  'tv_pair','tv_pair_pin','back','home','vol_up','vol_down','mute','menu','power',
  // Android TV remote extended
  'text','launch','keyboard','long_click',
  'media_play_pause','media_next','media_prev','media_rewind','media_fast_forward','media_stop','media_play','media_pause','captions',
  'num_0','num_1','num_2','num_3','num_4','num_5','num_6','num_7','num_8','num_9','num_star','num_hash',
  'channel_up','channel_down','guide','info','settings_tv','search','input_hdmi','dpad_center_long','color_red','color_green','color_yellow','color_blue'
]);

function isValidNumber(n){
  return typeof n === 'number' && isFinite(n) && !isNaN(n);
}

function clampMove(v){
  if(!isValidNumber(v)) return 0;
  return Math.max(-100, Math.min(100, v));
}

wss.on('connection', (ws, req)=>{
  const ip = req.socket.remoteAddress || 'unknown';
  // per-IP connection limit
  const cnt = ipConnections.get(ip) || 0;
  if(cnt >= MAX_CONN_PER_IP){
    ws.close(1013, 'Too many connections');
    return;
  }
  ipConnections.set(ip, cnt + 1);

  const url = new URL(req.url, 'http://localhost');
  let room = url.searchParams.get('room') || '0000';
  let role = url.searchParams.get('role') || 'unknown';
  // strict sanitize
  room = room.replace(/[^0-9a-zA-Z_-]/g,'').slice(0,16) || '0000';
  role = role.replace(/[^0-9a-zA-Z_-]/g,'').slice(0,24) || 'unknown';
  const ALLOWED_ROLES = new Set(['tv','remote','unified','tv-bridge','tv-global','laptop-bridge','tv-remote-bridge','unknown']);
  if(!ALLOWED_ROLES.has(role)) role = 'unknown';

  ws.room = room;
  ws.role = role;
  ws._ip = ip;
  const set = getRoom(room);
  if(!set){
    ws.close(1013, 'Too many rooms'); return;
  }
  set.add(ws);
  console.log(`+ ${role} joined room ${room} (${set.size}) from ${ip}`);

  // notify others
  for(const peer of set){
    if(peer !== ws && peer.readyState===1){
      try{ peer.send(JSON.stringify({type:'peer_join', role, room})); }catch{}
    }
  }

  ws.msgCount=0;
  ws._rateWindow = Date.now();
  ws._rateCount = 0;

  ws.on('message', (data)=>{
    // rate limit: 60 msg/sec per socket
    const now = Date.now();
    if(now - ws._rateWindow > 1000){ ws._rateWindow = now; ws._rateCount = 0; }
    ws._rateCount++;
    if(ws._rateCount > 60){
      // drop excess silently to mitigate flood
      return;
    }
    // size already limited by maxPayload, but double-check
    if(data.length > MAX_PAYLOAD) return;

    let msg;
    try{
      const str = data.toString();
      if(str.length > MAX_PAYLOAD) return;
      msg = JSON.parse(str);
    }catch{
      // malformed - drop without broadcast
      return;
    }
    if(!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
    if(!ALLOWED_TYPES.has(msg.type)) return;

    // validate and sanitize numeric fields
    if(msg.type === 'move'){
      msg.dx = clampMove(msg.dx);
      msg.dy = clampMove(msg.dy);
      if(Math.abs(msg.dx) < 0.01 && Math.abs(msg.dy) < 0.01) return;
    } else if(msg.type === 'scroll'){
      msg.dy = clampMove(msg.dy);
    } else if(msg.type === 'key'){
      if(typeof msg.key !== 'string') return;
      msg.key = msg.key.replace(/[^a-zA-Z0-9_-]/g,'').slice(0,32);
      if(!msg.key) return;
    } else if(msg.type === 'click' || msg.type === 'long_click'){
      const btn = msg.button || 'left';
      if(typeof btn !== 'string' || !['left','right','middle'].includes(btn)) msg.button = 'left';
      else msg.button = btn;
      if(msg.type==='long_click'){
        let dur = parseInt(msg.duration,10);
        if(!isFinite(dur)) dur=600;
        msg.duration = Math.max(200, Math.min(2000, dur));
      }
    } else if(msg.type === 'text' || msg.type === 'keyboard'){
      if(typeof msg.text !== 'string') return;
      // allow unicode text but cap length, strip control chars except newline
      msg.text = msg.text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g,'').slice(0,512);
      if(!msg.text) return;
      if(msg.type==='keyboard' && typeof msg.action === 'string'){
        msg.action = msg.action.replace(/[^a-zA-Z0-9_-]/g,'').slice(0,16);
      }
    } else if(msg.type === 'launch'){
      if(typeof msg.pkg !== 'string' && typeof msg.app !== 'string') return;
      const p = String(msg.pkg || msg.app);
      if(!/^[a-zA-Z0-9._]+$/.test(p) || p.length>128) return;
      msg.pkg = p;
      if(typeof msg.action === 'string') msg.action = msg.action.replace(/[^a-zA-Z0-9._\/-]/g,'').slice(0,128);
    }

    msg.room = room;

    if(msg.type==='move' && ws.msgCount<5){
      console.log(`move room ${room} ${role} dx=${msg.dx} dy=${msg.dy} -> ${set.size-1} peers`);
      ws.msgCount++;
    } else if(msg.type && msg.type!=='move' && ws.msgCount<5){
      console.log(`${msg.type} room ${room} ${role}`);
      if(ws.msgCount!==undefined) ws.msgCount++;
    }

    const out = JSON.stringify(msg);
    for(const peer of set){
      if(peer !== ws && peer.readyState===1){
        try{ peer.send(out); }catch{}
      }
    }
  });

  ws.on('close', ()=>{
    set.delete(ws);
    const c = ipConnections.get(ip) || 1;
    ipConnections.set(ip, Math.max(0, c - 1));
    if(c <= 1) ipConnections.delete(ip);
    console.log(`- ${role} left room ${room} (${set.size})`);
    if(set.size===0) rooms.delete(room);
  });

  ws.on('error', (e)=> console.error('ws error', e.message));

  ws.isAlive=true;
  ws.on('pong', ()=> ws.isAlive=true);
});

// heartbeat interval
setInterval(()=>{
  for(const ws of wss.clients){
    if(ws.isAlive===false){ try{ ws.terminate(); }catch{} continue; }
    ws.isAlive=false;
    try{ ws.ping(); }catch{}
  }
  // cleanup stale ip entries
  for(const [ip, cnt] of ipConnections){
    if(cnt <= 0) ipConnections.delete(ip);
  }
}, 30000);

server.listen(PORT, '0.0.0.0', ()=>{
  console.log(`AirMouse unified server listening on http://0.0.0.0:${PORT} + ws://0.0.0.0:${PORT}`);
  console.log(`Health: http://localhost:${PORT}/health`);
  console.log(`TV:     http://<this-host>:${PORT}/tv.html`);
  console.log(`Remote: http://<this-host>:${PORT}/airmouse.html`);
  console.log(`Tunnel: forward port ${PORT} only — WS will be wss://<tunnel-host> (same as page, no extra port)`);
});
