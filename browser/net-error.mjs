// NetError + NetErrorHelper.NiceString (decompiled client) and the kick reason flow: the server sends
// ServerManagement.KP(int) before dropping a player (NetUser.Kick); ServerManagement keeps it and
// MainMenu.uLink_OnDisconnectedFromServer shows "Disconnected (<NiceString>)", else "Disconnected from server.".
export const NET_ERROR={AlreadyConnectedToAnotherServer:-1,CreateSocketOrThreadFailure:-2,IncorrectParameters:-3,EmptyConnectTarget:-4,InternalDirectConnectFailed:-5,
 NoError:0,ConnectionFailed:14,TooManyConnectedPlayers:17,RSAPublicKeyMismatch:20,ConnectionBanned:21,InvalidPassword:22,DetectedDuplicatePlayerID:23,
 NATTargetNotConnected:61,NATTargetConnectionLost:62,NATPunchthroughFailed:63,IncompatibleVersions:64,ConnectionTimeout:70,LimitedPlayers:71,
 IsAuthoritativeServer:80,ApprovalDenied:81,ProxyTargetNotConnected:90,ProxyTargetNotRegistered:91,ProxyServerNotEnabled:92,ProxyServerOutOfPorts:93,
 Facepunch_Kick_ServerRestarting:128,Facepunch_Approval_Closed:129,Facepunch_Approval_TooManyConnectedPlayersNow:130,Facepunch_Approval_ConnectorAuthorizeException:131,
 Facepunch_Approval_ConnectorAuthorizeExecution:132,Facepunch_Approval_ConnectorDidNothing:133,Facepunch_Approval_ConnectorCreateFailure:134,
 Facepunch_Approval_ServerDoesNotSupportConnector:135,Facepunch_Approval_MissingServerManagement:136,Facepunch_Approval_ServerLoginException:137,
 Facepunch_Approval_DisposedWait:138,Facepunch_Approval_DisposedLimbo:139,Facepunch_Kick_MultipleConnections:140,Facepunch_Kick_Violation:141,
 Facepunch_Kick_RCON:142,Facepunch_Kick_Ban:143,Facepunch_Kick_BadName:144,Facepunch_Connector_InLimboState:145,Facepunch_Connector_WaitedLimbo:146,
 Facepunch_Connector_RoutineMoveException:147,Facepunch_Connector_RoutineYieldException:148,Facepunch_Connector_MissingFeatureImplementation:149,
 Facepunch_Connector_Cancelled:150,Facepunch_Connector_AuthFailure:151,Facepunch_Connector_AuthException:152,Facepunch_Connector_MultipleAttempts:153,
 Facepunch_Connector_VAC_Banned:154,Facepunch_Connector_AuthTimeout:155,Facepunch_Connector_Old:156,Facepunch_Connector_NoConnect:157,
 Facepunch_Connector_Invalid:158,Facepunch_Connector_Expired:159,Facepunch_Connector_ConnectedElsewhere:160,Facepunch_API_Failure:161,Facepunch_Whitelist_Failure:162};
