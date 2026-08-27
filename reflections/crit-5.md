# Crit 5 reflection

**What was the breakthrough that moved the work forward?**

Splitting the game into a DOM-free `engine.ts` (pure state transitions) and a
single DOM-touching `view.ts` adapter. Once that split existed, the two hardest
things about a bluffing game — "does the whole-pot rule ever compute the wrong
drinker" and "does the game always end" — stopped being questions I had to
answer by playing dozens of games by hand. `engine.test.ts` pins the rule
directly; `view.ts` exposes a `step()` that lets a test drive an entire game,
including the human seat, through the bot heuristic, so I could assert "every
one of 40 seeds reaches an ending, and both `won` and `lost` are reachable" as
a normal, fast, deterministic test. The breakthrough wasn't the split itself —
it's obvious architecture — it was noticing that the same seam that makes the
engine unit-testable also makes the *whole game* automatable for the harder
spec claim ("it can be lost"), without writing a second, test-only code path.

**What did this work change about who I want to be as a software developer?**

It sharpened a habit I already had but hadn't earned yet: a green test suite
and an actual playthrough answer different questions. `engine.test.ts` was
fully green and correctly asserting the whole-pot damage value the entire
time I had a real bug — the feed was displaying that same correct number in a
place where it read as a lie to a player, because the meter caps and the raw
pot value doesn't. No unit test was ever going to catch that; only watching
the number scroll past in a browser did. I want to keep treating "the tests
pass" as necessary evidence, not sufficient evidence, and to keep budgeting
real time for driving the actual rendered page before calling something done.
