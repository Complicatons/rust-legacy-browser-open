---
date: 2026-10-22
title: One account for desktop too
summary: The plan and the website side of a desktop launcher, so the same website account can join from the original game as well as the browser.
stats: 3 | steps: sign in, connect, launch; 60 s | lease without a check-in; 1 | use per join pass
media: account-launchers.jpg | Test run: the account page on our test site with sample data, one launcher in game on a server and one just signed in with a code, each with its own Sign out button; launcher-approved.jpg | Test run: a launcher signed in to a website account with a typed code
---

Players asked to use the same website account in the original desktop game. The project checked how the 2014 game proves who a player is when joining, by reading its files only. The answer is yes: a small launcher can sign the player in with their website account and hand the game a one-use join pass for the chosen server.

## What is built

- **Website:** launchers can sign in with a username or email and password. Steam and Discord accounts sign a launcher in with a short code typed on the website.
- **Join passes:** each join gets a fresh pass that works once, for one server, for one minute. A website ticket and a launcher pass only work on their own path.
- **Staying connected:** the launcher checks in every 15 seconds while the game runs. If it signs out, or stops checking in for a minute, the server ends that character's session. "Sign out everywhere" on the account page signs launchers out too.
- **Same character:** the server decides which character an account plays, the same way for browser and desktop. Existing desktop characters can still be claimed with the planned `/browserlink` command.

## Not done yet

The launcher window and the part that talks to the game are not built. Nothing has been tried with the original game yet.
