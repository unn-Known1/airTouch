import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { URL } from 'url';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 7888;

// rooms: roomCode -> Set<ws>
const rooms = new Map();

function getRoom(code){
  if(!rooms.has(code)) rooms.set(code, new Set());
  return rooms.get(code);
}

const MIME = {
  '.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json',
  '.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon'
};

const server = createServer((req,res)=>{
  const url = new URL(req.url, 'http://localhost');
  // health
  if(url.pathname === '/health'){
    res.writeHead(200, {'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*'});
    res.end(JSON.stringify({ok:true, rooms: rooms.size, port: PORT}));
    return;
  }
  // websocket upgrade handled by wss, ignore here
  if(req.headers.upgrade === 'websocket'){
    res.writeHead(426); res.end(); return;
  }
  // static file serving for tunnel-friendly single-port mode
  let filePath = path.join(__dirname, url.pathname === '/' ? 'index.html' : url.pathname);
  // prevent directory traversal
  if(!filePath.startsWith(__dirname)) { res.writeHead(403); res.end('Forbidden'); return; }
  // if directory, serve index
  try{
    const stat = fs.statSync(filePath);
    if(stat.isDirectory()) filePath = path.join(filePath, 'index.html');
  }catch{}
  if(fs.existsSync(filePath) && fs.statSync(filePath).isFile()){
    const ext = path.extname(filePath);
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, {'Content-Type': mime, 'Access-Control-Allow-Origin':'*', 'Cache-Control':'no-cache'});
    fs.createReadStream(filePath).pipe(res);
    return;
  }
  // fallback 404 -> serve index for SPA? or text
  if(!fs.existsSync(filePath)){
    res.writeHead(404, {'Content-Type':'text/plain', 'Access-Control-Allow-Origin':'*'});
    res.end('Not found: '+url.pathname+'\nTry /tv.html , /airmouse.html , /index.html');
    return;
  }
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req)=>{
  const url = new URL(req.url, 'http://localhost');
  let room = url.searchParams.get('room') || '0000';
  const role = url.searchParams.get('role') || 'unknown';
  // sanitize room 4 digits
  room = room.replace(/[^0-9a-zA-Z_-]/g,'').slice(0,16) || '0000';

  ws.room = room;
  ws.role = role;
  const set = getRoom(room);
  set.add(ws);
  console.log(`+ ${role} joined room ${room} (${set.size}) from ${req.socket.remoteAddress}`);

  // tell others someone joined
  for(const peer of set){
    if(peer !== ws && peer.readyState===1){
      peer.send(JSON.stringify({type:'peer_join', role, room}));
    }
  }

  ws.on('message', (data)=>{
    // broadcast to all peers in same room except sender
    let msg;
    try{ msg = JSON.parse(data.toString()); }catch{ msg = {raw: data.toString()}; }
    // attach room/role if missing
    msg.room = room;
    const out = JSON.stringify(msg);
    for(const peer of set){
      if(peer !== ws && peer.readyState===1){
        peer.send(out);
      }
    }
  });

  ws.on('close', ()=>{
    set.delete(ws);
    console.log(`- ${role} left room ${room} (${set.size})`);
    if(set.size===0) rooms.delete(room);
  });

  ws.on('error', (e)=> console.error('ws error', e.message));

  // heartbeat
  ws.isAlive=true;
  ws.on('pong', ()=> ws.isAlive=true);
});

// heartbeat interval
setInterval(()=>{
  for(const ws of wss.clients){
    if(ws.isAlive===false){ ws.terminate(); continue; }
    ws.isAlive=false;
    ws.ping();
  }
}, 30000);

server.listen(PORT, '0.0.0.0', ()=>{
  console.log(`AirMouse unified server listening on http://0.0.0.0:${PORT} + ws://0.0.0.0:${PORT}`);
  console.log(`Health: http://localhost:${PORT}/health`);
  console.log(`TV:     http://<this-host>:${PORT}/tv.html`);
  console.log(`Remote: http://<this-host>:${PORT}/airmouse.html`);
  console.log(`Tunnel: forward port ${PORT} only — WS will be wss://<tunnel-host> (same as page, no extra port)`);
});
