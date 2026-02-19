/**
 * Earn Secret — Room Page
 *
 * CREATOR flow:
 *   1. Arrives from redirect, sessionStorage has es_pending
 *   2. Opens WS → sends createRoom (with secret + gameType)
 *   3. Server creates room, responds roomCreated
 *   4. Shows waiting screen with share link
 *   5. When opponent joins, server broadcasts gameStart to BOTH players
 *   6. Game begins
 *
 * JOINER flow:
 *   1. Arrives via shared link, no sessionStorage
 *   2. Opens WS → sends getRoomInfo
 *   3. Server confirms room exists and is waiting
 *   4. Shows secret entry form
 *   5. Sends joinRoom → server broadcasts gameStart to BOTH players
 *   6. Game begins
 *
 * KEY: The creator's WS stays open on the room page (never closes between steps).
 */

const ROOM_ID = location.pathname.split('/room/')[1];

// ── App state ──────────────────────────────────────────────────────────────────
const S = {
  ws:         null,
  role:       null,   // 'creator' | 'joiner'
  symbol:     null,   // 'X'|'O'|'w'|'b'
  gameType:   null,
  gameState:  null,
  selSq:      null,   // chess selected square
  legalMoves: []
};

// ── Phase map ──────────────────────────────────────────────────────────────────
const PH = {
  loading:  document.getElementById('phase-loading'),
  join:     document.getElementById('phase-join'),
  waiting:  document.getElementById('phase-waiting'),
  playing:  document.getElementById('phase-playing'),
  gameover: document.getElementById('phase-gameover'),
  error:    document.getElementById('phase-error')
};

function show(name) {
  Object.keys(PH).forEach(k => PH[k].classList.toggle('hidden', k !== name));
}

// ── Connection indicator ───────────────────────────────────────────────────────
function setConn(s) {
  document.getElementById('conn-indicator').className = 'conn-indicator ' + s;
  document.getElementById('conn-label').textContent =
    ({ connected:'Connected', disconnected:'Disconnected', connecting:'Connecting...' })[s] || s;
}

// ── WebSocket send helper ──────────────────────────────────────────────────────
function send(obj) {
  if (S.ws && S.ws.readyState === WebSocket.OPEN) S.ws.send(JSON.stringify(obj));
}

// ── BOOT ───────────────────────────────────────────────────────────────────────
function boot() {
  if (!ROOM_ID) { showErr('Bad Link', 'No room ID in URL.'); return; }
  show('loading');
  setConn('connecting');

  const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  const ws = new WebSocket(proto + location.host);
  S.ws = ws;

  ws.onopen = () => {
    setConn('connected');

    const raw = sessionStorage.getItem('es_pending');
    if (raw) {
      try {
        const p = JSON.parse(raw);
        if (p.roomId === ROOM_ID) {
          sessionStorage.removeItem('es_pending');
          S.role = 'creator';
          // Send createRoom — WS stays open, server keeps this connection alive
          send({ type: 'createRoom', roomId: ROOM_ID, gameType: p.gameType, secret: p.secret });
          return;
        }
      } catch(e) {}
    }

    // Joiner path
    S.role = 'joiner';
    send({ type: 'getRoomInfo', roomId: ROOM_ID });
  };

  ws.onmessage = e => {
    try { dispatch(JSON.parse(e.data)); } catch(e) { console.error(e); }
  };

  ws.onclose = () => {
    setConn('disconnected');
    // Only show error if game was in progress
    if (S.gameState && !S.gameState.winner && !S.gameState.isDraw) {
      showGameOver({ result:'error', message:'Connection lost.', icon:'📡' });
    }
  };

  ws.onerror = () => {
    setConn('disconnected');
    showErr('Connection Failed', 'Cannot reach server. Make sure it is running on port 3000.');
  };
}

// ── Message dispatcher ─────────────────────────────────────────────────────────
function dispatch(msg) {
  switch (msg.type) {

    case 'roomCreated': {
      // Creator: server confirmed room exists, WS is live — show waiting
      S.symbol   = msg.symbol;
      S.gameType = msg.gameType;
      document.getElementById('room-share-link').value = location.href;
      show('waiting');
      break;
    }

    case 'roomInfo': {
      // Joiner: server told us about the room
      if (msg.phase === 'finished') { showErr('Room Closed', 'This game already ended.'); break; }
      if (msg.playerCount >= 2)     { showErr('Room Full',   'This room already has 2 players.'); break; }
      if (msg.playerCount === 1 && msg.phase === 'waiting') {
        S.gameType = msg.gameType;
        show('join');
        initJoinForm();
      } else {
        showErr('Not Found', 'Room does not exist or has expired.');
      }
      break;
    }

    case 'joinedRoom': {
      S.symbol   = msg.symbol;
      S.gameType = msg.gameType;
      // gameStart will follow immediately from server broadcast
      break;
    }

    case 'gameStart': {
      S.gameState = msg.gameState;
      show('playing');
      initGameUI();
      renderGame();
      updateTurn();
      break;
    }

    case 'tttUpdate': {
      S.gameState = msg.gameState;
      renderTTT(msg.lastMove);
      updateTurn();
      break;
    }

    case 'chessUpdate': {
      S.gameState  = msg.gameState;
      S.selSq      = null;
      S.legalMoves = [];
      renderChess(msg.lastMove);
      updateTurn();
      break;
    }

    case 'legalMoves': {
      S.legalMoves = msg.moves;
      paintLegal(msg.from);
      break;
    }

    case 'gameOver': {
      showGameOver(msg);
      break;
    }

    case 'playerDisconnected': {
      showGameOver({ result:'error', message: msg.message, icon:'📡' });
      break;
    }

    case 'error': {
      toast(msg.message);
      // If we haven't shown any meaningful phase yet, show the error page
      const visiblePhase = Object.keys(PH).find(k => !PH[k].classList.contains('hidden'));
      if (visiblePhase === 'loading') showErr('Error', msg.message);
      break;
    }
  }
}

