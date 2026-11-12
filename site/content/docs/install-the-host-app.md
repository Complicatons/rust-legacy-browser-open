---
title: The host app
summary: Download and install the app that runs your server, the gateway and everything around them
group: Running a server
order: 2
---

**Rust Legacy Host** is the software you install on the Windows PC or VPS that runs your Legacy server. It sets the server up, starts and watches every part, and gives you one dashboard for running it. It also links your server to this website, so players can find it and sign in to play.

## What you need

- Windows 10 or 11, or Windows Server 2016 or newer, 64-bit, with administrator access.
- **Your own copy** of the Legacy server. We never supply the game's server files.
- An account on this website, with your server added on [Your servers](/owner).

## Download

The download box above has the current installer, its size and its SHA-256. [Downloads](/downloads) shows how to check it.

**The installer isn't code-signed yet.** Windows SmartScreen says "Windows protected your PC": press **More info**, check that the SHA-256 shown on the installer's first page matches the one in the download box, then press **Run anyway**. Once the installer is signed, the box says who signed it.

## Install

Run `RustLegacyHostSetup.exe` and follow its four pages:

1. **Welcome.** Shows the version, the signature and the installer's SHA-256.
2. **Your server.** Choose the folder that holds `rust_server.exe`, or the original `RustLegacyServer.zip` (it's checked and unpacked for you). The installer checks the SHA-256 against the verified build and tells you what kind of server it is: stock, Oxide, Fougerite, or a modified build. If it isn't the verified build, tick the box to accept it as your own. You can also choose **Later**.
3. **Options.** Where to install, the firewall rule for the gateway, and whether to keep the game server offline (recommended for a stock server; leave it off if your plugins call web services).
4. **Install.** Takes about a minute. It installs the host app as a Windows service under its own account, which has no password and isn't an administrator, then opens the dashboard, already signed in.

Open it again from the Start menu: **Rust Legacy Host**. The dashboard only answers on the machine itself; you reach it from elsewhere through [the website](/docs/manage-from-the-website). Running a newer installer updates the app and keeps your settings, logs and backups.

## Finish on the Setup page

**Setup** first asks where the server runs:

| Choice | Use it when |
| --- | --- |
| **An existing server, as it is** | Your server already runs, with its own plugins and saves. Chosen for you when you picked a server folder in the installer. |
| **This PC, for testing** or **A VPS, as a public server** | A fresh, locked-down copy made by the [Setup wizard](/docs/set-up-your-server)'s steps. |

For an existing server there are five steps:

| Step | What it does |
| --- | --- |
| Your server | Shows the server's SHA-256 and build. Change the folder here if the app can open it. |
| Browser ready | Adds our adapter so website players can join. Stock server: your `Assembly-CSharp.dll` is patched and the original is kept beside it. Oxide: one plugin file and its config. Your other plugins are left alone. **Undo** puts every file back. Fougerite isn't supported yet. |
| Connect to the website | On [Your servers](/owner), press **New enrolment code** on your server and paste the code. One code links the gateway and the [console](/docs/manage-from-the-website). |
| Public address | How browsers reach the gateway: your certificate on a public port, behind your own HTTPS proxy or tunnel, or not yet. |
| Run | Your OK that the app may start your server. Until you tick it, the app never starts it. |

Stop the game server before changing setup, then start it on the Overview. Within a few seconds your server's [console](/console) on this website shows it as connected. By default your existing players keep joining as before; tick **Only players who signed in on the website may join** under Browser ready to admit website players only.

## Uninstall

**Settings → Apps → Rust Legacy Host → Uninstall.** It asks whether to put your server's own files back and whether to delete the app's settings, logs and backups. Your game saves are never deleted.

## What it does

- **Sets your server up** step by step on the Setup page.
- **Runs every part in order** (helpers, game server, gateway) and restarts one that crashes, backing off if it keeps crashing.
- **Catches freezes.** If the game server stops logging, stops answering and stops using CPU, all for 90 seconds, it restarts it with the last good save.
- **Saves before it stops.** Stop and Restart ask the server to save first, so players don't lose progress.
- **Restarts and wipes on a schedule**, with countdown warnings in chat. See [Restarts and wipes](/docs/restarts-and-wipes).
- **Keeps backups**, on the same machine and, if you like, off-site. See [Backups](/docs/backups).
- **Shows how the server is doing** over the last day and week, and **sends Discord alerts** when something goes wrong. See [Health and alerts](/docs/health-and-alerts).
- **Edits server settings and plugins** without hunting for files. See [Server settings and plugins](/docs/server-settings-and-plugins).
- **Installs updates** with one-click roll back. See [Updates](/docs/host-app-updates).
- **Reports to this website**, so you can [manage the server from here](/docs/manage-from-the-website) too.

## The app

**Starting up.** The app opens with a terminal that shows each part of your server being checked and started in order, then the health check, line by line. Press Esc to skip it.

**The tray.** The tray icon shows the server's state, warns you about crashes and freezes, and has Start, Stop and Restart. Closing the window keeps everything running.

**The terminal panel**, docked at the side (Ctrl+` shows or hides it):

| Tab | What it's for |
| --- | --- |
| Host | Quick commands: `status`, `start`, `stop` or `restart` a part, `logs`, `health`, `backup now`, `restart-in`, `players`. Type `help` for the list. |
| PowerShell, CMD | Real Windows shells on this machine, as your Windows account, starting in the server folder. Only in the app: never on the website or from another computer. |

Ctrl+1 to Ctrl+9 jump between pages.

## The dashboard

| Page | What it's for |
| --- | --- |
| Overview | Each part's state, Start/Stop/Restart, the freeze watchdog, and the **health check** |
| Logs | Every part's log in one live view, with filters and search |
| Accounts | Website accounts linked to characters on your server |
| Setup | The setup wizard |
| Players | Who is online; message, go to, bring, kick, ban; each player's history |
| Anti-cheat | Flags with their evidence, and player reports |
| Backups | Saves kept by the host app, your own copies, and off-site copies |
| Schedule | Daily restarts and wipes |
| Updates | Install updates and roll them back |
| Plugins | Your Oxide plugins |
| Health | Players, CPU, memory and response times over 24 hours and 7 days |
| Settings | Server settings, the admin password, message of the day, and Discord alerts |

If something isn't working, see [Host app troubleshooting](/docs/host-app-troubleshooting).
