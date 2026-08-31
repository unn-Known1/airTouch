import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { URL } from 'url';

const PORT = process.env.PORT || 7889;

// rooms: roomCode -> Set<ws>
const rooms = new Map();

function getRoom(code){
  if(!rooms.has(code)) rooms.set(code, new Set());
  return rooms.get(code);
}

const server = createServer((req,res)=>{
  if(req.url === '/health'){
    res.writeHead(200, {'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*'});
    res.end(JSON.stringify({ok:true, rooms: rooms.size, port: PORT}));
    return;
  }
  res.writeHead(200, {'Content-Type':'text/plain', 'Access-Control-Allow-Origin':'*'});
  res.end('AirMouse Relay running. Connect via ws://'+req.headers.host+'?room=CODE&role=tv|remote\n');
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
  console.log(`AirMouse relay listening on ws://0.0.0.0:${PORT}`);
  console.log(`Health: http://localhost:${PORT}/health`);
  console.log(`TV:     http://<this-host>:7888/tv.html`);
  console.log(`Remote: http://<this-host>:7888/airmouse.html`);
});
