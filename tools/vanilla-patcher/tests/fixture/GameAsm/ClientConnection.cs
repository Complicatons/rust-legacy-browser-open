// Field-for-field match of the real ClientConnection (analysis/decompiled/server/Assembly-CSharp/ClientConnection.cs):
// only the fields ReadConnectionData sets, which is exactly what the admission-hook fix's injected IL also sets.
public class ClientConnection {
    public int Protocol;
    public int ConnectionMode;
    public ulong UserID;
    public string UserName;
    public byte[] SteamTicket;
}
