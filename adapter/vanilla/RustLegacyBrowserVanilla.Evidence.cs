// Server-side evidence for the sidecar (ANTICHEAT-ADMIN-PLAN.md slice 8): item moves between players and containers
// (item-transfer events, inventory spam) and desktop combat facts (fire times, bullet hits with the server's own line of
// sight). Reached through calls tools/vanilla-patcher injects into the server's own methods:
//   Inventory.ITMV / ITMG                    → OnSlotMoveBefore at entry, OnSlotMoveAfter before every return
//   Inventory.ISMV / ITSM / ITSP             → OnSlotOp at entry (counted only)
//   DropHelper.DropItem(inv, slot, out pickup) → OnDropItemAfter before every return
//   DropHelper.DropInventoryContents(inv, out to) → OnDeathDropBefore at entry, OnDeathDropAfter before every return
//   ItemPickup.PlayerUse                     → OnPickupBefore at entry, OnPickupAfter before every return
//   Bullet/Shotgun/Melee/BowWeaponDataBlock.DoAction1 → OnWeaponAction at entry (arrival time of every attack)
//   BulletWeaponDataBlock.ApplyDamage        → OnBulletHit at entry (after the server's own validation)
// Facts only: every rule (provenance, transfers, rates, ranges) runs in the sidecar (bridge/item-transfers.mjs,
// bridge/desktop-combat.mjs), which is unit-tested. Hooks never change what the server does and swallow their own errors.
// Type-checked against the server's own assemblies; NOT yet run on a server.
using System;
using System.Collections.Generic;
using System.Text;
using UnityEngine;

namespace RustLegacyBrowser
{
    public static partial class Hooks
    {
        // BulletWeaponDataBlock hit mask (layers 0 4 10 12 17-21 27 28), as the client's bullets use it.
        const int BulletMask = 406721553;
        const int MaxMoves = 300, MaxHits = 500, MaxOps = 500; // shots: 200 weapon entries × 64 times
        static readonly List<string> moves = new List<string>();
        static readonly List<string> hits = new List<string>();
        static readonly Dictionary<string, List<long>> shots = new Dictionary<string, List<long>>(); // "user|uid|name|rate" → arrival, ms since server start
        static readonly Dictionary<string, int> ops = new Dictionary<string, int>(); // user → inventory slot operations
        static int lost; // facts dropped because a buffer was full
        static float windowStart = -1f;

        struct PendingMove
        {
            public bool active;
            public Inventory from, to;
            public int fromSlot, toSlot, uses;
            public IInventoryItem item;
            public string looter, name;
            public bool splittable;
        }
        static PendingMove move, pickup;
        static string deathOwner, deathKind;

        // ---- poll body: facts gathered since the last poll ----
        static string TakeEvidence()
        {
            var sb = new StringBuilder();
            if (moves.Count > 0) sb.Append(",\"moves\":[").Append(string.Join(",", moves.ToArray())).Append(']');
            if (hits.Count > 0) sb.Append(",\"hits\":[").Append(string.Join(",", hits.ToArray())).Append(']');
            if (shots.Count > 0)
            {
                sb.Append(",\"shots\":[");
                int n = 0;
                foreach (KeyValuePair<string, List<long>> s in shots)
                {
                    string[] k = s.Key.Split('|');
                    if (n++ > 0) sb.Append(',');
                    sb.Append("{\"id\":").Append(Str(k[0])).Append(",\"uid\":").Append(k[1]).Append(",\"name\":").Append(Str(k[2])).Append(",\"rate\":").Append(k[3]).Append(",\"t\":[");
                    for (int i = 0; i < s.Value.Count; i++) { if (i > 0) sb.Append(','); sb.Append(s.Value[i]); }
                    sb.Append("]}");
                }
                sb.Append(']');
            }
            if (ops.Count > 0)
            {
                sb.Append(",\"ops\":{");
                int n = 0;
                foreach (KeyValuePair<string, int> o in ops) { if (n++ > 0) sb.Append(','); sb.Append(Str(o.Key)).Append(':').Append(o.Value); }
                sb.Append('}');
            }
            if (lost > 0) sb.Append(",\"lost\":").Append(lost);
            if (windowStart >= 0f) sb.Append(",\"window\":").Append(Num(Time.realtimeSinceStartup - windowStart));
            moves.Clear(); hits.Clear(); shots.Clear(); ops.Clear(); lost = 0;
            windowStart = Time.realtimeSinceStartup;
            return sb.ToString();
        }

