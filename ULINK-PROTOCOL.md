# uLink 1.5.6 wire protocol (static reconstruction, in progress)

Private working notes for the gateway's native session engine (decision document step 3, "protocol fixtures"). Started 17 October 2026 in a cloud session.

**Source.** The server's `uLink.dll` (`analysis/server-audit/rust_server_Data/Managed/uLink.dll`, SHA-256 `5b0539b3…bdd`, byte-identical to the Oxide reference copy) and the client's (`b9aea75b…8120`), both decompiled statically with ilspycmd 8.2 into ignored `analysis/decompiled/{server,client}/uLink/`. Internal identifiers are obfuscated. `tools/shorten-obfuscated.py` rewrites them to stable short names (`O<n>`) in `analysis/decompiled/*/uLink-short/`, with `name-map.json` mapping back. File and identifier names below are those short names: re-run the tool to reproduce them; the order is deterministic. Nothing was loaded or executed, and no packet has been captured. Every statement here comes from code reading and still needs fixture tests and, eventually, an authorised trace.

## Verified against the original server (2026-10-21)

The first browser join to the original `rust_server.exe` (Azure test VM, firewall-locked, run by the owner) found three places where this reconstruction differed from the real server. All three are fixed in `bridge/ulink/` and pinned by tests; with them a browser player spawns (`ServerManagement` → `:client` → ready → `:player_soldier`).

1. **Sequence numbers start at the handshake nonces, not 0** (`O104`). Each connection draws its nonce with `Random.O1768(0, 65534)` (0..65533). Every send sequence starts at the *local* nonce (`O2111`: `O2094[i] = O1871`) and every expected receive sequence at the *remote* nonce (`O2110`: `O2097[j] = O2095[l] = O1873`), reset when the remote nonce becomes known (server: on Connect; client: on ConnectResponse). A login sent with sequence 0 is acknowledged and then dropped as old, so the server never answers it.
2. **`BufferedRPCs` (3)** carries a newly connected player's buffered Instantiates and RPCs (`O1629.O3095`, sent right after approval; ServerManagement is one of them, instantiated with `NetCull.InstantiateClassic` in `ServerInit.uLink_OnServerInitialized`). Body (`BitStream.O3122`/`O599`): `varuint count`, then `count ×` (`varuint byteLength` + a complete uLink message, header included). The client handles each as if it had arrived on its own (`O2898.O598`).
3. **`Create` initial data is the rest of the message**, not a length-prefixed blob (`O490.O591` passes `O499` itself). ServerManagement's Create ends right after its three prefab strings; `:client` carries 19 bytes of instantiate arguments. Server-owned views come from the top of the range (ServerManagement 61177).

## Layering

uLink's transport is a modified **Lidgren.Network gen2**: enum member names survived obfuscation and match gen2. On top of it, uLink adds its own message header, typed serialisation, RPCs and state sync.

| Layer | Short names | Role |
| --- | --- | --- |
| UDP socket | `O0` (abstract peer), `O391` (server peer), `O1629` (client peer) | One `Socket(InterNetwork, Dgram, Udp)`, several messages per datagram |
| Lidgren connection | `O109` | Handshake, ping/pong, acks, resends, disconnect |
| Bit buffer | `O13` | Lidgren `NetBuffer`: bit-packed, LSB first (`O579` bit writer) |
| Lidgren message | `O11` incoming, `O60` outgoing | Header below |
| uLink message | `O575` | uLink header, internal types `O575.O551`, RPCs |
| uLink peer | `O1947` (client), `O1523` (base) | Connect flow, login data, approval |

## Lidgren message framing

A datagram holds consecutive messages. `O11.O118` reads each one:

| Field | Encoding | Notes |
| --- | --- | --- |
| padding | zero bytes | Skipped until a non-zero byte |
| kind/channel | 1 byte | `kind = b & 7` (`O135`), `channel = b >> 3` (`O155`) |
| sequence | uint16 (16 bits) | `O13.O673` |
| length | 7-bit varint, bytes | `O13.O688`; rejects >35 bits; message dropped if longer than the remainder |
| payload | `length` bytes | |

