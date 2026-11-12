---
date: 2026-10-23
title: Test bots play on the original server
summary: The bots from yesterday's checks now play on a real Legacy server: they gather, craft, light and cook on a camp fire, hunt, see each other, fight with rocks and walk well over a kilometre to meet. Building, guns and raiding wait for admin rights on the test server.
stats: 26 | checks passed on the real server; 1.7 km | walk to meet, no kick; 0 | anti-cheat kicks; 30 s | sack lock, as the original
media: real-campfire-cooked.jpg | Test run on the original server: the camp fire burned Wood into Charcoal and cooked two chicken breasts; real-other-player.jpg | Test run on the original server: the second bot as the first one sees it, after walking over to meet; real-killed-by-rock.jpg | Test run on the original server: the server's own death message after a fight with rocks; real-hunt.jpg | Test run on the original server: a chicken hunted with the Rock
---

Yesterday's test bots ran against our own test server. Today they played on the original Rust Legacy server, running in a sealed cloud machine. Every check reads what that server sends back.

## What works on the real server

- **Gathering and crafting.** A bot hits a tree with the Rock for Wood, crafts a Camp Fire, cancels a craft, then finishes one. The server's craft timer and the Wood it uses match the original.
- **Camp fire.** The bot places the fire, puts Wood and raw chicken in it and lights it. The server burns the Wood, leaves Charcoal and cooks the meat.
- **Hunting.** A bot walked more than 100 m to a chicken, killed it with two Rock hits and got Cloth and Raw Chicken Breast from the body.
- **Two players.** Each bot sees the other walk, hold a Rock or a Torch, swing, chat and die as a ragdoll, all in time with the drawn body.
- **Fighting.** Two Rock hits took the other bot from 100 to 60 health with bleeding, and a third fight ended in a kill with the original death message.
- **Getting together.** Without admin rights the bots can't teleport, so one walks to the other along a path planned on the original navigation mesh. The longest walk was 1.7 km, and the server's anti-cheat never complained.
- **Bad connections.** Lag, a five-second freeze and a dropped connection all came back without a kick, and the player rejoined exactly where they left.

## Things we learned

- The original locks a dead player's loot sack to its owner for 30 seconds ("Locked for a while..."). The check now waits that out, as a player would.
- The test server only shows the camp fire's loot window since this morning's build. Before that, a message the original sends was being dropped.

## What's next

Building a base, guns, the bow, armour, doors and raiding need items handed out, and that needs admin rights on the test server. Those checks already pass on our own test server and run as soon as the admin login is set up.
