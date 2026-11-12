---
date: 2026-10-23
title: An installer for the host app
summary: Server owners can now install the host app from one download. It runs as a Windows service of its own, and nothing it starts can outlive it.
stats: 1 | download to install; 0 | passwords to type; 0 | private game files in the download; 47 | MB download
media: host-fresh-install.jpg | The dashboard right after a fresh install, before any part of the server is set up
---

The host app can now be installed rather than run from the project's source.

## What the owner does

1. Unzip the download on the server PC or VPS.
2. Run the install script in an administrator PowerShell. Like the other setup scripts, it first shows exactly what it will do and changes nothing until it is run again with `-Apply`.
3. The script prints a sign-in link for the dashboard.

## What it sets up

- **A Windows service of its own.** It starts with Windows and restarts if it ever stops. It runs under its own service account, which has no password, cannot sign in and is not an administrator.
- **Nothing left behind.** Every part the app starts runs inside one Windows "job", so stopping or killing the service ends the website, gateway and game server it started too.
- **The scripts keep working.** If the server was already set up with the setup scripts, the app picks up the same folders. A server started either way shows on the dashboard.
- **A clean uninstall.** It removes the app and keeps the owner's settings, logs and backups unless asked to delete them.

The download carries our own code and the Node runtime only, never the original game or server files.

## What's next

The first owner run on a real VPS.
