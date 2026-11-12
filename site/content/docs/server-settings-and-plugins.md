---
title: Server settings and plugins
summary: Change your server's settings, admin password, welcome message and Oxide plugins
group: Running a server
order: 8
---

## Server settings

**Settings** → **Server** edits your server's `server.cfg` for you. Each setting has a short explanation and only accepts sensible values: the server name, PvP, sleepers, airdrops, crafting speed, decay, day and night length, autosave interval, anti-cheat strictness and more. Values the page doesn't know are listed under **Other values**.

The server reads these files when it starts, so press **Restart** (or wait for the next scheduled restart) after saving. Before each save the old file is copied into the host app's data folder, so you can always go back.

**Max players** is set by the server's start-up options, not `server.cfg`, so it's shown but can't be changed here.

## Admins

Legacy has no list of admins. A player becomes an admin for one session by opening the F1 console and typing `rcon.login` followed by the **admin password**. Set the admin password under **Settings** → **Server**. It's never shown again after you save it.

Your **server team** on this website (admins and moderators you add on [Your servers](/owner)) use the [Server admin panel](/docs/server-admin-panel) instead, and don't need the password. See [Roles and permissions](/docs/roles-and-permissions).

## Our server add-on

| Setting | What it does |
| --- | --- |
| **Website players only** | Only players who signed in through this website or the game loader can join. Turn this on for a public server. |
| **Message of the day** | A chat message every player sees just after joining. Leave it empty for none. |

## Plugins

The **Plugins** page lists your Oxide plugins with their name, version and author.

- **Add plugin**: upload a `.cs` plugin file. A plugin with the same name is replaced, and the old one is archived.
- **Turn off / Turn on**: moves the plugin aside without deleting it.
- **Remove**: archives it, so it can be put back.

Changes take effect at the server's next restart.

Plugins you add run inside your server with full access to it, so only use plugins you trust. Our own add-on is listed but can't be changed here; it's updated with the host app.
