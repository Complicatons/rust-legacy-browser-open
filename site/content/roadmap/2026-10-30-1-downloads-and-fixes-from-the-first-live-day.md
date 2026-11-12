---
date: 2026-10-30
title: A downloads page, and five fixes from the first live day
summary: The site now has a downloads page for the game loader and the server software, each with a checksum you can check. The first day of real players on EU 1 also turned up five problems, and all five are fixed and live.
stats: 2 | Windows downloads; 5 | live problems fixed
media: site-downloads.jpg | The new downloads page, with the version, size, release date and SHA-256 checksum for each app; play-server-tab.jpg | EU 1 in the in-game server browser's first tab, where our own servers belong
---

EU 1 has been open to real players for a day now. That turned up a handful of problems no test machine had shown. All of them are fixed and on the live site, along with something people kept asking for: a proper place to download the Windows apps.

## Downloads

There's a new [Downloads](/downloads) page, linked from the footer of every page.

- **Game loader**: for playing with your own copy of the desktop game, signed in with your website account. It's a small zip: unpack it and run `Install.cmd`.
- **Rust Legacy Host**: for running your own server and listing it for browser players.

Each one shows its version, size and release date, plus a SHA-256 checksum. The page explains how to compare the checksum with your downloaded file, so you know the file is exactly the one we published. The apps aren't code-signed yet, so Windows will warn about an unknown publisher the first time you run them.

## What was fixed

- **Getting kicked "because of violation".** Buildings and other placed objects weren't reaching players' browsers, so they were invisible but still solid. Walking into one looked like cheating to the server, which kicked the player. The missing data is restored on EU 1, and players now see what they bump into.
- **Looting crates.** Online, the page was drawing its own crates in place of the server's real ones, so items wouldn't move into your inventory. The crates now come from the server, and dragging, Shift-click and Ctrl-click all move items.
- **Right-click.** Right-clicking in game opened the browser's own menu, which got in the way of using items. It's now switched off in game. It still works in text boxes.
- **Our servers in the server browser.** EU 1 sat in the community tab with an empty first tab above it. It now shows in the first tab, as intended.
- **Renaming a server.** Server owners can now rename their server from Your servers, along with everything else in the listing.

## What's next

More time on EU 1 with more players at once, to check these fixes hold up under real use.
