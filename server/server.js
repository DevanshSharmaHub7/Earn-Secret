/**
 * Earn Secret - Game Server
 */

const express = require('express');
const http    = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const path    = require('path');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });
const PORT   = process.env.PORT || 3000;

// ── Room store ────────────────────────────────────────────────────────────────
const rooms = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms)
    if (now - room.createdAt > 60 * 60 * 1000) rooms.delete(id);
}, 10 * 60 * 1000);

// ── TTT ───────────────────────────────────────────────────────────────────────
function newTTT() {
  return { board: Array(9).fill(null), currentTurn:'X', winner:null, winLine:null, isDraw:false };
}

function applyTTT(room, sym, idx) {
  const s = room.gameState;
  if (s.winner || s.isDraw)  return { error:'Game over' };
  if (s.currentTurn !== sym) return { error:'Not your turn' };
  if (idx < 0 || idx > 8)   return { error:'Bad index' };
  if (s.board[idx] !== null) return { error:'Cell taken' };

  s.board[idx] = sym;
  const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  for (const [a,b,c] of lines) {
    if (s.board[a] && s.board[a]===s.board[b] && s.board[a]===s.board[c]) {
      s.winner = s.board[a];
      s.winLine = [a,b,c];
      return { ok:true };
    }
  }
  if (s.board.every(c => c !== null)) { s.isDraw = true; return { ok:true }; }
  s.currentTurn = sym === 'X' ? 'O' : 'X';
  return { ok:true };
}

// ── Chess ─────────────────────────────────────────────────────────────────────
function newChess() {
  return {
    board:[
      'r','n','b','q','k','b','n','r',
      'p','p','p','p','p','p','p','p',
      null,null,null,null,null,null,null,null,
      null,null,null,null,null,null,null,null,
      null,null,null,null,null,null,null,null,
      null,null,null,null,null,null,null,null,
      'P','P','P','P','P','P','P','P',
      'R','N','B','Q','K','B','N','R'
    ],
    currentTurn:'w', winner:null, isDraw:false,
    castling:{wK:true,wQ:true,bK:true,bQ:true},
    enPassant:null, lastMove:null, inCheck:null
  };
}

const col = p => !p ? null : (p===p.toUpperCase() ? 'w' : 'b');
const typ = p => p ? p.toLowerCase() : null;
const rc  = i => ({ r:Math.floor(i/8), c:i%8 });
const ix  = (r,c) => r*8+c;
const inB = (r,c) => r>=0&&r<8&&c>=0&&c<8;

function sliding(board, i, dirs) {
  const moves=[], color=col(board[i]);
  for (const [dr,dc] of dirs) {
    let {r,c}=rc(i);
    while(true){r+=dr;c+=dc;if(!inB(r,c))break;const t=board[ix(r,c)];if(!t)moves.push(ix(r,c));else{if(col(t)!==color)moves.push(ix(r,c));break;}}
  }
  return moves;
}

function pseudoMoves(board, i, castling, ep) {
  const p=board[i];if(!p)return[];
  const color=col(p),type=typ(p),{r,c}=rc(i),moves=[];
  const addIf=(nr,nc)=>{if(inB(nr,nc)){const t=board[ix(nr,nc)];if(!t||col(t)!==color)moves.push(ix(nr,nc));}};

  if(type==='p'){
    const dir=color==='w'?-1:1,start=color==='w'?6:1;
    if(inB(r+dir,c)&&!board[ix(r+dir,c)]){moves.push(ix(r+dir,c));if(r===start&&!board[ix(r+2*dir,c)])moves.push(ix(r+2*dir,c));}
    for(const dc2 of[-1,1])if(inB(r+dir,c+dc2)){const t=board[ix(r+dir,c+dc2)];if(t&&col(t)!==color)moves.push(ix(r+dir,c+dc2));if(ep!==null&&ix(r+dir,c+dc2)===ep)moves.push(ep);}
  }else if(type==='n'){for(const[dr,dc2]of[[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]])addIf(r+dr,c+dc2);}
  else if(type==='b')return sliding(board,i,[[-1,-1],[-1,1],[1,-1],[1,1]]);
  else if(type==='r')return sliding(board,i,[[-1,0],[1,0],[0,-1],[0,1]]);
  else if(type==='q')return sliding(board,i,[[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]]);
  else if(type==='k'){
    for(const[dr,dc2]of[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]])addIf(r+dr,c+dc2);
    if(color==='w'&&r===7){if(castling.wK&&!board[ix(7,5)]&&!board[ix(7,6)]&&board[ix(7,7)]==='R')moves.push(ix(7,6));if(castling.wQ&&!board[ix(7,3)]&&!board[ix(7,2)]&&!board[ix(7,1)]&&board[ix(7,0)]==='R')moves.push(ix(7,2));}
    if(color==='b'&&r===0){if(castling.bK&&!board[ix(0,5)]&&!board[ix(0,6)]&&board[ix(0,7)]==='r')moves.push(ix(0,6));if(castling.bQ&&!board[ix(0,3)]&&!board[ix(0,2)]&&!board[ix(0,1)]&&board[ix(0,0)]==='r')moves.push(ix(0,2));}
  }
  return moves;
}

