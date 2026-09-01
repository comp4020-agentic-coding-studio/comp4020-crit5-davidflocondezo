# Process overview

## What I built

**Last Player Standing** — a solo-vs-three-bots bluffing game that blends
Liar's Dice bidding with Cheat's face-down deception. Each round
everyone pushes 1–4 face-down shots and claims a tier for them; a claim must
raise the pot by quantity or by tier; a doubt reveals every push made so far
and whoever was wrong drinks the whole accumulated pot, not just the last
push. Miss 100% intoxication and you black out; last one standing wins.

## The moments that mattered

1. **The rule the whole game hinges on got its own test before any UI existed.**
   "Whoever was wrong drinks the whole pot" is easy to get backwards (drinker
   vs. challenger) or to under-scope (last push only, not the round's full
   pot). I wrote the state machine (`engine.ts`) and its focused rule test
   (`engine.test.ts`) together, DOM-free, before touching `view.ts` — so a
   sign error would fail loud on a unit test.
   [`caccde6`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-davidflocondezo/commit/caccde6)

2. **Revamping the UI** 
   After completing the functionality of the game I realised that the UI was 
   very rudimentary and didn't give the player a sense of what the game was about.
   Because there is no tutorial this could make it harder for the player to try
   and understand what the game is about. To address this, I thought about putting the player in the game itself by making the board a pseudo-3d game with a HUD. This made it easier for players to identify the pieces and plays of the game.
   [`49ddb5a`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-davidflocondezo/commit/49ddb5a)
