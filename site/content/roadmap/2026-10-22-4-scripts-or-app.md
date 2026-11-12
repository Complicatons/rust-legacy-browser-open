---
date: 2026-10-22
title: Scripts or app, the owner's choice
summary: Server owners can keep running everything with the PowerShell scripts, or use the host app, or mix the two. A server started either way shows up in the app and can be stopped either way.
stats: 2 | ways to run a server; 1 | shared run folder; 0 | script steps rewritten; 30 | automated checks for the host app
media: host-scripts-adopted.jpg | A server started outside the app, picked up by the dashboard and watched like its own
---

Some owners will want the host app's dashboard. Others will want the PowerShell scripts they already know. Both are now fully supported, and they work together instead of against each other.

## How

The app does not rewrite the scripts. It uses the same settings file and the same safety checks, and it writes down what it starts in the same place the scripts do:

- A server or gateway the scripts started appears in the app as running and is watched by the same freeze detector. When the app can confirm the process is the right one, it can stop it too.
- Anything the app started can be stopped with the usual stop scripts, and the start scripts refuse to start a second copy.
- When a stop script ends something on purpose, it leaves a small note so the app knows it was a stop and not a crash to recover from.

The scripts still work on their own, with no app installed.

## What's next

Accounts: the page in the app that shows which website accounts are linked to which characters on the server, for browser and desktop players, so players keep their character when they sign in and out.
