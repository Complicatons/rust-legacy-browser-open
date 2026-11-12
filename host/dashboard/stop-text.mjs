// The Stop/Restart warning for the original game server (the dashboard's confirm dialog). Kept apart so a node test can
// check it: it says the server saves first when save-and-quit is available (host/server-control.mjs), and what is lost
// when it is not.
export function stopWarning({action,target,graceful,saveSeconds=60,lastSaveAgo}){
 const last=lastSaveAgo?`${lastSaveAgo} ago`:'none kept yet',all=target==='all';
 if(graceful?.available)return `${all?'Every part stops. ':''}The game server saves the world first, then quits${action==='restart'?' and starts again':''}. If it does not confirm the save within ${saveSeconds} s, it is ended, and play since the last good save (${last}) is lost.`;
 return `${all?'Every part stops. ':''}The server process is ended at once${graceful?.reason?` (it cannot save first: ${graceful.reason})`:''}. Anything since the last good save (${last}) is lost.`;
}
