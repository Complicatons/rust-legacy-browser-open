// Central account/directory service command line (pilot).
//   node tools/central.mjs new-key <dir>        → writes signing-<kid>.pem (mode 0600); list it first in signingKeys to activate
//   node tools/central.mjs check <config.json>
//   node tools/central.mjs run <config.json>
//   node tools/central.mjs staff <config.json> <email or username> [--remove]  → grant or remove site staff (audited)
// config.json: {listen:{host,port}, publicUrl:"https://play.example/", database:"central.db", signingKeys:["keys/signing-….pem", …],
//   allowedOrigins:["https://play.example"], steam:{enabled:true, apiKeyFile?},
//   mail?:{transport:'smtp', host, port?:587, secure?, user?, passwordFile?, from:'Rust Legacy <hello@your-domain>'} or {transport:'console'}
//     (central/mailer.mjs: account mail and the opening-day email; omit to hide password reset and email verification),
//   playUrl?: game page that reads sessionStorage 'rlb-join', serveGame?: serve the game itself at /play (sets playUrl), tls?:{cert,key},
//   testDevSignIn?: true enables POST /auth/login {subject} (dev identities, never password accounts) for the gameplay test
//   tools; only with allowInsecure (test VMs reachable from the owner's address alone), never in production,
//   progressUrl?: README the roadmap progress bar reads (default the public journal's; null = the committed snapshot only),
//   trustedProxies?: ["loopback","cloudflare", CIDR…] whose X-Forwarded-For / CF-Connecting-IP name the client for rate limits
//     (bridge/client-ip.mjs; behind Caddy and Cloudflare: ["loopback","cloudflare"]),
//   identity?: {pepperFile?, disposableDomainsFile?, hostingRangesFile?} (central/identity.mjs; without pepperFile a pepper
//     is generated into the database), phone?: {provider:"console"} enables phone verification (codes go to the log until an
//     SMS provider is added), screenshots?: {retentionDays: 30}, ips?: {retentionDays: 90} (logged IP addresses, central/ip-bans.mjs), listingReview?: true (site staff approve server listings on /staff before they show;
//   leave it off on test stacks); steam.apiKeyFile also enables Steam quality checks,
//   downloadsDir?: folder whose host/ and loader/ hold the host app installer and the game loader zip, each with its
//     signed latest.json (central/downloads.mjs: /downloads/{host,loader}/*, /download/{host,loader}), and whose updates/ holds the kit-update release feed and its tars
//     (central/downloads.mjs: /downloads/updates/*, H11)}. The first signing key signs; later keys only verify tickets issued before a rotation.
import {createGameHandler} from './serve.mjs';
import {readFileSync} from 'node:fs';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createServer as createHttp} from 'node:http';
import {createServer as createHttps} from 'node:https';
import {openCentralDb} from '../central/db.mjs';
import {createCentralService,createDevLoginVerifier} from '../central/service.mjs';
import {steamProvider} from '../central/providers.mjs';
import {writeSigningKey,loadSigningKey} from '../central/keys.mjs';
import {createSiteHandler} from '../central/site.mjs';
import {createDownloadsHandler} from '../central/downloads.mjs';
import {createProgress} from '../central/progress.mjs';
import {createMailer} from '../central/mailer.mjs';
import {trustedProxyErrors} from '../bridge/client-ip.mjs';
import {createConsolePhoneProvider} from '../central/phone.mjs';
import {createSteamQuality} from '../central/steam-quality.mjs';

// The public journal's README: its progress figures feed the roadmap's progress bar.
const PUBLIC_README='https://raw.githubusercontent.com/OWNER/rust-legacy-browser/main/README.md';
const [cmd,arg]=process.argv.slice(2);
const secret=f=>f?readFileSync(f,'utf8').trim():undefined;

