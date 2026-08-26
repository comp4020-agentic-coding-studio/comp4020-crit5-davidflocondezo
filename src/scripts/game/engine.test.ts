import { describe, expect, it } from "vitest";
import {
  IllegalMoveError,
  MAX_INTOXICATION,
  MAX_PUSH,
  advanceTurn,
  applyDamage,
  beatsBid,
  checkElimination,
  legalClaims,
  pushToPot,
  resolveChallenge,
  type GameState,
  type Player,
} from "./engine.ts";

function makeState(overrides: Partial<GameState> = {}): GameState {
  const players: Player[] = [0, 1, 2, 3].map((seat) => ({
    seat,
    name: seat === 0 ? "You" : `Bot${seat}`,
    kind: seat === 0 ? "human" : "bot",
    flight: [],
    intoxication: 0,
    out: false,
  }));
  return {
    players,
    turn: 0,
    round: 1,
    pot: [],
    phase: "playing",
    resolution: null,
    outcome: null,
    log: [],
    seed: 1,
    ...overrides,
  };
}

describe("rule: whoever was wrong drinks the whole pot", () => {
  it("a true claim burns the doubter with everything pushed so far, not just the last push", () => {
    let state = makeState({
      players: [
        { seat: 0, name: "You", kind: "human", flight: ["vodka", "vodka"], intoxication: 0, out: false },
        { seat: 1, name: "Mira", kind: "bot", flight: ["whiskey", "whiskey"], intoxication: 0, out: false },
        { seat: 2, name: "Ozzy", kind: "bot", flight: [], intoxication: 0, out: false },
        { seat: 3, name: "Pim", kind: "bot", flight: [], intoxication: 0, out: false },
      ],
    });

    state = pushToPot(state, 0, [0], { quantity: 1, tier: "vodka" }); // honest: 1 vodka
    state = advanceTurn(state);
    state = pushToPot(state, 1, [0, 1], { quantity: 2, tier: "whiskey" }); // honest: 2 whiskey

    const resolved = resolveChallenge(state, 0); // seat 0 doubts a TRUE claim

    expect(resolved.resolution?.claimWasTrue).toBe(true);
    expect(resolved.resolution?.drinker).toBe(0); // the doubter is burned
    expect(resolved.resolution?.damage).toBe(10 + 25 + 25); // vodka + whiskey + whiskey, the WHOLE pot
    expect(resolved.players[0].intoxication).toBe(60);
    expect(resolved.players[1].intoxication).toBe(0);
  });

  it("a false claim burns the claimer with everything pushed so far, not just the last push", () => {
    let state = makeState({
      players: [
        { seat: 0, name: "You", kind: "human", flight: ["vodka", "vodka"], intoxication: 0, out: false },
        { seat: 1, name: "Mira", kind: "bot", flight: ["tequila", "tequila"], intoxication: 0, out: false },
        { seat: 2, name: "Ozzy", kind: "bot", flight: [], intoxication: 0, out: false },
        { seat: 3, name: "Pim", kind: "bot", flight: [], intoxication: 0, out: false },
      ],
    });

    state = pushToPot(state, 0, [0], { quantity: 1, tier: "vodka" }); // honest: 1 vodka
    state = advanceTurn(state);
    state = pushToPot(state, 1, [0, 1], { quantity: 2, tier: "whiskey" }); // LIE: actually tequila

    const resolved = resolveChallenge(state, 0); // seat 0 doubts a LIE

    expect(resolved.resolution?.claimWasTrue).toBe(false);
    expect(resolved.resolution?.drinker).toBe(1); // the liar is burned, not the doubter
    expect(resolved.resolution?.damage).toBe(10 + 15 + 15); // vodka + tequila + tequila, the WHOLE pot
    expect(resolved.players[1].intoxication).toBe(40);
    expect(resolved.players[0].intoxication).toBe(0);
  });

  it("the lie is judged by tier only — the claimed quantity always matches what was pushed", () => {
    const state = makeState({
      players: [
        { seat: 0, name: "You", kind: "human", flight: ["vodka", "vodka"], intoxication: 0, out: false },
        { seat: 1, name: "Mira", kind: "bot", flight: [], intoxication: 0, out: false },
        { seat: 2, name: "Ozzy", kind: "bot", flight: [], intoxication: 0, out: false },
        { seat: 3, name: "Pim", kind: "bot", flight: [], intoxication: 0, out: false },
      ],
    });

    expect(() => pushToPot(state, 0, [0], { quantity: 2, tier: "vodka" })).toThrow(IllegalMoveError);
  });
});

