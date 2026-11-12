// Minimal stand-ins for the other uLink types the patched sites' signatures reference. None of their members are
// touched by the admission-hook fix itself; they only need to exist so Mono.Cecil can resolve the parameter types.
namespace uLink;

public class NetworkPlayerApproval {
    public readonly BitStream loginData;
    public NetworkPlayerApproval(BitStream loginData) { this.loginData = loginData; }
}

public class NetworkPlayer { }

public struct NetworkMessageInfo { }
