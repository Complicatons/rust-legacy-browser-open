---
date: 2026-10-21
title: No more walking through rocks
summary: Rocks had collision, but the way the player moved could still carry you through them, and standing on one could freeze the game. Both are fixed.
stats: 533 | test walks into rocks; 0 | went through; 0 | freezes standing on a rock; 0.03 ms | extra frame time
media: rock-buried.jpg | Walking into a rock that used to let you through: you now stop at its face; rock-formation.jpg | Standing on a rock formation, which used to freeze the game
---

Earlier today every rock and cliff on the island got its original collision. Players could still walk through some of them, though. The rocks were solid, but our movement code had three holes.

## What was wrong

- **Standing on a rock froze the game.** Our movement code treats whatever you stand on as a platform that might move, like a lift. Rocks and tree trunks were missing a piece of that platform data, so stepping onto one stopped the game. A stray arrow sticking into a rock did the same.
- **Rock bases sank into the ground.** Rocks sit partly buried. Walking downhill into one, our code could drop you below the ground for a moment. Down there, the rock pushed you forward and you came out on the other side.
- **Rock clusters pushed you through.** Many cliffs are several rocks overlapping. Touching one from an odd angle could shove you up to 2 m in one step, straight through the rock.

## What changed

- Rocks and tree trunks are fixed platforms now, so you can stand on them and the game keeps running.
- The ground stops your movement first, so you can't sink into a rock's buried base.
- The original game moves you with a sweep, so you can never pass through the front of anything solid. Our movement now checks every step for that and refuses any step that would go through a rock.

In 533 test walks and sprints into rocks all over the island, none went through and none froze the game.

## Still to do

In a few spots where rocks overlap, you now stop where the original might let you climb on. The full fix is to move the player with the same sweep the original used.
