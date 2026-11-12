---
date: 2026-10-22
title: Everyone can play, one account each
summary: You don't need Steam to play. Instead, a ban now follows the person, not just the account, and server admins can take a screenshot of what a suspected cheater sees.
stats: 0 | servers that need Steam by default; 6 | identities a ban covers; 30 days | screenshots kept; 0.1 s | to take a screenshot
media: game-capture.jpg | A screenshot taken by the new code on the offline island: the game view with the belt, health and panels drawn over it, and the request's code stamped in the corner; admin-screenshots.jpg | The admin page with sample data: an automatic screenshot after a teleport flag, with how close its position and aim are to what the server saw; admin-alts.jpg | Possible alts for one player: a shared browser, items traded while new, and whether the two were ever online together
---

Many Legacy players use a desktop client without Steam. The rule for this port is simple: **everyone can play**, with or without Steam. That makes one thing harder: stopping a banned cheater from coming straight back on a new account. This update handles it without asking anyone for Steam.

## A ban follows the person

When an account is banned, the ban now covers everything that account has used to sign in or verify: its email, Discord, Steam, phone, and the PC it played from with the desktop launcher. A new account that uses any of them is refused on that server (or everywhere, for a network ban). A new account that only shares a browser with a banned one, like a brother on the family PC, isn't refused: it waits for an admin to take a quick look. Lifting the ban lifts all of it.

Sign-up refuses throwaway email services, and treats `j.o.e+rust@googlemail.com` and `joe@gmail.com` as the same address, so one mailbox is one account.

## Possible alts, for a person to judge

Admins see notes like "same browser", "same browser and connection", "items traded while both accounts were new" and "never online at the same time". We keep only scrambled versions (hashes) of these details, never the details themselves, and these notes never ban anyone on their own.

## Servers choose how strict to be

Each server can still let anyone in, or ask for an older account, a verified phone, a linked Steam account, or a Steam account of a certain age or level without VAC bans. The server list shows what each server asks for before you try to join.

## Screenshots for admins

An admin can press Screenshot on a player, and the anti-cheat asks for one by itself when it flags something serious like a teleport. The game copies its next frame with everything on screen, so the admin sees what the player saw. It only ever captures the game, never the rest of your screen. Screenshots are visible to that server's staff only, every look is logged, and they're deleted after 30 days.

The game runs on the player's own computer, so a screenshot is evidence, not proof. The admin page shows how well it matches what the server saw (position and aim), and marks blank, repeated or late pictures.

The [Privacy policy](/privacy) and [Terms](/terms) now explain all of this.