describe("beatsBid: raise by quantity (same tier) or by tier (any quantity)", () => {
  it("accepts a higher quantity of the same tier", () => {
    expect(beatsBid({ quantity: 3, tier: "vodka" }, { quantity: 2, tier: "vodka" })).toBe(true);
  });

  it("accepts a higher tier even at a lower quantity", () => {
    expect(beatsBid({ quantity: 1, tier: "tequila" }, { quantity: 3, tier: "vodka" })).toBe(true);
  });

  it("rejects an equal bid", () => {
    expect(beatsBid({ quantity: 2, tier: "vodka" }, { quantity: 2, tier: "vodka" })).toBe(false);
  });

  it("rejects a lower quantity of the same tier", () => {
    expect(beatsBid({ quantity: 1, tier: "vodka" }, { quantity: 2, tier: "vodka" })).toBe(false);
  });

  it("rejects a lower tier regardless of quantity", () => {
    expect(beatsBid({ quantity: 4, tier: "soju" }, { quantity: 1, tier: "vodka" })).toBe(false);
  });

  it("accepts any bid when the pot is empty", () => {
    expect(beatsBid({ quantity: 1, tier: "soju" }, null)).toBe(true);
  });
});

describe("legalClaims: the whiskey trap", () => {
  it("is empty once the bid is the maximum — 4 Whiskeys", () => {
    const state = makeState({
      pot: [{ by: 1, actual: ["whiskey", "whiskey", "whiskey", "whiskey"], claimed: { quantity: MAX_PUSH, tier: "whiskey" } }],
      players: [
        { seat: 0, name: "You", kind: "human", flight: ["soju", "vodka", "tequila", "whiskey"], intoxication: 0, out: false },
        { seat: 1, name: "Mira", kind: "bot", flight: [], intoxication: 0, out: false },
        { seat: 2, name: "Ozzy", kind: "bot", flight: [], intoxication: 0, out: false },
        { seat: 3, name: "Pim", kind: "bot", flight: [], intoxication: 0, out: false },
      ],
    });

    expect(legalClaims(state, 0)).toEqual([]);
  });
});

describe("elimination: exactly at MAX_INTOXICATION, not one drink later", () => {
  it("does not eliminate just under the cap", () => {
    let state = makeState();
    state = applyDamage(state, 0, MAX_INTOXICATION - 1);
    state = checkElimination(state, 0);
    expect(state.players[0].out).toBe(false);
  });

  it("eliminates exactly at the cap", () => {
    let state = makeState();
    state = applyDamage(state, 0, MAX_INTOXICATION);
    state = checkElimination(state, 0);
    expect(state.players[0].out).toBe(true);
  });

  it("caps the meter at MAX_INTOXICATION even when damage would overshoot", () => {
    let state = makeState();
    state = applyDamage(state, 0, MAX_INTOXICATION + 40);
    expect(state.players[0].intoxication).toBe(MAX_INTOXICATION);
  });
});

describe("advanceTurn: skips eliminated seats", () => {
  it("moves to the next live seat, not just seat + 1", () => {
    const state = makeState({
      turn: 0,
      players: [
        { seat: 0, name: "You", kind: "human", flight: [], intoxication: 0, out: false },
        { seat: 1, name: "Mira", kind: "bot", flight: [], intoxication: MAX_INTOXICATION, out: true },
        { seat: 2, name: "Ozzy", kind: "bot", flight: [], intoxication: 0, out: false },
        { seat: 3, name: "Pim", kind: "bot", flight: [], intoxication: 0, out: false },
      ],
    });

    expect(advanceTurn(state).turn).toBe(2);
  });
});
