// Crafts a fake approval.loginData the same way the real ClientConnection.ReadConnectionData reads one, invokes
// ConnectionAcceptor.uLink_OnPlayerApproval (whatever is on disk right now: unpatched or patched by
// tools/vanilla-patcher, stock-shaped or Fougerite-shaped), and reports what happened as one line of JSON.
// args[0]: "true"/"false" for Hooks.ReturnValue (does the hook take the login over, or let the original continue).
using System.Text;
using System.Text.Json;
using uLink;

RustLegacyBrowser.Hooks.ReturnValue = args.Length > 0 && args[0] == "true";

const ulong userId = 76561197960287930UL;
const string userName = "tester";
byte[] ticket = { 0x52, 0x4C, 0x42, 0x41, 1, 2, 3 }; // "RLBA" + extra, matching the real envelope magic

var body = new List<byte>();
body.AddRange(BitConverter.GetBytes(1069));            // Protocol
body.Add(2);                                            // ConnectionMode (2 = the branch that reads UserID/UserName/SteamTicket)
body.AddRange(BitConverter.GetBytes(userId));
var nameBytes = Encoding.UTF8.GetBytes(userName);
body.AddRange(BitConverter.GetBytes(nameBytes.Length)); body.AddRange(nameBytes);
body.AddRange(BitConverter.GetBytes(ticket.Length)); body.AddRange(ticket);

var approval = new NetworkPlayerApproval(new BitStream(body.ToArray(), false));
var acceptor = new ConnectionAcceptor();
acceptor.uLink_OnPlayerApproval(approval);

var call = RustLegacyBrowser.Hooks.LastCall;
var result = new Dictionary<string, object> {
    ["hookCalled"] = call != null,
    ["protocol"] = call?.Protocol,
    ["connectionMode"] = call?.ConnectionMode,
    ["userId"] = call?.UserID.ToString(),
    ["userName"] = call?.UserName,
    ["steamTicketHex"] = call?.SteamTicket is byte[] t ? Convert.ToHexString(t) : null,
    ["connectionsAfter"] = acceptor.m_Connections.Count,
};
Console.WriteLine(JsonSerializer.Serialize(result));
