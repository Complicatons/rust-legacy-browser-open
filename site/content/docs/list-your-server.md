---
title: List your server
summary: Register, connect and send the listing, step by step
group: Running a server
order: 1
---

Listing puts your server on the server list on this website and in the desktop launcher. Browser players join it from there. Here is the whole path, in four steps.

## 1. Register the server

Sign in and open [Your servers](/owner). Under **Register a server**, fill in:

- **Name**: what players see (up to 64 characters).
- **Region**: a short code such as `eu` or `na`.
- **Gateway address**: the `wss://` address players' browsers connect to, for example `wss://play.yourserver.com/play`. The gateway is the bridge between browsers and your Legacy server. The [host app](/docs/install-the-host-app) runs it for you.

The page then shows a **one-time enrolment code**, valid for 15 minutes.

## 2. Connect it

- **With the [host app](/docs/install-the-host-app)**: paste the code on its Setup page, under **Connect to the website**. That one code enrols the gateway and gives the app its key, so you can [manage the server from the website](/docs/manage-from-the-website).
- **Without the host app**: run the command the page shows to enrol the gateway yourself.

Once enrolled, the gateway reports in every 15 seconds and the server shows as online. To replace the host app's key later, press **New host app key** on Your servers and paste it into the app's Accounts page. A new key replaces the old one.

## 3. Send the listing

Press **Send listing** on the server. Describe it honestly and add:

- up to 6 **tags** (players can search by them),
- your **wipe schedule** and **language**,
- your **Discord invite** (`discord.gg/…`) and **website**.

Tick the [listing rules](/docs/listing-rules) box and send it. The Rust Legacy team checks every new server. If it's approved, the server is listed as soon as its gateway is online. If it isn't, the reason shows on Your servers: fix it and send it again.

## 4. After approval

- **Unlist** and **Publish** hide and show the server without another review.
- Changes to an approved listing go live straight away.
- A server only shows as online while its gateway reports. Offline servers stay on the list, but nobody can join them.
