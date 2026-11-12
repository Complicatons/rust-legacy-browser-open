---
date: 2026-10-21
title: A test server in the cloud
summary: Instead of anyone's home PC, the original server will be tested on a rented Windows machine in Microsoft's cloud, locked down the same way, with the browser port playing against it over the internet.
stats: 1 | cloud test server; 3 | ports open, only to the tester; 1.9 GB | test kit; 30 days | of free credit
media: site-servers.jpg | The server browser the cloud test server will appear in; multiplayer.mp4 | Multiplayer so far runs against our own test server
---

The plan for trying the port against the original Legacy server changed once more: it will run on a Windows virtual machine rented from Microsoft Azure, in its UK data centre, not on a home PC.

## Why the cloud

- **Nothing runs at home.** The original server program never touches anyone's own computer, and the whole machine can be deleted when testing is done.
- **It's realistic.** Players will connect over the internet, the same way they will to the real servers later, so this tests the actual path.
- **It's cheap.** Azure's free account credit covers the whole test month.

## How it is set up

- One script, pasted into Azure's own web console, creates the machine. Only the tester's own internet address can reach it, and only on three ports: remote desktop, the website and the game connection.
- On the machine, the server runs as in the home-PC plan:
  - under its own restricted account, with the firewall blocking its own internet access;
  - with the modified anti-cheat file left out;
  - with every action recorded.
- One zip, about 1.9 GB, carries everything the machine needs: the website, the game, the bridge and the checked server files.

The whole setup was rehearsed on a normal PC first: the website, the gateway, its security checks and the connection from a browser. The original server itself was not run in the rehearsal.

## What's next

1. Start the original server on the cloud machine on its own, recording what it does.
2. Join it from a browser for the first time.
3. Run the full gameplay checklist against it.
