import { pick } from "./rng.ts";
import { TIER_ORDER, bidValue, tierRank, type Tier } from "./tiers.ts";

export const SEAT_COUNT = 4;
export const HUMAN_SEAT = 0;
export const FLIGHT_SIZE = 5;
export const MAX_PUSH = 4;
export const MAX_INTOXICATION = 100;

const BOT_NAMES = ["Mira", "Ozzy", "Pim"];

export class IllegalMoveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IllegalMoveError";
  }
}

export interface Player {
  seat: number;
  name: string;
  kind: "human" | "bot";
  flight: Tier[];
  intoxication: number;
  out: boolean;
}

export interface Claim {
  quantity: number;
  tier: Tier;
}

export interface PotEntry {
  by: number;
  actual: Tier[];
  claimed: Claim;
}

export interface Resolution {
  challenger: number;
  accused: number;
  claimed: Claim;
  claimWasTrue: boolean;
  drinker: number;
  damage: number;
  eliminated: number | null;
}

export type Phase = "playing" | "reveal" | "over";

export type LogEntry =
  | { kind: "round-start"; round: number; opener: number }
  | { kind: "push"; by: number; quantity: number; tier: Tier }
  | { kind: "resolution"; resolution: Resolution }
  | { kind: "game-over"; outcome: "won" | "lost" };

export interface GameState {
  players: Player[];
  turn: number;
  round: number;
  pot: PotEntry[];
  phase: Phase;
  resolution: Resolution | null;
  outcome: "won" | "lost" | null;
  log: LogEntry[];
  seed: number;
}

export type Move =
  | { kind: "push"; shots: number[]; claimed: Claim }
  | { kind: "doubt" };

export function createGame(options: { seed?: number } = {}): GameState {
  const players: Player[] = [
    { seat: 0, name: "You", kind: "human", flight: [], intoxication: 0, out: false },
    ...BOT_NAMES.map((name, index) => ({
      seat: index + 1,
      name,
      kind: "bot" as const,
      flight: [],
      intoxication: 0,
      out: false,
    })),
  ];
  const state: GameState = {
    players,
    turn: 0,
    round: 0,
    pot: [],
    phase: "playing",
    resolution: null,
    outcome: null,
    log: [],
    seed: options.seed ?? 1,
  };
  return nextRound(state, 0);
}

export function currentPlayer(state: GameState): Player {
  return state.players[state.turn];
}

export function livePlayers(state: GameState): Player[] {
  return state.players.filter((player) => !player.out);
}

export function currentBid(state: GameState): Claim | null {
  if (state.pot.length === 0) return null;
  return state.pot[state.pot.length - 1].claimed;
}

export function beatsBid(next: Claim, prev: Claim | null): boolean {
  if (!prev) return true;
  const nextRank = tierRank(next.tier);
  const prevRank = tierRank(prev.tier);
  if (nextRank > prevRank) return true;
  if (nextRank < prevRank) return false;
  return next.quantity > prev.quantity;
}

export function legalClaims(state: GameState, seat: number): Claim[] {
  const player = state.players[seat];
  const bid = currentBid(state);
  const maxQuantity = Math.min(MAX_PUSH, player.flight.length);
  const claims: Claim[] = [];
  for (const tier of TIER_ORDER) {
    for (let quantity = 1; quantity <= maxQuantity; quantity++) {
      const candidate: Claim = { quantity, tier };
      if (beatsBid(candidate, bid)) claims.push(candidate);
    }
  }
  return claims;
}

export function legalMoves(state: GameState): { canPush: boolean; canDoubt: boolean } {
  if (state.phase !== "playing") return { canPush: false, canDoubt: false };
  return {
    canPush: legalClaims(state, state.turn).length > 0,
    canDoubt: state.pot.length > 0,
  };
}

export function dealFlights(state: GameState): GameState {
  const next = structuredClone(state);
  let seed = next.seed;
  for (const player of next.players) {
    if (player.out) {
      player.flight = [];
      continue;
    }
    const flight: Tier[] = [];
    for (let i = 0; i < FLIGHT_SIZE; i++) {
      const [tier, nextSeed] = pick(seed, TIER_ORDER);
      flight.push(tier);
      seed = nextSeed;
    }
    player.flight = flight;
  }
  next.seed = seed;
  return next;
}

