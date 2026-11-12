---
date: 2026-10-22
title: Every original class accounted for
summary: We listed every piece of the original game's code and data and checked each one against the port. The first gap it found is fixed: the text that says what E will do now looks and sits where the original put it.
stats: 1636 | original code classes checked; 99 % | of the classes the game uses done; 757 | prefabs checked; 151 | sounds checked; 14 | open items left
media: use-hover-door.jpg | A garage door: "Open" in the original pixel font, at the spot the door itself names; use-hover-campfire.jpg | A camp fire says "Use", like the original, at its use icon
---

Earlier checks looked at samples of the original game. This time we went through all of it.

## The list

The original game's code has 1,636 classes. For each one we now record what it does, whether the shipped game actually uses it, and whether the port has it. Anything we left out has a written reason, for example code that only runs in the original editor, or on the server, or engine parts that the browser does for us.

We did the same for the game's data: every prefab, every item, every line of the default settings file, every window and every sound the game can play.

Result: 99 % of the classes the game uses are done. 14 items are still open, mostly in how other players and animals move smoothly online, and a few small effects.

## The first fix: the use text

When you look at a door, box or fire, the game shows a word for what E will do. Ours was a made-up label under the crosshair. Now it matches the original:

- **The original font**, the small pixel font from the inventory, twice its size with a black shadow.
- **In the right place.** Doors put the word at a point set on each door. Boxes and fires put it at their use icon. It stays on the screen at the edges, as the original did.
- **The right words.** A camp fire says "Use", not "Ignite". A bed shows nothing and cannot be picked up, as in the original. Only the person who placed a sleeping bag sees "Pick Up".
- **Online**, walls and resource piles no longer offer "Use", and a box someone else is looting says who.

## How it was checked

A browser test aims at a door and a camp fire and checks the word, its size and where it sits. Unit tests cover the screen-edge rules and the text for each kind of object.
