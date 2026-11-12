// Outgoing mail: account mail (password reset, email verification) and the staff opening-day email to the launch list.
// Until a transport is configured the website hides the features that need mail (site-config `mail:false`).
//   central config mail: {transport:'console'}                                    development: print instead of send
//                        {transport:'smtp', host, port?, secure?, user?, passwordFile?, from}
// SMTP works with any provider (the host's own mail, Resend, Postmark, Amazon SES, Mailgun, …): port 587 upgrades with
// STARTTLS, port 465 (or secure:true) is TLS from the start. The password is never sent over an unencrypted link.
import net from 'node:net';
import tls from 'node:tls';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';

export function createConsoleMailer({log=console.log}={}){
 return {enabled:true,from:'console',async send({to,subject,text}){log(`[mail] to=${to} subject=${JSON.stringify(subject)}\n${text}`);}};
}
export function createNullMailer(){return {enabled:false,from:null,async send(){throw new Error('mail is not configured');}};}

const address=s=>{const m=/<([^<>\s]+@[^<>\s]+)>\s*$/.exec(s);return (m?m[1]:s).trim();};
const encodeWord=s=>/^[\x20-\x7e]*$/.test(s)?s:`=?UTF-8?B?${Buffer.from(s,'utf8').toString('base64')}?=`;

const base64Body=text=>Buffer.from(String(text).replace(/\r?\n/g,'\r\n'),'utf8').toString('base64').replace(/.{1,76}/g,'$&\r\n');

// An RFC 5322 message: UTF-8 text, base64 body in 76-character lines, encoded subject. With `html` the message is
// multipart/alternative (plain text part first, styled HTML part second — mail clients render the last part they
// understand). Header values with line breaks are refused (header injection).
export function buildMessage({from,to,subject,text,html=null,headers={},date=new Date(),messageId=null}){
 const base={From:from,To:to,Subject:encodeWord(subject),Date:date.toUTCString(),
  'Message-ID':messageId??`<${randomBytes(12).toString('hex')}@${address(from).split('@')[1]??'localhost'}>`,'MIME-Version':'1.0',...headers};
 let h,body;
 if(html){
  const boundary=`RLB_${randomBytes(16).toString('hex')}`;
  h={...base,'Content-Type':`multipart/alternative; boundary="${boundary}"`};
  const part=(type,content)=>`--${boundary}\r\nContent-Type: ${type}; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64Body(content)}`;
  body=part('text/plain',text)+part('text/html',html)+`--${boundary}--`;
 }else{
  h={...base,'Content-Type':'text/plain; charset=utf-8','Content-Transfer-Encoding':'base64'};
  body=base64Body(text);
 }
 for(const [k,v] of Object.entries(h))if(/[\r\n]/.test(k+String(v)))throw new Error(`mail header ${k} contains a line break`);
 return Object.entries(h).map(([k,v])=>`${k}: ${v}`).join('\r\n')+'\r\n\r\n'+body;
}

const connect=(host,port,secure)=>new Promise((resolve,reject)=>{
 const s=secure?tls.connect({host,port,servername:host}):net.connect({host,port});
 s.once(secure?'secureConnect':'connect',()=>resolve(s));s.once('error',reject);
});

// One SMTP conversation: replies are queued as they arrive, cmd() sends a line and checks the reply code.
async function smtpSession({host,port,secure,timeoutMs}){
 let sock,buf='',lines=[],failed=null;const replies=[],waiters=[];
 const fail=e=>{failed??=e;for(const w of waiters.splice(0))w.reject(failed);};
 const feed=d=>{buf+=d.toString('latin1');let i;
  while((i=buf.indexOf('\r\n'))>=0){const line=buf.slice(0,i);buf=buf.slice(i+2);lines.push(line);
   if(/^\d{3}(?: |$)/.test(line)){const reply=lines;lines=[];const w=waiters.shift();if(w)w.resolve(reply);else replies.push(reply);}}};
 const bind=s=>{sock=s;s.setTimeout(timeoutMs,()=>{fail(new Error('SMTP timed out'));s.destroy();});s.on('data',feed);s.on('error',fail);s.on('close',()=>fail(new Error('SMTP connection closed')));};
 const unbind=s=>{for(const ev of ['data','error','close'])s.removeAllListeners(ev);s.setTimeout(0);};
 const read=()=>replies.length?Promise.resolve(replies.shift()):failed?Promise.reject(failed):new Promise((resolve,reject)=>waiters.push({resolve,reject}));
 bind(await connect(host,port,secure));
 return {
  // Errors name the command, never its arguments (AUTH carries the credentials).
  async cmd(line,ok){
   if(line!=null)sock.write(line+'\r\n');const r=await read(),code=Number(r.at(-1).slice(0,3));
   if(!ok.includes(code))throw new Error(`SMTP ${line==null?'greeting':line.split(/[ :]/)[0]} refused: ${r.join(' | ')}`);return r;
  },
  async startTls(){const plain=sock;unbind(plain);bind(await new Promise((resolve,reject)=>{const s=tls.connect({socket:plain,servername:host},()=>resolve(s));s.once('error',reject);}));},
  close(){sock.end();},
 };
}

export function createSmtpMailer({host,port=587,secure=port===465,user=null,password=null,from,helo='rustlegacy-central',allowInsecureAuth=false,timeoutMs=20000}){
 return {
  enabled:true,from,
  async send({to,subject,text,html,headers}){
   const message=buildMessage({from,to,subject,text,html,headers});
   const s=await smtpSession({host,port,secure,timeoutMs});let encrypted=secure;
   try{
    await s.cmd(null,[220]);
    let ehlo=await s.cmd(`EHLO ${helo}`,[250]);const offers=word=>ehlo.some(l=>l.slice(4).toUpperCase().startsWith(word));
    if(!encrypted&&offers('STARTTLS')){await s.cmd('STARTTLS',[220]);await s.startTls();encrypted=true;ehlo=await s.cmd(`EHLO ${helo}`,[250]);}
    if(user){
     if(!encrypted&&!allowInsecureAuth)throw new Error('SMTP server offered no STARTTLS: not sending the password unencrypted (use port 465 or a server with STARTTLS)');
     await s.cmd('AUTH PLAIN '+Buffer.from(`\0${user}\0${password??''}`,'utf8').toString('base64'),[235]);
    }
    await s.cmd(`MAIL FROM:<${address(from)}>`,[250]);
    await s.cmd(`RCPT TO:<${address(to)}>`,[250,251]);
    await s.cmd('DATA',[354]);
    await s.cmd(message.replace(/^\./gm,'..')+'.',[250]);
    await s.cmd('QUIT',[221]).catch(()=>{});
   }finally{s.close();}
  },
 };
}

// The mailer for a central config `mail` block (see the top of this file).
export function createMailer(config,{log,readSecret=f=>readFileSync(f,'utf8').trim()}={}){
 if(!config)return createNullMailer();
 if(config.transport==='console')return createConsoleMailer({log});
 if(config.transport==='smtp'){
  if(!config.host)throw new Error('mail.host is required for smtp');
  if(!config.from)throw new Error('mail.from is required for smtp (e.g. "Rust Legacy <hello@your-domain>")');
  return createSmtpMailer({host:config.host,port:config.port??587,secure:config.secure,user:config.user??null,password:config.passwordFile?readSecret(config.passwordFile):null,from:config.from});
 }
 throw new Error(`unknown mail transport ${JSON.stringify(config.transport)} (use smtp or console)`);
}