        static bool Collecting { get { return loaded && pluginKey != null; } }

        static void Add(List<string> list, int max, string fact)
        {
            if (list.Count >= max) { lost++; return; }
            list.Add(fact);
        }

        // ---- inventories ----
        // The player behind an inventory: a live character's NetUser, or a sleeper's creator. Containers have none.
        static string OwnerOf(Inventory inventory, out string kind)
        {
            kind = "container";
            if (!inventory) return null;
            IDMain main = inventory.idMain;
            Character character = main as Character;
            if (character != null)
            {
                NetUser user = character.netUser;
                if (user == null) return null;
                kind = "player";
                return user.userID.ToString();
            }
            SleepingAvatar sleeper = main as SleepingAvatar;
            if (sleeper != null && sleeper.creatorID != 0) { kind = "sleeper"; return sleeper.creatorID.ToString(); }
            return null;
        }

        static string Side(Inventory inventory)
        {
            string kind, owner = OwnerOf(inventory, out kind);
            return "{\"inv\":" + Str(inventory.GetInstanceID().ToString()) + ",\"kind\":" + Str(kind) + (owner != null ? ",\"owner\":" + Str(owner) : "") + "}";
        }

        static string UserOf(uLink.NetworkPlayer player)
        {
            NetUser user = NetUser.Find(player);
            return user != null ? user.userID.ToString() : null;
        }

        static void Count(string user)
        {
            if (user == null) return;
            int n;
            if (ops.TryGetValue(user, out n)) ops[user] = n + 1;
            else if (ops.Count < MaxOps) ops[user] = 1;
        }

        public static void OnSlotOp(uLink.NetworkMessageInfo info)
        {
            try { if (Collecting && info != null) Count(UserOf(info.sender)); }
            catch (Exception) { }
        }

        public static void OnSlotMoveBefore(Inventory from, NetEntityID toInvID, byte fromSlot, byte toSlot, uLink.NetworkMessageInfo info)
        {
            move.active = false;
            try
            {
                if (!Collecting || !from || info == null) return;
                string looter = UserOf(info.sender);
                Count(looter);
                Inventory to = toInvID.GetComponent<Inventory>();
                IInventoryItem item;
                if (!to || to == from || looter == null || !from.GetItem(fromSlot, out item) || item == null) return;
                move = new PendingMove { active = true, from = from, to = to, fromSlot = fromSlot, toSlot = toSlot, item = item, uses = item.uses, looter = looter, name = item.datablock.name, splittable = item.datablock.IsSplittable() };
            }
            catch (Exception) { move.active = false; }
        }

        // What left the source slot: all of it (moved, or stacked completely) or part of a stack.
        static int Moved(Inventory from, int slot, IInventoryItem before, int usesBefore, bool splittable)
        {
            IInventoryItem now;
            bool same = from && from.GetItem(slot, out now) && object.ReferenceEquals(now, before);
            int left = same ? before.uses : 0;
            if (same && left >= usesBefore) return 0;
            return splittable ? usesBefore - left : 1;
        }

        public static void OnSlotMoveAfter(Inventory from)
        {
            if (!move.active) return;
            PendingMove m = move;
            move.active = false;
            try
            {
                int amount = Moved(m.from, m.fromSlot, m.item, m.uses, m.splittable);
                if (amount <= 0 || !m.to) return;
                Add(moves, MaxMoves, "{\"looter\":" + Str(m.looter) + ",\"src\":" + Side(m.from) + ",\"srcSlot\":" + m.fromSlot + ",\"dst\":" + Side(m.to) + ",\"dstSlot\":" + m.toSlot
                    + ",\"item\":" + Str(m.name) + ",\"amount\":" + amount + ",\"via\":\"loot\"}");
            }
            catch (Exception) { }
        }

