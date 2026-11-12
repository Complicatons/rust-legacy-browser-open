// Rust Legacy browser admission adapter for Oxide (pilot). Thin hook only: all admission state lives in the
// loopback sidecar (bridge/sidecar.mjs). Written against the static trace in EXISTING-SERVER-INTEGRATION-PLAN.md
// ("Auth feasibility verdict"); type-checked against reference assemblies, NOT yet run on a server.
//
// Native logins (no RLBA/RLBD envelope) are untouched unless LauncherOnly is true: then only players who signed in
// through the website (browser or desktop launcher) can join, and every other login gets "Authorization failed".
// For envelope logins this replaces only the native
// DoSteamAuthorisation step; ban/duplicate checks, the approval reply and NetUser setup match the original code.
// Known gap: Oxide core's IOnUserApprove kicks an existing session with the same UserID before this hook runs.
//
// Admin tooling (ANTICHEAT-ADMIN-PLAN.md): polls the sidecar for a fixed list of admin actions issued on the website
// (teleport-to, bring, message, kick-native, ban-native, unban-native) and runs them with the original server APIs by user ID,
// never by name matching or console strings. /report files an accountable report for linked characters.
// Server-wide actions from the owner's host app (HOST-AND-LOADER-BUILD.md H1) come the same way, without a target:
// save (the server's own save.all), broadcast (chat to everyone as "Server", for restart warnings) and quit. The host
// sends save, waits for the server's " Saved N Object(s)" log line, then sends quit, so Stop no longer loses play.
using System;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Rust;
using uLink;
using UnityEngine;

namespace Oxide.Plugins
{
    [Info("RustLegacyBrowser", "Rust Legacy Browser contributors", "0.1.1")]
    [Description("Admits browser players verified by the project gateway (pilot)")]
    public class RustLegacyBrowser : RustLegacyPlugin
    {
        // "RLBA" (browser, via the gateway) and "RLBD" (desktop launcher, DESKTOP-LAUNCHER-PLAN.md) share "RLB" + one kind byte.
        static readonly byte[] EnvelopeMagic = { 0x52, 0x4C, 0x42 }; // "RLB"
        const float ConnectTimeoutSeconds = 60f, LinkCooldownSeconds = 30f, PollSeconds = 2f;
        const float MotdDelaySeconds = 10f; // after the join, so the message lands once the player is in the world (assumed delay)
        const int MaxQueuedRequests = 256; // beyond this (sidecar down) new requests fail at once instead of piling up

        string sidecarUrl;
        byte[] pluginKey;
        bool launcherOnly;
        string motd = "";
        string boot;
        long seq; // only SendNext touches it
        readonly Queue<KeyValuePair<Dictionary<string, object>, Action<Dictionary<string, object>>>> outgoing = new Queue<KeyValuePair<Dictionary<string, object>, Action<Dictionary<string, object>>>>();
        bool sending;
        readonly Dictionary<ClientConnection, string> connectionIds = new Dictionary<ClientConnection, string>();
        readonly HashSet<ClientConnection> browserConnections = new HashSet<ClientConnection>();
        readonly Dictionary<ulong, DateTime> lastLinkRequest = new Dictionary<ulong, DateTime>();

        protected override void LoadDefaultConfig()
        {
            Config["SidecarUrl"] = "http://127.0.0.1:28090/plugin";
            Config["PluginKeyHex"] = "";
            Config["LauncherOnly"] = false;
            Config["Motd"] = "";
        }

        void Init()
        {
            sidecarUrl = Convert.ToString(Config["SidecarUrl"]);
            pluginKey = ParseHex(Convert.ToString(Config["PluginKeyHex"]));
            launcherOnly = Config["LauncherOnly"] != null && Convert.ToBoolean(Config["LauncherOnly"]); // older configs lack it
            motd = Config["Motd"] != null ? Convert.ToString(Config["Motd"]).Trim() : ""; // message of the day; older configs lack it
            boot = Guid.NewGuid().ToString("N");
            if (pluginKey == null || pluginKey.Length < 32)
            {
                pluginKey = null;
                PrintWarning("PluginKeyHex is missing or shorter than 32 bytes; browser joins will be refused.");
            }
            if (!sidecarUrl.StartsWith("http://127.0.0.1:"))
            {
                pluginKey = null;
                PrintWarning("SidecarUrl must be on 127.0.0.1; browser joins will be refused.");
            }
            if (pluginKey != null) timer.Once(PollSeconds, PollCommands);
        }

