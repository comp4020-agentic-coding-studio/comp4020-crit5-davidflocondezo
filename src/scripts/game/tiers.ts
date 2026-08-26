export type Tier = "soju" | "vodka" | "tequila" | "whiskey";

export const TIER_ORDER: readonly Tier[] = ["soju", "vodka", "tequila", "whiskey"];

export const TIER_DAMAGE: Readonly<Record<Tier, number>> = {
  soju: 5,
  vodka: 10,
  tequila: 15,
  whiskey: 25,
};

export const TIER_COLOR: Readonly<Record<Tier, string>> = {
  soju: "#3fae4b",
  vodka: "#9aa0a6",
  tequila: "#2f8fe0",
  whiskey: "#e0b12f",
};

export function tierRank(tier: Tier): number {
  return TIER_ORDER.indexOf(tier);
}

export function bidValue(tiers: readonly Tier[]): number {
  return tiers.reduce((total, tier) => total + TIER_DAMAGE[tier], 0);
}
