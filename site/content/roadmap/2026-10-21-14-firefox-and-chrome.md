---
date: 2026-10-21
title: Tested in Firefox and Chrome
summary: The island now has automatic checks in Firefox and Chrome as well as Edge.
stats: 3 | browsers checked; 0 | errors in Firefox; 11 s | to load in Firefox
media: firefox-island.jpg | Test run: the island in Firefox 158, in walk mode with the Rock in hand
---

Until now every automatic check ran in Microsoft Edge. Edge and Chrome share the same engine, but Firefox doesn't, so a Firefox player could have hit problems we never saw.

## What we checked

- **Chrome:** the full performance check runs in Chrome with the same results as Edge.
- **Firefox:** a new check starts Firefox on its own, loads the island, walks in, and records any errors, which texture formats were used and the frame rate. The island loaded in about 11 seconds with no errors, using the same compressed textures as Edge.

## Still to do

We couldn't measure a laptop with integrated graphics yet: the test PC only has a desktop graphics card. Safari isn't available on the test PC either.
