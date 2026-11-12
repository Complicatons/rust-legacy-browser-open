---
date: 2026-10-20
end: 2026-10-21
title: Getting ready for real servers
summary: A plan and a full test kit for trying the port against an original Legacy server in a sealed virtual machine, plus a 20-minute soak test of single player.
stats: 35 | test rows; 66 | soak cycles; 0 | errors; 154 MB | memory, flat
media: forest-morning.jpg | The offline island the soak test plays on
---

Everything online so far has been checked against our own test server. The next step is to try the real one, and that needs care: the original server program has never been run on the project's own PC, and it will not be.

## The plan

The original server will run only inside an isolated virtual machine with no internet and no access to the home network, no shared folders or clipboard, and a snapshot before each step so it can be wiped back. Files go in on read-only disk images. Every packet it sends is recorded. Each phase that runs original code needs the owner's go-ahead.

## The test kit

Everything that can be built before then is built. A test run joins through the real website like a player and checks **35 things** against what the server actually sends: joining, moving, gathering, building, fighting, chat, death and the admin tools. A capture tool decodes recorded traffic and compares our gateway's messages with the original client's. The gateway, its sidecar and the plugin are packed onto a disk image with step-by-step scripts for the machine. None of it has been run against a real server yet.

## The soak test

To make sure single player holds up over a long session, a test plays the offline island for 20 minutes through the real menus: walking, sprinting, chopping trees, shooting a wolf, throwing grenades, opening the inventory and travelling. The 20-minute run: **66 cycles, 0 errors**, memory flat at about 154 MB, and the frame rate between about 138 and 143 FPS from start to end (the screen caps it at 144). Animals and resources fill the island up to the original spawn targets and stop there.