- `O135` kinds: `None 0, User 1, UserFragmented 2, Acknowledge 3, AckBitVector 4, OutOfBand 5, Unused 6, System 7`.
- `O155` channels: `Unreliable 0`, `UnreliableInOrder1..15` (1–15), `ReliableUnordered 16`, `ReliableInOrder1..15` (17–31).
- System messages: the first payload byte is `O153`: `Error 0, Connect 1, ConnectResponse 2, ConnectionEstablished 3, ConnectionRejected 4, Disconnect 5, Discovery 50, DiscoveryResponse 51, NatIntroduction 75, Ping 100, Pong 101, StringTableAck 200`.

Buffer primitives (`O13`): string = varint byte length + UTF-8 (`O149` write, `O704` read); `byte[]` written raw with no length (`O656`); int32 = 32 bits (`O729`/`O674`); uint16 = 16 bits. Exact bit order still needs a fixture test against `O579`.

## Lidgren handshake (`O109`, `O391`)

Application identifier: `"uLink 1.5.6"` (client config `new O20("uLink 1.5.6")` in `O1947.O2064`). Signatures are 16 random bytes (`O1049.O4`); nonces are int32.

1. **Connect** (client → server, system): `string appId`, `byte[16] clientSig`, `int32 clientNonce`, then the hail bytes (rest of payload). The server (`O391`, unconnected handler) ignores duplicates from pending or connected endpoints. It rejects with `ConnectionRejected("Bad app id")` or `("Server full")`, ignores self-connections, then creates a pending connection `O109(..., hail, clientSig, clientNonce)`. With approval mode (flag 16) it raises an approval event carrying the hail.
2. **ConnectResponse** (server → client): `byte[16] serverSig`, `int32 serverNonce`, `byte[16] clientSig`, `int32 clientNonce`, then server hail.
3. **ConnectionEstablished** (client → server): `byte[16] clientSig`, `int32 clientNonce`, `byte[16] serverSig`, `int32 serverNonce`, then hail. Mismatched signatures or nonces → "Not the same connection".
4. `ConnectionRejected` and `Disconnect` carry a reason string.
5. The connecting side resends `Connect` on a timeout until a retry limit, then fails with "No answer from remote host" (`O109.O1119`; limits come from config getters `O1125`/`O1126`, values not yet resolved).

The client's Lidgren hail is `O1667.O1783`: bytes derived from the connect **password** (`new O1667(password)`). Rust passes no password in `ClientConnect.DoConnect`; check how `O1667` encodes an empty password.

## uLink connection request

After the Lidgren connection is up, the client sends uLink internal message **`ClientConnectRequest`** (`O1947.O2141`): `uint16` (`O2153`: 0 or a value from `O1985()`, meaning unresolved), then the `Network.Connect` login-data objects serialised by `O946.O958`. Rust passes one prepared `uLink.BitStream` (`ClientConnect.DoConnect`: Int32 1069, Byte 2, UInt64 ID, String name, Bytes ticket). The server exposes this as `NetworkPlayerApproval.loginData`. Next: decode `O946.O958`'s typed encoding (`BitStreamTypeCode`, type-safe flag) and the `ClientConnectResponse` / `ConnectDenied` replies, which carry the approval data written by `ClientConnection.AuthorisationRoutine`.

## uLink message header (`O575` decoding constructor)

Carried in Lidgren `User` messages. The first byte is a flag set:

| Bits | Meaning |
| --- | --- |
| `0x01` | Explicit sender `NetworkPlayer` follows; otherwise the sender is the connection's player |
| `0x06` | Target: `0` server · `2` a `NetworkPlayer` follows (target) · `4` unassigned · `6` a `NetworkPlayer` follows (secondary/"other" player) |
| `0x18` | Body: `0` internal message, `byte O551` · `8` RPC, `NetworkViewID` + `string name` · `16` internal message on a view, `NetworkViewID` + `byte O551` · `24` buffered RPC, `NetworkViewID` + `string name` |
| `0x60` | Timestamp: `0` none · `32` 16-bit · `64` 24-bit · `96` 40-bit (`O457`) |
| `0x80` | Type-safe body; if clear, `NetworkFlags.TypeUnsafe` |

The remainder is the body BitStream. Delivery flags: a reliable channel bit (`O155` ≥ 16) maps to `NetworkFlags` reliability. `Unencrypted` is set when the message was not decrypted.

