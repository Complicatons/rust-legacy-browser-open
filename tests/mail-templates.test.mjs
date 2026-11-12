// Branded HTML account mail (central/mail-templates.mjs): matches the plain-text content, escapes user-visible
// text, and never reaches outside the message (no webfonts, no tracking pixels, no external resources).
import test from 'node:test';
import assert from 'node:assert/strict';
import {verificationEmail,passwordResetEmail,waitlistMailHtml} from '../central/mail-templates.mjs';

test('verificationEmail: html carries the same link as the text, with the name escaped', ()=>{
 const {subject,text,html}=verificationEmail({name:'<script>Rook</script>',url:'https://your-domain.example/auth/verify-email?token=abc'});
 assert.equal(subject,'Confirm your email for Rust Legacy Browser');
 assert.match(text,/https:\/\/your-domain.example\/auth\/verify-email\?token=abc/);
 assert.match(html,/<!doctype html>/i);
 assert.match(html,/href="https:\/\/your-domain.example\/auth\/verify-email\?token=abc"/);
 assert.ok(!html.includes('<script>Rook</script>'),'the name is escaped, not injected as markup');
 assert.match(html,/&lt;script&gt;Rook&lt;\/script&gt;/);
 assert.match(html,/Confirm email/);
});

test('passwordResetEmail: html carries the reset link and the time limit', ()=>{
 const {subject,text,html}=passwordResetEmail({name:'Rook',url:'https://your-domain.example/reset?token=xyz'});
 assert.equal(subject,'Reset your Rust Legacy Browser password');
 assert.match(text,/30 minutes/);
 assert.match(html,/href="https:\/\/your-domain.example\/reset\?token=xyz"/);
 assert.match(html,/30 minutes/);
});

test('waitlistMailHtml: renders staff text as paragraphs and links the unsubscribe URL, escaping the body', ()=>{
 const html=waitlistMailHtml({subject:'Servers are open',text:'Come and play.\n\nSee you there <3',launchUrl:'https://your-domain.example/launch',unsubscribeUrl:'https://your-domain.example/unsubscribe?t=abc123'});
 assert.match(html,/Come and play\./);
 assert.match(html,/See you there &lt;3/);
 assert.match(html,/href="https:\/\/your-domain.example\/unsubscribe\?t=abc123"[^>]*>Unsubscribe</);
 assert.match(html,/href="https:\/\/your-domain.example\/launch"/);
});

test('templates never load outside resources', ()=>{
 for(const html of [
  verificationEmail({name:'Rook',url:'https://your-domain.example/x'}).html,
  passwordResetEmail({name:'Rook',url:'https://your-domain.example/x'}).html,
  waitlistMailHtml({subject:'s',text:'t',launchUrl:'https://your-domain.example/launch',unsubscribeUrl:'https://your-domain.example/u'}),
 ]){
  assert.ok(!/<img|<script|@font-face|url\(/i.test(html),'no images, scripts or external fonts');
 }
});
