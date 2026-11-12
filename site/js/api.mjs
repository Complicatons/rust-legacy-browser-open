// JSON calls to the central service (same origin; session cookie + CSRF header on changes).
let csrf=null;
export const setCsrf=value=>{csrf=value??null;};

const MESSAGES={
 'sign-in-required':'Sign in to continue.',
 csrf:'Your session expired. Reload the page and try again.',
 'rate-limited':'Too many attempts. Wait a minute and try again.',
 origin:'This request came from another site and was blocked.',
 state:'Sign-in expired or was started in another tab. Try again.',
 'identity-in-use':'That login already belongs to another account.',
 'account-suspended':'This account is suspended.',
 reauthenticate:'For security, sign in again first.',
 'already-linked':'You already have a character linked on this server.',
 'invalid-code':'That code is not valid. Type /browserlink in the desktop game for a new one.',
 'unknown-code':'That code was not recognised or has expired.',
 'invalid-launcher-code':'Type the 8-character code your launcher shows, like K7QM-3XPA.',
 'unknown-launcher-code':'That code is not valid or has expired. Start again in the launcher.',
 conflict:'That desktop character is already linked to another account.',
 'server-offline':'That server is offline right now.',
 'unknown-server':'That server is no longer listed.',
 banned:'This account is banned from that server.',
 'account-too-new':'This server only accepts accounts older than its minimum age. Try again later.',
 'steam-required':'This server requires a linked Steam sign-in. Add Steam on your account page.',
 'heartbeat-required':'Start the gateway first: the server needs a live heartbeat before it can be listed.',
 'invalid-endpoint':'The endpoint must be a wss:// address.','invalid-server':'Add a name (up to 64 characters) and a region.','invalid-server-name':'Give the server a name, up to 64 characters.',
 'desktop-required':'Gameplay needs a desktop browser with a keyboard and mouse.',
 'invalid-credentials':'Email/username or password is incorrect.',
 'account-locked':'Too many failed sign-ins. Try again in 15 minutes.',
 'username-taken':'That username is taken. Try another.',
 'email-taken':'An account already uses that email. Sign in instead.',
 'invalid-username':'Use 3–20 letters, numbers, _ or -, starting with a letter or number.',
 'reserved-username':'That username is reserved. Try another.',
 'invalid-email':'Enter an email address like name@example.com.',
 'password-too-short':'Use at least 8 characters.',
 'password-too-long':'Use 128 characters or fewer.',
 'password-matches-name':"Your password can't be your username or email.",
 'no-pending-signup':'That sign-up expired. Start again with Steam.',
 'username-set':'Your username is already set.',
 'invalid-token':'That link has expired or was already used. Request a new one.',
 'mail-disabled':'Password reset by email is not available yet.',
 'staff-only':'Only site staff can do that.',
 'host-offline':'The host app is not connected, so the command cannot reach the server.','control-off':'Website control is switched off in this host app (host.json remote.control).',
 'unknown-command':'That command is not available.','unknown-component':'That part is not in this host app.','backup-name-required':'Pick a backup to restore.',
 'rules-not-accepted':'Tick the listing rules box first.','invalid-listing':'Check the listing: a description up to 600 characters, up to 6 tags, a discord.gg invite and https links.',
 'listing-not-approved':'Send the listing first: the Rust Legacy team approves new servers before they show in the list.','server-suspended':'This server is suspended by the Rust Legacy team. Contact us on Discord.',
 'no-listing':'That server has not sent a listing.','invalid-decision':'Choose approve or reject.','invalid-state':'Unknown listing state.',
 'invalid-title':'Add a title (up to 120 characters).','invalid-slug':'The address can use a–z, 0–9 and dashes.','invalid-section':'Pick a section.','body-too-long':'The text is over 100,000 characters.','unknown-revision':'That revision no longer exists.',
 'disposable-email':'Throwaway email addresses can’t be used. Use your own email, or sign up with Steam.',
 'identity-banned':'This login is linked to a banned account.',
 'held-for-review':'This account shares a device with a banned account, so it is waiting for a quick review by staff.',
 'phone-required':'This server asks for a verified phone. Add one on your account page.',
 'invalid-phone':'Enter your number with its country code, like +44 7700 900123.','phone-taken':'That number is already verified on another account.',
 'phone-code-wrong':'That code is not right. Check the text message and try again.','phone-code-expired':'That code has expired. Send a new one.','phone-disabled':'Phone verification is not available yet.',
 'steam-check-unavailable':'Steam could not be reached to check your account. Try again in a minute.','steam-profile-private':'This server checks your Steam profile. Make your profile and game details public on Steam, then try again.',
 'steam-account-too-new':'This server only accepts older Steam accounts.','steam-level-too-low':'Your Steam level is below what this server asks for.',
 'steam-vac-banned':'This server does not accept Steam accounts with VAC bans.','steam-game-banned':'This server does not accept Steam accounts with game bans.','steam-recent-ban':'This server does not accept Steam accounts with a recent ban.',
 'invalid-thread-title':'Add a title (3–120 characters).','empty-post':'Write something first.','post-too-long':'Posts can be up to 20,000 characters.',
 'posting-too-fast':'Wait a few seconds before posting again.','thread-locked':'This thread is locked.','not-your-post':'You can only change your own posts.',
 'first-post':'The first post goes with its thread: delete the thread instead.','forum-banned':'Your account cannot post on the forum right now.',
 'username-required':'Choose a username on your account page first.','unknown-thread':'That thread no longer exists.','unknown-post':'That post no longer exists.',
 'unknown-category':'That forum category does not exist.','cannot-ban-staff':'Staff accounts cannot be banned from posting.','unknown-player':'No account has that username.',
 'reason-required':'Add a reason (up to 200 characters).','invalid-days':'Pick a ban length.',
 network:'Could not reach the server. Check your connection and try again.',
};
export function explain(code){return MESSAGES[code]??`Something went wrong (${code}). Try again.`;}

export async function api(method,path,data){
 const headers={};if(data!==undefined)headers['content-type']='application/json';if(csrf&&method!=='GET')headers['x-csrf-token']=csrf;
 let res;
 try{res=await fetch(path,{method,headers,body:data!==undefined?JSON.stringify(data):undefined,credentials:'same-origin'});}
 catch{throw Object.assign(new Error('network'),{code:'network',status:0});}
 const body=await res.json().catch(()=>({}));
 if(!res.ok)throw Object.assign(new Error(body.error??String(res.status)),{code:body.error??String(res.status),status:res.status});
 return body;
}
