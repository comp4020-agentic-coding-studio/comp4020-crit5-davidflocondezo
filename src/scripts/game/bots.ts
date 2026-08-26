import { nextFloat } from "./rng.ts";
import { TIER_DAMAGE, TIER_ORDER, tierRank, type Tier } from "./tiers.ts";
import { MAX_INTOXICATION, currentBid, legalClaims, type Claim, type GameState, type Move } from "./engine.ts";

// Bots only ever read: the public claim history (state.pot[].claimed), public
// intoxication levels, and their own flight. They never read another seat's
// flight or a pot entry's `actual` — that's the hidden information the human
// is bluffing against, and a bot that peeked at it wouldn't be a fair opponent.

export interface Personality {
  name: string;
  callThreshold: number;
  bluffRate: number;
}

export const PERSONALITIES: readonly Personality[] = [
  { name: "Mira", callThreshold: 0.45, bluffRate: 0.25 }, // steady
  { name: "Ozzy", callThreshold: 0.62, bluffRate: 0.55 }, // rarely doubts, lies a lot
  { name: "Pim", callThreshold: 0.35, bluffRate: 0.35 }, // trigger-happy doubter
];

function personalityFor(seat: number): Personality {
  return PERSONALITIES[seat - 1] ?? PERSONALITIES[0];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function potClaimedValue(state: GameState): number {
  return state.pot.reduce((total, entry) => total + entry.claimed.quantity * TIER_DAMAGE[entry.claimed.tier], 0);
}

function cheapestShots(flight: Tier[], count: number): number[] {
  return flight
    .map((tier, index) => ({ index, damage: TIER_DAMAGE[tier] }))
    .sort((a, b) => a.damage - b.damage)
    .slice(0, count)
    .map((entry) => entry.index);
}

function indicesOfTier(flight: Tier[], tier: Tier, count: number): number[] {
  const indices: number[] = [];
  for (let i = 0; i < flight.length && indices.length < count; i++) {
    if (flight[i] === tier) indices.push(i);
  }
  return indices;
}

// Score in [0,1]: how suspicious this bot finds the current bid.
export function suspicion(state: GameState, seat: number, rngSeed: number): [number, number] {
  const bid = currentBid(state);
  if (!bid) return [0, rngSeed];

  const player = state.players[seat];
  const tierSuspicion = tierRank(bid.tier) / (TIER_ORDER.length - 1);
  const held = player.flight.filter((tier) => tier === bid.tier).length;
  const scarcity = held >= bid.quantity ? 0 : 1 - held / bid.quantity;

  const risk = Math.min(1, (player.intoxication + potClaimedValue(state)) / MAX_INTOXICATION);
  const riskAversion = risk * 0.3; // a scary pot makes a bot LESS willing to call, not more

  const [jitter, nextSeed] = nextFloat(rngSeed);
  const score = clamp01(tierSuspicion * 0.5 + scarcity * 0.4 - riskAversion + (jitter - 0.5) * 0.1);
  return [score, nextSeed];
}

// Assumes legalClaims(state, seat) is non-empty — callers check the trap first.
export function chooseRaise(state: GameState, seat: number, rngSeed: number): [Move, number] {
  const options = legalClaims(state, seat);
  const player = state.players[seat];
  const personality = personalityFor(seat);

  const [reachRoll, seedAfterReach] = nextFloat(rngSeed);
  const reachIndex = reachRoll < 0.15 ? Math.min(1, options.length - 1) : 0; // usually the minimum raise
  const claimed: Claim = options[reachIndex];

  const heldOfClaimedTier = player.flight.filter((tier) => tier === claimed.tier).length;
  const canBeHonest = heldOfClaimedTier >= claimed.quantity;
  const [bluffRoll, seedAfterBluff] = nextFloat(seedAfterReach);
  const bluff = !canBeHonest || bluffRoll < personality.bluffRate;

  const shots = bluff ? cheapestShots(player.flight, claimed.quantity) : indicesOfTier(player.flight, claimed.tier, claimed.quantity);

  return [{ kind: "push", shots, claimed }, seedAfterBluff];
}

export function chooseBotMove(state: GameState, seat: number, rngSeed: number): [Move, number] {
  const options = legalClaims(state, seat);
  if (options.length === 0) return [{ kind: "doubt" }, rngSeed]; // the whiskey trap: no legal raise left
  if (state.pot.length === 0) return chooseRaise(state, seat, rngSeed); // must open the round with a push

  const personality = personalityFor(seat);
  const [score, seedAfterSuspicion] = suspicion(state, seat, rngSeed);
  if (score > personality.callThreshold) return [{ kind: "doubt" }, seedAfterSuspicion];
  return chooseRaise(state, seat, seedAfterSuspicion);
}