Internal message types `O551`: `None 0, AllocRequest 1, AllocResponse 2, BufferedRPCs 3, CellConnectResponse 4, CellConnectRequest 5, ClientConnectRequest 6, ClientConnectResponse 7, ConnectDenied 8, Create 9, Dealloc 10, DestroyByPlayerID 11, DestroyByViewID 12, DisconnectPlayerID 13, HandoverRequest 14, HandoverResponse 15, Redirect 16, SecurityRequest 17, SecurityResponse 18, StateSyncOwner 19, StateSyncProxy 20, TrackPosition 21, PlayerIDConnected 22, PlayerIDDisconnected 23, MultiStateSyncProxy 24, MultiStateSyncOwner 25, RedirectPlayerID 26, UnsecurityRequest 27, UnsecurityResponse 28, DestroyAll 29, DestroyInGroup 30, DestroyInGroupByPlayerID 31, LicenseCheck 32, ChangeGroup 33, ResyncClockRequest 34, ResyncClockResponse 35`.

## Side effects the gateway must not reproduce

- **Analytics beacon:** `Network.Connect` calls `O2012.O2013("uLink1.5.6", "Connect", host)`, which builds a Unity `WWW` request to `http://www.google-analytics.com/__utm.gif` (or `https://download-muchdifferent-com.loopiasecure.com/google_analytics/forward.php` when web security is enabled). The browser client and gateway must not send it. Native clients still do, independently of us.
- `LicenseCheck` (internal type 32): purpose not yet read. Do not implement any licence-server contact.

## Encryption: not used by this server build (resolved)

- No Rust Legacy code calls `uLink.Network.InitializeSecurity` or sets keys (server and client `Assembly-CSharp`).
- No `uLinkOverrideSettings` instance exists in server `mainData`, `sharedassets0.assets`, `resources.assets`, `scenes.unity3d` or `gameobject.000/.001`. The only uLink behaviours referenced are 104 `uLinkNetworkView` and one `ConsoleNetworker` (UnityPy script-reference scan).
- uLink reads its settings from the `uLinkPrefs` TextAsset (`NetworkPrefs.resourcePath`). The server's copy in `rust_server_Data/resources.assets` contains: `Network.requireSecurityForConnecting=False`, `symmetricKeySize=128` (unused without security), `incomingPassword=` (empty), `maxManualViewIDs=1000`, `sendRate=5` (Rust's NetCull sets its own), `isAuthoritativeServer=True`, `minimumAllocatableViewIDs=60176`, `minimumUsedViewIDs=1`, `useDifferentStateForOwner=True`, `rpcTypeSafe=0`, `useProxy=False`, `config.sendBufferSize/receiveBufferSize=262143`, **`config.maximumTransmissionUnit=1400`**, **`config.timeBetweenPings=3`**, **`config.timeoutDelay=300`**, **`config.handshakeRetriesMaxCount=5`**, **`config.handshakeRetryDelay=2.5`**, `batchSendAtEndOfFrame=False`, `allowInternalUnconnectedMessages=True`, `MasterServer.ipAddress=unityparkdemo.muchdifferent.com` (the gateway never contacts a master server).

So the gateway does not need uLink's RSA/symmetric layer for this build; messages arrive with `NetworkFlags.Unencrypted`. RustProtect's optional client-side `NetCrypt` wrapper cannot apply on the wire either, because the server uses plain sockets. The client's `uLinkPrefs` (installer payload `resources.assets`) were read on 2026-10-23: same values; see "Dead peer" below for the client's 60 s override.

## Reliability and ordering (`O109`)

- **Sequence numbers** are per channel, assigned on send (`O1133`) and **wrap at 65535, not 65536**: values 0..65534. Relative order: `O1154(a, b)` computes `b - a` folded into ±32767 using 65535, then negated.
- **Receive** (`O989`): `Unreliable` → deliver. `UnreliableInOrder1..15` → drop if older than expected; deliver; expected = seq+1. Reliable channels (16–31): **always queue an ack** for `(channel, seq)`. Older than expected → duplicate, dropped. Equal to expected → deliver, then release any withheld messages in order. Otherwise → mark received in a 65535-bit window (duplicate if already set); `ReliableUnordered` delivers immediately, `ReliableInOrder*` withholds.
- **Acks** (`O1127`): kind `Acknowledge`, channel `Unreliable`; payload = repeated 3-byte entries `[channel byte][seq uint16 little-endian]`. Messages are split when ≥ `(MTU-10)/3*8` bits. A payload length not a multiple of 3 is rejected; a channel byte < 16 is ignored.
- **On ack** (`O986`): remove the matching stored message. Any earlier stored message on that channel with a lower seq is **resent immediately** (fast retransmit).
- **Resend timer** (`O1135`/`O1123`): next resend at `now + 0.025 + avgRTT * 1.1 * (1 + n²)` seconds, where n is the resend count (`O20` default delegate).

