// Rust Legacy browser admission adapter for servers WITHOUT Oxide (pilot). Same sidecar contract and admission
// rules as adapter/RustLegacyBrowser.cs; reached through four calls that tools/vanilla-patcher injects into the
// operator's own copy of Assembly-CSharp.dll (see EXISTING-SERVER-INTEGRATION-PLAN.md, "Vanilla patch"):
//   ConnectionAcceptor.uLink_OnPlayerApproval    → OnUserApprove, just before m_Connections.Add (ban and
//                                                   duplicate checks have already run natively; no kick)
//   ConnectionAcceptor.uLink_OnPlayerConnected   → OnPlayerConnected, before every return
//   ConnectionAcceptor.uLink_OnPlayerDisconnected → OnPlayerDisconnected, at entry
//   chat.say                                     → OnChat, at entry (handles /browserlink and /report privately)
// Native logins (no RLBA/RLBD envelope) are untouched unless LauncherOnly=true (then they get "Authorization failed",
// as in the Oxide plugin). Type-checked against the server's own assemblies; NOT yet run.
// Admin tooling (ANTICHEAT-ADMIN-PLAN.md) matches the Oxide plugin: after the first hook call it polls the sidecar
// every 2 s for the fixed admin actions, sending the desktop players and their positions with each poll.
// The host app's server-wide actions (save, broadcast, quit: save-and-quit and restart warnings) come the same way. Until
// the first hook call (a player joining) nothing polls, so a server nobody has joined since it started cannot be asked to
// save; the host then ends it as before.
// Owner decision (29 Oct 2026, HOST-AND-LOADER-BUILD.md question 6): add a start-up hook so this works before the
// first join too. Unlike the Oxide plugin — which gets this for free from Oxide's own Init() lifecycle hook, called
// at plugin load regardless of players — the vanilla patch has no such hook: tools/vanilla-patcher only injects into
// the four player-triggered call sites above plus the evidence sites (all also player-triggered; ANTICHEAT-ADMIN-PLAN.md).
// A genuine fifth, non-player-triggered injection site (something in the server's own startup sequence, e.g. Assembly-CSharp's
// ServerInit — confirmed to exist, docs/port-coverage/classes.md, but its method names and call order are not in this
// environment's reach: analysis/decompiled/server/Assembly-CSharp is a private, git-ignored export this worktree does not
// have) needs tracing from the decompiled source before tools/vanilla-patcher can safely target it, the same way the
// Fougerite admission hook's own fix was traced (OFFSHOOT-COMPATIBILITY-PLAN.md work item 4) before any IL was written.
// Not done here: guessing at an unverified method name in Mono.Cecil IL injection risks corrupting an operator's own
// server binary, which the patcher is designed never to risk (it refuses any build whose hash is not on its allowlist
// for the same reason). Needs either that decompiled trace, or confirmation from a real server run that its stdin
// accepts console commands the way host/server-control.mjs's existing 'console' via already assumes for the mock
// server — either would unblock this without a guess.
using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using LitJson;
using Rust;
using UnityEngine;

namespace RustLegacyBrowser
{
    public static partial class Hooks
    {
        // "RLBA" (browser, via the gateway) and "RLBD" (desktop launcher, DESKTOP-LAUNCHER-PLAN.md) share "RLB" + one kind byte.
        static readonly byte[] EnvelopeMagic = { 0x52, 0x4C, 0x42 }; // "RLB"
        const float ConnectTimeoutSeconds = 60f, LinkCooldownSeconds = 30f, RequestTimeoutSeconds = 5f, PollSeconds = 2f;
        const float MotdDelaySeconds = 10f; // after the join, so the message lands once the player is in the world (assumed delay)
        const int MaxQueuedRequests = 256; // beyond this (sidecar down) new requests fail at once instead of piling up
        public const string ConfigFile = "cfg/rustlegacybrowser.cfg";

