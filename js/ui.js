// UI module: all DOM rendering and event binding
import { SUITS } from './gameState.js';

let handlers = {};
const $ = sel => document.querySelector(sel);

export function initUI(h){ handlers = h || {}; createPlayerSetup(); createGameTable(); createMultiplayerUI(); bindControls(); createHamburgerBehavior(); }

export function bindControls(){
  $('#playerCount').addEventListener('change', ()=>{ handlers.onPlayerCountChange && handlers.onPlayerCountChange(parseInt($('#playerCount').value)); });
  $('#newGame').addEventListener('click', ()=> handlers.onNewGame && handlers.onNewGame());
  $('#how').addEventListener('click', ()=> handlers.onHow && handlers.onHow());
}

export function createPlayerSetup(){
  const setupArea = $('#playerSetup');
  setupArea.innerHTML = '';
  const playerCount = parseInt($('#playerCount').value || 4);
  for (let i = 0; i < playerCount; i++){
    const row = document.createElement('div');
    row.className = 'player-setup-row';
    row.innerHTML = `
      <label>Player ${i + 1}: 
        <input id="p${i}name" type="text" value="${i===0?'You':'Bot '+(i+1)}" style="width:120px" />
      </label>
      <label>
        <input id="p${i}human" type="checkbox" ${i===0 ? 'checked' : ''} /> Human
      </label>
    `;
    setupArea.appendChild(row);
  }
}

export function createGameTable(){
  const table = $('#table');
  const playerCount = parseInt($('#playerCount').value || 4);
  table.innerHTML = '';
  table.className = `table players-${playerCount}`;
  for (let i = 0; i < playerCount; i++){
    const seat = document.createElement('div');
    seat.className = 'seat';
    seat.id = `seat-${i}`;
    seat.innerHTML = `
      <div class="name" id="name-${i}">Player ${i + 1}</div>
      <div class="badge" id="badge-${i}">0 cards</div>
      <div class="stack" id="played-${i}"></div>
    `;
    table.appendChild(seat);
  }
}

export function readPlayerConfigs(){
  const configs = [];
  const pc = parseInt($('#playerCount').value || 4);
  for (let i = 0; i < pc; i++){
    const nameInput = document.getElementById(`p${i}name`);
    const humanInput = document.getElementById(`p${i}human`);
    configs.push({ name: nameInput ? (nameInput.value.trim() || `Player ${i+1}`) : `Player ${i+1}`, isHuman: humanInput ? humanInput.checked : (i===0) });
  }
  return configs;
}

// Log helper
export function log(msg, kind=''){
  const el = document.getElementById('log');
  const div = document.createElement('div'); if (kind) div.className = kind; div.textContent = msg; el.appendChild(div); el.scrollTop = el.scrollHeight;
}

// Card element creation
export function makeCardEl(card, opts={clickable:false,disabled:false, onClick:null}){
  const el = document.createElement(opts.clickable ? 'button' : 'div');
  el.className = `card ${card && card.suit ? ({'♠':'spade','♥':'heart','♦':'diamond','♣':'club'})[card.suit] : ''}`;
  if (opts.clickable){ el.addEventListener('click', opts.onClick); el.classList.add('playable'); }
  if (opts.disabled){ el.classList.add('disabled'); if (el.tagName === 'BUTTON') el.disabled = true; }
  const face = document.createElement('div'); face.className = 'face'; face.innerHTML = card ? `<div class="rank">${card.rank}</div><div class="suit">${card.suit}</div>` : '';
  el.appendChild(face);
  return el;
}

