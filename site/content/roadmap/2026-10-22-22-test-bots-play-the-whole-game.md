---
date: 2026-10-22
title: Test bots now play the whole game
summary: Two browser bots can now craft, build a base, lock a door, cook, smelt, raid, hunt, fight and loot each other, fall off things and lose their connection, all checked against what the server says. The real server run on the cloud machine is next.
stats: 22 | new automated checks; 52 | checks in total; 46 | passed against the test server; 2 | bugs fixed on the way
media: matrix-base.jpg | Test run: a bot built this base itself: foundation, eight pillars, a wall, a doorway, a ceiling and stairs; matrix-door-code.jpg | Test run: the second bot was refused at the locked door, then typed the owner's code and got in; matrix-campfire.jpg | Test run: the camp fire burned Wood into charcoal and cooked the raw chicken the bot put in; matrix-loot.jpg | Test run: after the fight, the winner opens the loser's loot sack, armour and all
---

Until today most of the game could only be tested by a person playing it. Our test bots could join, walk, chat and gather, but crafting, building, combat and the rest were marked "manual".

## What the bots do now

Two bots sign in through the website and join the server like players. One crafts a Camp Fire, cancels a craft, finishes one and studies a blueprint. It builds a small base piece by piece, hangs a door, locks it and sets a code. The other bot is refused at the door, enters the code and walks in. The bots fill a storage box, cook in a camp fire, smelt ore in a furnace, blow a hole in a wall with an explosive charge, hunt a chicken, and fight with a rock, a bow and a revolver, with and without armour. One kills the other, loots the sack and watches it respawn. They also fall from a height, respawn at a sleeping bag, and play through lag, a frozen connection and a dropped one. Each check reads what the server sends back, not just what the screen shows.

## Bugs found on the way

- Closing a camp fire, furnace or storage box never told the server, so the fire stayed "in use" for everyone. The gateway now passes it on.
- After closing the inventory, the click that takes back the mouse also used whatever you were holding: a swing, a shot, or a placed charge. That click now only takes back the mouse.

## What's next

These checks have passed against our own test server. Next they run against the original server on the cloud machine, as soon as this build is installed there. Checks that need items handed out (building, guns, explosives) also need admin rights on that server.
