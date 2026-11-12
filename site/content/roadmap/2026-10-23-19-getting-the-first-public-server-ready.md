---
date: 2026-10-23
title: Getting the first public server ready
summary: The setup for our first public game server in London is written and tested. Nothing is switched on yet.
stats: 1 | server in London; 443 | only public port; 100 | player slots
media: servers-london.jpg | Test run: how a London server with 100 slots shows in the server list, on our test site (sample listing, the real server is not switched on yet)
---

Our game server machine in London is set up to receive the original Legacy server, our bridge and its anti-cheat, ready for the day we switch it on.

- **Only through the website.** Players join from your-domain.example in the browser. The server refuses anyone who doesn't come through our sign-in.
- **Hidden behind Cloudflare.** The only way in is one encrypted port that only Cloudflare can reach, so the server's address stays private.
- **Ready to switch on.** The remaining steps are a handful of sign-ins and a final go from us.