        // One request every PollSeconds; the next poll is armed only after the reply, so requests never pile up.
        void PollCommands()
        {
            var request = new Dictionary<string, object> { { "type", "poll" } };
            // Every poll lists desktop players with their server-side positions: website admins see and act on them,
            // and the sidecar scores their movement with the same checks the gateway applies to browser players.
            request["players"] = ListPlayers();
            Post(request, reply =>
            {
                object value;
                JArray list = reply != null && reply.TryGetValue("commands", out value) ? value as JArray : null;
                if (list != null)
                    foreach (JToken token in list)
                    {
                        JObject command = token as JObject;
                        if (command == null) continue;
                        string id = (string)command["id"], failure = null;
                        try { failure = RunCommand(command); }
                        catch (Exception e) { failure = "error"; PrintWarning("Admin command " + id + " failed: " + e.Message); }
                        Post(new Dictionary<string, object> { { "type", "command-result" }, { "id", id }, { "ok", failure == null }, { "reason", failure } }, null);
                    }
                timer.Once(PollSeconds, PollCommands);
            });
        }

        List<Dictionary<string, object>> ListPlayers()
        {
            var players = new List<Dictionary<string, object>>();
            foreach (PlayerClient client in PlayerClient.All)
            {
                NetUser user = client.netUser;
                // Every player, browser ones included: the sidecar keeps their leases by this list and the host counts players
                // from it (restart warnings); its desktop list and movement checks leave browser leases out themselves.
                if (user == null || players.Count >= 500) continue;
                var entry = new Dictionary<string, object> { { "id", user.userID.ToString() }, { "name", user.displayName } };
                // The native connection's address, for IP logging and IP bans on the website (browser players are skipped above).
                string ip = user.networkPlayer.externalIP;
                if (!string.IsNullOrEmpty(ip)) entry["ip"] = ip;
                // Same transform ServerManagement.GetOrigin uses; a respawn creates a new character object (life).
                Character character = client.controllable != null ? client.controllable.GetComponent<Character>() : null;
                if (character != null)
                {
                    Vector3 p = character.transform.position;
                    entry["pos"] = new[] { p.x, p.y, p.z };
                    entry["life"] = character.GetInstanceID().ToString();
                }
                players.Add(entry);
            }
            return players;
        }

        // Returns null on success or a short failure reason.
        string RunCommand(JObject command)
        {
            string action = (string)command["action"], reason = (string)command["reason"] ?? "";
            if (action == "save" || action == "broadcast" || action == "quit") return RunServerCommand(action, (string)command["message"]);
            ulong targetId;
            if (!ulong.TryParse((string)command["targetId"], out targetId)) return "malformed";
            NetUser target = NetUser.FindByUserID(targetId);
            switch (action)
            {
                case "teleport-to":
                case "bring":
                {
                    ulong actorId;
                    if (!ulong.TryParse((string)command["actorId"], out actorId)) return "malformed";
                    NetUser actor = NetUser.FindByUserID(actorId);
                    if (actor == null) return "admin-offline";
                    if (target == null) return "player-offline";
                    RustServerManagement management = RustServerManagement.Get();
                    if (management == null) return "unavailable";
                    bool moved = action == "teleport-to"
                        ? management.TeleportPlayerToPlayer(actor.networkPlayer, target.networkPlayer)
                        : management.TeleportPlayerToPlayer(target.networkPlayer, actor.networkPlayer);
                    return moved ? null : "not-spawned";
                }
                case "message":
                    if (target == null) return "player-offline";
                    rust.SendChatMessage(target, "Admin", (string)command["message"]);
                    return null;
                case "kick-native":
                    if (target == null) return "player-offline";
                    target.Kick(NetError.Facepunch_Kick_RCON, true);
                    Puts("Kicked " + targetId + " for the website (" + reason + ")");
                    return null;
                case "ban-native":
                    BanList.Add(targetId, target != null ? target.displayName : "browser-account", reason);
                    BanList.Save();
                    if (target != null) target.Kick(NetError.Facepunch_Kick_RCON, true);
                    Puts("Banned " + targetId + " for the website (" + reason + ")");
                    return null;
                case "unban-native":
                    bool removed = BanList.Remove(targetId);
                    BanList.Save();
                    return removed ? null : "not-banned";
                default:
                    return "unknown-action";
            }
        }

