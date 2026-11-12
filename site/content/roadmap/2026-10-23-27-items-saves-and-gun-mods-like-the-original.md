---
date: 2026-10-23
title: Items, saves and gun mods like the original
summary: Reloading gives you your Rock back, saves keep only what the original kept, and fitting a sight to the gun in your hands makes you draw it again.
stats: 7 | item rules fixed; 1 | Rock back after a reload; 1.4 s | M4 draw time after a new mod; 0 | redraws from opening the inventory
media: m4-holo-redraw.jpg | The M4 drawn again with its new holo sight, after the sight was fitted from the inventory; m4-holo-drawing.jpg | The same M4 halfway through being drawn again, just after the sight went on
---

We checked how items behave in the original game around saving, mods, melee and special items. Six things worked differently from the original, and checking the fixes in the browser turned up a seventh. All seven now match it.

## What changed

- **Your Rock comes back.** If you reload a single-player game without a Rock, you get one back in the first belt slot, as the original gives one every time you load in. A character with nothing at all gets the whole starting kit.
- **Saves keep what the original kept.** A save now holds your items, the blueprints you learned, your health, bleeding, food, water, radiation and warmth. The item in your hands, a craft in progress and poisoning are not kept, as in the original.
- **Fitting a mod draws the gun again.** Putting a sight, laser or silencer on the gun you are holding now puts it away and takes it out again: you see it drawn, hear it, and wait for it before you can fire, as in the original.
- **The inventory no longer puts your gun away.** Opening and closing the inventory, chat or the console used to make you wait for the gun again, and put a bow away. In the original the weapon stays in your hands behind those windows, and now it does here too.
- **Hitting crates wears your tool.** Swinging at loot crates, dead players' bags, airdrop crates and items on the ground now wears your hatchet or pick, as it did in the original.
- **Cancelling a craft online.** Cancel now stops the craft straight away instead of waiting for the server to say so.
- **Special items stay with you.** The Uber Hatchet, the Uber Hunting Bow and the invisible armour vanish if you drop them, cannot go into boxes and are never saved, as in the original.

## How it was checked

New unit tests cover the Rock coming back, what a save keeps, the redraw after a mod, tool wear on crates, cancelling a craft and the special items. A new browser test fits a holo sight to a held M4 from the inventory. It checks the gun is drawn again with the sight on, the draw sound plays, nothing fires during the draw and the gun fires after it. It also checks that opening and closing the inventory leaves the gun as it was. None of this has been tried on the original server yet.
