---
title: The staff panel
summary: For the Rust Legacy team, every server at a glance
group: Site staff
order: 1
---

The **Staff panel** (`/staff`) is for site staff only. Everyone else gets a "site staff only" message.

## At a glance

Tiles across the top: servers, online, players now, listing requests, flags in the last 24 hours and open reports.

## Listing requests

New listings wait here when review is on. Each one shows the description, tags, wipe schedule, language, links and gateway address. **Approve** lists the server as soon as its gateway is online. **Reject** asks for a note, and the owner sees it on Your servers.

## Every server

One row per registered server: owner, online state (or when it last reported), players, whether its host app is connected, listing state, flags in 24 hours, open reports and linked-account holds. Sort by any column. Filter by name or owner, or show only servers that need attention.

Each row opens that server's **Console** and **Admin**. Site staff can do everything the owner can there.

**Suspend** takes a server off the list and stops its gateway and host app from reporting. It asks for a reason, which goes in the audit log. **Restore** undoes it.

## Making someone site staff

On the machine that runs the website:

```
node tools/central.mjs staff <central.json> <email or username>
node tools/central.mjs staff <central.json> <email or username> --remove
```

Both are recorded in the audit log.
