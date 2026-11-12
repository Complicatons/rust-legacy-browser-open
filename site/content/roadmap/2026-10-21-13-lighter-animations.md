---
date: 2026-10-21
title: Lighter animations
summary: The animations for animals, players and held items now download in a compact form, so the island loads 43 MB lighter than this morning.
stats: 13.8 → 4.1 MB | animation download; 210 → 167 MB | whole download; 25 MB | less browser memory
media: animals-walking.jpg | A boar and a stag walking, their animations loaded from the new compact files
---

After the texture change earlier today, the next biggest files were the animations: every movement of the animals, the player models and the held items in first person. They were stored as plain text, over 100 MB of numbers before compression, which the browser also had to read and keep in memory.

## What changed

The original game stores these animations as 32-bit numbers. They are now sent exactly like that, packed together, instead of as text. Many animations also repeat the same list of keyframe times, and that list is now stored only once.

Nothing about the animations changes: the test loads both versions and checks that every one of the 6 million numbers is the same.

## The result

- The animations went from 13.8 MB to 4.1 MB to download.
- With this morning's texture and grass changes, joining the island now downloads 167 MB instead of 210 MB, 20% less.
- The game uses 25 MB less memory in the browser after loading.
