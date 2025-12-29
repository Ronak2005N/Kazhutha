// Core game state and rules (no DOM access)
// Exports functions to manipulate state and subscribe to state changes.

export const SUITS = ['♠', '♥', '♦', '♣'];
export const RANKS_DESC = ['A','K','Q','J','10','9','8','7','6','5','4','3','2'];
export const RANK_VALUE = Object.fromEntries(RANKS_DESC.map((r,i)=>[r, RANKS_DESC.length - i]));

// Game state (single source of truth)
export let players = []; // {name,isHuman,hand:[],out,peerId?}
export let playerCount = 4;
export let leader = 0;
export let turn = 0;
export let trick = []; // [{player, card}]
export let leadSuit = null;
export let currentHighest = null;
export let participantsThisTrick = new Set();
export let activeAtTrickStart = 0;
export let firstTrick = true;
export let gameOver = false;
export let turnLocked = false; // prevents double plays / cheating (used by multiplayer)
let pendingTrick = null; // {type: 'clean'|'pickup', nextLeader?, collector?}
export let giveAllRequest = null; // {requester,target}
let displayTurn = null; // temporary visible turn during host pause

export function setDisplayTurn(idx){ displayTurn = typeof idx === 'number' ? idx : null; }
export function clearDisplayTurn(){ displayTurn = null; }

// Turn lock helpers — use these from other modules instead of assigning to
// the exported `turnLocked` property (module namespace is read-only from imports).
export function lockTurn(){ turnLocked = true; }
export function unlockTurn(){ turnLocked = false; }
export function isTurnLocked(){ return turnLocked; }

export function setGiveAllRequest(req){
  // req: {requester: index, target: index}
  giveAllRequest = req || null;
  // While a give-all request is pending, lock turns to prevent plays
  turnLocked = !!req;
  notify();
}

export function clearGiveAllRequest(){ giveAllRequest = null; turnLocked = false; notify(); }

export function transferAllCards(requesterIndex, targetIndex){
  if (typeof requesterIndex !== 'number' || typeof targetIndex !== 'number') return false;
  if (!players[requesterIndex] || !players[targetIndex]) return false;
  // Move all cards from target to requester
  const taken = players[targetIndex].hand.splice(0, players[targetIndex].hand.length);
  players[requesterIndex].hand.push(...taken);
  sortHand(players[requesterIndex].hand);
  // Update out flags
  players[targetIndex].out = players[targetIndex].hand.length === 0;
  players[requesterIndex].out = players[requesterIndex].hand.length === 0;
  return true;
}

export function acceptGiveAll(requesterIndex, targetIndex){
  // Apply the transfer then mark the target as finished (they've secured a win position)
  const ok = transferAllCards(requesterIndex, targetIndex);
  if (!ok) return false;
  // Mark target as finished/out so they are skipped in future turns
  players[targetIndex].out = true;
  pushLog(`${players[targetIndex].name} accepted a Give-All request from ${players[requesterIndex].name} and is finished (winner).`, 'ok');
  // Clear any pending request and unlock turns so play can continue
  giveAllRequest = null;
  turnLocked = false;
  // Re-evaluate game end (only ends when one player remains active)
  checkGameEnd();
  notify();
  return true;
}

export function rejectGiveAll(requesterIndex, targetIndex){
  // No transfer, simply clear request and continue
  pushLog(`${players[targetIndex].name} rejected the Give-All request from ${players[requesterIndex].name}.`, 'warn');
  giveAllRequest = null;
  turnLocked = false;
  notify();
  return true;
}

const subscribers = new Set();
const logSubscribers = new Set();
const logs = [];

function notify() { subscribers.forEach(cb=>cb(getPublicState())); }

export function subscribe(cb){ subscribers.add(cb); return ()=> subscribers.delete(cb); }

function pushLog(msg, kind=''){
  const entry = {msg, kind, ts: Date.now()};
  logs.push(entry);
  logSubscribers.forEach(cb=>cb(entry));
}

export function subscribeLogs(cb){ logSubscribers.add(cb); return ()=> logSubscribers.delete(cb); }

export function getLogs(){ return logs.slice(); }

// Deck helpers
export function newDeck(){
  const deck = [];
  for (const s of SUITS) for (const r of RANKS_DESC) deck.push({suit: s, rank: r});
  return deck;
}

