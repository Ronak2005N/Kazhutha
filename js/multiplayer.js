// PeerJS multiplayer logic. Handles connections and authoritative host actions.
import * as gameState from './gameState.js';

let peer = null;
let connections = {}; // peerId -> conn
let isHost = false;
let hostConnection = null; // for clients
let myPeerId = null;
let peerToIndex = {}; // peerId -> playerIndex (host=0)
let _logSubUnsub = null;
let roundTimer = null;
// Pause duration (ms) for host-controlled trick pause
const PAUSE_MS = 3000;

// Callbacks provided by main/UI
let callbacks = {};

export function initMultiplayer(cb){ callbacks = cb || {}; }

function startLogForwarding(){
  if (_logSubUnsub) return;
  _logSubUnsub = gameState.subscribeLogs(entry=>{
    if (!isHost) return;
    Object.values(connections).forEach(conn=>{ if (conn.open) conn.send({type:'log_entry', entry}); });
  });
}

function stopLogForwarding(){ if (_logSubUnsub) { _logSubUnsub(); _logSubUnsub = null; } }

export function initializePeer(){
  if (peer) return;
  peer = new Peer();
  peer.on('open', id => { myPeerId = id; callbacks.onPeerOpen && callbacks.onPeerOpen(id); });
  peer.on('connection', conn => { handleIncomingConnection(conn); });
  peer.on('error', err => { callbacks.onConnectionStatus && callbacks.onConnectionStatus('Peer error: '+err, 'bad'); });
}

function handleIncomingConnection(conn){
  if (!isHost) return conn.close();
  connections[conn.peer] = conn;
  setupConnection(conn, true);
}

function setupConnection(conn, isIncoming){
  conn.on('open', ()=>{
    if (isIncoming) {
      callbacks.onConnectionStatus && callbacks.onConnectionStatus('Player connected: '+conn.peer.substr(-4),'ok');
    } else {
      hostConnection = conn; callbacks.onConnectionStatus && callbacks.onConnectionStatus('Connected to host','ok');
      // Client connected to host — tell UI we're waiting for host to start
      callbacks.onJoinedHostWaiting && callbacks.onJoinedHostWaiting();
    }
    updatePlayersList();
  });

  conn.on('data', data=> handleMessage(data, conn));
  conn.on('close', ()=>{ if (connections[conn.peer]) delete connections[conn.peer]; updatePlayersList(); callbacks.onConnectionStatus && callbacks.onConnectionStatus('Player disconnected','warn'); });
}

