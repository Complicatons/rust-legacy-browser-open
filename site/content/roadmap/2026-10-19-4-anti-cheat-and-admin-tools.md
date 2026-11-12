---
date: 2026-10-19
end: 2026-10-21
title: Anti-cheat and admin tools
summary: Free anti-cheat in the gateway, bans and reports on the website, admin actions that reach into the game, and movement checks for desktop players, built in five slices.
stats: 5 | slices; 15 | cheat checks; 2 s | desktop position checks; 0 | SteamIDs shown to staff
media: site-admin.jpg | The admin page: players, flags and evidence; site-admin-actions.jpg | Admin actions from the website; site-admin-desktop.jpg | Test run: a desktop player flagged for a teleport
---

The project owner asked for anti-cheat and admin tools that cost nothing and need nothing extra on the players' side. Because every browser player goes through the gateway, the gateway can check what each player sends before the server sees it. The work came in five slices between 19 and 21 October.

## Slice 1 (19 Oct): the checks and the admin page

The gateway watches each player with limits taken from the game itself: how fast you can run, jump and fall, how fast each gun can fire, how many pellets a shotgun fires. Teleports, impossible fire rates and extra pellets are **dropped**, not just reported. Other signs, such as hits from too far away or a suspicious share of headshots, raise a score that fades over time, with the evidence and a short replay kept for staff. The website gained roles (owner, admin, moderator), server and network bans, player reports, an audit log of every staff action, and the [admin page](/admin).

## Slice 2 (20 Oct): line of sight

The gateway now loads the island's collision, trees and player buildings, so it can tell when someone hits a player they could not see, uses something through a wall, or moves through walls or terrain. It also flags snapping the view around just before a hit, and limits how fast inventory, crafting and use commands can be sent.

## Slices 3 and 4 (20–21 Oct): reaching into the game

Admins can now go to a player, bring them, message them, kick them and ban them on the server itself, from the website. Players can `/report` from in-game chat. Each server can require a minimum account age or a Steam sign-in to slow down ban evasion. Desktop players appear in the admin page too, identified by a per-server code instead of their Steam ID. The same actions work whether a server uses our Oxide plugin or our patch for the plain original server, and a check makes sure the two stay identical. Neither has run on a real server yet.

## Slice 5 (21 Oct): checking desktop players too

Desktop players skip the gateway, so until now only the server's own old speed check watched them. The server plugin now reports where each desktop player's character is every two seconds. The same movement checks used for browser players then run on those positions: speed, teleports and flying straight up. A respawn or a sleeping bag starts a fresh trail, so it is never mistaken for a teleport. Desktop players now show a score, flags and evidence on the admin page. Their shots are still not checked: that would need hooks inside the server's weapon code.

The thresholds have only been tried against our own test server. They will be tuned with real players before anything is kicked automatically.
