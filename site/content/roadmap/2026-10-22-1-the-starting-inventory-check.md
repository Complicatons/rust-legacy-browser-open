---
date: 2026-10-22
title: The starting-inventory check was wrong, not the game
summary: One failed test on the original server turned out to be the test kit forgetting the first inventory message during a long load. The kit now keeps it.
stats: 1 | failed test explained; 0 | game or gateway changes needed; 44,238 | messages received in that test run
media: native-inventory.jpg | Test run on the original server: the starting Rock, Bandages and Torch the server sent
---

When the browser port first ran its gameplay tests against the original 2014 server, one test failed: it waited for the server's starting inventory (a Rock, Bandages and a Torch) and reported that none came.

## What happened

The inventory did arrive. The same run moved the Torch around the bag and the server answered, and the picture above is from that test. The problem was the test kit's own record of the connection: it keeps only the most recent 20,000 messages. The first world load on the test machine took about ten minutes, and the island kept sending updates the whole time (animals, the sky, other objects), so the starting-inventory message had already dropped out of that record by the time the test looked for it.

## The fix

The test kit now keeps the few one-off messages a joining player gets, such as the starting inventory and the player's own character, however long the load takes. Everyday world updates are still trimmed as before. A new test also confirms the gateway handles the inventory correctly when the server bundles it with the player's other first messages.

## What's next

The next test run against the original server should show this check passing.