        static bool loaded;
        static string sidecarUrl;
        static byte[] pluginKey;
        static bool launcherOnly;
        static string motd = "";
        static string boot;
        static long seq; // only the sender thread (SendQueued) touches it
        static readonly Queue<KeyValuePair<string, Action<JsonData>>> outgoing = new Queue<KeyValuePair<string, Action<JsonData>>>();
        static bool sending; // guarded by outgoing
        static Pump pump;
        static readonly Dictionary<ClientConnection, string> connectionIds = new Dictionary<ClientConnection, string>();
        static readonly HashSet<ClientConnection> browserConnections = new HashSet<ClientConnection>();
        static readonly Dictionary<ulong, DateTime> lastLinkRequest = new Dictionary<ulong, DateTime>();

        // Lazy start on the main thread (first hook call): config, boot id and the callback pump.
        static void Load()
        {
            if (loaded) return;
            loaded = true;
            boot = Guid.NewGuid().ToString("N");
            var go = new GameObject("RustLegacyBrowser");
            UnityEngine.Object.DontDestroyOnLoad(go);
            pump = go.AddComponent<Pump>();
            string path = Path.Combine(server.datadir, ConfigFile);
            var config = ReadConfig(path);
            sidecarUrl = Get(config, "SidecarUrl", "http://127.0.0.1:28090/plugin");
            pluginKey = ParseHex(Get(config, "PluginKeyHex", ""));
            launcherOnly = string.Equals(Get(config, "LauncherOnly", "false"), "true", StringComparison.OrdinalIgnoreCase);
            motd = Get(config, "Motd", ""); // message of the day (host app Settings); empty sends nothing
            if (pluginKey == null || pluginKey.Length < 32)
            {
                pluginKey = null;
                Debug.LogWarning("[RustLegacyBrowser] PluginKeyHex in " + path + " is missing or shorter than 32 bytes; browser joins will be refused.");
            }
            if (!sidecarUrl.StartsWith("http://127.0.0.1:"))
            {
                pluginKey = null;
                Debug.LogWarning("[RustLegacyBrowser] SidecarUrl must be on 127.0.0.1; browser joins will be refused.");
            }
            if (pluginKey != null) pump.After(PollSeconds, PollCommands);
        }

        // One request every PollSeconds, re-armed after the reply so requests never pile up.
        static void PollCommands()
        {
            // Every connected player with server-side positions every poll (leases, player count, desktop admin list and movement checks).
            // Plus the evidence facts gathered since the last poll (RustLegacyBrowserVanilla.Evidence.cs).
            string body = "{\"type\":\"poll\",\"players\":" + ListPlayers() + TakeEvidence();
            Post(body, reply =>
            {
                JsonData list = reply != null && reply.IsObject && ((IDictionary)reply).Contains("commands") ? reply["commands"] : null;
                if (list != null && list.IsArray)
                    for (int i = 0; i < list.Count; i++)
                    {
                        JsonData command = list[i];
                        if (command == null || !command.IsObject) continue;
                        string id = Field(command, "id"), failure;
                        try { failure = RunCommand(command); }
                        catch (Exception e) { failure = "error"; Debug.LogWarning("[RustLegacyBrowser] Admin command " + id + " failed: " + e.Message); }
                        if (id != null)
                            Post("{\"type\":\"command-result\",\"id\":" + Str(id) + ",\"ok\":" + (failure == null ? "true" : "false") + ",\"reason\":" + (failure == null ? "null" : Str(failure)), null);
                    }
                pump.After(PollSeconds, PollCommands);
            });
        }

        static string ListPlayers()
        {
            var sb = new StringBuilder("[");
            int n = 0;
            foreach (PlayerClient client in PlayerClient.All)
            {
                NetUser user = client.netUser;
                // Every player, browser ones included: the sidecar keeps their leases by this list and the host counts players
                // from it (restart warnings); its desktop list and movement checks leave browser leases out themselves.
                if (user == null || n >= 500) continue;
                if (n++ > 0) sb.Append(',');
                sb.Append("{\"id\":").Append(Str(user.userID.ToString())).Append(",\"name\":").Append(Str(user.displayName ?? ""));
                // The native connection's address, for IP logging and IP bans on the website (browser players are skipped above).
                string ip = user.networkPlayer.externalIP;
                if (!string.IsNullOrEmpty(ip)) sb.Append(",\"ip\":").Append(Str(ip));
                Character character = client.controllable != null ? client.controllable.GetComponent<Character>() : null;
                if (character != null)
                {
                    Vector3 p = character.transform.position;
                    sb.Append(",\"pos\":[").Append(Num(p.x)).Append(',').Append(Num(p.y)).Append(',').Append(Num(p.z)).Append("],\"life\":").Append(Str(character.GetInstanceID().ToString()));
                }
                sb.Append('}');
            }
            return sb.Append(']').ToString();
        }

