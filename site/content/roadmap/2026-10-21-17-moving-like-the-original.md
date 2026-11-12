---
date: 2026-10-21
title: Moving like the original
summary: Your character now moves the way the original game moved it: it slides along rocks and walls and never gets pushed through them.
stats: 356 | test walks into rocks; 0 | went through; 0 | emergency stops; +5% | distance walked
media: rock-slide.jpg | Walking at an angle into a rock: you stop at its face and slide along it
---

Earlier today we stopped players walking through rocks. That fix was a safety net: it caught a step that went through a rock and took it back. It worked, but it also stopped players in a few places where they should have kept walking.

Now the movement itself works like the original game's.

## How the original moves you

The original game uses a "sweep" for movement. Each step, it moves your body forward until it touches something. Then it slides you along that surface for the rest of the step. You never move further than you asked to, and you never go through anything solid.

Our old code worked the other way round. It moved you the full step first, then pushed you out of anything you ended up inside. Usually that looked the same. But at the back of a rock, or where several rocks overlap, the push could go the wrong way and send you out the far side.

## What changed

- **Walking, stepping up and falling all use the sweep now**, so nothing pushes you through a rock any more.
- **Rocks only block you from the outside, as in the original.** If you end up inside a rock, you can walk back out.
- **Rising onto steep ground under an overhang** is checked the same way. If you can't fit, you stop where you are.
- **We fixed a hidden collision bug.** Our collision test could miss a large rock slope directly under you, so a falling player could drop into the rock. That's fixed for rocks, trees and buildings.

## The numbers

We walked and sprinted into 356 rocks across the island. None of those runs went through a rock. The safety net from this morning never had to step in (before: 23,118 times). In runs the old code handled cleanly, players now get 5% further, because they slide along rock faces instead of sticking to them.

Some old test runs went further than today's. They got there by being pushed sideways through a rock, up to 2 m in one step. That doesn't happen any more. The original wouldn't do it either.