export function checkCentralConfig(c){
 const e=[];let pub;
 try{pub=new URL(c.publicUrl);if(pub.protocol!=='https:'&&!c.allowInsecure)e.push('publicUrl must be https');}catch{e.push('publicUrl must be a URL');}
 if(!Array.isArray(c.signingKeys)||!c.signingKeys.length)e.push('signingKeys must list at least one key file');
 if(!c.database)e.push('database path required');
 if(!c.steam?.enabled)e.push('enable steam');
 if(!c.tls&&c.listen?.host!=='127.0.0.1'&&!c.allowInsecure)e.push('serve TLS or listen on 127.0.0.1 behind an HTTPS proxy');
 if(c.testDevSignIn&&!c.allowInsecure)e.push('testDevSignIn is for insecure test deployments only');
 e.push(...trustedProxyErrors(c.trustedProxies));
 if(c.phone&&c.phone.provider!=='console')e.push('phone.provider must be "console" (the only provider so far)');
 if(c.screenshots?.retentionDays!==undefined&&!(Number.isInteger(c.screenshots.retentionDays)&&c.screenshots.retentionDays>=1&&c.screenshots.retentionDays<=365))e.push('screenshots.retentionDays must be 1..365');
 if(c.ips?.retentionDays!==undefined&&!(Number.isInteger(c.ips.retentionDays)&&c.ips.retentionDays>=1&&c.ips.retentionDays<=365))e.push('ips.retentionDays must be 1..365');
 if(c.downloadsDir!==undefined&&(typeof c.downloadsDir!=='string'||!c.downloadsDir))e.push('downloadsDir must be a folder path');
 if(c.mail){if(!['smtp','console'].includes(c.mail.transport))e.push('mail.transport must be smtp or console');
  else if(c.mail.transport==='smtp'){if(!c.mail.host)e.push('mail.host required');if(!c.mail.from)e.push('mail.from required');if(c.mail.user&&!c.mail.passwordFile)e.push('mail.passwordFile required with mail.user');}}
 return e;
}

export function buildCentral(c){
 const pub=new URL(c.publicUrl),origin=pub.origin;
 const providers={};
 if(c.steam?.enabled)providers.steam=steamProvider({returnTo:new URL('/auth/steam/callback',pub).href,realm:origin+'/',apiKey:secret(c.steam.apiKeyFile)});
 // serveGame: the game page lives on this origin at /play, so the website's sessionStorage join hand-off reaches it.
 const game=c.serveGame?createGameHandler({brotliUpgrade:true}):null;
 // mail (see the top): smtp sends account mail and the opening-day email; console prints it; without it they stay hidden.
 const mailer=createMailer(c.mail);
 const progress=createProgress({url:c.progressUrl===undefined?PUBLIC_README:c.progressUrl,snapshot:fileURLToPath(new URL('../site/content/progress.json',import.meta.url))});
 const db=openCentralDb(c.database);
 // /players/<name> answers 404 unless it is a public profile (central/stats.mjs rules: active, not hidden).
 const profileExists=name=>{const p=db.playerByUsernameKey(String(name).toLowerCase());return Boolean(p&&!p.leaderboard_hidden&&p.status==='active');};
 const site=createSiteHandler({providers:Object.keys(providers),publicUrl:pub.href,progress,playUrl:c.playUrl??(game?'/play':null),mail:mailer.enabled,profileExists});
 // Unknown paths that a browser navigates to get the site's 404 page instead of the API's JSON error.
 if(c.testDevSignIn)console.warn('WARNING: testDevSignIn is on: anyone who reaches this site can sign in as any dev identity (test VMs only).');
 const apiKey=c.steam?.enabled?secret(c.steam.apiKeyFile):undefined;
 const identity={...(c.identity?.pepperFile?{pepper:secret(c.identity.pepperFile)}:{}),...(c.identity?.disposableDomainsFile?{disposableFile:c.identity.disposableDomainsFile}:{}),...(c.identity?.hostingRangesFile?{hostingFile:c.identity.hostingRangesFile}:{})};
 // externalServers: optional import of a public Rust Legacy server list (OFFSHOOT-COMPATIBILITY-PLAN.md work item
 // 9), off unless config.externalServers.enabled is explicitly set — the source's terms of use aren't stated, so
 // turning it on is the owner's own call.
 const api=createCentralService({identity,phone:c.phone?createConsolePhoneProvider():null,steamQuality:apiKey?createSteamQuality({apiKey}):null,screenshotRetentionDays:c.screenshots?.retentionDays??30,ipRetentionDays:c.ips?.retentionDays??90,listingReview:c.listingReview===true,externalServers:c.externalServers,...(c.testDevSignIn?{verifyLogin:createDevLoginVerifier()}:{}),db,keys:c.signingKeys.map(loadSigningKey),issuer:origin,providers,publicUrl:pub.href,allowedOrigins:c.allowedOrigins??[origin],secureCookies:pub.protocol==='https:',mailer,trustedProxies:c.trustedProxies,onNotFound:(req,res)=>site(req,res,{fallback:true}),onError:(req,res)=>site(req,res,{fallback:true,error:true})});
 const downloads=createDownloadsHandler(c.downloadsDir);
 return (req,res)=>{
  // The website answers first: its pages, /site/* assets and site-config.json (API twins such as GET /servers fall through).
  if(site(req,res))return;
  if(downloads(req,res))return;
  if(game&&(req.method==='GET'||req.method==='HEAD')){const path=new URL(req.url,'http://central').pathname;
   if(path==='/play'){req.url='/';game(req,res);return;}
   if(/\.[a-z0-9]+$/i.test(path)){game(req,res);return;}}
  api.handle(req,res);};
}