function handleMessage(data, conn){
  switch(data.type){
    case 'player_join':
      // host receives join request; simply update list
      updatePlayersList();
      break;
    case 'play_request':
      // client asks host to play
      if (!isHost) return;
      // find playerIndex for this conn using mapping
      const idx = peerToIndex[conn.peer];
      if (typeof idx === 'undefined') return;
      // If host is already processing a turn, resync clients
      if (gameState.isTurnLocked && gameState.isTurnLocked()){
        broadcastGameState();
        sendHandsToClients();
        break;
      }
      // Process the play first (playCard enforces turn and turnLocked checks)
      const res = gameState.playCard(idx, data.card);
      // If this play completed the trick, host should lock, broadcast, pause, finalize, then broadcast again
      if (res && (res.clean || res.pickup)){
        if (roundTimer) { clearTimeout(roundTimer); roundTimer = null; }
        // set next turn visually to the upcoming leader/collector so other players don't appear to have the turn
        if (res.clean && typeof res.nextLeader !== 'undefined') gameState.setDisplayTurn(res.nextLeader);
        if (res.pickup && typeof res.collector !== 'undefined') gameState.setDisplayTurn(res.collector);
        gameState.lockTurn();
        broadcastGameState();
        sendHandsToClients();
        console.log(`Host: trick completed — pausing ${PAUSE_MS}ms before finalizing`);
        roundTimer = setTimeout(()=>{
          console.log('Host: pause ended — finalizing trick');
          gameState.finalizePendingTrick();
          gameState.unlockTurn();
          broadcastGameState();
          sendHandsToClients();
          roundTimer = null;
        }, PAUSE_MS);
      } else {
        // Normal play: broadcast immediately
        broadcastGameState();
        sendHandsToClients();
      }
      break;

    case 'give_all_request':
      // client -> host: request that all cards be given from targetPeerId to requester
      if (!isHost) return;
      if (!data || !data.targetPeerId) return;
      // Determine requester index
      const requesterPeerId = conn ? conn.peer : null;
      const requesterIndex = typeof peerToIndex[requesterPeerId] !== 'undefined' ? peerToIndex[requesterPeerId] : 0;
      // Resolve target index
      const targetPeerId = data.targetPeerId;
      const targetIndex = (targetPeerId === myPeerId) ? 0 : peerToIndex[targetPeerId];
      // Safety checks
      if (typeof targetIndex === 'undefined') { if (conn && conn.open) conn.send({type:'give_all_denied', reason:'invalid_target'}); break; }
      if (targetIndex === requesterIndex){ if (conn && conn.open) conn.send({type:'give_all_denied', reason:'no_self_target'}); break; }
      if (gameState.gameOver) { if (conn && conn.open) conn.send({type:'give_all_denied', reason:'game_over'}); break; }
      if (gameState.giveAllRequest){ if (conn && conn.open) conn.send({type:'give_all_denied', reason:'another_request_pending'}); break; }
      // Record pending request in authoritative game state and notify players
      gameState.setGiveAllRequest({ requester: requesterIndex, target: targetIndex });
      broadcastGameState();
      sendHandsToClients();
      // Forward prompt to the target player only
      const targetConn = Object.values(connections).find(c=> c.peer === targetPeerId);
      if (targetIndex === 0){
        // Target is host (local) — call callback so host UI can prompt locally
        callbacks.onGiveAllPrompt && callbacks.onGiveAllPrompt({ fromIndex: requesterIndex, fromPeerId: requesterPeerId, fromName: gameState.players[requesterIndex]?.name });
      } else if (targetConn && targetConn.open){
        targetConn.send({ type: 'give_all_prompt', fromPeerId: requesterPeerId, fromIndex: requesterIndex, fromName: gameState.players[requesterIndex]?.name });
      } else {
        // If no connection to target, deny request
        gameState.clearGiveAllRequest();
        broadcastGameState();
        if (conn && conn.open) conn.send({type:'give_all_denied', reason:'target_unreachable'});
      }
      break;
      
    case 'request_join':
      // client requests to join; host records provided name for UI and mapping
      if (isHost && conn && data && data.name){ conn._name = data.name; conn._peerId = data.peerId; }
      updatePlayersList();
      break;
    case 'your_hand':
      // Client receives its own hand from host
      if (isHost) return;
      const pIdx = data.playerIndex;
      // Ensure players array has slot
      while (gameState.players.length <= pIdx) gameState.players.push({name:`Player ${gameState.players.length+1}`, isHuman:false, hand:[], out:false});
      // Mark this slot as a human (it's the local player) to avoid client-side bot logic firing
      gameState.players[pIdx].isHuman = true;
      gameState.players[pIdx].hand = data.hand;
      callbacks.onYouAssigned && callbacks.onYouAssigned(pIdx, data.hand);
      // signal that multiplayer has started for this client
      callbacks.onMultiplayerStarted && callbacks.onMultiplayerStarted();
      // Ensure UI updates now that hand and index are set
      if (gameState.publishState) gameState.publishState();
      break;
    case 'give_all_prompt':
      // Host forwards a prompt to the target; clients receive and show prompt via callbacks
      if (isHost) return;
      callbacks.onGiveAllPrompt && callbacks.onGiveAllPrompt({ fromPeerId: data.fromPeerId, fromIndex: data.fromIndex, fromName: data.fromName });
      break;
    case 'give_all_response':
      // Client -> host: target's decision (only target should send this)
      if (!isHost) return;
      if (!data || typeof data.accepted === 'undefined') return;
      // Ensure the responder is indeed the target for the pending request
      const responderPeer = conn ? conn.peer : null;
      const responderIndex = typeof peerToIndex[responderPeer] !== 'undefined' ? peerToIndex[responderPeer] : 0;
      const pending = gameState.giveAllRequest;
      if (!pending) return;
      if (responderIndex !== pending.target) return;
      // Apply decision
      if (data.accepted){
        gameState.acceptGiveAll(pending.requester, pending.target);
        // Broadcast final state and send updated hands
        broadcastGameState();
        sendHandsToClients();
        // Inform original requester of result (if connected)
        const requesterPeer = Object.keys(peerToIndex).find(k=> peerToIndex[k] === pending.requester);
        if (requesterPeer && connections[requesterPeer] && connections[requesterPeer].open){ connections[requesterPeer].send({ type: 'give_all_result', accepted:true, fromIndex: pending.requester, targetIndex: pending.target }); }
      } else {
        gameState.rejectGiveAll(pending.requester, pending.target);
        broadcastGameState();
        sendHandsToClients();
        const requesterPeer = Object.keys(peerToIndex).find(k=> peerToIndex[k] === pending.requester);
        if (requesterPeer && connections[requesterPeer] && connections[requesterPeer].open){ connections[requesterPeer].send({ type: 'give_all_result', accepted:false, fromIndex: pending.requester, targetIndex: pending.target }); }
      }
      break;
    case 'give_all_denied':
      // Client receives immediate denial from host (e.g., invalid target or another pending request)
      if (isHost) return;
      callbacks.onGiveAllDenied && callbacks.onGiveAllDenied(data && data.reason);
      break;
    case 'give_all_result':
      // Client receives final outcome (either acceptance causing game end, or rejection)
      if (isHost) return;
      callbacks.onGiveAllResult && callbacks.onGiveAllResult({ accepted: data.accepted, fromIndex: data.fromIndex, targetIndex: data.targetIndex });
      break;
    case 'log_entry':
      // client receives a log entry from host
      if (isHost) return;
      callbacks.onLog && callbacks.onLog(data.entry);
      break;
    case 'game_state':
      // Client receives public state to sync
      if (isHost) return;
      gameState.applyHostState(data.gameState);
      break;
    case 'players_list':
      // Client receives updated connected-players list from host
      if (isHost) return;
      callbacks.onPlayersList && callbacks.onPlayersList(data.list || [], false);
      break;
  }
}

