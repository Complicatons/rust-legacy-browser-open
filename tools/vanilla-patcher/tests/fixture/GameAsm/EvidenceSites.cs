// Stand-ins for the remaining evidence-hook sites' types (analysis/decompiled/server/Assembly-CSharp), matching
// only the exact member signatures tools/vanilla-patcher's Exact() lookups need. Never touched by the
// admission-hook fix; exist only so the fixture exercises the same 21-site Plan() as the real assembly.
public struct NetEntityID { }
public class ItemRepresentation { }
public class Controllable { }
public enum BodyPart { Body }

public class Inventory {
    public void ITMV(NetEntityID id, byte fromSlot, byte toSlot, uLink.NetworkMessageInfo info) { }
    public void ITMG(NetEntityID id, byte fromSlot, byte toSlot, bool split, uLink.NetworkMessageInfo info) { }
    public void ISMV(byte fromSlot, byte toSlot, uLink.NetworkMessageInfo info) { }
    public void ITSM(byte fromSlot, byte toSlot, bool split, uLink.NetworkMessageInfo info) { }
    public void ITSP(byte fromSlot, uLink.NetworkMessageInfo info) { }
}

public static class DropHelper {
    public static void DropItem(Inventory inv, int slot, out ItemPickup pickup) { pickup = null; }
    public static void DropInventoryContents(Inventory inv, out Inventory droppedTo) { droppedTo = null; }
}

public class ItemPickup {
    public void PlayerUse(Controllable controllable) { }
}

// Mono.Cecil's TypeDefinition.Methods lists only directly-declared methods, same as the real game: each weapon
// type declares its own DoAction1 (not just inherited), so Exact()'s per-type lookup finds it on every one.
public class WeaponDataBlock { }
public class BulletWeaponDataBlock : WeaponDataBlock {
    public void DoAction1(uLink.BitStream stream, ItemRepresentation rep, out uLink.NetworkMessageInfo info) { info = default; }
    public void ApplyDamage(UnityEngine.GameObject hitObj, UnityEngine.Transform fromTransform, bool isHeadshot, UnityEngine.Vector3 endPos, BodyPart bodyPart, ItemRepresentation rep) { }
}
public class ShotgunDataBlock : WeaponDataBlock { public void DoAction1(uLink.BitStream stream, ItemRepresentation rep, out uLink.NetworkMessageInfo info) { info = default; } }
public class MeleeWeaponDataBlock : WeaponDataBlock { public void DoAction1(uLink.BitStream stream, ItemRepresentation rep, out uLink.NetworkMessageInfo info) { info = default; } }
public class BowWeaponDataBlock : WeaponDataBlock { public void DoAction1(uLink.BitStream stream, ItemRepresentation rep, out uLink.NetworkMessageInfo info) { info = default; } }
