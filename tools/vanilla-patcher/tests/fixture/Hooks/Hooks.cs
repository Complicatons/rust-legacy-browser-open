// Stand-in for RustLegacyBrowser.Hooks (adapter/vanilla): records each call instead of doing anything real, so the
// driver can check the admission-hook fix built a ClientConnection with the right fields from its own independent
// read of approval.loginData. ReturnValue controls both tested paths: false lets the original method body continue
// (proving it still works unaffected), true takes the login over (proving the early return skips it).
namespace RustLegacyBrowser;

public static class Hooks {
    public static bool ReturnValue;
    public static ClientConnection LastCall;

    public static bool OnUserApprove(ClientConnection connection, uLink.NetworkPlayerApproval approval, ConnectionAcceptor acceptor) {
        LastCall = connection;
        return ReturnValue;
    }

    public static void OnPlayerConnected(uLink.NetworkPlayer player) { }
    public static void OnPlayerDisconnected(uLink.NetworkPlayer player) { }
    public static bool OnChat(ref ConsoleSystem.Arg arg) => false;

    public static void OnSlotMoveBefore(Inventory from, NetEntityID toInvID, byte fromSlot, byte toSlot, uLink.NetworkMessageInfo info) { }
    public static void OnSlotMoveAfter(Inventory from) { }
    public static void OnSlotOp(uLink.NetworkMessageInfo info) { }
    public static void OnDropItemAfter(Inventory inventory, ItemPickup dropped) { }
    public static void OnDeathDropBefore(Inventory inventory) { }
    public static void OnDeathDropAfter(Inventory droppedTo) { }
    public static void OnPickupBefore(ItemPickup itemPickup, Controllable controllable) { }
    public static void OnPickupAfter(ItemPickup itemPickup) { }
    public static void OnWeaponAction(WeaponDataBlock block, ItemRepresentation rep) { }
    public static void OnBulletHit(BulletWeaponDataBlock block, UnityEngine.GameObject hitObj, UnityEngine.Vector3 endPos, BodyPart bodyPart, ItemRepresentation rep) { }
}