        // Server-wide actions (bridge/adapter.mjs SERVER_ACTIONS); a fixed list, never console text from outside.
        string RunServerCommand(string action, string message)
        {
            switch (action)
            {
                case "save":
                    // The server's own save console command (ServerSaveManager): it logs "Saving to" and " Saved N Object(s)",
                    // the line the host waits for before it sends quit.
                    ConsoleSystem.Run("save.all", false);
                    return null;
                case "broadcast":
                    if (string.IsNullOrEmpty(message)) return "malformed";
                    rust.BroadcastChat("Server", message);
                    return null;
                case "quit":
                    // A moment later, so this result reaches the sidecar first; the host waits for the exit and ends the
                    // process itself if it does not come.
                    Puts("Quitting for the host app (the world was saved first)");
                    timer.Once(1f, () => UnityEngine.Application.Quit());
                    return null;
                default:
                    return "unknown-action";
            }
        }

        public static bool IsEnvelope(byte[] ticket)
        {
            if (ticket == null || ticket.Length < EnvelopeMagic.Length) return false;
            for (int i = 0; i < EnvelopeMagic.Length; i++)
                if (ticket[i] != EnvelopeMagic[i]) return false;
            return ticket.Length > EnvelopeMagic.Length && (ticket[3] == 0x41 || ticket[3] == 0x44); // 'A' or 'D'; the sidecar checks the rest
        }

        object OnUserApprove(ClientConnection connection, NetworkPlayerApproval approval, ConnectionAcceptor acceptor)
        {
            if (!IsEnvelope(connection.SteamTicket))
            {
                if (!launcherOnly) return null;
                Puts("Refused " + connection.UserID + ": LauncherOnly is on and the login did not come through the website.");
                return Deny(approval, NetError.Facepunch_Connector_AuthFailure);
            }
            if (pluginKey == null) return Deny(approval, NetError.Facepunch_Connector_Cancelled);
            // Same order as ConnectionAcceptor.uLink_OnPlayerApproval, re-checked because the hook position is not proven.
            if (Rust.Steam.Server.SteamGroup != 0) return Deny(approval, NetError.Facepunch_Whitelist_Failure);
            if (BanList.Contains(connection.UserID)) return Deny(approval, uLink.NetworkConnectionError.ConnectionBanned);
            if (acceptor.IsConnected(connection.UserID)) return Deny(approval, uLink.NetworkConnectionError.AlreadyConnectedToAnotherServer);

            string id = Track(connection);
            browserConnections.Add(connection);
            acceptor.m_Connections.Add(connection); // reserves the UserID for IsConnected while we wait, as native auth does
            approval.Wait();
            var request = new Dictionary<string, object>
            {
                { "type", "approval" }, { "connectionId", id },
                { "claimedUserId", connection.UserID.ToString() },
                { "authBytes", Convert.ToBase64String(connection.SteamTicket) }
            };
            Post(request, reply =>
            {
                bool approved = reply != null && Has(reply, "approved", true)
                    && Has(reply, "backendId", connection.UserID.ToString());
                if (approval.status == NetworkPlayerApprovalStatus.Denied) { Release(connection); return; }
                if (!approved)
                {
                    Puts("Browser admission refused for " + connection.UserID + ": " + Field(reply, "reason"));
                    Release(connection);
                    approval.Deny((uLink.NetworkConnectionError)NetError.Facepunch_Connector_Cancelled);
                    return;
                }
                approval.localData = connection;
                approval.Approve(WorldInfo());
                timer.Once(ConnectTimeoutSeconds, () => { if (connection.netUser == null && connectionIds.ContainsKey(connection)) Release(connection); });
            });
            return true;
        }

