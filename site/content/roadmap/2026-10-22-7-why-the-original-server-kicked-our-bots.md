---
date: 2026-10-22
title: Why the original server kicked our test bots
summary: Four test bots played on the original server for nearly an hour. Its anti-cheat kicked them for walking through rocks, because the test machine still runs an older build without solid rocks. We also fixed how moves are timed.
stats: 13 of 15 | server corrections were rocks; 0 | moves refused for timing; 1 ms | gaps now impossible; 3 | 15-minute soaks
media: rock-face.jpg | A rock you cannot walk through in the current build. The test machine's older build still lets players walk through rocks like this
---

The original Rust Legacy server has an anti-cheat check that kicks players who seem to move impossibly. Our test bots kept getting kicked while they walked around on the cloud test machine.

## Two causes

Every move the browser sends carries the time it was made. The server divides the distance moved by the time between two moves. Bunched moves could get timestamps only a millisecond apart, so a normal step looked like 450 m/s. The gateway now keeps the browser's own spacing between moves and holds a move back rather than squeeze it. A replay of jittery and late moves through the server's own timing rules now shows no violations at all.

The kicks still came, so we logged every position correction the server sent. 13 of the 15 were rocks: the server checks each move for walls and rocks in the way, and five blocked moves mean a kick. The test machine still runs a build from before rocks became solid, so the bots walked straight through them.

## What's next

The current build, with solid rocks and faster loading, is ready for the test machine. It needs about 100 MB of new files copied over. Then the bots soak again.
