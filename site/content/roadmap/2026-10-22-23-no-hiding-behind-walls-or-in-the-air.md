---
date: 2026-10-22
title: No hiding behind walls or in the air
summary: The anti-cheat now checks melee swings, arrows and hits on animals and buildings for walls in the way, follows every door's open or closed state, and spots players hovering in mid-air.
stats: 5 | new checks; 3 | door types followed; 4 s | arrow flights traced; 0 | automatic kicks
media: admin-anticheat-notes.jpg | Test run: the admin console with sample data, a player's notes for a hatchet hit through a wall, an arrow off its path and hovering, with the numbers behind each and no kick
---

The game server checks very little about where a hit came from. A hatchet swing only has to be within 6 metres; an arrow only has to have been fired. Our gateway sits between every browser player and the server, so it can check what the server doesn't, and keep the evidence for admins.

## What changed

- **Melee through walls.** A hatchet or rock hit on a player, an animal, a box or a building piece is checked for a wall between the attacker's eyes and the target, the same way gun hits already were.
- **Arrows follow their real path.** An arrow curves down as it flies. When the hit arrives, up to 4 seconds after the shot, the gateway traces that same curve from where the arrow was fired. A wall in the way, an arrow that lands on something it never passed near, or a shot that claims to start somewhere the player wasn't standing all get noted.
- **Animals and buildings count.** Shots at wolves, bears, boxes and walls get the same check as shots at players.
- **Doors open and close.** The gateway follows each wooden door, metal door and gate as the server opens and closes it. A closed door blocks shots and walking through it; an open or swinging one never does.
- **Hovering.** A player who stays more than 3 metres above the ground for 2 seconds without falling is noted. The gateway looks under them for roofs, floors and walls first, so standing on a building isn't mistaken for flying.

## Still no automatic kicks

Every check only adds a note with the numbers behind it for a server's admins to look at. None of them removes anyone. The limits get tuned with real players before any server turns automatic kicks on.

## Coming next

The 32 doors built into the island itself will join once we re-read their IDs from the original map files. Boxes and shelters aren't in the gateway's world yet, which is why the hover check allows 3 metres.
