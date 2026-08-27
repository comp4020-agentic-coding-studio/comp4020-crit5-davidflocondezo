# Process overview

## What I built

**Last Player Standing** — a solo-vs-three-bots bluffing game that blends
Liar's Dice bidding with Cheat's face-down deception, reskinned as a cartoon
dive bar (no real alcohol; a purely fictional "Intoxication Meter"). Each round
everyone pushes 1–4 face-down shots and claims a tier for them; a claim must
raise the pot by quantity or by tier; a doubt reveals every push made so far
and whoever was wrong drinks the *whole* accumulated pot, not just the last
push. Miss 100% intoxication and you black out; last one standing wins. The
whole ruleset is taught by the controls themselves — the push button won't
light up for an illegal claim, and once someone claims 4 Whiskeys there's no
raise left to offer, so doubt becomes the only live control.

## The moments that mattered

1. **The rule the whole game hinges on got its own test before any UI existed.**
   "Whoever was wrong drinks the whole pot" is easy to get backwards (drinker
   vs. challenger) or to under-scope (last push only, not the round's full
   pot). I wrote the state machine (`engine.ts`) and its focused rule test
   (`engine.test.ts`) together, DOM-free, before touching `view.ts` — so a
   sign error would fail loud on a unit test instead of surfacing as "the game
   feels wrong" three files later.
   [`caccde6`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-davidflocondezo/commit/caccde6)

2. **Actually playing the built game (not just reading green checks) found a
   bug no unit test would catch.** `engine.test.ts` correctly asserts that a
   resolution's `damage` is the raw sum of every shot pushed that round — that
   part of the rule is right. But driving a real browser through a long round
   (Playwright, `force: true` clicks because the idle "breathe" animation
   trips its stability check) produced a pot big enough that the feed printed
   "Pim drinks the pot: +160%." on a meter that caps at 100 — numerically
   correct as "value of the pot," but a visible lie about what the meter just
   did, and confusing to a player watching the number. Fixed by having
   `view.ts` snapshot each player's intoxication before and after a resolution
   and display the *applied* (capped) delta instead of the raw pot value,
   leaving `engine.ts`'s own semantics (and its passing tests) untouched. I
   re-verified with a throwaway 60-seed scratch check before deleting it: no
   displayed percentage ever exceeds 100 again.
   [`5ee2e8e`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-davidflocondezo/commit/5ee2e8e)

3. **Pacing tuned from watching a real-time playthrough, not a guess.** The
   feed narration is the game's only rulebook (no on/off-screen instructions
   at all), so a sentence like "Ozzy doubted Pim — it was a lie. Pim drinks
   the pot: +75%. Pim blacks out!" has to actually be readable before the UI
   moves on. A Playwright script that played through in real time (rather than
   instantly stepping the engine, which is what the spec test does) showed the
   original 1600ms reveal hold wasn't enough for the longer sentences. Bumped
   `revealHoldMs` to 2400ms; left `botDelayMs` alone since bot-to-bot pacing
   already read fine.
   [`d045e94`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-davidflocondezo/commit/d045e94)
