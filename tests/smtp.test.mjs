// Outgoing mail over SMTP (central/mailer.mjs): message building and a conversation with a fake SMTP server.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {buildMessage,createSmtpMailer,createMailer} from '../central/mailer.mjs';
import {listenServer} from '../bridge/listen.mjs';

// A minimal SMTP server: records the commands and the DATA it receives.
async function fakeSmtp({auth=true,reject=null}={}){
 const sessions=[];
 const server=createServer(sock=>{
  const s={commands:[],data:''};sessions.push(s);let inData=false,buf='';
  const say=l=>sock.write(l+'\r\n');say('220 fake.test ESMTP');
  sock.on('data',chunk=>{buf+=chunk.toString('latin1');let i;
   while((i=buf.indexOf('\r\n'))>=0){const line=buf.slice(0,i);buf=buf.slice(i+2);
    if(inData){if(line==='.'){inData=false;say('250 queued');}else s.data+=line+'\r\n';continue;}
    s.commands.push(line);const verb=line.split(' ')[0].toUpperCase();
    if(reject&&line.startsWith(reject))say('550 no such user');
    else if(verb==='EHLO')say(auth?'250-fake.test\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME':'250 fake.test');
    else if(verb==='AUTH')say(line==='AUTH PLAIN '+Buffer.from('\0mailer\0secret').toString('base64')?'235 ok':'535 bad');
    else if(verb==='DATA'){inData=true;say('354 go');}
    else if(verb==='QUIT'){say('221 bye');sock.end();}
    else say('250 ok');}});
 });
 await listenServer(server);
 return {port:server.address().port,sessions,close:()=>new Promise(r=>server.close(r))};
}

test('messages are plain UTF-8 text with encoded headers and dot-safe base64 bodies', ()=>{
 const m=buildMessage({from:'Rust Legacy <hello@rustlegacy.example>',to:'rook@example.com',subject:'Servers are open — join now',text:'Hello ✓\n.\nBye',
  date:new Date(Date.UTC(2026,9,21,12,0,0)),messageId:'<abc@rustlegacy.example>',headers:{'List-Unsubscribe':'<https://rustlegacy.example/unsubscribe?t=x>'}});
 assert.match(m,/^From: Rust Legacy <hello@rustlegacy\.example>\r\nTo: rook@example\.com\r\n/);
 assert.match(m,/\r\nSubject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=\r\n/);
 assert.match(m,/\r\nDate: Wed, 21 Oct 2026 12:00:00 GMT\r\n/);
 assert.match(m,/\r\nList-Unsubscribe: <https:\/\/rustlegacy\.example\/unsubscribe\?t=x>\r\n/);
 assert.match(m,/\r\nContent-Type: text\/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n/);
 const body=m.split('\r\n\r\n')[1].replace(/\r\n/g,'');assert.equal(Buffer.from(body,'base64').toString('utf8'),'Hello ✓\r\n.\r\nBye');
 assert.ok(m.split('\r\n\r\n')[1].split('\r\n').every(l=>l.length<=76));
 assert.match(buildMessage({from:'a@b.c',to:'d@e.f',subject:'Plain subject',text:'x'}),/\r\nSubject: Plain subject\r\n/);
 assert.throws(()=>buildMessage({from:'a@b.c',to:'d@e.f\r\nBcc: x@y.z',subject:'s',text:'x'}),/header/);
});

