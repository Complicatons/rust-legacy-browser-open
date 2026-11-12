# Shortlist: Oxide plugins worth running on our servers

Picked from the plugins that load (`tools/oxide-plugin-check/shortlist.txt`); plugins they use are added. Method and caveats: [OXIDE-PLUGINS.md](../../OXIDE-PLUGINS.md).

### Gameplay

| Plugin | Author | Why | Watch out |
|---|---|---|---|
| [Kits](https://github.com/Calytic/oxideplugins/blob/9da63dfaebec960d94645e5d38b4281bb3bd8c8d/rust%20legacy/Kits.cs) | Reneb | Starter, VIP and admin-only kits (/kit; create one with /kit add "name" "description" -admin) |  |
| [RemoverTool](https://github.com/Calytic/oxideplugins/blob/9da63dfaebec960d94645e5d38b4281bb3bd8c8d/rust%20legacy/RemoverTool.cs) | Reneb | Players remove their own building parts, with optional refund |  |
| [SetHome](https://github.com/Calytic/oxideplugins/blob/9da63dfaebec960d94645e5d38b4281bb3bd8c8d/rust%20legacy/SetHome.cs) | Reneb | /home on your own or shared buildings; preset to 4 homes each | hooks Oxide for Rust Legacy never calls (that part does nothing): OnPlayerDisconnect \| bundle copy fixed: disconnect hook renamed to OnPlayerDisconnected |
| [TPR](https://github.com/Calytic/oxideplugins/blob/9da63dfaebec960d94645e5d38b4281bb3bd8c8d/rust%20legacy/TPR.cs) | Reneb Fix by Copper, Flapstik,DraB | Teleport requests between players (/tpr, /tpa) | hooks Oxide for Rust Legacy never calls (that part does nothing): OnPlayerDisconnect \| bundle copy fixed: disconnect hook renamed to OnPlayerDisconnected |
| [DeathMessages](https://github.com/strykes/Oxide2Plugins/blob/3d31a7f8d0ec9cf0e0339be87212605deb72968a/Legacy/DeathMessages.cs) | Reneb | Kill messages in chat |  |
| [SkipNightVote](https://github.com/RustServers-IO/oxideplugins/blob/4de21d4db2d609e9e652f71bafc23c84bdba6da2/universal/SkipNightVote.cs) | k1lly0u | Players vote to skip the night |  |
| [Wipe Timer](https://github.com/RustServers-IO/oxideplugins/blob/4de21d4db2d609e9e652f71bafc23c84bdba6da2/universal/WipeTimer.cs) | 531devv | /wipe shows the next wipe |  |

### Server tuning

| Plugin | Author | Why | Watch out |
|---|---|---|---|
| [ResourceManager](https://github.com/Calytic/oxideplugins/blob/9da63dfaebec960d94645e5d38b4281bb3bd8c8d/rust%20legacy/ResourceManager.cs) | Reneb | Admin config only: where resource nodes and animals spawn and how many |  |
| [LootSpawnLists](https://github.com/Calytic/oxideplugins/blob/9da63dfaebec960d94645e5d38b4281bb3bd8c8d/rust%20legacy/LootSpawnLists.cs) | Reneb from thomasfn | Admin config only: what crates, supply drops and mutant animals drop |  |
| [AutoSackRemover](https://github.com/Calytic/oxideplugins/blob/9da63dfaebec960d94645e5d38b4281bb3bd8c8d/rust%20legacy/AutoSackRemover.cs) | Reneb | Removes loot sacks after a set time (less clutter, less lag) |  |
| [CleanDeployables](https://github.com/Calytic/oxideplugins/blob/9da63dfaebec960d94645e5d38b4281bb3bd8c8d/rust%20legacy/CleanDeployables.cs) | Reneb | Admin cleanup of deployables and sacks |  |

### Anti-cheat

| Plugin | Author | Why | Watch out |
|---|---|---|---|
| [AntiCheat](https://github.com/Calytic/oxideplugins/blob/9da63dfaebec960d94645e5d38b4281bb3bd8c8d/rust%20legacy/AntiCheat.cs) | Reneb | Reneb's speed/fly/wall/autoloot checks; preset to report to admins only (no kicks or bans) while testing | hooks Oxide for Rust Legacy never calls (that part does nothing): OnDeny |

### Admin

| Plugin | Author | Why | Watch out |
|---|---|---|---|
| [KickBan](https://github.com/Calytic/oxideplugins/blob/9da63dfaebec960d94645e5d38b4281bb3bd8c8d/rust%20legacy/KickBan.cs) | Reneb & Mughisi | /kick, /ban, /unban by user ID |  |
| [Jail](https://github.com/Calytic/oxideplugins/blob/9da63dfaebec960d94645e5d38b4281bb3bd8c8d/rust%20legacy/Jail.cs) | Reneb | Jail rule breakers |  |
| [Freeze](https://github.com/RustServers-IO/oxideplugins/blob/4de21d4db2d609e9e652f71bafc23c84bdba6da2/universal/Freeze.cs) | Wulf/lukespragg | Freeze a player in place |  |
| [AdminTeleportation](https://github.com/Calytic/oxideplugins/blob/9da63dfaebec960d94645e5d38b4281bb3bd8c8d/rust%20legacy/AdminTeleportation.cs) | Reneb | Teleport to players and positions |  |
| [AdminDoor](https://github.com/Calytic/oxideplugins/blob/9da63dfaebec960d94645e5d38b4281bb3bd8c8d/rust%20legacy/AdminDoor.cs) | Reneb | Doors open for admins |  |
| [AdminAirdrop](https://github.com/Calytic/oxideplugins/blob/9da63dfaebec960d94645e5d38b4281bb3bd8c8d/rust%20legacy/AdminAirdrop.cs) | Reneb | Call and control airdrops |  |
| [Prod](https://github.com/Calytic/oxideplugins/blob/9da63dfaebec960d94645e5d38b4281bb3bd8c8d/rust%20legacy/Prod.cs) | Reneb | Shows who owns a structure or deployable |  |
| [HouseLocations](https://github.com/Calytic/oxideplugins/blob/9da63dfaebec960d94645e5d38b4281bb3bd8c8d/rust%20legacy/HouseLocations.cs) | Reneb | Finds a player's buildings |  |
| [Copy Paste](https://github.com/Calytic/oxideplugins/blob/9da63dfaebec960d94645e5d38b4281bb3bd8c8d/rust%20legacy/CopyPaste.cs) | Reneb | Copy and paste buildings |  |
| [itemGiver](https://github.com/upperking/Old-Rust-Legacy-Plugins/blob/0f6631cc889e7c842c85449e3d71442df49d5173/Oxide-RustLegacy/ItemGiver/ItemGiver.cs) | ice cold | Give items to yourself or others |  |
| [Secure Admin](https://github.com/RustServers-IO/oxideplugins/blob/4de21d4db2d609e9e652f71bafc23c84bdba6da2/universal/SecureAdmin.cs) | Wulf/lukespragg | Admin commands only with permission |  |
| [Logger](https://github.com/RustServers-IO/oxideplugins/blob/4de21d4db2d609e9e652f71bafc23c84bdba6da2/universal/Logger.cs) | Wulf/lukespragg | Logs chat, commands and connections |  |
| [Admin Chatroom](https://github.com/RustServers-IO/oxideplugins/blob/4de21d4db2d609e9e652f71bafc23c84bdba6da2/universal/AdminChatroom.cs) | austinv900 | Private admin chat |  |
| [Casper](https://github.com/Calytic/oxideplugins/blob/9da63dfaebec960d94645e5d38b4281bb3bd8c8d/rust%20legacy/Casper.cs) | Reneb | /casper: invisible and silent to other players (ported to this Oxide; patches/Casper.cs.diff) | bundle copy is our port: tools/oxide-plugin-check/patches/Casper.cs.diff |

### Chat

| Plugin | Author | Why | Watch out |
|---|---|---|---|
| [Easy Chat](https://github.com/Calytic/oxideplugins/blob/9da63dfaebec960d94645e5d38b4281bb3bd8c8d/rust%20legacy/EasyChat.cs) | PaiN | Colours chat by rank, no tags (preset); Legacy's chat window can't colour the name itself |  |
| [Server Information Announcer](https://github.com/Calytic/oxideplugins/blob/9da63dfaebec960d94645e5d38b4281bb3bd8c8d/rust%20legacy/Announcer.cs) | Mughisi | Join/leave messages, rules and timed broadcasts |  |
| [HelpText](https://github.com/Calytic/oxideplugins/blob/9da63dfaebec960d94645e5d38b4281bb3bd8c8d/universal/HelpText.cs) | Domestos/Calytic | /help collects every plugin's help |  |
| [Private Messages](https://github.com/RustServers-IO/oxideplugins/blob/4de21d4db2d609e9e652f71bafc23c84bdba6da2/universal/PrivateMessages.cs) | PaiN | /pm and /r |  |
| [OfflineMail](https://github.com/RustServers-IO/oxideplugins/blob/4de21d4db2d609e9e652f71bafc23c84bdba6da2/universal/OfflineMail.cs) | redBDGR | Messages delivered on the player's next login |  |
| [NoobMessages](https://github.com/RustServers-IO/oxideplugins/blob/4de21d4db2d609e9e652f71bafc23c84bdba6da2/universal/NoobMessages.cs) | Kappasaurus | Message on a player's first join |  |

### Events

| Plugin | Author | Why | Watch out |
|---|---|---|---|
| [ArenaMiniGames](https://github.com/RustServers-IO/oxideplugins/blob/4de21d4db2d609e9e652f71bafc23c84bdba6da2/rust%20legacy/ArenaMiniGames.cs) | tugamano | Arena mini-games (uses ZoneManager zones) |  |
| [MiniEvents](https://github.com/RustServers-IO/oxideplugins/blob/4de21d4db2d609e9e652f71bafc23c84bdba6da2/rust%20legacy/MiniEvents.cs) | tugamano (Lottery idea by P0LENT4) | Automatic lottery (by number or by player) and maths quiz with item prizes |  |

### Needed by others

| Plugin | Author | Why | Watch out |
|---|---|---|---|
| [PlayerDatabase](https://github.com/RustServers-IO/oxideplugins/blob/4de21d4db2d609e9e652f71bafc23c84bdba6da2/universal/PlayerDatabase.cs) | Reneb | used by RemoverTool |  |
| [Share](https://github.com/Calytic/oxideplugins/blob/9da63dfaebec960d94645e5d38b4281bb3bd8c8d/rust%20legacy/Share.cs) | Reneb | used by RemoverTool |  |
| [ZoneManager](https://github.com/Calytic/oxideplugins/blob/9da63dfaebec960d94645e5d38b4281bb3bd8c8d/rust%20legacy/ZoneManager.cs) | Reneb | used by Jail | hooks Oxide for Rust Legacy never calls (that part does nothing): OnItemDeployedByPlayer, OnStructurePlaced |
| [Spawns Database](https://github.com/Calytic/oxideplugins/blob/9da63dfaebec960d94645e5d38b4281bb3bd8c8d/rust%20legacy/Spawns.cs) | Reneb | used by Jail |  |