export function shuffle(a){
  for (let i=a.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [a[i],a[j]] = [a[j], a[i]];
  }
  return a;
}

export function sortHand(hand){
  const suitOrder = {'♠':0,'♥':1,'♦':2,'♣':3};
  hand.sort((c1,c2)=> suitOrder[c1.suit]-suitOrder[c2.suit] || RANK_VALUE[c2.rank]-RANK_VALUE[c1.rank]);
}

export function compareRank(c1,c2){ return RANK_VALUE[c1.rank] - RANK_VALUE[c2.rank]; }

export function activePlayersCount(){ return players.filter(p=>!p.out).length; }

export function nextActive(idx){
  let n = idx;
  do { n = (n - 1 + playerCount) % playerCount; } while (players[n].out);
  return n;
}

export function setupPlayers(configs){
  // configs: array of {name,isHuman,peerId?}
  players = configs.slice(0, Math.max(1, configs.length)).map(c=>({
    name: c.name || 'Player', isHuman: !!c.isHuman, hand: [], out: false, peerId: c.peerId
  }));
  playerCount = players.length;
  notify();
}

export function deal(){
  const deck = shuffle(newDeck());
  const cardsPerPlayer = Math.floor(52 / playerCount);
  const remainingCards = 52 % playerCount;

  for (const p of players) p.hand = [];

  let cardIndex = 0;
  for (let i = 0; i < cardsPerPlayer; i++){
    for (let p = 0; p < playerCount; p++){
      players[p].hand.push(deck[cardIndex++]);
    }
  }
  for (let i = 0; i < remainingCards; i++) players[i].hand.push(deck[cardIndex++]);

  for (const p of players) sortHand(p.hand);

  leader = players.findIndex(p=> p.hand.some(c=> c.rank==='A' && c.suit==='♠'));
  if (leader === -1) leader = 0;
  turn = leader;
  leadSuit = null;
  trick = [];
  currentHighest = null;
  participantsThisTrick = new Set();
  firstTrick = true;
  gameOver = false;
  activeAtTrickStart = activePlayersCount();
  turnLocked = false;
  pushLog(`New ${playerCount}-player game. ${players[leader].name} holds A♠ and leads.`, 'ok');
  pushLog(`Cards per player: ${cardsPerPlayer}${remainingCards > 0 ? ` (${remainingCards} players get +1)` : ''}`);
  notify();
}

export function removeFromHand(playerIndex, card){
  const hand = players[playerIndex].hand;
  const idx = hand.findIndex(c=> c.suit===card.suit && c.rank===card.rank);
  if (idx>=0) hand.splice(idx,1);
  if (hand.length===0) players[playerIndex].out = true;
  if (players[playerIndex].out) pushLog(`${players[playerIndex].name} is out of cards! ✨`, 'ok');
}

function cardToText(c){ return c ? `${c.rank}${c.suit}` : ''; }

export function enforceFollowSuit(playerIndex, card){
  if (!leadSuit) return true;
  if (card.suit === leadSuit) return true;
  const hasLeadSuit = players[playerIndex].hand.some(c=> c.suit===leadSuit);
  return !hasLeadSuit;
}

function checkGameEnd(){
  const active = players.filter(p=>!p.out);
  if (active.length === 1){
    gameOver = true;
  }
}

export function beginNewTrick(nextLeader){
  leader = nextLeader;
  turn = leader;
  trick = [];
  leadSuit = null;
  currentHighest = null;
  participantsThisTrick = new Set();
  activeAtTrickStart = activePlayersCount();
  firstTrick = false;
  notify();
}

