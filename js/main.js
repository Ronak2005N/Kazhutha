import * as gameState from './gameState.js';
import * as ui from './ui.js';
import { chooseCard } from './bots.js';
import * as mp from './multiplayer.js';

let myIndex = null;
let multiplayerStarted = false;

// Subscribe UI to game state updates
gameState.subscribe((publicState)=>{
  const myHand = gameState.getPlayerHand(myIndex);
  const turnLocked = (gameState.isTurnLocked && gameState.isTurnLocked()) || false;
  ui.renderAll(publicState, myIndex, myHand, { turnLocked, enforceFollowSuit: gameState.enforceFollowSuit, multiplayerActive: multiplayerStarted });
  // If current turn is a bot, trigger bot play
  maybeBotPlay();
});

// Subscribe to logs and forward to UI
gameState.subscribeLogs(entry=>{ ui.log(entry.msg, entry.kind); });

function maybeBotPlay(){
  if (gameState.gameOver) return;
  const p = gameState.players[gameState.turn];
  if (!p) return;
  // Don't run bot logic on clients — only the host should auto-play bots in multiplayer
  if (typeof mp !== 'undefined' && mp && mp.amIHost && mp.amIHost() === false) return;
  if (!p.isHuman){
    setTimeout(()=>{
      // Bot chooses card using pure logic
      const card = chooseCard(gameState, gameState.turn);
      if (mp && (mp.getMyPeerId && mp.getMyPeerId())){
        // If multiplayer active, send via mp
        mp.sendPlayRequest(gameState.turn, card);
      } else {
        gameState.playCard(gameState.turn, card);
      }
    }, 600);
  }
}

// UI handlers
ui.initUI({
  onNewGame: ()=>{
    const configs = ui.readPlayerConfigs();
    gameState.setupPlayers(configs);
    gameState.deal();
    myIndex = 0;
    ui.log(`New ${gameState.playerCount}-player game. ${gameState.players[gameState.leader].name} leads.`,'ok');
  },
  onHow: ()=>{
    alert(`How to play Kazhutha:\n\n• Supports 2-8 players. Cards are dealt evenly (remaining cards go to first players).\n• Order: A > K > Q > J > 10 > … > 2.\n• The player with A♠ leads the very first trick.\n• Anti‑clockwise turns. Follow the suit if you have it.\n• If everyone follows the suit: highest card of that suit \"loses\" the trick and leads the next one. Those cards are discarded.\n• If someone cannot follow suit and plays any other suit: the current highest (of the lead suit so far) must pick up ALL cards on the table, add them to their hand, and lead the next trick.\n• Goal: empty your hand. The last person with cards is the Kazhutha!`);
  },
  onPlayerCountChange: (n)=>{ document.getElementById('playerCount').value = n; ui.createPlayerSetup(); ui.createGameTable(); },
  onPlayRequest: (playerIndex, card)=>{
    // Called when local UI player clicks a card
    if (mp && mp.getMyPeerId && mp.getMyPeerId()){
      mp.sendPlayRequest(playerIndex, card);
    } else {
      gameState.playCard(playerIndex, card);
    }
  },
  onHostGame: ()=>{
    mp.initializePeer(); mp.hostGame(); ui.updateConnectionStatus('Hosting...','warn');
  },
  onShowJoin: ()=>{ mp.initializePeer(); },
  onJoinAttempt: (hostId)=>{ mp.joinGame(hostId); },
  onStartMultiplayer: ()=>{ mp.startGame(); }
  ,
  onGiveAllRequest: (targetPeerId)=>{ mp.sendGiveAllRequest(targetPeerId); },
  onGiveAllResponse: (accepted)=>{ mp.sendGiveAllResponse(accepted); }
});

// Multiplayer callbacks
mp.initMultiplayer({
  onPeerOpen: (id)=>{ document.getElementById('myPeerId') && (document.getElementById('myPeerId').textContent = id); },
  onConnectionStatus: (msg,type)=> ui.updateConnectionStatus(msg,type),
  onPlayersList: (list, isHost)=> ui.updatePlayersListForUI(list, isHost, multiplayerStarted),
  onLog: (entry)=> ui.log(entry.msg, entry.kind),
  onHostHands: (hand, index)=>{ 
    // Host has been dealt their hand locally — assign host index 0 and enable UI
    myIndex = 0;
    multiplayerStarted = true;
    ui.updateConnectionStatus('You (Host) have been dealt your hand','ok');
    // Ensure UI re-renders now that myIndex is assigned
    if (gameState.publishState) gameState.publishState();
  },
  onYouAssigned: (idx, hand)=>{ myIndex = idx; /* ensure local hand set in gameState already */ },
  onHostStarted: ()=>{
    // Show host controls
    const hostSection = document.getElementById('hostSection'); if (hostSection) hostSection.style.display = 'block';
    const startBtn = document.getElementById('startGameBtn'); if (startBtn) startBtn.style.display = 'inline-block';
    ui.updateConnectionStatus('Hosting — waiting for players','ok');
  },
  onJoinedHostWaiting: ()=>{
    myIndex = null; multiplayerStarted = false; ui.updateConnectionStatus('Connected — waiting for host to start','warn');
  },
  onMultiplayerStarted: ()=>{
    multiplayerStarted = true; ui.updateConnectionStatus('Multiplayer game started','ok');
  }
  ,
  onGiveAllPrompt: (info)=>{ /* info: {fromPeerId,fromIndex,fromName} */ ui.showGiveAllPrompt(info); },
  onGiveAllDenied: (reason)=>{ ui.updateConnectionStatus('Give-All request denied: '+(reason||'unknown'), 'warn'); },
  onGiveAllResult: (res)=>{ ui.updateConnectionStatus(`Give-All ${res.accepted ? 'accepted' : 'rejected'}`, res.accepted ? 'ok' : 'warn'); }
});

// Expose small helpers for debugging
window.gameState = gameState;

// Initialize layout on load
document.addEventListener('DOMContentLoaded', ()=>{
  // ensure UI created
  ui.createPlayerSetup(); ui.createGameTable();
});
