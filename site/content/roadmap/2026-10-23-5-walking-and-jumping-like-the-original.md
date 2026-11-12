---
date: 2026-10-23
title: Walking and jumping like the original
summary: Walking, sprinting and jumping now follow the original game's movement rules, from slowing down uphill to the short stumble after a landing.
stats: 2.96 | m/s up a 30° hill; 3 | m/s backwards, sprint or not; 1 | second between jumps after landing; 10 | new tests
media: walk-jump.mp4 | Test run: walking, then sprinting up a hill and jumping on the offline island
---

Our player already had the original's speeds, its size and its crouch. Many of the smaller rules around them were still our own guesses. They now come from the original game's code.

## What changed

- **Hills.** Walking uphill slows you down the steeper it gets, as in the original: a 30° slope takes you to about three quarters of walking speed, 45° to half. Downhill you keep your speed. Before, you walked up any hill at full speed.
- **Sprinting.** Sprint only works going forwards. Holding sprint while walking backwards, strafing, aiming, crafting or with an injured leg does nothing, and in the air it stops.
- **Jumping.** After you land, the next jump has to wait a second. A jump pressed just before then still happens, but holding the key down doesn't keep you hopping. Jumps reach their original height.
- **Landing.** For a moment after a landing you move slower, then pick up speed again, as in the original.
- **In the air.** You can't crouch, sprint or aim while airborne: a scoped gun drops its zoom in a jump, and you keep the speed you jumped with.
- **Too steep to stand on.** Slopes steeper than the original's limit now slide you down instead of holding you in place.
- **Crafting.** While something is being crafted you walk at half speed.
- **What others see.** The movement state we send to the server (moving, sprinting, crouching, airborne) follows the same rules, so other players see the same animations the original would show.

## Still to check

These rules are checked by our tests and in our own browser runs. They still need a session against the original server, alongside everything else on the test list.
