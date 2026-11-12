---
title: Death and respawning
summary: Your loot sack, sleeping bags, beds and the 4-minute wait
group: Survival
order: 5
image: /site/generated/media/guides/base-gear.jpg
tags: death die respawn sleeping bag bed loot sack sleeper camp
---

## When you die

Everything you carry drops in a **loot sack** where you fell. Anyone can open it, and it disappears after **30 minutes**. Items in the sack are shuffled, so the killer has to search for the good stuff.

Some servers lock the sack for a while (the `player.backpackLockTime` server setting, off by default): until the time runs out, only its owner can open it. A [[item:Handmade Lockpick]] opens a locked sack straight away, every time, and is used up. Every player knows the lockpick recipe: 8 low quality metal and 5 cloth at a workbench.

The death screen offers two buttons: **Respawn** puts you at a random spawn point (there are 63 across the island), and **Respawn at a camp** puts you at your sleeping bag or bed.

Killed by an animal? The original game's death message for that case was never finished: it says *"TODO: Handle this death condition"*, followed by the animal's name. That's the real text from the original server, and this port keeps it.

![Killed by a wolf: the original unfinished death message](/site/generated/media/guides/death-todo.jpg)

## Sleeping bags and beds

| | Recipe | Health | Notes |
|---|---|---|---|
| [[item:Sleeping Bag]] | 15 cloth, 30 s | 500 | Place it on flat ground |
| [[item:Bed]] | 40 cloth, 100 metal fragments, 30 s | 500 | Must stand on a building |

Both have a **4-minute cooldown** (240 seconds) after you spawn on them. You can pick a sleeping bag back up once its cooldown has passed.

![A sleeping bag and a workbench](/site/generated/media/guides/base-gear.jpg)

## Sleepers

Leaving a server doesn't take your character with it. You stay in the world **asleep** where you stood, and other players can find you, kill you and take your things. Log off inside a locked base.
