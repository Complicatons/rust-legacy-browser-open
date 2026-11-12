---
date: 2026-10-21
title: Testing the original server safely on a normal PC
summary: The original server files were checked, the one antivirus warning was traced to a false positive, and a locked-down test kit now lets the real server run on a normal Windows PC instead of a virtual machine.
stats: 47 | files checked; 1 | false positive explained; 1 | modified file kept out; 3 | firewall rules
media: online-gun.jpg | Playing online against our own test server. The real one comes next; site-servers.jpg | The server browser the test server will appear in
---

The plan was to try the port against the original Legacy server inside a sealed virtual machine. The server files have now been checked closely enough to run it on a normal PC instead, inside a locked-down setup.

## What the checks found

- **The one antivirus warning is a false positive.** One engine out of 60 flagged `rust_server.exe`. That file turned out to be the Unity engine's own player program, byte for byte the same as the copy in Unity's signed 2014 installer, except for the icon.
- **One file had been changed.** The anti-cheat module `VAC2.dll` that ships with the server's offline Steam emulator has a Valve signature that no longer matches its contents. Its code is encrypted, so the change cannot be read. It is simply left out of the copy of the server that runs.
- The full results, with links to every public scan report, are on the project's GitHub page under "Server file scans".

## How the server is kept in a box

- It runs under its own Windows account with no access to anyone else's files or programs.
- The firewall blocks all of its traffic to and from the internet and the home network. Only our own bridge on the same PC can talk to it.
- The emulator's online features (master-server heartbeats and DLC lookups) are switched off.
- Process Monitor records everything it does. A report afterwards lists any file, registry or network activity outside its own folder.

The bridge between the browser and the server, the gateway and the website now have ready-made settings for running entirely on the one PC. The full chain was rehearsed: sign-up, adding a server, connecting the gateway and the website seeing the server online.

## What's next

The first run starts the real server on its own and records what it does. After that, the first browser player joins it. Then the full gameplay checklist runs against it: building, raiding, combat, airdrops and the admin tools.
