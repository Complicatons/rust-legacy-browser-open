---
date: 2026-10-21
title: Faster loading
summary: Joining the island from a remote server now takes 25 seconds instead of 83, and a second visit loads it from your browser in 11.
stats: 83 → 25 s | first join; 65 → 11 s | next visits; 1,400 → 4 | requests on a return visit; 0 | pixels changed
media: load-menu.jpg | The original menu, now up in under 6 seconds on a first visit; load-in-world.jpg | In the world after the join
---

The first browser join to a real server ran on a test server in the cloud, and the loading screen was slow. We measured why before changing anything.

## What we found

The game downloads about 200 MB the first time. That should take 15 to 20 seconds on a 100 Mbit/s connection. It took 90 seconds, because the files were fetched one after another, each waiting for the last. Coming back the next day was almost as slow: the browser had kept every file, but asked the server about each of the 1,400 files again, one at a time.

## What changed

- **Every file now carries a fingerprint of its contents.** The browser keeps it and never asks again until the file really changes. A return visit makes 4 requests instead of about 1,400.
- **The island downloads while you are in the menu.** By the time you pick a server, much of it is already on your computer, and the game is built from there.
- **The menu loads its pieces together** instead of one by one, and its pictures come in a smaller lossless format: 33 MB became 24 MB, every pixel the same.
- **The server compresses the world's 3D data harder** once, in the background, and keeps the result.

## The result

Measured over a link like the one to our test server (30 ms away, 100 Mbit/s):

| | Before | Now |
|---|---|---|
| Menu, first visit | 8.4 s | 5.7 s |
| Join, first visit | 82.5 s | 24.6 s |
| Join after 15 s in the menu | 82.5 s | 16.0 s |
| Menu, next visit | 5.1 s | 1.4 s |
| Join, next visit | 65.2 s | 11.2 s |

The game looks and plays exactly the same. What is left is mostly building the world on your computer (collision, textures, shaders), which is the next thing to speed up.