## Fragmentation (`O109.O1110` send, `O1094` receive)

- On any channel except `Unreliable`, a message whose payload exceeds the MTU (`O20.O1114` = 1400 by default and in `uLinkPrefs`) is split into ceil(len / (MTU-10)) parts.
- Each part is kind `UserFragmented` on the same channel, payload `[groupId uint16][index varuint][count varuint][chunk bytes]`. `groupId` counts from 1 per connection; chunks are MTU-10 bytes, the last one shorter.
- The receiver allocates `chunkSize * count` from the **first** fragment seen. **Quirk:** if that first fragment is the last one, it is dropped (no buffer is created). Ordered reliable channels avoid this. The reassembled message is delivered once all `count` parts arrive.

## Ping, pong, timeout

- System messages are sent immediately as their own datagram (`O0.O94`): `[0x07][seq uint16 = 0][len varuint = payload+1][systemType byte][payload]`.
- **Ping** payload: `uint64 senderMs` (`O123.O1187`), `int64 DateTime.Now.ToBinary()`.
- **Pong** payload: `uint64 echoedMs`, `uint64 senderMs`, `int64 DateTime.ToBinary()`. RTT = now − echoed × 0.001 s.
- Ping interval `timeBetweenPings` (3 s). The connection times out when no pong arrives within `timeoutDelay` (default 30 s; server `uLinkPrefs` 300 s).
- **Dead peer (client side, checked against the decompiled code 2026-10-23):** Lidgren tests for a dead peer only when a ping is due (`now − lastPingSent > timeBetweenPings`): if `now − lastPong > timeoutDelay` it closes with `"Connection timed out; no pong for N seconds"` and sends a Disconnect; otherwise it pings. `lastPong` is set on every Pong and at handshake completion (the initial RTT sample); other traffic does not count. The **client's own `uLinkPrefs`** (client `resources.assets`, read as text) hold the same values as the server's (MTU 1400, pings 3 s, timeout 300, handshake 5 × 2.5 s), but `ClientConnect.DoConnect` sets **`NetCull.config.timeoutDelay = 60`** before every connect, so the original client notices a dead server 60–63 s after its last pong. The server keeps `server.clienttimeout` (300). The gateway's client session uses these client values (`CLIENT_DEFAULTS`).
- **Failed connect:** 5 unanswered Connects (t = 0, 2.5, 5, 7.5, 10 s) close with `"No answer from remote host"` at 12.5 s. A Lidgren close while uLink is still connecting raises `uLink_OnFailedToConnect`: a ConnectionRejected reason maps `"Server full"` → TooManyConnectedPlayers, `"Invalid password"`, `"Connection banned"`, `"Special server"` → LimitedPlayers, `"App id bad"` → IncompatibleVersions; anything else → **ConnectionFailed (14)**. Rust's `MainMenu` shows `"Failed to connect (" + NetError.ToString() + ")"`, i.e. "Failed to connect (ConnectionFailed)" for a stopped server; a connection lost after approval shows "Disconnected from server." (or the KP kick reason). ICMP port unreachable from a stopped server is ignored (Lidgren drops ConnectionReset), so only these timers end the attempt. The gateway sends such failures to the page as `{type: 'denied', reason: 'connection-failed', error: 14}` (before 2026-10-23 it sent `disconnected`, which the page and the test driver ignored before approval).
- `StringTableAck` exists in Lidgren, but uLink never calls the string-table writer (`O13.O705`/`O737(O109, string)` have no callers), so RPC names travel as plain strings.

## uLink outgoing header (`O575` encoding constructor)

`[flags][target player uint16 if 0x02/0x06][other player uint16 if 0x06][viewID uint16 if view][type byte | name string][timestamp N bits if 0x60]`, then the body.

