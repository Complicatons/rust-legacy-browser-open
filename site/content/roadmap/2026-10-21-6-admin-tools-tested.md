---
date: 2026-10-21
title: Admin tools, tested end to end
summary: The real-server test kit now checks every admin action from the website to the game and back, and testing it caught two bugs before any server ran.
stats: 9 | new admin checks; 25 | checks passing on our test server; 2 | bugs fixed before launch
media: admin-desktop-players.jpg | The admin page after a test run: a desktop player with no Steam ID shown, and Go to, Bring and Message all reported done by the server; admin-reports-in-game.jpg | A report sent with /report in-game, open on the admin page, with every staff action in the audit log
---

The [anti-cheat and admin tools](/roadmap#2026-10-19-4-anti-cheat-and-admin-tools) let staff act on players from the website: go to them, bring them, message them, kick or ban them on the server, and read reports players send from in-game chat. Until now each piece was tested on its own. This update tests them all together the way a real server will use them.

## Nine new checks

The real-server test kit plays the game in a browser through the real website and checks what the server sends back. It now has nine checks for the admin tools, run as a staff member against a second test player:

- **Go to and Bring:** the website asks for a teleport, the server moves the right character next to the other one, and that player can carry on walking normally.
- **Message:** the player sees the message in chat, from "Admin".
- **In-game reports:** typing `/report <name> <what happened>` gets a private reply, nobody else sees it in chat, and the report appears on the admin page.
- **Desktop players:** a player on the original desktop game shows up in the admin page's Desktop players list under a per-server code. Their Steam ID never leaves the game server. Kick works on them by that code.
- **Server bans:** a website ban copied to the game server's own ban list ends the player's session, and lifting it lets them back in.
- **Join rules:** a server that only allows accounts older than 30 days turns a brand-new account away, and the rule is put back afterwards.

All nine pass on our own test server, along with the other 16 automatic checks (25 in all). The rest need the real server, or a person, to run.

## Two bugs caught

- **A teleported player got stuck.** After an admin used Go to or Bring, the gateway's anti-cheat still remembered where the player used to be. Their first step after the teleport looked like a jump across the map, so the gateway threw that step away, and every one after it, and raised their cheat score each time. The player would have been frozen, and with automatic kicks on, kicked within seconds. The gateway now takes the server's teleport as the player's new position. The same goes for desktop players, whose movement the server plugin now reports for the anti-cheat too: being brought by an admin no longer counts against them.
- **Messages to the server could arrive out of order.** The server plugin numbers every message it sends to its helper, which turns down anything numbered lower than the last one, so a replayed message can't be slipped in. Two messages sent at nearly the same time could overtake each other, and the one that lost would be refused: an admin action with no result, or even a refused join. The plugin now sends one message at a time, in order.

## What's next

The test kit has been rebuilt with these changes. Next is the first run against the original server, which the owner has decided to run on their own PC, locked down by the firewall, instead of in the virtual machine described in [Getting ready for real servers](/roadmap#2026-10-20-4-ready-for-real-servers).
