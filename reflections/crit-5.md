# Crit 5 reflection

**What was the breakthrough that moved the work forward?**

I think coming up with the look-and-feel and mechanics of the game so that
they will be easy to recognise/understand how to play was challenging. 
I had to think of visual cues and focus on how to make it easy for players to pick up.
As part of this I essentially created 3 versions of the game. The first just focusing
on the functionality, the second focusing on making it easy to use and the third being 
a major UI overhaul to add context and setting to the game.
This required constant rounds of testing that the agent and tests alone could not do
which meant a lot of manual testing from my end. This was essential to get the final
look-and-feel that the game ships with.

**What did this work change about who I want to be as a software developer?**

It enforced my belief that a green test suite and an actual playthrough answer different questions. For example there were several instances when `engine.test.ts` was
fully green and correctly asserting that the 'life' bar value was correct however
when I played it a couple of times I ran into the issue that the feed was displaying 
the incorrect number, because the meter caps but the amount of shots a player could take doesn't. No unit test was ever going to catch that; only watching the number scroll past in a browser did. Moving forward, I want to acknowledge when tests pass but also supplement testing with my own manual testing.
