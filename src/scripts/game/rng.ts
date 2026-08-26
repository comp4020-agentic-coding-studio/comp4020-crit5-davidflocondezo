// Seeded mulberry32 PRNG, threaded as [value, nextSeed] tuples so callers
// (GameState in particular) stay plain, structuredClone-safe objects — no RNG
// closures hiding in state.

export function nextUint32(seed: number): [number, number] {
  let state = (seed + 0x6d2b79f5) | 0;
  state = Math.imul(state ^ (state >>> 15), state | 1);
  state ^= state + Math.imul(state ^ (state >>> 7), state | 61);
  const value = ((state ^ (state >>> 14)) >>> 0);
  return [value, state >>> 0];
}

export function nextFloat(seed: number): [number, number] {
  const [value, nextSeed] = nextUint32(seed);
  return [value / 4294967296, nextSeed];
}

export function nextInt(seed: number, bound: number): [number, number] {
  const [value, nextSeed] = nextFloat(seed);
  return [Math.floor(value * bound), nextSeed];
}

export function pick<T>(seed: number, items: readonly T[]): [T, number] {
  const [index, nextSeed] = nextInt(seed, items.length);
  return [items[index], nextSeed];
}