        // Same actions and APIs as the Oxide plugin's RunCommand; null on success or a short failure reason.
        static string RunCommand(JsonData command)
        {
            string action = Field(command, "action"), reason = Field(command, "reason") ?? "";
            if (action == "save" || action == "broadcast" || action == "quit") return RunServerCommand(action, Field(command, "message"));
            ulong targetId;
            if (!ulong.TryParse(Field(command, "targetId"), out targetId)) return "malformed";
            NetUser target = NetUser.FindByUserID(targetId);
            switch (action)
            {
                case "teleport-to":
                case "bring":
                {
                    ulong actorId;
                    if (!ulong.TryParse(Field(command, "actorId"), out actorId)) return "malformed";
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
                    Say(target, "Admin", Field(command, "message") ?? "");
                    return null;
                case "kick-native":
                    if (target == null) return "player-offline";
                    target.Kick(NetError.Facepunch_Kick_RCON, true);
                    Debug.Log("[RustLegacyBrowser] Kicked " + targetId + " for the website (" + reason + ")");
                    return null;
                case "ban-native":
                    BanList.Add(targetId, target != null ? target.displayName : "browser-account", reason);
                    BanList.Save();
                    if (target != null) target.Kick(NetError.Facepunch_Kick_RCON, true);
                    Debug.Log("[RustLegacyBrowser] Banned " + targetId + " for the website (" + reason + ")");
                    return null;
                case "unban-native":
                    bool removed = BanList.Remove(targetId);
                    BanList.Save();
                    return removed ? null : "not-banned";
                default:
                    return "unknown-action";
            }
        }

        // Server-wide actions from the host app, as in the Oxide plugin; a fixed list, never console text from outside.
        static string RunServerCommand(string action, string message)
        {
            switch (action)
            {
                case "save":
                    // The server's own save console command (ServerSaveManager): it logs " Saved N Object(s)", which the host
                    // waits for before it sends quit.
                    ConsoleSystem.Run("save.all", false);
                    return null;
                case "broadcast":
                    if (string.IsNullOrEmpty(message)) return "malformed";
                    // What chat.say sends to every client, from "Server".
                    ConsoleNetworker.Broadcast("chat.add " + Facepunch.Utility.String.QuoteSafe("Server") + " " + Facepunch.Utility.String.QuoteSafe(message));
                    return null;
                case "quit":
                    // A moment later, so this result reaches the sidecar first; the host ends the process if no exit comes.
                    Debug.Log("[RustLegacyBrowser] Quitting for the host app (the world was saved first)");
                    pump.After(1f, UnityEngine.Application.Quit);
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

        // Returns true when this login was taken over (approval answered or deferred); false leaves the native path.
        public static bool OnUserApprove(ClientConnection connection, uLink.NetworkPlayerApproval approval, ConnectionAcceptor acceptor)
        {
            Load(); // first, so LauncherOnly is known for native logins too
            if (!IsEnvelope(connection.SteamTicket))
            {
                if (!launcherOnly) return false;
                Debug.Log("[RustLegacyBrowser] Refused " + connection.UserID + ": LauncherOnly is on and the login did not come through the website.");
                return Deny(approval, NetError.Facepunch_Connector_AuthFailure);
            }
            if (pluginKey == null) return Deny(approval, NetError.Facepunch_Connector_Cancelled);
            if (Rust.Steam.Server.SteamGroup != 0) return Deny(approval, NetError.Facepunch_Whitelist_Failure);

            string id = Track(connection);
            browserConnections.Add(connection);
            acceptor.m_Connections.Add(connection); // reserves the UserID for IsConnected while we wait, as native auth does
            approval.Wait();
            string body = "{\"type\":\"approval\",\"connectionId\":" + Str(id) + ",\"claimedUserId\":" + Str(connection.UserID.ToString())
                + ",\"authBytes\":" + Str(Convert.ToBase64String(connection.SteamTicket));
            Post(body, reply =>
            {
                bool approved = reply != null && Bool(reply, "approved") && Field(reply, "backendId") == connection.UserID.ToString();
                if (approval.status == uLink.NetworkPlayerApprovalStatus.Denied) { Release(connection); return; }
                if (!approved)
                {
                    Debug.Log("[RustLegacyBrowser] Browser admission refused for " + connection.UserID + ": " + Field(reply, "reason"));
                    Release(connection);
                    approval.Deny((uLink.NetworkConnectionError)NetError.Facepunch_Connector_Cancelled);
                    return;
                }
                approval.localData = connection;
                approval.Approve(WorldInfo());
                pump.After(ConnectTimeoutSeconds, () => { if (connection.netUser == null && connectionIds.ContainsKey(connection)) Release(connection); });
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

        public static void OnPlayerConnected(uLink.NetworkPlayer player)
        {
            var netUser = player.GetLocalData() as NetUser;
            if (netUser == null) return; // the native method closed the connection
            Load();
            // Message of the day, to every player (browser, loader and native alike).
            if (motd.Length > 0) pump.After(MotdDelaySeconds, () => Say(netUser, "Server", motd));
            ClientConnection connection = netUser.connection;
            if (connection == null || browserConnections.Contains(connection)) return;
            if (pluginKey == null) return;
            // Native player that passed normal authentication: holds the identity lease and may request a link code.
            string id = Track(connection);
            Post("{\"type\":\"native-authenticated\",\"connectionId\":" + Str(id) + ",\"userId\":" + Str(netUser.userID.ToString()), null);
        }

        public static void OnPlayerDisconnected(uLink.NetworkPlayer player)
        {
            object data = player.GetLocalData();
            ClientConnection connection = data is NetUser ? ((NetUser)data).connection : data as ClientConnection;
            if (connection != null) Release(connection);
        }

        // chat.say entry: "/browserlink" is answered privately and not broadcast (the code must stay secret).
        public static bool OnChat(ref ConsoleSystem.Arg arg)
        {
            NetUser netUser = arg.argUser;
            if (netUser == null) return false;
            string text = arg.GetString(0, "").Trim();
            if (text.StartsWith("/report ", StringComparison.OrdinalIgnoreCase) || text.Equals("/report", StringComparison.OrdinalIgnoreCase)) { Load(); Report(netUser, text); return true; }
            if (!text.Equals("/browserlink", StringComparison.OrdinalIgnoreCase)) return false;
            Load();
            ClientConnection connection = netUser.connection;
            string id;
            if (pluginKey == null || connection == null || browserConnections.Contains(connection) || !connectionIds.TryGetValue(connection, out id))
            {
                Reply(netUser, "Browser linking is only available from the desktop game.");
                return true;
            }
            DateTime last;
            if (lastLinkRequest.TryGetValue(netUser.userID, out last) && (DateTime.UtcNow - last).TotalSeconds < LinkCooldownSeconds)
            {
                Reply(netUser, "Please wait before requesting another link code.");
                return true;
            }
            lastLinkRequest[netUser.userID] = DateTime.UtcNow;
            Post("{\"type\":\"link-challenge\",\"connectionId\":" + Str(id), reply =>
            {
                string code = Field(reply, "code");
                if (code == null) Reply(netUser, "This character cannot be linked right now.");
                else Reply(netUser, "Link code " + code + " - enter it on the website within 5 minutes. Never share it.");
            });
            return true;
        }

        // /report <exact name> <what happened>: sent to the server's website admins with the reporter's linked account.
        static void Report(NetUser netUser, string text)
        {
            string[] parts = text.Split(new[] { ' ' }, 3, StringSplitOptions.RemoveEmptyEntries);
            ClientConnection connection = netUser.connection;
            string id;
            if (parts.Length < 3 || pluginKey == null || connection == null || !connectionIds.TryGetValue(connection, out id))
            {
                Reply(netUser, "Usage: /report <player name> <what happened>");
                return;
            }
            string targetId = "null";
            foreach (PlayerClient client in PlayerClient.FindAllWithName(parts[1], StringComparison.OrdinalIgnoreCase))
            {
                NetUser user = client.netUser;
                if (user != null) { targetId = Str(user.userID.ToString()); break; }
            }
            Post("{\"type\":\"report\",\"connectionId\":" + Str(id) + ",\"targetName\":" + Str(parts[1]) + ",\"targetId\":" + targetId + ",\"text\":" + Str(parts[2]), reply =>
            {
                string failure = reply != null && Bool(reply, "ok") ? null : Field(reply, "reason");
                if (failure == null) Reply(netUser, "Report sent to the server admins. Thank you.");
                else if (failure == "not-linked") Reply(netUser, "Link this character on the website (/browserlink) to send reports.");
                else if (failure == "cooldown") Reply(netUser, "Please wait a minute between reports.");
                else Reply(netUser, "The report could not be sent right now.");
            });
        }

        static void Reply(NetUser netUser, string message) { Say(netUser, "Browser", message); }

        static void Say(NetUser netUser, string from, string message)
        {
            if (netUser.connected)
                ConsoleNetworker.SendClientCommand(netUser.networkPlayer, "chat.add " + Facepunch.Utility.String.QuoteSafe(from) + " " + Facepunch.Utility.String.QuoteSafe(message));
        }

        static string Track(ClientConnection connection)
        {
            string id;
            if (!connectionIds.TryGetValue(connection, out id))
            {
                id = Guid.NewGuid().ToString("N");
                connectionIds[connection] = id;
            }
            return id;
        }

        static void Release(ClientConnection connection)
        {
            string id;
            if (!connectionIds.TryGetValue(connection, out id)) return;
            connectionIds.Remove(connection);
            if (browserConnections.Remove(connection)) ConnectionAcceptor.CloseConnection(connection);
            Post("{\"type\":\"disconnect\",\"connectionId\":" + Str(id), null);
        }

        static bool Deny(uLink.NetworkPlayerApproval approval, NetError error)
        {
            approval.Deny((uLink.NetworkConnectionError)error);
            return true;
        }

        // `body` is an unterminated JSON object. Requests go out one at a time, in the order they were posted: the
        // sidecar refuses a seq at or below the last one it saw, so two requests in flight at once could overtake each
        // other and the later-numbered one would be refused. seq/ts/MAC are stamped by the sender as each one goes out.
        static void Post(string body, Action<JsonData> callback)
        {
            lock (outgoing)
            {
                if (outgoing.Count >= MaxQueuedRequests) { if (callback != null) pump.Enqueue(() => callback(null)); return; }
                outgoing.Enqueue(new KeyValuePair<string, Action<JsonData>>(body, callback));
                if (sending) return;
                sending = true;
            }
            ThreadPool.QueueUserWorkItem(_ => SendQueued());
        }

        // The only sender: each request waits for the previous reply (or its timeout); callbacks run on the main thread.
        static void SendQueued()
        {
            while (true)
            {
                KeyValuePair<string, Action<JsonData>> next;
                lock (outgoing)
                {
                    if (outgoing.Count == 0) { sending = false; return; }
                    next = outgoing.Dequeue();
                }
                JsonData reply = Send(next.Key);
                Action<JsonData> callback = next.Value;
                if (callback != null) pump.Enqueue(() => callback(reply));
            }
        }

        // boot/seq/ts are appended and the raw text is MACed as the sidecar expects. Blocks until the reply.
        static JsonData Send(string body)
        {
            long ts = (long)(DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
            string raw = body + ",\"boot\":" + Str(boot) + ",\"seq\":" + (++seq) + ",\"ts\":" + ts + "}";
            try
            {
                var request = (HttpWebRequest)WebRequest.Create(sidecarUrl);
                request.Method = "POST";
                request.ContentType = "application/json";
                request.Headers["x-rlb-mac"] = Mac(pluginKey, raw);
                request.Timeout = request.ReadWriteTimeout = (int)(RequestTimeoutSeconds * 1000);
                request.Proxy = null;
                byte[] bytes = Encoding.UTF8.GetBytes(raw);
                request.ContentLength = bytes.Length;
                using (Stream s = request.GetRequestStream()) s.Write(bytes, 0, bytes.Length);
                using (var response = (HttpWebResponse)request.GetResponse())
                using (var reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
                    return response.StatusCode == HttpStatusCode.OK ? JsonMapper.ToObject(reader.ReadToEnd()) : null;
            }
            catch (Exception) { return null; }
        }

        public static string Mac(byte[] key, string raw)
        {
            using (var hmac = new HMACSHA256(key))
            {
                string b64 = Convert.ToBase64String(hmac.ComputeHash(Encoding.UTF8.GetBytes(raw)));
                return b64.TrimEnd('=').Replace('+', '-').Replace('/', '_');
            }
        }

        static string Num(float v)
        {
            return float.IsNaN(v) || float.IsInfinity(v) ? "0" : v.ToString("R", System.Globalization.CultureInfo.InvariantCulture);
        }

        static string Str(string s)
        {
            var sb = new StringBuilder("\"");
            foreach (char c in s)
            {
                if (c == '"' || c == '\\') sb.Append('\\').Append(c);
                else if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
                else sb.Append(c);
            }
            return sb.Append('"').ToString();
        }

        static bool Bool(JsonData reply, string key)
        {
            return reply.IsObject && ((IDictionary)reply).Contains(key) && reply[key] != null && reply[key].IsBoolean && (bool)reply[key];
        }

        static string Field(JsonData reply, string key)
        {
            if (reply == null || !reply.IsObject || !((IDictionary)reply).Contains(key) || reply[key] == null) return null;
            JsonData v = reply[key];
            return v.IsString ? (string)v : v.ToJson();
        }

        static Dictionary<string, string> ReadConfig(string path)
        {
            var values = new Dictionary<string, string>();
            if (!File.Exists(path))
            {
                Directory.CreateDirectory(Path.GetDirectoryName(path));
                File.WriteAllText(path, "# Rust Legacy browser adapter\nSidecarUrl=http://127.0.0.1:28090/plugin\nPluginKeyHex=\nLauncherOnly=false\nMotd=\n");
                return values;
            }
            foreach (string line in File.ReadAllLines(path))
            {
                string t = line.Trim();
                int eq = t.IndexOf('=');
                if (t.Length == 0 || t[0] == '#' || eq < 1) continue;
                values[t.Substring(0, eq).Trim()] = t.Substring(eq + 1).Trim();
            }
            return values;
        }

        static string Get(Dictionary<string, string> c, string key, string def)
        {
            string v;
            return c.TryGetValue(key, out v) && v.Length > 0 ? v : def;
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

    // Runs HTTP callbacks and timers on Unity's main thread.
    public class Pump : MonoBehaviour
    {
        readonly Queue<Action> queue = new Queue<Action>();
        readonly List<KeyValuePair<float, Action>> timers = new List<KeyValuePair<float, Action>>();

        public void Enqueue(Action action) { lock (queue) queue.Enqueue(action); }
        public void After(float seconds, Action action) { timers.Add(new KeyValuePair<float, Action>(Time.realtimeSinceStartup + seconds, action)); }

        void Update()
        {
            while (true)
            {
                Action next;
                lock (queue)
                {
                    if (queue.Count == 0) break;
                    next = queue.Dequeue();
                }
                Run(next);
            }
            float now = Time.realtimeSinceStartup;
            for (int i = timers.Count - 1; i >= 0; i--)
                if (timers[i].Key <= now) { Action a = timers[i].Value; timers.RemoveAt(i); Run(a); }
        }

        static void Run(Action action)
        {
            try { action(); }
            catch (Exception e) { Debug.LogException(e); }
        }
    }
}