test('with html, the message is multipart/alternative carrying both parts intact', ()=>{
 const m=buildMessage({from:'a@b.c',to:'d@e.f',subject:'s',text:'Plain ✓',html:'<p>Styled ✓</p>'});
 const boundaryMatch=/Content-Type: multipart\/alternative; boundary="([^"]+)"/.exec(m);
 assert.ok(boundaryMatch,'declares a multipart boundary');
 const boundary=boundaryMatch[1],parts=m.split('\r\n\r\n').slice(1).join('\r\n\r\n').split(`--${boundary}`).filter(s=>s.trim()&&s.trim()!=='--');
 assert.equal(parts.length,2);
 assert.match(parts[0],/Content-Type: text\/plain; charset=utf-8/);
 assert.match(parts[1],/Content-Type: text\/html; charset=utf-8/);
 const decode=part=>Buffer.from(part.split('\r\n\r\n')[1].replace(/\r\n/g,''),'base64').toString('utf8');
 assert.equal(decode(parts[0]),'Plain ✓');
 assert.equal(decode(parts[1]),'<p>Styled ✓</p>');
 // No header injection through the html body, and headers refuse line breaks exactly as without html.
 assert.throws(()=>buildMessage({from:'a@b.c',to:'d@e.f\r\nBcc: x@y.z',subject:'s',text:'x',html:'<p>x</p>'}),/header/);
});

test('sends one message: EHLO, AUTH PLAIN, envelope from the From address, DATA', async()=>{
 const smtp=await fakeSmtp();
 try{
  const mailer=createSmtpMailer({host:'127.0.0.1',port:smtp.port,user:'mailer',password:'secret',from:'Rust Legacy <hello@rustlegacy.example>',allowInsecureAuth:true});
  assert.equal(mailer.enabled,true);
  await mailer.send({to:'rook@example.com',subject:'Hi',text:'Body'});
  const s=smtp.sessions[0];
  assert.deepEqual(s.commands.map(c=>c.split(' ')[0]),['EHLO','AUTH','MAIL','RCPT','DATA','QUIT']);
  assert.equal(s.commands[2],'MAIL FROM:<hello@rustlegacy.example>');assert.equal(s.commands[3],'RCPT TO:<rook@example.com>');
  assert.match(s.data,/^From: Rust Legacy <hello@rustlegacy\.example>/);
 }finally{await smtp.close();}
});

test('a refused recipient, wrong password or a missing TLS upgrade is an error, never a silent success', async()=>{
 const smtp=await fakeSmtp({reject:'RCPT'});
 try{
  const mailer=createSmtpMailer({host:'127.0.0.1',port:smtp.port,user:'mailer',password:'secret',from:'hello@rustlegacy.example',allowInsecureAuth:true});
  await assert.rejects(mailer.send({to:'nobody@example.com',subject:'Hi',text:'x'}),/550/);
  const wrong=createSmtpMailer({host:'127.0.0.1',port:smtp.port,user:'mailer',password:'nope',from:'hello@rustlegacy.example',allowInsecureAuth:true});
  await assert.rejects(wrong.send({to:'rook@example.com',subject:'Hi',text:'x'}),/535/);
  // Without STARTTLS on offer the password is never sent in the clear.
  const strict=createSmtpMailer({host:'127.0.0.1',port:smtp.port,user:'mailer',password:'secret',from:'hello@rustlegacy.example'});
  await assert.rejects(strict.send({to:'rook@example.com',subject:'Hi',text:'x'}),/STARTTLS/);
  assert.ok(!smtp.sessions.at(-1).commands.some(c=>c.startsWith('AUTH')),'no AUTH over plain text');
 }finally{await smtp.close();}
});

test('createMailer picks the transport from the central config', ()=>{
 assert.equal(createMailer(undefined).enabled,false);
 assert.equal(createMailer({transport:'console'},{log:()=>{}}).enabled,true);
 const smtp=createMailer({transport:'smtp',host:'smtp.example',port:587,user:'u',passwordFile:'pw.txt',from:'hello@rustlegacy.example'},{readSecret:f=>f==='pw.txt'?'pw':null});
 assert.equal(smtp.enabled,true);assert.equal(smtp.from,'hello@rustlegacy.example');
 assert.throws(()=>createMailer({transport:'smtp',host:'smtp.example'}),/from/);
 assert.throws(()=>createMailer({transport:'carrier-pigeon'}),/transport/);
});