export function renderAll(publicState, myIndex, myHand, extras={turnLocked:false}){
  // Update table seats and badges
  const pc = publicState.playerCount || parseInt($('#playerCount').value || 4);
  if (pc !== document.querySelectorAll('.seat').length) createGameTable();

  for (let i = 0; i < pc; i++){
    const nameEl = $(`#name-${i}`);
    const badge = $(`#badge-${i}`);
    const player = (publicState && publicState.players && publicState.players[i]) ? publicState.players[i] : null;
    if (nameEl) nameEl.textContent = player ? (player.name + (player.isHuman ? ' (Human)' : ' (Bot)')) : `Player ${i+1}`;
    if (badge) badge.textContent = player ? `${player.handCount} cards` : '0 cards';
  }

  // Render table plays
  for (let i = 0; i < pc; i++){ const playedEl = $(`#played-${i}`); if (playedEl) playedEl.innerHTML = ''; }
  for (const play of publicState.trick){
    const playedEl = $(`#played-${play.player}`);
    if (playedEl) playedEl.appendChild(makeCardEl(play.card, {clickable:false}));
  }

  // Highlight active turn
  for (let i = 0; i < pc; i++){ const seat = $(`#seat-${i}`); if (seat) seat.classList.toggle('active-turn', i === publicState.turn && !publicState.gameOver); }

  // Render my hand
  const handEl = $('#hand'); handEl.innerHTML = '';
  // Block interaction until `myIndex` is a valid number (fix: prevent clicks before assignment)
  if (myIndex === undefined || myIndex === null){
    // Show waiting message so user knows they're not yet assigned
    const wait = document.createElement('div'); wait.className = 'waiting'; wait.textContent = 'Waiting for your player assignment…';
    handEl.appendChild(wait);
  } else if (myHand && myIndex !== undefined && myIndex !== null){
    for (const c of myHand){
      // Allow clicking when it is the player's turn. Host sets `turnLocked` during pauses so clients must respect it.
      const playable = (publicState.turn === myIndex) && (extras.enforceFollowSuit ? extras.enforceFollowSuit(myIndex, c) : true) && !publicState.gameOver && !publicState.turnLocked;
      const btn = makeCardEl(c, {clickable:playable, disabled: !playable, onClick: ()=> handlers.onPlayRequest && handlers.onPlayRequest(myIndex, c)});
      if (!playable) btn.classList.add('disabled');
      handEl.appendChild(btn);
    }
  }

  // Status pills
  $('#leadPill').textContent = `Lead suit: ${publicState.leadSuit || '—'}`;
  $('#turnPill').textContent = `Turn: ${publicState.players[publicState.turn]?.name || '—'}`;
  const cpp = Math.floor(52 / publicState.playerCount || 4); const rem = 52 % (publicState.playerCount || 4);
  $('#cardsPill').textContent = `Cards per player: ${cpp}${rem>0?` (+${rem} get extra)`:''}`;
}

// Multiplayer UI insertion (visual elements only) and exposing handlers for multiplayer actions
export function createMultiplayerUI(){
  const multiplayerHTML = `
    <div class="panel" style="margin-bottom: 16px;">
      <h2>🌐 Multiplayer</h2>
      <div class="content">
        <div class="controls" style="margin-bottom: 12px;">
          <input type="text" id="playerName" placeholder="Your name" value="Player${Math.floor(Math.random()*1000)}" style="width: 140px;" />
          <button id="hostGame">🎮 Host Game</button>
          <button id="joinGameBtn">🔗 Join Game</button>
        </div>
        <div id="hostSection" style="display: none; margin-top: 12px;">
          <div class="pill" style="background: rgba(34, 211, 238, 0.1); border-color: var(--accent); display:flex; align-items:center; gap:8px;">
            <strong style="white-space:nowrap;">🎯 Your Game ID: <span id="myPeerId"></span></strong>
            <button id="copyGameIdBtn" title="Copy Game ID" style="font-size:12px;padding:6px 8px;">Copy</button>
          </div>
          <button id="startGameBtn" style="display:none; margin-top:8px;">🚀 Start Game</button>
        </div>
        <div id="joinSection" style="display:none; margin-top:12px;">
          <div class="controls"><input type="text" id="hostPeerId" placeholder="Enter Host's Game ID" style="width:200px;" /><button id="connectHostBtn">Connect</button></div>
        </div>
        <div id="connectedPlayers" style="margin-top: 12px;"><div style="font-weight:700; margin-bottom:6px;">Connected Players:</div><div id="playersList"></div></div>
        <div id="giveAllPrompt" style="margin-top:8px; display:none;"></div>
        <div id="connectionStatus" style="margin-top: 8px; font-size: 13px;"></div>
      </div>
    </div>
  `;
  const wrapper = document.querySelector('.wrapper'); const title = wrapper.querySelector('h1'); title.insertAdjacentHTML('afterend', multiplayerHTML);

  document.getElementById('hostGame').addEventListener('click', ()=> handlers.onHostGame && handlers.onHostGame());
  document.getElementById('joinGameBtn').addEventListener('click', ()=>{ document.getElementById('joinSection').style.display='block'; handlers.onShowJoin && handlers.onShowJoin(); });
  document.getElementById('connectHostBtn').addEventListener('click', ()=> handlers.onJoinAttempt && handlers.onJoinAttempt(document.getElementById('hostPeerId').value.trim()));
  document.getElementById('startGameBtn').addEventListener('click', ()=> handlers.onStartMultiplayer && handlers.onStartMultiplayer());
  const copyBtn = document.getElementById('copyGameIdBtn');
  if (copyBtn) {
    copyBtn.addEventListener('click', async ()=>{
      const idEl = document.getElementById('myPeerId');
      const text = idEl ? idEl.textContent.trim() : '';
      if (!text) return;
      try{
        if (navigator.clipboard && navigator.clipboard.writeText){
          await navigator.clipboard.writeText(text);
        } else {
          const ta = document.createElement('textarea'); ta.value = text; ta.style.position='fixed'; ta.style.left='-9999px'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
        }
        const prev = copyBtn.textContent;
        copyBtn.textContent = 'Copied!';
        setTimeout(()=> copyBtn.textContent = prev, 1400);
      }catch(e){
        copyBtn.textContent = 'Failed';
        setTimeout(()=> copyBtn.textContent = 'Copy', 1400);
      }
    });
  }
}