function updatePlayersList(){
  // Build a list of connected players with their chosen names (host only)
  // Use a deterministic (sorted) order for peers so the broadcast list
  // matches the ordering used by startGame when assigning player indices.
  const sortedPeers = Object.keys(connections).sort();
  const peers = sortedPeers.map(peerId=>({ peerId, name: (connections[peerId] && connections[peerId]._name) ? connections[peerId]._name : ('Player '+peerId.slice(-4)) }));
  // Include host as the first entry so clients see the full player order
  const hostName = document.getElementById('playerName')?.value || 'Host';
  const fullList = [{ peerId: myPeerId, name: hostName, isHost: true }, ...peers];
  callbacks.onPlayersList && callbacks.onPlayersList(fullList, isHost);
  // Broadcast the connected player list to all clients so everyone can show it
  const payload = { type: 'players_list', list: fullList };
  Object.values(connections).forEach(conn=>{ if (conn.open) conn.send(payload); });
}

export function hostGame(){
  if (!peer) initializePeer();
  isHost = true; callbacks.onHostStarted && callbacks.onHostStarted();
  startLogForwarding();
}

export function joinGame(hostId){
  if (!peer) initializePeer();
  const conn = peer.connect(hostId);
  setupConnection(conn, false);
  conn.on('open', ()=>{ conn.send({type:'request_join', name: document.getElementById('playerName')?.value || 'Player', peerId: myPeerId}); });
}

export function startGame(){
  if (!isHost) return;
  // Build players array: host + connected peers
  const configs = [];
  configs.push({ name: document.getElementById('playerName')?.value || 'Host', isHuman:true, peerId: myPeerId });
  // Determine a deterministic order for peers (sorted by peerId) and assign indices
  const sortedPeers = Object.keys(connections).sort();
  peerToIndex = {};
  sortedPeers.forEach((peerId, i)=>{
    const playerIndex = i + 1; // host is 0
    peerToIndex[peerId] = playerIndex;
    const conn = connections[peerId];
    const name = conn && conn._name ? conn._name : ('Player '+peerId.substr(-4));
    configs.push({ name, isHuman:true, peerId });
  });
  gameState.setupPlayers(configs);
  gameState.deal();
  // After dealing, send each client only their hand and index
  sendHandsToClients(true);
  // Broadcast public state
  broadcastGameState();
  // Ensure all clients immediately receive the connected players list and UI sync
  updatePlayersList();
  callbacks.onConnectionStatus && callbacks.onConnectionStatus('Game started!', 'ok');
}

function broadcastGameState(){
  const state = gameState.getPublicState();
  Object.values(connections).forEach(conn=> conn.open && conn.send({type:'game_state', gameState: state}));
}