        // A dropped item (ItemPickup) and a death sack start out stamped with the player they came from.
        static void Dropped(Inventory inventory, string owner, string kind, string via)
        {
            if (!inventory || owner == null) return;
            var sb = new StringBuilder();
            int n = 0;
            for (int slot = 0; slot < inventory.slotCount && n < 64; slot++)
            {
                IInventoryItem item;
                if (!inventory.GetItem(slot, out item) || item == null) continue;
                if (n++ > 0) sb.Append(',');
                sb.Append("{\"slot\":").Append(slot).Append(",\"item\":").Append(Str(item.datablock.name)).Append(",\"amount\":").Append(item.datablock.IsSplittable() ? item.uses : 1).Append('}');
            }
            if (n == 0) return;
            Add(moves, MaxMoves, "{\"drop\":" + Str(via) + ",\"owner\":" + Str(owner) + ",\"kind\":" + Str(kind) + ",\"inv\":" + Str(inventory.GetInstanceID().ToString()) + ",\"items\":[" + sb + "]}");
        }

        public static void OnDropItemAfter(Inventory inventory, ItemPickup dropped)
        {
            try
            {
                if (!Collecting || !dropped) return;
                string kind, owner = OwnerOf(inventory, out kind);
                Dropped(dropped.GetLocal<Inventory>(), owner, kind, "drop");
            }
            catch (Exception) { }
        }

        public static void OnDeathDropBefore(Inventory inventory)
        {
            deathOwner = null;
            try { if (Collecting) deathOwner = OwnerOf(inventory, out deathKind); }
            catch (Exception) { deathOwner = null; }
        }

        public static void OnDeathDropAfter(Inventory droppedTo)
        {
            string owner = deathOwner;
            deathOwner = null;
            try { if (Collecting && owner != null) Dropped(droppedTo, owner, deathKind, "corpse"); }
            catch (Exception) { }
        }

        public static void OnPickupBefore(ItemPickup itemPickup, Controllable controllable)
        {
            pickup.active = false;
            try
            {
                if (!Collecting || !itemPickup || !controllable) return;
                Inventory from = itemPickup.GetLocal<Inventory>(), to = controllable.GetLocal<Inventory>();
                PlayerClient client = controllable.playerClient;
                IInventoryItem item = from ? from.firstItem : null;
                if (!to || item == null || client == null || client.netUser == null) return;
                pickup = new PendingMove { active = true, from = from, to = to, fromSlot = item.slot, toSlot = -1, item = item, uses = item.uses, looter = client.netUser.userID.ToString(), name = item.datablock.name, splittable = item.datablock.IsSplittable() };
            }
            catch (Exception) { pickup.active = false; }
        }

        public static void OnPickupAfter(ItemPickup itemPickup)
        {
            if (!pickup.active) return;
            PendingMove m = pickup;
            pickup.active = false;
            try
            {
                int amount = Moved(m.from, m.fromSlot, m.item, m.uses, m.splittable);
                if (amount <= 0 || !m.to) return;
                // The pickup object is destroyed after a full pickup; its inventory key was taken before.
                Add(moves, MaxMoves, "{\"looter\":" + Str(m.looter) + ",\"src\":{\"inv\":" + Str(m.from.GetInstanceID().ToString()) + ",\"kind\":\"container\"},\"srcSlot\":" + m.fromSlot
                    + ",\"dst\":" + Side(m.to) + ",\"dstSlot\":-1,\"item\":" + Str(m.name) + ",\"amount\":" + amount + ",\"via\":\"pickup\"}");
            }
            catch (Exception) { }
        }

        // ---- combat (desktop players; the gateway already checks browser sessions) ----
        static NetUser ShooterOf(ItemRepresentation rep, out Character character)
        {
            character = null;
            IHeldItem held;
            if (!rep || !rep.Item<IHeldItem>(out held) || held == null || !held.inventory) return null;
            character = held.inventory.idMain as Character;
            NetUser user = character != null ? character.netUser : null;
            if (user == null || (user.connection != null && browserConnections.Contains(user.connection))) return null;
            return user;
        }

        public static void OnWeaponAction(WeaponDataBlock block, ItemRepresentation rep)
        {
            try
            {
                if (!Collecting || block == null) return;
                Character character;
                NetUser user = ShooterOf(rep, out character);
                if (user == null) return;
                string key = user.userID + "|" + block.uniqueID + "|" + block.name.Replace('|', ' ') + "|" + Num(block.fireRate);
                List<long> list;
                if (!shots.TryGetValue(key, out list))
                {
                    if (shots.Count >= 200) { lost++; return; }
                    shots[key] = list = new List<long>();
                }
                if (list.Count >= 64) { lost++; return; }
                list.Add((long)(Time.realtimeSinceStartup * 1000.0));
            }
            catch (Exception) { }
        }

