---
title: Updating the host app
summary: Check for updates, install them, and roll back
group: Running a server
order: 9
---

The **Updates** page installs new versions of the gateway, our server add-on's helpers and the host app's own parts. Updates never touch the game's own files.

## Getting an update

- **Check for updates**: the host app asks our update feed for the newest version. Every update is signed by the Rust Legacy team, and the host app refuses one whose signature or contents don't match.
- **Add update**: if you were sent an update file, choose it under **Update file** and press **Add update**. Compare the fingerprint shown with the one we published.

Each update shows its release notes, its fingerprint, how many files it changes and which parts will restart.

## Installing

Press **Install**. The parts it changes restart; the game server itself keeps running. If the gateway restarts, browser players are disconnected for a few seconds and can rejoin straight away, so install while the server is quiet. If an update would also change the website part, it asks you first.

**Install automatically when the server is empty** installs new versions on its own, only while nobody is playing.

## Rolling back

Every install keeps the files it replaced. Press **Roll back** next to it in the history to go back to how things were.

## Our server add-on

If an update changes our server add-on itself, the page says so. Run **Patch the server copy** in [Setup](/docs/set-up-your-server) again, then restart the game server.
