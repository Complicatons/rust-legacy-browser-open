---
date: 2026-10-23
title: Accounts in the host app
summary: Server owners can now see which website accounts are tied to which characters on their server, browser and desktop, and undo a link when a player asks. A fix also stops a restarted gateway from locking every player out.
stats: 3 | link steps shown per desktop player; 1 | key from the website, owner-only, one server; 0 | links made by name, email or address; 13 | dashboard checks passing
media: host-accounts.jpg | The Accounts page on the demo server: three demo accounts, the identity adapter and a desktop link from code to link
---

A player's website account has to stay tied to their character on each server, so they keep it when they sign in and out, in the browser or on the desktop. The server decides those links. The host app now shows them.

## What the owner sees

- **Every account the server knows**: who played in the browser, who linked a desktop character, which character each one plays, and who is in the game right now.
- **Each desktop link step by step**: the code typed in game, the website reserving it, and the server confirming it. If a link stops, the reason shows.
- **The identity service's health**: whether it answers, how many links it holds, and when the gateway last reported to the website.
- **Unlink with a reason.** It is refused while the player is in the game. The character, with its items and buildings, stays on the server, and the website hears about it the next time the server reports in. Every change goes in the audit log.

The app reads the names and history from the website with a key the owner makes on the Owner page. The key works only for that one server, can be replaced or withdrawn at any time, and every action taken with it is marked in the audit log.

## A fix found on the way

When the gateway was restarted on its own, for example by the host app's Restart button or after a crash, the identity service refused everything it sent until the service was restarted too. No player could join in that time. Each gateway run now identifies itself, so a restart is accepted straight away, and replayed messages are still refused.

## What's next

The Players and Anti-cheat pages in the host app, using the same key.
