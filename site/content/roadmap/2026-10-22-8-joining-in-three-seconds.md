---
date: 2026-10-22
title: Joining in three seconds
summary: The island's buildings, ground and textures now load side by side, and return visits stop re-reading files the browser already has, taking a return-visit join from about 4.2 to 3 seconds.
stats: 4.2 → 3.0 s | join, next visits; 4.7 → 3.7 s | join, first visit; 0 | files checked again; 0 | pixels changed
media: load-scene-in-world.jpg | In the world after the join
---

After the last round, two loading steps still took the longest: preparing the island's ground and importing the original buildings and rocks. Most of that was waiting. The ground's largest texture took up to two seconds to unpack, and nothing else could start until it was done. Then each building's files were asked for only after the previous building was finished.

## What changed

- **The ground unpacks in the background.** The ground is set up straight away, and its biggest texture finishes unpacking while the buildings and rocks load. The game waits for it before anything is drawn.
- **Every building file is asked for up front.** When the join starts, the game queues the files the island's buildings and rocks need, six at a time, in the order it builds them. It still builds them one by one in the original order, so the island comes out exactly the same.
- **Textures go to the graphics card while the game waits.** Textures used to be sent to the graphics card in the first frames. They now go in the gaps while the join waits for files, so the last loading step is shorter.
- **Next visits skip what is already downloaded.** The browser keeps the game's files, but the game used to read every one of them again on each visit. It now remembers what it already has. The last two interface pictures that were still checked again on every join are now kept as well.

## The result

Measured on our test PC with no network delay, old and new taking turns, three times each:

| | Before | Now |
|---|---|---|
| Join, next visit | 4.2 to 4.4 s | 3.0 to 3.1 s |
| Join, first visit | 4.6 to 4.7 s | 3.7 to 3.8 s |
| Preparing the island and importing buildings | 2.0 s | 1.1 s |
| Last loading step | 0.5 s | 0.3 s |

Every object, material and texture the join builds was checked against the old version, including all 135 textures as stored on the graphics card. Over a 30 ms, 100 Mbit/s link the first join is still limited by the download (164 MB), so it stays at about 20 seconds.