// Site staff (platform_staff) by the account's email or username; returns what changed, throws when nobody matches.
export function staffCommand(db,who,{remove=false,at=Date.now()}={}){
 const key=String(who??'').trim().toLowerCase();
 const p=key.includes('@')?db.playerByEmailKey(key):db.playerByUsernameKey(key);
 if(!p)throw Error(`No account with the ${key.includes('@')?'email':'username'} ${who}`);
 const name=p.username??p.display_name;
 if(remove){if(!db.removeStaff(p.uuid))return `${name} was not site staff`;db.audit(at,'cli','staff-removed',p.uuid);return `${name} is no longer site staff`;}
 if(db.isStaff(p.uuid))return `${name} is already site staff`;
 db.addStaff(p.uuid,at);db.audit(at,'cli','staff-granted',p.uuid);return `${name} is now site staff`;
}

// pathToFileURL: a plain `file://${argv[1]}` never matches on Windows (drive letter, backslashes).
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(cmd==='new-key'){const {kid,file}=writeSigningKey(arg);console.log('Wrote',file,'(kid',kid+')');}
 else if(cmd==='check'||cmd==='run'){
  const c=JSON.parse(readFileSync(arg,'utf8')),errors=checkCentralConfig(c);
  if(errors.length){console.error('Problems:\n - '+errors.join('\n - '));process.exit(1);}
  if(cmd==='check'){console.log('Configuration OK');process.exit(0);}
  const handler=buildCentral(c),server=c.tls?createHttps({cert:readFileSync(c.tls.cert),key:readFileSync(c.tls.key)},handler):createHttp(handler);
  server.listen(c.listen?.port??8443,c.listen?.host??'127.0.0.1',()=>console.log('Central service on',server.address(),'public',c.publicUrl));
 }else if(cmd==='staff'){
  const [who,flag]=process.argv.slice(4);
  if(!who){console.error('usage: node tools/central.mjs staff <config> <email or username> [--remove]');process.exit(2);}
  const c=JSON.parse(readFileSync(arg,'utf8')),db=openCentralDb(c.database);
  try{console.log(staffCommand(db,who,{remove:flag==='--remove'}));}catch(e){console.error(e.message);process.exit(1);}
 }else{console.error('usage: node tools/central.mjs new-key <dir> | check <config> | run <config> | staff <config> <email or username> [--remove]');process.exit(2);}
}