function inCheck(board, color) {
  const kp=color==='w'?'K':'k',ki=board.indexOf(kp);if(ki===-1)return true;
  const opp=color==='w'?'b':'w';
  for(let i=0;i<64;i++)if(board[i]&&col(board[i])===opp&&pseudoMoves(board,i,{wK:false,wQ:false,bK:false,bQ:false},null).includes(ki))return true;
  return false;
}

function doMove(board, from, to, castling, ep) {
  const nb=[...board],p=nb[from],color=col(p),type=typ(p),{r:fr,c:fc}=rc(from),{r:tr,c:tc}=rc(to);
  let nc={...castling},nep=null;
  if(type==='p'&&ep!==null&&to===ep)nb[ix(fr,tc)]=null;
  if(type==='p'&&Math.abs(tr-fr)===2)nep=ix((fr+tr)/2,fc);
  nb[to]=p;nb[from]=null;
  if(type==='p'&&(tr===0||tr===7))nb[to]=color==='w'?'Q':'q';
  if(type==='k'){if(color==='w'){nc.wK=false;nc.wQ=false;}else{nc.bK=false;nc.bQ=false;}if(fc===4&&tc===6){nb[ix(fr,5)]=nb[ix(fr,7)];nb[ix(fr,7)]=null;}if(fc===4&&tc===2){nb[ix(fr,3)]=nb[ix(fr,0)];nb[ix(fr,0)]=null;}}
  if(type==='r'){if(from===ix(7,0))nc.wQ=false;if(from===ix(7,7))nc.wK=false;if(from===ix(0,0))nc.bQ=false;if(from===ix(0,7))nc.bK=false;}
  return{nb,nc,nep};
}

function legalMoves(board, i, castling, ep) {
  const p=board[i];if(!p)return[];
  const color=col(p);
  return pseudoMoves(board,i,castling,ep).filter(to=>{const{nb}=doMove(board,i,to,castling,ep);return!inCheck(nb,color);});
}

function hasAnyMoves(board, color, castling, ep) {
  for(let i=0;i<64;i++)if(board[i]&&col(board[i])===color&&legalMoves(board,i,castling,ep).length>0)return true;
  return false;
}

function applyChess(room, playerColor, from, to) {
  const s=room.gameState;
  if(s.winner||s.isDraw)return{error:'Game over'};
  if(s.currentTurn!==playerColor)return{error:'Not your turn'};
  const p=s.board[from];
  if(!p||col(p)!==playerColor)return{error:'Invalid piece'};
  if(!legalMoves(s.board,from,s.castling,s.enPassant).includes(to))return{error:'Illegal move'};
  const{nb,nc,nep}=doMove(s.board,from,to,s.castling,s.enPassant);
  s.board=nb;s.castling=nc;s.enPassant=nep;s.lastMove={from,to};
  const opp=playerColor==='w'?'b':'w';
  const oppCheck=inCheck(nb,opp),oppMoves=hasAnyMoves(nb,opp,nc,nep);
  if(!oppMoves){if(oppCheck)s.winner=playerColor;else s.isDraw=true;s.inCheck=null;}
  else{s.currentTurn=opp;s.inCheck=oppCheck?opp:null;}
  return{ok:true};
}

// ── Messaging helpers ─────────────────────────────────────────────────────────
function tell(ws, msg) {
  if (ws && ws.readyState === WebSocket.OPEN)
    ws.send(JSON.stringify(msg));
}

function bcast(room, msg) {
  for (const pl of room.players) tell(pl.ws, msg);
}

// ── Game over — send personalised result to each player ───────────────────────
function endGame(room) {
  const s = room.gameState;
  room.phase = 'finished';

  if (s.isDraw) {
    bcast(room, { type:'gameOver', result:'draw', message:"It's a draw! No secrets revealed.", gameState:s });
    setTimeout(() => rooms.delete(room.id), 5*60*1000);
    return;
  }

  // s.winner is the SYMBOL of the winning player ('X','O','w','b')
  const winner = room.players.find(p => p.symbol === s.winner);
  const loser  = room.players.find(p => p.symbol !== s.winner);

  if (winner) {
    tell(winner.ws, {
      type: 'gameOver',
      result: 'win',
      message: `You won! 🎉 Your opponent's secret was:`,
      revealedSecret: loser ? loser.secret : '(unknown)',
      gameState: s
    });
  }
  if (loser) {
    tell(loser.ws, {
      type: 'gameOver',
      result: 'lose',
      message: "You lost! Your secret was revealed to your opponent.",
      revealedSecret: null,
      gameState: s
    });
  }

  setTimeout(() => rooms.delete(room.id), 5*60*1000);
}