// ── Join form (joiner) ─────────────────────────────────────────────────────────
function initJoinForm() {
  const inp = document.getElementById('join-secret-input');
  const ctr = document.getElementById('join-char-count');
  const btn = document.getElementById('join-room-btn');
  inp.addEventListener('input', () => ctr.textContent = inp.value.length);
  btn.addEventListener('click', () => {
    const secret = inp.value.trim();
    if (!secret) { inp.style.borderColor='#ef4444'; setTimeout(()=>inp.style.borderColor='',1500); return; }
    btn.disabled = true;
    btn.textContent = 'Joining...';
    send({ type:'joinRoom', roomId:ROOM_ID, secret });
  });
}

// ── Copy button ────────────────────────────────────────────────────────────────
document.getElementById('room-copy-btn')?.addEventListener('click', () => {
  const v = document.getElementById('room-share-link').value;
  navigator.clipboard.writeText(v).then(() => {
    const b = document.getElementById('room-copy-btn');
    b.textContent = 'Copied!';
    setTimeout(() => b.textContent = 'Copy', 2000);
  });
});

// ── Game UI setup ──────────────────────────────────────────────────────────────
const DISP = { X:'✕', O:'○', w:'♔', b:'♚' };
const OPP  = { X:'O', O:'X', w:'b', b:'w' };

function initGameUI() {
  const opp = OPP[S.symbol];
  document.getElementById('your-avatar').textContent = DISP[S.symbol] || S.symbol;
  document.getElementById('opp-avatar').textContent  = DISP[opp]  || opp;
  document.getElementById('your-symbol').textContent  = S.symbol;
  document.getElementById('opp-symbol').textContent   = opp;

  if (S.gameType === 'tictactoe') {
    document.getElementById('ttt-container').classList.remove('hidden');
    buildTTT();
  } else {
    document.getElementById('chess-container').classList.remove('hidden');
    buildChess();
  }
}

// ── Turn bar ───────────────────────────────────────────────────────────────────
function updateTurn() {
  const gs   = S.gameState;
  if (!gs) return;
  const mine = gs.currentTurn === S.symbol;
  const el   = document.getElementById('turn-text');
  el.textContent = mine ? 'Your Turn' : "Opponent's Turn";
  el.className   = 'turn-text' + (mine ? ' your-turn' : '');

  const hid = S.gameType === 'tictactoe' ? 'ttt-hint' : 'chess-hint';
  const h   = document.getElementById(hid);
  if (h) h.textContent = gs.inCheck
    ? (gs.inCheck === S.symbol ? '⚠️ You are in check!' : '⚠️ Opponent is in check!')
    : (mine
        ? (S.gameType === 'chess' ? 'Select a piece to move' : 'Click a cell to play')
        : "Waiting for opponent's move...");
}

// ════════════════ TIC TAC TOE ════════════════════════════════════════════════

function buildTTT() {
  const b = document.getElementById('ttt-board');
  b.innerHTML = '';
  for (let i = 0; i < 9; i++) {
    const c = document.createElement('div');
    c.className = 'ttt-cell';
    c.addEventListener('click', () => onTTT(i));
    b.appendChild(c);
  }
}

function renderGame()    { S.gameType === 'tictactoe' ? renderTTT(null) : renderChess(null); }

function renderTTT(last) {
  const gs    = S.gameState;
  const cells = document.querySelectorAll('.ttt-cell');
  const myTurn = gs.currentTurn === S.symbol && !gs.winner && !gs.isDraw;
  cells.forEach((c, i) => {
    const v = gs.board[i];
    c.textContent = v ? (v==='X' ? '✕' : '○') : '';
    c.className = 'ttt-cell' + (v ? ' taken '+v.toLowerCase() : '') +
      (!myTurn || v ? ' disabled' : '') +
      (gs.winLine?.includes(i) ? ' win-cell' : '');
  });
}

function onTTT(i) {
  const gs = S.gameState;
  if (!gs || gs.winner || gs.isDraw || gs.currentTurn !== S.symbol || gs.board[i]) return;
  send({ type:'tttMove', index:i });
}

// ════════════════ CHESS ═══════════════════════════════════════════════════════