        // Identical fields and order to ClientConnection.AuthorisationRoutine's approval reply.
        static byte[] WorldInfo()
        {
            var bs = new uLink.BitStream(false);
            bs.WriteString(Globals.currentLevel);
            bs.WriteSingle(NetCull.sendRate);
            bs.WriteString(server.hostname);
            bs.WriteBoolean(Rust.Steam.Server.Modded);
            bs.WriteBoolean(Rust.Steam.Server.Official);
            bs.WriteUInt64(Rust.Steam.Server.SteamID);
            bs.WriteUInt32(Rust.Steam.Server.IPAddress);
            bs.WriteInt32(server.port);
            return bs.GetDataByteArray();
        }

        void OnPlayerConnected(NetUser netUser)
        {
            // Message of the day, to every player (browser, loader and native alike), set in the host app's Settings.
            if (motd.Length > 0) timer.Once(MotdDelaySeconds, () => { if (netUser.connected) rust.SendChatMessage(netUser, "Server", motd); });
            ClientConnection connection = netUser.connection;
            if (connection == null || browserConnections.Contains(connection)) return;
            // Native player that passed normal authentication: holds the identity lease and may request a link code.
            string id = Track(connection);
            Post(new Dictionary<string, object> { { "type", "native-authenticated" }, { "connectionId", id }, { "userId", netUser.userID.ToString() } }, null);
        }

        void OnPlayerDisconnected(uLink.NetworkPlayer player)
        {
            object data = player.GetLocalData();
            ClientConnection connection = data is NetUser ? ((NetUser)data).connection : data as ClientConnection;
            if (connection != null) Release(connection);
        }

        [ChatCommand("browserlink")]
        void cmdBrowserLink(NetUser netUser, string command, string[] args)
        {
            ClientConnection connection = netUser.connection;
            string id;
            if (connection == null || browserConnections.Contains(connection) || !connectionIds.TryGetValue(connection, out id))
            {
                SendReply(netUser, "Browser linking is only available from the desktop game.");
                return;
            }
            DateTime last;
            if (lastLinkRequest.TryGetValue(netUser.userID, out last) && (DateTime.UtcNow - last).TotalSeconds < LinkCooldownSeconds)
            {
                SendReply(netUser, "Please wait before requesting another link code.");
                return;
            }
            lastLinkRequest[netUser.userID] = DateTime.UtcNow;
            Post(new Dictionary<string, object> { { "type", "link-challenge" }, { "connectionId", id } }, reply =>
            {
                string code = Field(reply, "code");
                if (code == null) SendReply(netUser, "This character cannot be linked right now.");
                else rust.SendChatMessage(netUser, "Browser", "Link code " + code + " - enter it on the website within 5 minutes. Never share it.");
            });
        }

        // /report <exact name> <what happened>: goes to the server's admins on the website with the reporter's account.
        [ChatCommand("report")]
        void cmdReport(NetUser netUser, string command, string[] args)
        {
            string id;
            ClientConnection connection = netUser.connection;
            if (args == null || args.Length < 2 || connection == null || !connectionIds.TryGetValue(connection, out id))
            {
                SendReply(netUser, "Usage: /report <player name> <what happened>");
                return;
            }
            string targetId = null;
            foreach (PlayerClient client in PlayerClient.FindAllWithName(args[0], StringComparison.OrdinalIgnoreCase))
            {
                NetUser user = client.netUser;
                if (user != null) { targetId = user.userID.ToString(); break; }
            }
            Post(new Dictionary<string, object>
            {
                { "type", "report" }, { "connectionId", id }, { "targetName", args[0] },
                { "targetId", targetId }, { "text", string.Join(" ", args, 1, args.Length - 1) }
            }, reply =>
            {
                string failure = reply != null && Has(reply, "ok", true) ? null : Field(reply, "reason");
                if (failure == null) SendReply(netUser, "Report sent to the server admins. Thank you.");
                else if (failure == "not-linked") SendReply(netUser, "Link this character on the website (/browserlink) to send reports.");
                else if (failure == "cooldown") SendReply(netUser, "Please wait a minute between reports.");
                else SendReply(netUser, "The report could not be sent right now.");
            });
        }

