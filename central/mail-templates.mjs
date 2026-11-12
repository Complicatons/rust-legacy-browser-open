// Branded HTML for outgoing account mail (verification, password reset, the launch-list mailing), mirroring the
// site's dark theme (site/css/tokens.css: near-black panels, off-white body text, the orange accent for the one
// call-to-action). No webfonts or other external resources — mail clients strip or block them inconsistently, and
// a self-contained message is one less thing that can go wrong in transit. Every builder here also returns the
// plain-text version, sent alongside the HTML as the multipart/alternative fallback (central/mailer.mjs).
const BG='#0a0a0a',PANEL='#111111',BORDER='#262626',TEXT='#f2efe9',FAINT='#7f7b75',ORANGE='#cd5a28',ORANGE_FILL='#c0501e';
const FONT='Arial,Helvetica,sans-serif';

const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Plain text, escaped, blank lines become paragraph breaks and single line breaks become <br>.
const textToHtml=text=>String(text).trim().split(/\n{2,}/).map(block=>
 `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${TEXT}">${esc(block).replace(/\n/g,'<br>')}</p>`).join('');

// The shared shell: a dark panel with the wordmark, a heading, a body (raw HTML — callers escape their own text),
// and an optional fine-print footer (raw HTML, so it can hold an unsubscribe link). preheader is the hidden preview
// text inboxes show next to the subject.
function shell({preheader='',heading,bodyHtml,footerHtml=''}){
 return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(heading)}</title></head>
<body style="margin:0;padding:0;background:${BG}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BG}"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="width:480px;max-width:100%;background:${PANEL};border:1px solid ${BORDER}">
<tr><td style="padding:24px 32px 0">
<span style="font:900 13px/1 ${FONT};letter-spacing:.08em;text-transform:uppercase;color:${ORANGE}">Rust Legacy Browser</span>
</td></tr>
<tr><td style="padding:20px 32px 4px">
<h1 style="margin:0 0 20px;font:900 24px/1.2 ${FONT};letter-spacing:.01em;text-transform:uppercase;color:${TEXT}">${esc(heading)}</h1>
${bodyHtml}
</td></tr>
${footerHtml?`<tr><td style="padding:20px 32px 28px;border-top:1px solid ${BORDER}">${footerHtml}</td></tr>`:''}
</table>
</td></tr></table>
</body></html>`;
}

const footerLine=t=>`<p style="margin:0 0 8px;font-size:12px;line-height:1.6;color:${FAINT}">${t}</p>`;

// Body paragraph(s) plus a single call-to-action button, for the account-mail templates below.
function ctaBody(paragraphs,button){
 const p=paragraphs.map(t=>`<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${TEXT}">${esc(t)}</p>`).join('');
 const btn=`<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px"><tr><td style="background:${ORANGE_FILL}">
<a href="${esc(button.url)}" style="display:inline-block;padding:14px 30px;font:bold 13px/1 ${FONT};letter-spacing:.06em;text-transform:uppercase;color:#ffffff;text-decoration:none">${esc(button.text)}</a>
</td></tr></table>
<p style="margin:0 0 4px;font-size:12px;line-height:1.6;color:${FAINT}">Or copy this link:</p>
<p style="margin:0;font-size:12px;line-height:1.6;color:${ORANGE};word-break:break-all">${esc(button.url)}</p>`;
 return p+btn;
}

export function verificationEmail({name,url}){
 const subject='Confirm your email for Rust Legacy Browser';
 const text=`Confirm this address for ${name}:\n\n${url}\n\nThe link works for 24 hours. If you did not ask for this, ignore this email.`;
 const html=shell({preheader:`Confirm your email for ${name}`,heading:'Confirm your email',
  bodyHtml:ctaBody([`Confirm this address for ${name}.`],{text:'Confirm email',url}),
  footerHtml:footerLine('The link works for 24 hours. If you did not ask for this, you can ignore this email.')});
 return {subject,text,html};
}

export function passwordResetEmail({name,url}){
 const subject='Reset your Rust Legacy Browser password';
 const text=`Choose a new password for ${name}:\n\n${url}\n\nThe link works for 30 minutes and once. If you did not ask for this, ignore this email.`;
 const html=shell({preheader:`Reset your password, ${name}`,heading:'Reset your password',
  bodyHtml:ctaBody([`Choose a new password for ${name}.`],{text:'Reset password',url}),
  footerHtml:footerLine('The link works for 30 minutes and once. If you did not ask for this, you can ignore this email.')});
 return {subject,text,html};
}

// HTML for a staff-composed launch-list mailing (central/waitlist.mjs): free-form text plus the unsubscribe
// footer every recipient gets. subject is used only for the hidden preheader.
export function waitlistMailHtml({subject,text,launchUrl,unsubscribeUrl}){
 return shell({preheader:subject,heading:'Rust Legacy Browser',bodyHtml:textToHtml(text),
  footerHtml:footerLine(`You're getting this because you signed up at <a href="${esc(launchUrl)}" style="color:${FAINT}">${esc(launchUrl)}</a> to hear when Rust Legacy Browser opens.`)
   +footerLine(`<a href="${esc(unsubscribeUrl)}" style="color:${FAINT}">Unsubscribe</a>`)});
}