export function pushToPot(state: GameState, seat: number, shots: number[], claimed: Claim): GameState {
  const next = structuredClone(state);
  const player = next.players[seat];
  if (!player || player.out) throw new IllegalMoveError(`seat ${seat} cannot push`);
  if (claimed.quantity < 1 || claimed.quantity > MAX_PUSH) {
    throw new IllegalMoveError(`quantity must be between 1 and ${MAX_PUSH}`);
  }
  if (shots.length !== claimed.quantity) {
    throw new IllegalMoveError("pushed shot count must match the claimed quantity");
  }
  if (new Set(shots).size !== shots.length) {
    throw new IllegalMoveError("shot indices must be unique");
  }
  for (const index of shots) {
    if (index < 0 || index >= player.flight.length) {
      throw new IllegalMoveError(`shot index ${index} out of range`);
    }
  }
  if (!beatsBid(claimed, currentBid(next))) {
    throw new IllegalMoveError("claim does not beat the current bid");
  }

  const actual = shots.map((index) => player.flight[index]);
  for (const index of [...shots].sort((a, b) => b - a)) player.flight.splice(index, 1);

  next.pot.push({ by: seat, actual, claimed });
  next.log.push({ kind: "push", by: seat, quantity: claimed.quantity, tier: claimed.tier });
  return next;
}

export function applyDamage(state: GameState, seat: number, amount: number): GameState {
  const next = structuredClone(state);
  const player = next.players[seat];
  player.intoxication = Math.min(MAX_INTOXICATION, player.intoxication + amount);
  return next;
}

export function checkElimination(state: GameState, seat: number): GameState {
  const next = structuredClone(state);
  const player = next.players[seat];
  if (player.intoxication >= MAX_INTOXICATION && !player.out) {
    player.out = true;
    if (player.kind === "human") {
      // The human blacking out ends the game immediately -- there is no
      // reason to keep simulating bots fighting each other for a result the
      // player can no longer affect or see the point of.
      next.outcome = "lost";
      next.log.push({ kind: "game-over", outcome: "lost" });
      return next;
    }
    const survivors = livePlayers(next);
    if (survivors.length === 1) {
      next.outcome = survivors[0].kind === "human" ? "won" : "lost";
      next.log.push({ kind: "game-over", outcome: next.outcome });
    }
  }
  return next;
}

export function resolveChallenge(state: GameState, challengerSeat: number): GameState {
  let next = structuredClone(state);
  const last = next.pot[next.pot.length - 1];
  if (!last) throw new IllegalMoveError("cannot resolve a challenge on an empty pot");

  const accused = last.by;
  const claimWasTrue =
    last.actual.length === last.claimed.quantity && last.actual.every((tier) => tier === last.claimed.tier);
  const damage = bidValue(next.pot.flatMap((entry) => entry.actual));
  const drinker = claimWasTrue ? challengerSeat : accused;

  next = applyDamage(next, drinker, damage);
  next = checkElimination(next, drinker);

  const resolution: Resolution = {
    challenger: challengerSeat,
    accused,
    claimed: last.claimed,
    claimWasTrue,
    drinker,
    damage,
    eliminated: next.players[drinker].out ? drinker : null,
  };
  next.resolution = resolution;
  next.phase = "reveal";
  next.log.push({ kind: "resolution", resolution });
  return next;
}

export function advanceTurn(state: GameState): GameState {
  const next = structuredClone(state);
  for (let step = 1; step <= SEAT_COUNT; step++) {
    const candidate = (next.turn + step) % SEAT_COUNT;
    if (!next.players[candidate].out) {
      next.turn = candidate;
      break;
    }
  }
  return next;
}

export function nextRound(state: GameState, openerSeat: number): GameState {
  let next = structuredClone(state);
  next.pot = [];
  next.resolution = null;
  next.round += 1;
  let opener = openerSeat;
  for (let step = 0; step < SEAT_COUNT; step++) {
    if (!next.players[opener].out) break;
    opener = (opener + 1) % SEAT_COUNT;
  }
  next.turn = opener;
  next.phase = "playing";
  next.log.push({ kind: "round-start", round: next.round, opener });
  return dealFlights(next);
}

export function applyMove(state: GameState, move: Move): GameState {
  if (state.phase !== "playing") {
    throw new IllegalMoveError(`cannot move during phase "${state.phase}"`);
  }
  if (move.kind === "push") {
    return advanceTurn(pushToPot(state, state.turn, move.shots, move.claimed));
  }
  if (state.pot.length === 0) throw new IllegalMoveError("cannot doubt an empty pot");
  return resolveChallenge(state, state.turn);
}

export function continueAfterReveal(state: GameState): GameState {
  if (state.phase !== "reveal") {
    throw new IllegalMoveError(`cannot continue from phase "${state.phase}"`);
  }
  if (state.outcome) {
    const next = structuredClone(state);
    next.phase = "over";
    return next;
  }
  return nextRound(state, state.resolution!.drinker);
}
