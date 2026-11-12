---
title: Set up your server
summary: The Setup wizard, step by step, on your own PC or a VPS
group: Running a server
order: 3
---

The **Setup** page in the host app takes you through everything your server needs: a locked-down account for the game server, its folders, the firewall, our server add-on, and the link to this website. Each step shows what it will change before it changes anything.

## First, choose where it runs

| Choice | Use it when |
| --- | --- |
| **This PC, for testing** | You're trying it out on your own computer. Players can't reach it from the internet. |
| **A VPS, as a public server** | It's a server players will join. Adds the public address, the website certificate and start-at-boot steps. |

## The steps

| Step | What it does |
| --- | --- |
| Server account | Makes a Windows account with no admin rights for the game server to run as |
| Server folders | Unpacks your server copy and sets who may read and write each folder |
| Public address (VPS) | Records your server's public address and the address you manage it from |
| Firewall | Opens only the ports players need and closes everything else for the game server |
| Isolation check | Checks the game server can't reach anything it shouldn't |
| Secrets | Makes the keys the parts use to talk to each other |
| Gateway certificate (this PC) | A test certificate for the gateway |
| Certificate request and Cloudflare certificate (VPS) | The certificate players' browsers trust for your server's address |
| Patch the server copy | Adds our server add-on to your copy of the server |
| Website (this PC) | A local test copy of the website |
| Enrol with the website | Links the server to your listing, using the code from [Your servers](/owner) |
| Password-free start | Lets the server start on its own (at boot on a VPS) |
| Start the server | Starts the game server for the first time |

## Running a step

1. Open the step. **Plan** shows exactly what it will change.
2. Press **Run**. You see its output live, then **Passed**, **Passed, with warnings** or **Failed**, with the reason.
3. You can run any step again later. The wizard remembers where you got to.

## Steps that need an administrator

The host app runs as a plain account, so it can't change the firewall or Windows accounts itself. For those steps the wizard gives you **one line to paste** into PowerShell opened as administrator, with a **Copy** button. Paste it, press Enter, and the wizard reads the result back on its own. You can also choose **Run it myself instead** on any step.

## If a step fails

The step shows the reason in plain words. Fix what it says, then run it again. If you're stuck, copy the step's output into our [Discord](https://discord.gg/your-invite).