- Internal messages built with `O575(peer, type, player)` use flags `26` (`Unbuffered | NoTimestamp | TypeUnsafe`, from `NetworkFlags`: `Unreliable 1, Unbuffered 2, Unencrypted 4, NoTimestamp 8, TypeUnsafe 16`) and channel 17 (`ReliableInOrder1`).
- A connect request to the server therefore encodes as header byte `0x00`, then type byte, then body.
- The 0x01 sender bit is never written by this encoder: the sender is implied by the connection.
- Timestamps in headers are the low 16/40 bits of the sender's ms clock (`O457.O1533`). The receiver widens them against its own synchronised clock (`O457.O1530`, which tolerates up to 1000 ms ahead).
- Player IDs and view IDs are `uint16`; `NetworkPlayer.unassigned` = 0, `NetworkPlayer.server` = 65535 (clients 1..65534).
- Encoder target bits (`O2425`–`O2427`): target server → no bits; a client player → `0x02` + uint16; unassigned → `0x04`; unassigned with an "other" player → `0x06` + uint16. So `ClientConnectRequest` (to server) has header `0x00`; `ClientConnectResponse`/`ConnectDenied` (to unassigned) have `0x04`. View-ID ranges (`O443`) are two `uint16`.

## Connect, approve, deny (uLink layer)

1. **`ClientConnectRequest` (6)**, client → server, channel 17, untyped body: `uint16 requestedPlayerId` (0 unless reconnect/handover), then login data. For Rust this is the raw `uLink.BitStream(isTypeSafe:false)`, appended without a prefix: `int32 1069`, `byte 2`, `uint64 userId`, `string name` (varuint length + UTF-8), `bytes ticket` (varuint length + raw).
2. **Server** (`O896.O2489`): drops the request if the Lidgren connection isn't `Connected`, if security is required but missing (not the case here), or if a player is already assigned. On an authoritative server (`O2154`), `requestedPlayerId > 0` → `ConnectDenied(IsAuthoritativeServer)`. It derives the password key from the Lidgren hail, then raises `OnPlayerApproval` (Rust: `ConnectionAcceptor.uLink_OnPlayerApproval`).
3. **`ConnectDenied` (8)**, server → client: `int32 NetworkConnectionError`, followed by a Lidgren disconnect "Normal disconnect".
4. **`ClientConnectResponse` (7)**, server → client (`O3610`): `uint16 playerId`, `varuint n` + `n × (uint16 viewStart, uint16 viewEnd)` pre-allocated view-ID ranges, `uint64 requestReceivedMs`, `uint64 serverNowMs`, then the approval objects (header `0x04`). Rust passes one `byte[]` (the world-info BitStream from `AuthorisationRoutine`): `varuint length` + bytes, with type code `135` only in type-safe mode. Internal messages are untyped. The client reads it with `NetCull.approvalData.ReadObject(typeof(byte[]))`. The server then handles the original login BitStream (`O3482`) and continues player setup (Rust `uLink_OnPlayerConnected`).

## Typed object codec (`O946`, `BitStreamCodec`, `BitStreamTypeCode`)

- A list of objects is encoded one after another (`O946.O958`). **If the last object is a `BitStream`, it is appended raw** (`WriteBitStream`: both streams must share type-safety).
- Each value is written through its `BitStreamCodec`, preceded by its `BitStreamTypeCode` byte **only when the stream is type-safe**.
- Codes: Boolean 1, Char 3, SByte 5, Byte 7, Int16 9, UInt16 11, Int32 13, UInt32 15, Int64 17, UInt64 19, Single 21, Double 23, Decimal 25, DateTime 27, String 29, IPEndPoint 30, NetworkPlayer 31, NetworkViewID 33, NetworkPeer 35, Vector2 37, Vector3 39, Vector4 41, Quaternion 43, Color 45, … PublicKey 50, PrivateKey 51, NetworkGroup 54. Even codes are the Nullable variants; 64–127 are user-defined; 128 + element code = array (e.g. 135 = `byte[]`).
- **uLink `BitStream` booleans are one whole byte** (`O1760`), unlike Lidgren's 1-bit `O711`. Floats/doubles are raw little-endian IEEE bytes at the current bit position.
- Arrays are `varuint count` + elements; `byte[]` is `varuint length` + raw bytes.
- Enums use their underlying type's codec. Per-type float/vector layouts still need reading for RPC arguments (item 5).

### Type-safe RPCs from an untyped server (NGC carrier calls)