        string Track(ClientConnection connection)
        {
            string id;
            if (!connectionIds.TryGetValue(connection, out id))
            {
                id = Guid.NewGuid().ToString("N");
                connectionIds[connection] = id;
            }
            return id;
        }

        void Release(ClientConnection connection)
        {
            string id;
            if (!connectionIds.TryGetValue(connection, out id)) return;
            connectionIds.Remove(connection);
            if (browserConnections.Remove(connection)) ConnectionAcceptor.CloseConnection(connection);
            Post(new Dictionary<string, object> { { "type", "disconnect" }, { "connectionId", id } }, null);
        }

        static object Deny(NetworkPlayerApproval approval, NetError error) { return Deny(approval, (uLink.NetworkConnectionError)error); }
        static object Deny(NetworkPlayerApproval approval, uLink.NetworkConnectionError error) { approval.Deny(error); return true; }

        // Requests go out one at a time, in the order they were posted: the sidecar refuses a seq at or below the last one
        // it saw, and Oxide's web requests may run in parallel, so two in flight could overtake each other and the
        // later-numbered one would be refused. seq/ts/MAC are stamped by SendNext as each one goes out.
        void Post(Dictionary<string, object> body, Action<Dictionary<string, object>> callback)
        {
            if (outgoing.Count >= MaxQueuedRequests) { if (callback != null) callback(null); return; }
            outgoing.Enqueue(new KeyValuePair<Dictionary<string, object>, Action<Dictionary<string, object>>>(body, callback));
            if (!sending) SendNext();
        }

        // The only sender: the next request starts from the previous one's reply callback (Oxide's main thread).
        void SendNext()
        {
            if (outgoing.Count == 0) { sending = false; return; }
            sending = true;
            var next = outgoing.Dequeue();
            Dictionary<string, object> body = next.Key;
            Action<Dictionary<string, object>> callback = next.Value;
            body["boot"] = boot;
            body["seq"] = ++seq;
            body["ts"] = (long)(DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
            string raw = JsonConvert.SerializeObject(body);
            var headers = new Dictionary<string, string> { { "Content-Type", "application/json" }, { "x-rlb-mac", Mac(pluginKey, raw) } };
            try
            {
                webrequest.EnqueuePost(sidecarUrl, raw, (code, response) =>
                {
                    try
                    {
                        if (callback == null) return;
                        Dictionary<string, object> reply = null;
                        if (code == 200)
                        {
                            try { reply = JsonConvert.DeserializeObject<Dictionary<string, object>>(response); }
                            catch (Exception) { reply = null; }
                        }
                        callback(reply);
                    }
                    finally { SendNext(); }
                }, this, headers, 5f);
            }
            catch (Exception)
            {
                try { if (callback != null) callback(null); }
                finally { SendNext(); }
            }
        }

        public static string Mac(byte[] key, string raw)
        {
            using (var hmac = new HMACSHA256(key))
            {
                string b64 = Convert.ToBase64String(hmac.ComputeHash(Encoding.UTF8.GetBytes(raw)));
                return b64.TrimEnd('=').Replace('+', '-').Replace('/', '_');
            }
        }

        static bool Has(Dictionary<string, object> reply, string key, object expected)
        {
            object value;
            return reply.TryGetValue(key, out value) && value != null && value.Equals(expected);
        }

        static string Field(Dictionary<string, object> reply, string key)
        {
            object value;
            return reply != null && reply.TryGetValue(key, out value) && value != null ? value.ToString() : null;
        }

        static byte[] ParseHex(string hex)
        {
            if (string.IsNullOrEmpty(hex) || hex.Length % 2 != 0) return null;
            var bytes = new byte[hex.Length / 2];
            try
            {
                for (int i = 0; i < bytes.Length; i++) bytes[i] = Convert.ToByte(hex.Substring(i * 2, 2), 16);
            }
            catch (FormatException) { return null; }
            return bytes;
        }
    }
}
