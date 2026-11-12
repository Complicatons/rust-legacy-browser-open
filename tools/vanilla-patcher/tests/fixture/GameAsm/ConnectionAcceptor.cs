// A reduced stand-in for ConnectionAcceptor (analysis/decompiled/server/Assembly-CSharp/ConnectionAcceptor.cs).
// uLink_OnPlayerApproval has two bodies behind a build-time flag (FOUGERITE_SHAPE): the stock one still does its own
// ReadConnectionData-style parse and the real m_Connections.Add pattern (unused by the fix now, but kept for
// realism), the Fougerite one is the real 4-instruction shape that delegates the whole decision to its own
// framework, with nothing left for the old pattern-match to find. The admission-hook fix no longer cares which
// shape this method has: it reads its own independent copy of approval.loginData before either body runs at all.
using System.Collections.Generic;
using uLink;

public class ConnectionAcceptor {
    public List<ClientConnection> m_Connections = new();
    public static int MaxPlayers = 100;

    public bool IsConnected(ulong userID) { foreach (var c in m_Connections) if (c.UserID == userID) return true; return false; }

    public void uLink_OnPlayerApproval(NetworkPlayerApproval approval) {
#if FOUGERITE_SHAPE
        FougeriteHooks.PlayerApproval(approval);
#else
        if (m_Connections.Count >= MaxPlayers) { return; }
        var connection = new ClientConnection();
        connection.Protocol = approval.loginData.ReadInt32();
        connection.ConnectionMode = approval.loginData.ReadByte();
        if (connection.ConnectionMode != 2) { return; }
        connection.UserID = approval.loginData.ReadUInt64();
        connection.UserName = approval.loginData.ReadString();
        connection.SteamTicket = approval.loginData.ReadBytes();
        if (IsConnected(connection.UserID)) { return; }
        m_Connections.Add(connection);
#endif
    }

    public void uLink_OnPlayerConnected(NetworkPlayer player) {
        return;
    }

    public void uLink_OnPlayerDisconnected(NetworkPlayer player) {
    }
}

// Stands in for Fougerite's own framework (Fougerite.Hooks.PlayerApproval): never touched by the fix, which reads
// its own copy of approval.loginData before this ever runs.
public static class FougeriteHooks {
    public static void PlayerApproval(NetworkPlayerApproval approval) { }
}
