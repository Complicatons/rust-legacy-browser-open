---
date: 2026-10-29
title: Steam or your website account to sign in — Discord sign-in retired
summary: Sign-in is now your email and password, or Steam. The Discord sign-in button and account link are gone; the project's own Discord community server is unaffected.
stats: 2 | sign-in methods, 0 | accounts lost
media: signin-steam-only.jpg | The sign-in page: email and password, or Continue with Steam
---

Players asked for a simple answer to "how do I sign in", and we had three options doing the same job. The owner's call: "People can just login using their login from our website or Steam."

## What changed

- **Discord sign-in is gone.** The sign-in and register pages, the account page's linked-accounts list, and the desktop launcher's code-approval page now offer email and password, or Steam — nothing else.
- **Nobody loses their account.** A ban still reaches every identifier it ever covered; an account that signed up with Discord in the past still exists and still works, reachable with its email or password.
- **The project's Discord server is a different thing.** Our community Discord — for chat, support tickets and server status — isn't going anywhere. Only the "sign in with Discord" button is retired.

## How it was checked

The full automated test suite (1,458 tests) covers Steam sign-in, linking a second identity to an account, and the login error and reauthentication rules that used to also run through Discord — rewritten to prove the same rules without it, so nothing about how linking or bans work was lost. Checked live in the browser too: the sign-in page now shows only email/password and Steam.