export function updateConnectionStatus(message, type=''){ const el = document.getElementById('connectionStatus'); if (el){ el.textContent = message; el.className = type; } }

export function updatePlayersListForUI(list, isHost, started=false){
  // `list` is expected to be the full ordered list including host: [{peerId,name,isHost}, ...]
  const container = document.getElementById('playersList'); if (!container) return; container.innerHTML='';
  const localName = document.getElementById('playerName')?.value.trim() || '';
  list.forEach(p=>{
    let label = p.name || ('Player');
    if (p.isHost) label += ' (Host)';
    if (localName && p.name === localName && !p.isHost) label += ' (You)';
    addPlayer(container, label, !!p.isHost, p);
  });

  // If the multiplayer game has started (or host wants to lock setup), sync the player setup controls
  if (started){
    const pcInput = document.getElementById('playerCount'); if (pcInput){ pcInput.value = list.length; }
    // Rebuild player setup rows to match connected players
    createPlayerSetup();
    // Fill in names and disable editing
    for (let i = 0; i < list.length; i++){
      const nameInput = document.getElementById(`p${i}name`);
      const humanInput = document.getElementById(`p${i}human`);
      if (nameInput){ nameInput.value = list[i].name || nameInput.value; nameInput.disabled = true; }
      if (humanInput){ humanInput.checked = true; humanInput.disabled = true; }
    }
  }
}

function addPlayer(container, name, isHost, peerObj){
  const el = document.createElement('div'); el.className='pill'; el.style.margin='4px'; el.style.display='flex'; el.style.alignItems='center'; el.style.justifyContent='space-between'; el.style.background = isHost ? 'rgba(34,211,238,0.1)' : 'rgba(16,185,129,0.1)';
  const left = document.createElement('div'); left.textContent = name; left.style.paddingRight = '8px';
  el.appendChild(left);
  // If peerObj provided and it's not the local peer, show a Request button
  const myId = document.getElementById('myPeerId') ? document.getElementById('myPeerId').textContent.trim() : '';
  if (peerObj && peerObj.peerId && peerObj.peerId !== myId){
    const btn = document.createElement('button'); btn.textContent = 'Request Cards'; btn.style.fontSize='12px'; btn.style.padding='4px 8px';
    btn.addEventListener('click', ()=>{
      if (handlers.onGiveAllRequest) handlers.onGiveAllRequest(peerObj.peerId);
    });
    el.appendChild(btn);
  }
  container.appendChild(el);
}

export function showGiveAllPrompt(info){
  // info: { fromPeerId, fromIndex, fromName }
  const box = document.getElementById('giveAllPrompt'); if (!box) return;
  box.innerHTML = '';
  const txt = document.createElement('div'); txt.textContent = `${info.fromName || 'A player'} requests ALL your cards. Accept?`; txt.style.marginBottom='6px';
  const acc = document.createElement('button'); acc.textContent = 'Accept'; acc.style.marginRight='6px';
  const rej = document.createElement('button'); rej.textContent = 'Reject';
  acc.addEventListener('click', ()=>{ box.style.display='none'; handlers.onGiveAllResponse && handlers.onGiveAllResponse(true); });
  rej.addEventListener('click', ()=>{ box.style.display='none'; handlers.onGiveAllResponse && handlers.onGiveAllResponse(false); });
  box.appendChild(txt); box.appendChild(acc); box.appendChild(rej); box.style.display = 'block';
}

export function hideGiveAllPrompt(){ const box = document.getElementById('giveAllPrompt'); if (!box) return; box.style.display='none'; box.innerHTML=''; }

// Hamburger behavior: top-left fixed button, dropdown appears below with fade+slide; closes on outside click or Escape
function createHamburgerBehavior(){
  const container = document.getElementById('hamburger-container');
  const btn = document.getElementById('hamburgerBtn');
  const menu = document.getElementById('hamburgerMenu');
  if (!container || !btn || !menu) return;

  function openMenu(){ menu.classList.add('open'); menu.setAttribute('aria-hidden','false'); btn.setAttribute('aria-expanded','true'); }
  function closeMenu(){ menu.classList.remove('open'); menu.setAttribute('aria-hidden','true'); btn.setAttribute('aria-expanded','false'); }

  btn.addEventListener('click', (ev)=>{ ev.stopPropagation(); if (menu.classList.contains('open')) closeMenu(); else openMenu(); });

  // Close when clicking outside the container
  document.addEventListener('click', (ev)=>{ if (!container.contains(ev.target)) closeMenu(); });

  // Close on Escape key
  document.addEventListener('keydown', (ev)=>{ if (ev.key === 'Escape') closeMenu(); });

  // Close when About Me clicked (anchor will navigate)
  const about = document.getElementById('aboutMeLink'); if (about) about.addEventListener('click', ()=> closeMenu());
}
