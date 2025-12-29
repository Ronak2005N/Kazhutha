// Bot decision logic - pure functions, no DOM access
import { RANK_VALUE } from './gameState.js';

// Choose a card for a bot given a readonly view of gameState and playerIndex
export function chooseCard(gameState, playerIndex){
  const player = gameState.players[playerIndex];
  const hand = player.hand;
  const leadSuit = gameState.leadSuit;
  const firstTrick = gameState.firstTrick;
  const leader = gameState.leader;

  if (!leadSuit){
    // If first trick and bot holds A♠ and is leader, play it; else play lowest
    const idxAS = hand.findIndex(c=> c.rank==='A' && c.suit==='♠');
    if (firstTrick && idxAS>=0 && playerIndex===leader) return hand[idxAS];
    // Lowest by rank value (min)
    return hand.reduce((best,c)=> (RANK_VALUE[c.rank] < RANK_VALUE[best.rank] ? c : best), hand[0]);
  }

  const sameSuit = hand.filter(c=> c.suit===leadSuit);
  if (sameSuit.length){
    // Follow suit with lowest
    return sameSuit.reduce((low,c)=> (RANK_VALUE[c.rank] < RANK_VALUE[low.rank] ? c : low), sameSuit[0]);
  } else {
    // Void: throw highest to force pickup
    return hand.reduce((best,c)=> (RANK_VALUE[c.rank] > RANK_VALUE[best.rank] ? c : best), hand[0]);
  }
}