const PC = { K:'♔',Q:'♕',R:'♖',B:'♗',N:'♘',P:'♙', k:'♚',q:'♛',r:'♜',b:'♝',n:'♞',p:'♟' };

function buildChess() {
  const b = document.getElementById('chess-board');
  b.innerHTML = '';
  for (let i = 0; i < 64; i++) {
    const sq = document.createElement('div');
    sq.className = 'chess-sq ' + ((Math.floor(i/8)+i%8)%2===0 ? 'light' : 'dark');
    sq.dataset.idx = i;
    sq.addEventListener('click', () => onChess(i));
    b.appendChild(sq);
  }
  if (S.symbol === 'b') b.style.transform = 'rotate(180deg)';
}

function renderChess(last) {
  const gs  = S.gameState;
  if (!gs) return;
  const flip = S.symbol === 'b';
  document.querySelectorAll('.chess-sq').forEach((sq, i) => {
    const p = gs.board[i];
    sq.innerHTML = p
      ? `<span class="chess-piece" style="${flip?'transform:rotate(180deg);display:inline-block':''}">` + (PC[p]||'') + `</span>`
      : '';
    sq.className = 'chess-sq ' + ((Math.floor(i/8)+i%8)%2===0 ? 'light':'dark') +
      (last && (i===last.from||i===last.to) ? ' last-move' : '') +
      (!p ? ' no-piece' : '');
    if (gs.inCheck) {
      const kp = gs.inCheck==='w' ? 'K' : 'k';
      if (gs.board[i]===kp) sq.classList.add('in-check');
    }
  });
  if (S.selSq !== null) {
    document.querySelectorAll('.chess-sq')[S.selSq]?.classList.add('selected');
    paintLegal(S.selSq);
  }
}

function paintLegal(from) {
  document.querySelectorAll('.chess-sq').forEach(sq => sq.classList.remove('legal-move','legal-capture'));
  if (S.selSq !== null) document.querySelectorAll('.chess-sq')[S.selSq]?.classList.add('selected');
  S.legalMoves.forEach(to => {
    const sq = document.querySelectorAll('.chess-sq')[to];
    if (sq) sq.classList.add(S.gameState?.board[to] ? 'legal-capture' : 'legal-move');
  });
}

function onChess(idx) {
  const gs = S.gameState;
  if (!gs || gs.winner || gs.isDraw || gs.currentTurn !== S.symbol) return;

  const p     = gs.board[idx];
  const isMine = p && (S.symbol==='w' ? p===p.toUpperCase() : p===p.toLowerCase());

  // Execute move if legal target selected
  if (S.selSq !== null && S.legalMoves.includes(idx)) {
    send({ type:'chessMove', from:S.selSq, to:idx });
    S.selSq = null; S.legalMoves = [];
    return;
  }

  // Select own piece
  if (isMine) {
    S.selSq = idx; S.legalMoves = [];
    document.querySelectorAll('.chess-sq').forEach(sq => sq.classList.remove('selected','legal-move','legal-capture'));
    document.querySelectorAll('.chess-sq')[idx].classList.add('selected');
    send({ type:'getLegalMoves', from:idx });
    return;
  }

  // Deselect
  S.selSq = null; S.legalMoves = [];
  document.querySelectorAll('.chess-sq').forEach(sq => sq.classList.remove('selected','legal-move','legal-capture'));
}

// ── Game over screen ───────────────────────────────────────────────────────────
function showGameOver(msg) {
  const ICONS  = { win:'🏆', lose:'💀', draw:'🤝', error:'📡' };
  const TITLES = { win:'You Won!', lose:'You Lost', draw:"It's a Draw!", error:'Game Ended' };
  document.getElementById('gameover-icon').textContent    = msg.icon || ICONS[msg.result]  || '🎮';
  document.getElementById('gameover-title').textContent   = TITLES[msg.result] || 'Game Over';
  document.getElementById('gameover-message').textContent = msg.message || '';
  const rv = document.getElementById('secret-reveal');
  const sc = document.getElementById('secret-content');
  if (msg.revealedSecret) { rv.classList.remove('hidden'); sc.textContent = msg.revealedSecret; }
  else rv.classList.add('hidden');
  show('gameover');
}

// ── Error page ─────────────────────────────────────────────────────────────────
function showErr(title, msg) {
  document.getElementById('error-title').textContent   = title;
  document.getElementById('error-message').textContent = msg;
  show('error');
}

// ── Toast ──────────────────────────────────────────────────────────────────────
function toast(msg) {
  let el = document.getElementById('_toast');
  if (!el) {
    el = document.createElement('div'); el.id = '_toast';
    el.style.cssText = 'position:fixed;bottom:2rem;left:50%;transform:translateX(-50%);background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.4);color:#fca5a5;border-radius:8px;padding:.75rem 1.5rem;font-size:.9rem;z-index:999;backdrop-filter:blur(8px);animation:fadeUp .3s ease';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  clearTimeout(el._t);
  el._t = setTimeout(() => el?.remove(), 3500);
}

boot();