const E=NET_ERROR;
// NetErrorHelper.BuildNiceString.
const NICE={[E.AlreadyConnectedToAnotherServer]:'Already connected to different server',[E.ApprovalDenied]:"You've been denied from connecting",[E.ConnectionBanned]:'Banned from connecting',
 [E.ConnectionFailed]:'Could not reach the server',[E.ConnectionTimeout]:'Timed out',[E.CreateSocketOrThreadFailure]:'Could not create socket or thread',[E.DetectedDuplicatePlayerID]:'Duplicate players identified',
 [E.EmptyConnectTarget]:'Invalid server',[E.IncompatibleVersions]:'Version incompatible',[E.IncorrectParameters]:'Incorrect parameters',[E.InternalDirectConnectFailed]:'Direct connect failed',
 [E.InvalidPassword]:'Invalid password',[E.IsAuthoritativeServer]:'Authoritative server',[E.LimitedPlayers]:'Server has limited players',[E.NATPunchthroughFailed]:'NAT punchthrough',
 [E.NATTargetConnectionLost]:'NAT target connection lost',[E.NATTargetNotConnected]:'NAT target not connected',[E.ProxyServerNotEnabled]:'Proxy server not enabled',
 [E.ProxyServerOutOfPorts]:'Proxy server out of ports',[E.ProxyTargetNotConnected]:'Proxy target not connected',[E.ProxyTargetNotRegistered]:'Proxy target not registered',
 [E.RSAPublicKeyMismatch]:'RSA public key mismatch',[E.TooManyConnectedPlayers]:'Full',[E.Facepunch_Connector_VAC_Banned]:'VAC banned',[E.Facepunch_Approval_Closed]:'Not accepting new connections.',
 [E.Facepunch_Connector_Cancelled]:'A ticket was cancelled - try again',[E.Facepunch_Connector_AuthTimeout]:'Timed out authorizing your ticket',[E.Facepunch_Approval_TooManyConnectedPlayersNow]:'Authorization busy',
 [E.Facepunch_Kick_ServerRestarting]:'Server restarting',[E.Facepunch_Kick_MultipleConnections]:'Started a different connection',[E.Facepunch_Kick_Violation]:'Kicked because of violation',
 [E.Facepunch_Kick_RCON]:'Kicked by admin',[E.Facepunch_Kick_Ban]:'Kicked and Banned by admin',[E.Facepunch_Kick_BadName]:'Rejected name',[E.Facepunch_Approval_ServerLoginException]:'Server exception',
 [E.Facepunch_Approval_DisposedLimbo]:'Failed to run authorization',[E.Facepunch_Approval_DisposedWait]:'Aborted authorization',[E.Facepunch_Approval_ConnectorAuthorizeException]:'Server exception with authorization',
 [E.Facepunch_Approval_ConnectorAuthorizeExecution]:'Aborted starting of authorization',[E.Facepunch_Approval_ConnectorCreateFailure]:'Server was unable to start authorization',
 [E.Facepunch_Approval_ConnectorDidNothing]:'Server failed to start authorization',[E.Facepunch_Approval_MissingServerManagement]:'Server is not prepared',
 [E.Facepunch_Approval_ServerDoesNotSupportConnector]:'Unsupported ticket',[E.Facepunch_Connector_AuthException]:'Server exception while starting authorization',
 [E.Facepunch_Connector_AuthFailure]:'Authorization failed',[E.Facepunch_Connector_InLimboState]:'Lost connection during authorization',
 [E.Facepunch_Connector_MissingFeatureImplementation]:'Authorization produced an unhandled message',[E.Facepunch_Connector_MultipleAttempts]:'Multiple authorization attempts',
 [E.Facepunch_Connector_ConnectedElsewhere]:'Changed connection',[E.Facepunch_Connector_RoutineMoveException]:'Server exception occured while awaiting authorization',
 [E.Facepunch_Connector_RoutineYieldException]:'Server exception occured when checking authorization',[E.Facepunch_Connector_WaitedLimbo]:'Server lost you while processing ticket',
 [E.Facepunch_Connector_NoConnect]:'Lost authorization',[E.Facepunch_Connector_Old]:'Ticket already used',[E.Facepunch_Connector_Expired]:'Ticket expired',
 [E.Facepunch_Connector_Invalid]:'Ticket invalid',[E.Facepunch_API_Failure]:'API Failure',[E.Facepunch_Whitelist_Failure]:'Not in whitelist'};
const NAME=new Map(Object.entries(E).map(([k,v])=>[v,k]));
// NetErrorHelper.FallbackNiceString: enum name without "Facepunch_", "(" + hex value + ")", underscores as spaces.
// Unknown values print as the bare number, as Enum.ToString() does.
function fallback(code){const name=(NAME.get(code)??String(code)).replace('Facepunch_','');return (name+'('+(code>>>0).toString(16).toUpperCase()+')').replace(/_/g,' ');}
export function niceString(code){return NICE[code]??fallback(code);}
// Port addition: "Changed connection" (the gateway's replaced kick, a newer join with the same account) says why, since a
// browser player can easily have the game open in two tabs or windows (EU 1, 30 Oct).
export function disconnectMessage(kickCode){return kickCode!=null&&kickCode!==E.NoError?`Disconnected (${niceString(kickCode)})${kickCode===E.Facepunch_Connector_ConnectedElsewhere?': this account joined the server again from another tab, window or device':''}`:'Disconnected from server.';}
// NetError.ToString(): the enum name, or the bare number for a value the enum does not define.
export function netErrorName(code){return NAME.get(code)??String(code);}
// MainMenu.uLink_OnFailedToConnect: "Failed to connect (" + NetError.ToString() + ")", or "Failed to connect." for NoError
// (e.g. the gateway's ConnectionFailed when the server is stopped). A refusal without a NetError (website ticket, gateway
// admission) shows its project reason in the same form.
export function failedToConnectMessage({reason,error}={}){
 if(Number.isInteger(error))return error!==E.NoError?`Failed to connect (${netErrorName(error)})`:'Failed to connect.';
 return `Failed to connect (${reason??'denied'})`;
}
