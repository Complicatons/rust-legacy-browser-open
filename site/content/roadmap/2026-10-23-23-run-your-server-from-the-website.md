---
date: 2026-10-23
title: Run your server from the website
summary: Server owners can now list their server, and run it from your-domain.example: a live log, restarts and backups. The Rust Legacy team has a staff panel over every server, and the site has a help section for players, owners and server teams.
stats: 2 s | between host app reports; 0 | ports an owner opens for it; 4 | steps to a listed server; 11 | help pages
media: site-console.jpg | The server console with sample data: health, the parts, and the live log; site-staff.jpg | The staff panel: every server at a glance and a listing waiting for review; site-listing-form.jpg | Sending a listing, with the team's note on one that wasn't approved; site-list-your-server.jpg | The new List your server page; site-docs.jpg | One of the new help pages; site-console-phone.jpg | The console on a phone
---

Running a server used to mean Remote Desktop and four console windows. Now most of it happens on the website.

## The console

Each server has a [console](/console). It shows the game server's health, each part (game server, gateway, helpers) with Start, Stop and Restart, a live log you can filter and search, and the server's backups.

It works without opening any port. The owner's host app calls out to the website every 2 seconds, sends its status and new log lines, and picks up any commands waiting for it. Its own dashboard stays on the owner's machine. The logs stay in the website's memory (the newest 2,000 lines) and never reach the database. Only the owner and our staff can read them.

## Listing a server

The new [List your server](/list-your-server) page explains the four steps: register, connect, send the listing, run it. A listing adds a description, tags, the wipe schedule, the language and a Discord invite, and the server list shows all of them. Players can now search servers by tag. We check every new listing before it shows. A rejected one comes back to its owner with a note.

## The staff panel

Site staff (the Rust Legacy team) get a [staff panel](/staff) with every server on one page: online or not, players, whether its host app is connected, anti-cheat flags in the last day, open reports and held accounts. Each row opens that server's console and admin panel. Staff can approve or reject listings, and suspend a server that breaks the rules. A suspended server leaves the list and its gateway stops working.

Names are clearer too. **Site staff** is the Rust Legacy team, across every server. A server's own team (owner, server admins, moderators) is its **server team**, and its page is called **Server admin**.

## Help

[Help](/docs) has 11 pages in four groups: playing online, running a server, server teams, and site staff. They cover joining, reports and bans, listing, the host app, the console, the listing rules, the admin panel, anti-cheat flags, and who can do what.

The pictures use sample data from a local preview. No owner has connected a real host app yet.