`rpcTypeSafe=0` does not make every RPC untyped. It only adds `TypeUnsafe (16)` to `Network.defaultRPCFlags` (`server-ulink.il.txt` method `0x0600035c`: unless the setting is 2, or 1 in the editor, `defaultRPCFlags |= 16`). The `NetworkView.RPC(string, …)` overloads pass those default flags (`NetworkViewBase` getter `0x06000b48`). The `RPC(NetworkFlags, string, …)` overloads (`0x06000b02` → `NetworkViewBase.RPC` `0x06000b72`) pass the caller's flags unchanged. The message encoder (`0x06000054`) then sets header bit `0x80` and makes the body stream type-safe exactly when `TypeUnsafe` is clear (`0x06000063`). It writes timestamp bits (`0x20` unbuffered, `0x60` buffered) only when `NoTimestamp (8)` is clear (`0x06000062`). In a type-safe stream `BitStream.WriteBytes` writes the `BitStreamTypeCode` byte `135` before the usual `varuint length + bytes` (`0x06000609`), and `ReadBytes` checks it (`0x060005e4` → `0x060005cd`, "Can't read from BitStream because the type safe code …").

Rust hits this through NGC. `NGC.Prefab.Installation.Method.defaultNetworkFlags` (`NGC.cs:83`) adds `NoTimestamp` to every NGC message whose handler has no `uLink.NetworkMessageInfo` parameter (`(flags & 0x21) != 1`; bit 1 = info, set in `Method.Create`, `NGC.cs:166`). `FLAG_FORCE_TYPE_UNSAFE` is never set. `NGC.ShootRPC` (`NGC.cs:3863`) uses the default overload only when the flags are `Normal`, otherwise `networkView.RPC(rpc.flags, …)`. So every NGC call (`"C"`, and buffered `"C<innerID hex>_<msg hex>"` from `CallRPCName`, `NGC.cs:3927`) to such a handler arrives as **header `0x80`, no timestamp, body `0x87 varuint(length) data`**. Example: `BasicDoor.DOo(sbyte, ulong)` (`BasicDoor.cs:930`), sent `OthersBuffered` for every non-static door (`BasicDoor.InvalidateState`). NGC adds (`"A<innerID hex>"`, `NetworkFlags.Normal`) stay untyped.

The gateway used to read every body untyped. `0x87` became a varuint continuation byte, so the length read as `7 + 128 × length` and failed with "Byte array longer than buffer". That was the 296 errors on the Azure VM (2026-10-22, SERVER-TESTING-PLAN.md section 12): 8–14 per join, inside the joining player's `BufferedRPCs` batch, one per buffered NGC call of this kind. `readArgs`/`writeArgs` (`bridge/ulink/rust.mjs`) now take the header's `typeSafe` and read/check the type code before each value: Boolean 1, SByte 5, Byte 7, UInt16 11, Int32 13, UInt64 19, Single 21, String 29, NetworkPlayer 31, NetworkViewID 33, Vector3 39, Quaternion 43, `byte[]` 135. Rust's own codecs (Angle2, NetEntityID, ContextMenuData) use user codes 64–127 that are not mapped yet. A trailing `BitStream` argument has no code. The arguments inside the NGC byte[] (`RPCData`) stay untyped (`NGC.Procedure.CreateBitStream`, `isTypeSafe: false`). Fixtures: `tests/ulink-codec.test.mjs` ("type-safe buffered NGC call"), `tests/game-bridge.test.mjs` ("type-safe buffered NGC calls in the join batch").

## Not yet mapped

`AckBitVector` (kind 4: no sender found yet, possibly unused); Lidgren `Disconnect` details; uLink `ResyncClockRequest/Response` payloads and clock sync; `Create`/`Dealloc`/state-sync/RPC bodies and per-type value layouts (vectors, quaternions, floats) needed for gameplay (queue item 5); RustProtect's client socket wrapper (see `analysis/SECURITY-COMPATIBILITY.md`); exact bit order of `O579` for non-byte-aligned values (bools) — fixture tests will pin it.

## Codec

`bridge/ulink/` implements the above: `bits.mjs` (NetBuffer), `lidgren.mjs` (framing, system/handshake payloads, acks, sequence math, `ChannelReceiver`, fragmentation with the drop quirk, resend formula), `ulink.mjs` (header decode, internal-message encode, Rust login/approval/world-info, `ClientConnectRequest/Response`, `ConnectDenied`, timestamp widening). `tests/ulink-codec.test.mjs` pins hand-derived byte fixtures (9 tests). Every fixture comes from code reading, not a capture.
