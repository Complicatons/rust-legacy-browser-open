---
date: 2026-10-23
title: Melee hits and world sounds like the original
summary: Hitting a tree or a wall now throws up the original wood chips and dust. Explosions, signal smoke, flares, gunshots and attachment clicks carry and fade like the original, and the Uber Hatchet and Uber Hunting Bow show in other players' hands.
stats: 9 | sound and effect gaps closed; 1.5 s | wood chips on a tree hit; 60 s | signal smoke hiss; 2 | items now visible in other hands
media: melee-wood-chips.jpg | A hatchet hit on a tree: the original wood chips fly off the trunk; uber-arrow.jpg | The Uber Hunting Bow arrow with its original outline shader
---

We went through the sounds and small effects again, checking each one against the original game.

## What changed

- **Melee hits show.** Your own swings now throw up the original effect where they land: wood chips from trees for 1.5 seconds, and the dust or splinters of whatever else you hit for 1 second. Before, you only heard them.
- **Explosions carry.** Grenades and explosive charges fade with distance the way the original does and stay faintly audible far away, instead of cutting out at 200 m.
- **Signal smoke hisses.** A supply signal keeps hissing for the minute its smoke lasts, as in the original.
- **Flares sound right.** Thrown flares and flares in other players' hands are quieter and fade out by 20 m, like the original.
- **No sound where the original has none.** Wood piles shrink silently; ore rocks still crack.
- **Stereo like the original.** World sounds are panned the way the original game pans them.
- **Clicks and shots follow.** A flashlight or laser click follows the attachment, and another player's gunshot follows them as they move.
- **Uber items in other hands.** The Uber Hatchet and Uber Hunting Bow now show in other players' hands, with the right stance.

## How it was checked

Unit tests check each rule against the original game's data. A browser test spawns the tree-hit effect and the other melee effect and checks how long each lasts, and draws the Uber arrow with its original shader.
