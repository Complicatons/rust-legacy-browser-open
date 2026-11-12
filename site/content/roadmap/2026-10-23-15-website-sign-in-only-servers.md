---
date: 2026-10-23
title: Servers that only let website players in
summary: A server can now turn away anyone who did not sign in through our website, in the browser or with the desktop launcher. We also looked at the other Rust Legacy communities still running and planned how their servers can become browser ready.
stats: 2 | server adapters with the switch; 4 | communities checked; 1 | community closed (Legion); 0 | build errors
media: server-page.jpg | Test run: a server's page on our test site, where players join through the website in the browser or with the launcher (sample listing)
---

Rust Legacy players today join with the original Steam game or with a community's own copy of it. On our servers we want one rule: you play with your website account, or you don't play.

## The switch

Our server add-on (the Oxide plugin and the patch for servers without Oxide) now has a setting called LauncherOnly. When it is on, the server lets a player in only if the website vouched for them, either through the browser or through our desktop launcher. Everyone else gets the game's own "Authorization failed" message. That includes the original Steam game and other communities' clients.

It is off by default. A community server that adds our add-on keeps all its existing players and simply gains browser players too.

## The other communities

We looked at the communities still running Rust Legacy servers: Rustuj, PlayRustLegacy, RustLegacy.eu and the RustBuster servers. Legion, the best-known one, shut down in June 2024. They all run the same 2015 game server, so our browser game works on all of them once a server lets our players in. How each one lets players in is different, so the plan gives each community its own way to become "browser ready": a plugin to drop in, a patch, or our host app doing it for them.

## What's next

- The desktop launcher, so players who want the native game can sign in with their website account too.
- A version of the add-on for Fougerite servers, which RustBuster uses.
- An "attach my existing server" step in the host app.