// Core play function. Returns an object {accepted: bool, reason?:string}
export function playCard(playerIndex, card){
  if (gameOver) return {accepted:false, reason: 'game_over'};
  if (turnLocked) return {accepted:false, reason: 'turn_locked'};
  if (turn !== playerIndex) return {accepted:false, reason: 'not_your_turn'};
  if (!enforceFollowSuit(playerIndex, card)) return {accepted:false, reason: 'must_follow_suit'};

  // Apply play
  trick.push({player: playerIndex, card});
  participantsThisTrick.add(playerIndex);
  removeFromHand(playerIndex, card);

  if (!leadSuit){
    leadSuit = card.suit;
    currentHighest = {player: playerIndex, card};
    pushLog(`${players[playerIndex].name} leads ${cardToText(card)}.`);
  } else {
    if (card.suit === leadSuit){
      if (compareRank(card, currentHighest.card) > 0) currentHighest = {player: playerIndex, card};
      pushLog(`${players[playerIndex].name} now highest with ${cardToText(card)}.`);
    } else {
        // Off-suit thrown -> schedule pickup by currentHighest.player (host will finalize after pause)
        const collector = currentHighest.player;
        pendingTrick = { type: 'pickup', collector };
        pushLog(`${players[playerIndex].name} is void in ${leadSuit} and throws ${cardToText(card)} → ${players[collector].name} will pick up the trick!`, 'bad');
        notify();
        return {accepted:true, pickup:true, collector};
    }
  }

  const allPlayed = participantsThisTrick.size === activeAtTrickStart;
  if (allPlayed){
    const nextLeader = currentHighest.player;
    pushLog(`Clean trick. Highest was ${players[nextLeader].name} with ${cardToText(currentHighest.card)}. They lead next.`, 'warn');
    // Mark trick pending so host may pause before starting next trick
    pendingTrick = { type: 'clean', nextLeader };
    checkGameEnd();
    notify();
    return {accepted:true, clean:true, nextLeader};
  }

  // Continue to next player's turn (anti-clockwise)
  turn = nextActive(turn);
  notify();
  return {accepted:true};
}

export function getPublicState(){
  return {
    players: players.map(p=>({name:p.name,isHuman:p.isHuman,handCount: (typeof p.handCount === 'number' ? p.handCount : (p.hand ? p.hand.length : 0)),out:p.out,peerId:p.peerId})),
    playerCount, leader, turn: (displayTurn !== null ? displayTurn : turn), trick, leadSuit, gameOver, firstTrick,
    turnLocked, pendingTrick, displayTurn, giveAllRequest
  };
}

export function getPlayerHand(index){ return players[index] ? players[index].hand : []; }

// Apply a host-provided public state (clients use this to sync without revealing other hands)
export function applyHostState(state){
  if (!state) return;
  playerCount = state.playerCount || playerCount;
  // Ensure players array length
  while (players.length < playerCount) players.push({name:`Player ${players.length+1}`, isHuman:false, hand:[], out:false});
  for (let i=0;i<playerCount;i++){
    players[i].name = state.players[i]?.name || players[i].name;
    players[i].isHuman = state.players[i]?.isHuman || players[i].isHuman;
      players[i].out = state.players[i]?.out || false;
      // Preserve only the public hand count provided by the host (do not store cards)
      players[i].handCount = typeof state.players[i]?.handCount === 'number' ? state.players[i].handCount : (players[i].hand ? players[i].hand.length : 0);
      // do not overwrite existing hand arrays here (clients should only receive their own hand via 'your_hand')
  }
  leader = state.leader;
  turn = state.turn;
  trick = state.trick || [];
  leadSuit = state.leadSuit;
  gameOver = state.gameOver || false;
  firstTrick = state.firstTrick || false;
  // Respect host-provided turn lock and pending trick state
  turnLocked = !!state.turnLocked;
  pendingTrick = state.pendingTrick || null;
  giveAllRequest = state.giveAllRequest || null;
  displayTurn = typeof state.displayTurn !== 'undefined' ? state.displayTurn : null;
  notify();
}

// Finalize any pending trick (host should call this after the pause)
export function finalizePendingTrick(){
  if (!pendingTrick) return;
  const p = pendingTrick;
  pendingTrick = null;
  displayTurn = null;
  if (p.type === 'pickup'){
    const collector = p.collector;
    // Collector picks up all cards on table
    players[collector].hand.push(...trick.map(t=>t.card));
    sortHand(players[collector].hand);
    trick = [];
    leadSuit = null;
    currentHighest = null;
    participantsThisTrick = new Set();
    checkGameEnd();
    if (!gameOver) beginNewTrick(collector);
    notify();
    return;
  }
  if (p.type === 'clean'){
    const nextLeader = p.nextLeader;
    trick = [];
    leadSuit = null;
    currentHighest = null;
    participantsThisTrick = new Set();
    checkGameEnd();
    if (!gameOver) beginNewTrick(nextLeader);
    notify();
    return;
  }
}

// Expose a way for external modules to request a re-publish of the current state
export function publishState(){ notify(); }