function sendHandsToClients(initial=false){
  // Send each connected client only their hand and index
  Object.entries(peerToIndex).forEach(([peerId, playerIndex])=>{
    const conn = connections[peerId];
    if (!conn) return;
    const hand = gameState.getPlayerHand(playerIndex);
    if (conn.open) conn.send({ type: 'your_hand', playerIndex, hand });
  });
  // Also inform host (local) about their hand via callback
  callbacks.onHostHands && callbacks.onHostHands(gameState.getPlayerHand(0), 0);
}

export function sendPlayRequest(playerIndex, card){
  if (isHost){
    // Host processes directly. If locked, still broadcast to resync clients.
    if (gameState.isTurnLocked && gameState.isTurnLocked()){
      broadcastGameState();
      sendHandsToClients();
      return;
    }
    const res = gameState.playCard(playerIndex, card);
      if (res && (res.clean || res.pickup)){
      if (roundTimer) { clearTimeout(roundTimer); roundTimer = null; }
      if (res.clean && typeof res.nextLeader !== 'undefined') gameState.setDisplayTurn(res.nextLeader);
      if (res.pickup && typeof res.collector !== 'undefined') gameState.setDisplayTurn(res.collector);
      gameState.lockTurn();
      broadcastGameState();
      sendHandsToClients();
      console.log(`Host (direct): trick completed — pausing ${PAUSE_MS}ms`);
      roundTimer = setTimeout(()=>{
        console.log('Host (direct): pause ended — finalizing trick');
        gameState.finalizePendingTrick();
        gameState.unlockTurn();
        broadcastGameState();
        sendHandsToClients();
        roundTimer = null;
      }, PAUSE_MS);
    } else {
      broadcastGameState();
      sendHandsToClients();
    }
  } else {
    if (!hostConnection || !hostConnection.open){
      // Attempt to use peer.connect to host
      const hostId = document.getElementById('hostPeerId')?.value;
      if (!hostConnection && hostId) hostConnection = peer.connect(hostId);
    }
    if (hostConnection && hostConnection.open) hostConnection.send({type:'play_request', card});
  }
}

export function getMyPeerId(){ return myPeerId; }

export function sendGiveAllRequest(targetPeerId){
  if (isHost){
    // Host initiating a request: treat host as requesterIndex 0
    const requesterIndex = 0;
    const targetIndex = (targetPeerId === myPeerId) ? 0 : peerToIndex[targetPeerId];
    if (typeof targetIndex === 'undefined') return;
    if (targetIndex === requesterIndex) return;
    if (gameState.gameOver) return;
    if (gameState.giveAllRequest) return;
    gameState.setGiveAllRequest({ requester: requesterIndex, target: targetIndex });
    broadcastGameState(); sendHandsToClients();
    // Forward prompt to target
    if (targetIndex === 0){ callbacks.onGiveAllPrompt && callbacks.onGiveAllPrompt({ fromIndex: requesterIndex, fromPeerId: myPeerId, fromName: gameState.players[requesterIndex]?.name }); }
    else if (connections[targetPeerId] && connections[targetPeerId].open){ connections[targetPeerId].send({ type:'give_all_prompt', fromPeerId: myPeerId, fromIndex: requesterIndex, fromName: gameState.players[requesterIndex]?.name }); }
    return;
  }
  if (!hostConnection || !hostConnection.open){ const hostId = document.getElementById('hostPeerId')?.value; if (!hostConnection && hostId) hostConnection = peer.connect(hostId); }
  if (hostConnection && hostConnection.open) hostConnection.send({ type:'give_all_request', targetPeerId });
}

export function sendGiveAllResponse(accepted){
  if (isHost){
    // Host is the authoritative process — handle the pending request locally
    const pending = gameState.giveAllRequest;
    if (!pending) return;
    if (accepted){
      gameState.acceptGiveAll(pending.requester, pending.target);
    } else {
      gameState.rejectGiveAll(pending.requester, pending.target);
    }
    broadcastGameState(); sendHandsToClients();
    return;
  }
  if (!hostConnection || !hostConnection.open){ const hostId = document.getElementById('hostPeerId')?.value; if (!hostConnection && hostId) hostConnection = peer.connect(hostId); }
  if (hostConnection && hostConnection.open) hostConnection.send({ type:'give_all_response', accepted });
}

// Expose whether this instance is the host
export function amIHost(){ return isHost; }