        // One fact per bullet that the server is about to apply damage for (shotgun pellets on one target in one frame
        // share one). Sight: eye → each target point with RaycastAll on the bullet mask, ignoring triggers, the shooter, the
        // target and any other character (they move; the shooter saw them later or earlier).
        static int lastHitFrame = -1;
        static IDMain lastHitTarget;

        public static void OnBulletHit(BulletWeaponDataBlock block, GameObject hitObj, Vector3 endPos, BodyPart bodyPart, ItemRepresentation rep)
        {
            try
            {
                if (!Collecting || block == null || !hitObj) return;
                Character shooter;
                NetUser user = ShooterOf(rep, out shooter);
                if (user == null || shooter == null) return;
                IDMain target = IDBase.GetMain(hitObj);
                if (target == null || target == shooter) return;
                string kind, targetId = null;
                Character victim = target as Character;
                SleepingAvatar sleeper = target as SleepingAvatar;
                if (victim != null && victim.playerControlled) { kind = "player"; NetUser v = victim.netUser; if (v != null) targetId = v.userID.ToString(); }
                else if (victim != null) kind = "animal";
                else if (sleeper != null) { kind = "sleeper"; targetId = sleeper.creatorID.ToString(); }
                else return; // structures, deployables, resources: no sight or range rule
                if (Time.frameCount == lastHitFrame && target == lastHitTarget) return;
                lastHitFrame = Time.frameCount; lastHitTarget = target;
                Vector3 eye = shooter.eyesOrigin, root = target.transform.position;
                var points = new List<Vector3>();
                if ((endPos - root).sqrMagnitude <= 2.5f * 2.5f) points.Add(endPos);
                if (kind == "animal") points.Add(root + new Vector3(0f, 0.6f, 0f));
                else { points.Add(root + new Vector3(0f, 1f, 0f)); points.Add(root + new Vector3(0f, 1.6f, 0f)); points.Add(root + new Vector3(0f, 0.3f, 0f)); }
                RaycastHit blocker = new RaycastHit();
                bool clear = false, any = false;
                foreach (Vector3 point in points)
                {
                    RaycastHit hit;
                    if (!Blocked(eye, point, shooter, target, out hit)) { clear = true; break; }
                    if (!any) { blocker = hit; any = true; }
                }
                var sb = new StringBuilder("{\"id\":").Append(Str(user.userID.ToString())).Append(",\"uid\":").Append(block.uniqueID).Append(",\"name\":").Append(Str(block.name))
                    .Append(",\"range\":").Append(Num(block.GetBulletRange(rep))).Append(",\"kind\":").Append(Str(kind));
                if (targetId != null) sb.Append(",\"target\":").Append(Str(targetId));
                sb.Append(",\"part\":").Append((int)bodyPart).Append(",\"eye\":").Append(Vec(eye)).Append(",\"at\":").Append(Vec(root)).Append(",\"end\":").Append(Vec(endPos))
                    .Append(",\"clear\":").Append(clear ? "true" : "false");
                if (!clear && any)
                    sb.Append(",\"blockedBy\":").Append(Str(blocker.collider ? blocker.collider.name : "")).Append(",\"layer\":").Append(blocker.collider ? blocker.collider.gameObject.layer : -1)
                        .Append(",\"blockedAt\":").Append(Vec(blocker.point));
                Add(hits, MaxHits, sb.Append('}').ToString());
            }
            catch (Exception) { }
        }

        static bool Blocked(Vector3 from, Vector3 to, IDMain shooter, IDMain target, out RaycastHit first)
        {
            first = new RaycastHit();
            Vector3 d = to - from;
            float length = d.magnitude - 0.3f;
            if (length <= 0.05f) return false;
            RaycastHit[] all = Physics.RaycastAll(from, d.normalized, length, BulletMask);
            bool found = false;
            foreach (RaycastHit h in all)
            {
                if (!h.collider || h.collider.isTrigger || h.distance < 0.05f) continue;
                IDMain main = IDBase.GetMain(h.collider.gameObject);
                if (main != null && (main == shooter || main == target || main is Character)) continue;
                if (!found || h.distance < first.distance) { first = h; found = true; }
            }
            return found;
        }

        static string Vec(Vector3 v) { return "[" + Num(v.x) + "," + Num(v.y) + "," + Num(v.z) + "]"; }
    }
}