// ── WebSocket handler ─────────────────────────────────────────────────────────
wss.on('connection', ws => {
  let room = null;
  let pidx = null;   // 0 = creator/player1, 1 = joiner/player2

  ws.on('message', data => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }

    switch (msg.type) {

      // Creator arrives on room page, sends this to register their WS
      case 'createRoom': {
        const { gameType, secret, roomId } = msg;
        if (!secret || !secret.trim()) return tell(ws, { type:'error', message:'Secret required' });
        if (!['tictactoe','chess'].includes(gameType)) return tell(ws, { type:'error', message:'Bad game type' });

        const rid = roomId || uuidv4().slice(0,8);

        // Create room only if it doesn't exist yet
        if (!rooms.has(rid)) {
          rooms.set(rid, {
            id: rid, gameType,
            players: [],
            gameState: gameType === 'chess' ? newChess() : newTTT(),
            phase: 'waiting',
            createdAt: Date.now()
          });
        }

        const r = rooms.get(rid);
        const sym = gameType === 'chess' ? 'w' : 'X';

        if (r.players.length === 0) {
          r.players.push({ ws, secret: secret.trim().slice(0,200), symbol: sym, joined: Date.now() });
        } else {
          // Re-registering (e.g. page refresh) — update ws reference
          r.players[0].ws = ws;
        }

        room = r;
        pidx = 0;

        tell(ws, { type:'roomCreated', roomId: rid, symbol: sym, gameType });
        break;
      }

      // Joiner submits their secret
      case 'joinRoom': {
        const { roomId, secret } = msg;
        const r = rooms.get(roomId);
        if (!r)                  return tell(ws, { type:'error', message:'Room not found' });
        if (r.phase === 'finished') return tell(ws, { type:'error', message:'Game already ended' });
        if (r.players.length >= 2) return tell(ws, { type:'error', message:'Room is full' });
        if (!secret || !secret.trim()) return tell(ws, { type:'error', message:'Secret required' });

        const sym = r.gameType === 'chess' ? 'b' : 'O';
        r.players.push({ ws, secret: secret.trim().slice(0,200), symbol: sym, joined: Date.now() });
        room = r;
        pidx = 1;
        r.phase = 'playing';

        tell(ws, { type:'joinedRoom', roomId, symbol: sym, gameType: r.gameType });

        // Broadcast gameStart to BOTH players simultaneously
        bcast(r, { type:'gameStart', gameType: r.gameType, gameState: r.gameState });
        break;
      }

      // Joiner checks if room exists before showing secret form
      case 'getRoomInfo': {
        const r = rooms.get(msg.roomId);
        if (!r) return tell(ws, { type:'error', message:'Room not found' });
        tell(ws, { type:'roomInfo', roomId: r.id, gameType: r.gameType, phase: r.phase, playerCount: r.players.length });
        break;
      }

      case 'tttMove': {
        if (!room || room.phase !== 'playing') return tell(ws, { type:'error', message:'Not in game' });
        const pl  = room.players[pidx];
        const res = applyTTT(room, pl.symbol, msg.index);
        if (res.error) return tell(ws, { type:'error', message: res.error });
        bcast(room, { type:'tttUpdate', gameState: room.gameState, lastMove:{ index: msg.index, symbol: pl.symbol } });
        if (room.gameState.winner || room.gameState.isDraw) endGame(room);
        break;
      }

      case 'chessMove': {
        if (!room || room.phase !== 'playing') return tell(ws, { type:'error', message:'Not in game' });
        const pl  = room.players[pidx];
        const res = applyChess(room, pl.symbol, msg.from, msg.to);
        if (res.error) return tell(ws, { type:'error', message: res.error });
        bcast(room, { type:'chessUpdate', gameState: room.gameState, lastMove:{ from: msg.from, to: msg.to, symbol: pl.symbol } });
        if (room.gameState.winner || room.gameState.isDraw) endGame(room);
        break;
      }

      case 'getLegalMoves': {
        if (!room || room.gameType !== 'chess') return;
        const s = room.gameState;
        tell(ws, { type:'legalMoves', from: msg.from, moves: legalMoves(s.board, msg.from, s.castling, s.enPassant) });
        break;
      }
    }
  });

  ws.on('close', () => {
    if (!room) return;
    // Guard: only act if this ws is still the live connection for this player slot
    // This prevents the OLD landing-page ws (which closes on redirect) from
    // triggering a disconnect for the freshly-connected room-page ws
    const activePl = room.players[pidx];
    if (!activePl || activePl.ws !== ws) return;

    if (room.phase === 'playing') {
      bcast(room, { type:'playerDisconnected', message:'Opponent disconnected. Game over.' });
      room.phase = 'finished';
      setTimeout(() => rooms.delete(room.id), 30000);
    }
  });

  ws.on('error', err => console.error('WS error:', err.message));
});

// ── Static files ──────────────────────────────────────────────────────────────
const PUB = path.resolve(__dirname, '..', 'public');
app.use(express.static(PUB));
app.get('/', (_, res) => res.sendFile(path.join(PUB, 'index.html')));
app.get('/room/:id', (_, res) => res.sendFile(path.join(PUB, 'room.html')));
app.get('/api/health', (_, res) => res.json({ status:'ok', rooms: rooms.size }));

server.listen(PORT, () => console.log(`\n🎮 Earn Secret → http://localhost:${PORT}\n`));