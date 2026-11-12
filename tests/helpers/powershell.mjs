// Static checks for the PowerShell installers where there is no PowerShell (tests/launcher-installer.test.mjs,
// tests/host-desktop.test.mjs): a balance lexer, the script without comments, the dry-run gate, what counts as a change.

// Enough of PowerShell's lexer to check balance: block and line comments, '…' strings ('' escapes), "…" strings
// (` escapes, "" escapes, and $( … ) subexpressions, which hold code and can hold quotes of their own).
export function psBalance(src){
 const stack=[],pairs={')':'(',']':'[','}':'{'};let i=0;
 const fail=what=>{throw Error(`${what} at offset ${i}: …${src.slice(Math.max(0,i-40),i+20)}…`);};
 function code(until){
  while(i<src.length){
   const c=src[i];
   if(c==='<'&&src[i+1]==='#'){const e=src.indexOf('#>',i+2);if(e<0)fail('open block comment');i=e+2;continue;}
   if(c==='#'){const e=src.indexOf('\n',i);i=e<0?src.length:e+1;continue;}
   if(c==='\''){i++;for(;;){if(i>=src.length)fail('open single-quoted string');if(src[i]==='\''){if(src[i+1]==='\''){i+=2;continue;}i++;break;}i++;}continue;}
   if(c==='"'){i++;dquote();continue;}
   if('([{'.includes(c)){stack.push(c);i++;continue;}
   if(')]}'.includes(c)){if(stack.pop()!==pairs[c])fail('unbalanced '+c);i++;if(until!==undefined&&stack.length===until)return;continue;}
   i++;
  }
  if(until!==undefined)fail('open subexpression');
 }
 function dquote(){
  for(;;){
   if(i>=src.length)fail('open double-quoted string');
   const c=src[i];
   if(c==='`'){i+=2;continue;}
   if(c==='"'){if(src[i+1]==='"'){i+=2;continue;}i++;return;}
   if(c==='$'&&src[i+1]==='('){const depth=stack.length;stack.push('(');i+=2;code(depth);continue;}
   i++;
  }
 }
 code();
 if(stack.length)fail('unclosed '+stack.join(''));
 return true;
}
// Strip comments and the help block, so checks look at what runs.
export const body=src=>src.replace(/<#[\s\S]*?#>/g,'').split('\n').filter(l=>!/^\s*#/.test(l)).join('\n');
export const gate=/if \(-not \$Apply\) \{ Write-Host 'Dry run only\. Nothing was changed\. Re-run with -Apply to perform the steps above\.' -ForegroundColor Yellow; exit 0 \}/;
export const CHANGES=/\b(New-Item|Copy-Item|Remove-Item|Move-Item|Rename-Item|Set-Item|New-ItemProperty|Set-ItemProperty|Remove-ItemProperty|Start-Process|Set-Content|Out-File|Set-Location)\b|\.Save\(\)|& /;
