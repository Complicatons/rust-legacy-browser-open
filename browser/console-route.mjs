import {parseConsoleArg} from './chat.mjs';
// F1 console routing (ConsoleWindow.RunCommand): ConsoleSystem.RunCommand_Clientside first; when it returns false the
// typed text goes to the server verbatim (ConsoleNetworker.SendCommandToServer -> SV_RunConsoleCommand on view 997) and
// server output comes back as CL_ConsoleMessage (ConsoleWindow.AddText(message, bFromServer)).
// RunCommand_Clientside succeeds only for a static member of a client ConsoleSystem class carrying [Client]
// (Arg.CheckPermissions); a missing class/member (Type.GetMethod/GetField/GetProperty are case-sensitive), a member
// without [Client] ("No permission") or an invalid Arg all fall through to the server.
// [Client] members of the client Assembly-CSharp ConsoleSystem classes (static scan of analysis/decompiled/client;
// tests/console-route.test.mjs re-checks it when the decompiled source is present). Classes with no [Client] member
// (airdrop, env, falldamage, interp, gunshots, player, actor, and the empty dmg/inv/objects/server/teleport/voice/
// conditionloss stubs) are server-side from the client's point of view.
export const CLIENT_COMMANDS=Object.freeze({
 censor:['nudity'],chat:['enabled','add'],config:['save','load'],deathscreen:['reason','show'],footsteps:['quality'],gametip:['scale'],gameui:['hide','show'],
 gfx:['ssaa','bloom','grain','ssao','tonemap','shafts','damage','all'],gizmos:['carrier'],global:['logprint','fpslog','create_error','find','echo','quit'],
 grass:['on','forceredraw','displacement','disp_trail_seconds','shadowcast','shadowreceive'],gui:['hide','show','hide_branding','show_branding'],
 input:['mousespeed','flipy','bind','keys'],lockentry:['show','hide'],net:['connect','disconnect','reconnect'],notice:['popup','inventory','test'],
 render:['level','distance','frames','fov','vsync','update'],serverfavourite:['add','remove','save','load'],sound:['music','volume'],
 terrain:['manual','idleinterval','reassign','reassign_nocopy','mat','flush','flushtrees'],water:['level','reflection']});
// ConsoleWindow's dfTextbox maxLength (BuildPlayer-GameUI ConsoleWindow export).
export const CONSOLE_MAX_LENGTH=1024;
// 'client': the original ran it locally (the port answers it or says it is unknown, never forwards it);
// 'server': the original sent it to the server.
export function consoleRoute(text){const arg=parseConsoleArg(text);if(arg.invalid)return 'server';return CLIENT_COMMANDS[arg.className]?.includes(arg.fn)?'client':'server';}
// What the F1 console may send: only text the player typed (trusted submit), as typed, within the textbox limit.
// An empty or blank line is sent too (ConsoleWindow.OnInput -> RunCommand: RunCommand_Clientside fails on it, so
// SendCommandToServer; the server's RunCommand_Serverside fails quietly and answers nothing).
export function forwardableConsoleText(text,{trusted=false}={}){if(!trusted||typeof text!=='string'||text.length>CONSOLE_MAX_LENGTH)return null;return consoleRoute(text)==='server'?text:null;}
// ConsoleWindow.AddText(str, bFromServer: true): "[color #00ffff]" + str + "[/color]\n" then "\n" -> the message lines
// and one empty line.
export function serverConsoleLines(message){return [...String(message??'').split('\n'),''];}
