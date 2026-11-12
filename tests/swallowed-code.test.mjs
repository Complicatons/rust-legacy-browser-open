// Catches code swallowed by a // comment on a minified line. Twice an inline comment added in the middle of a long line in
// browser/main.mjs hid the declaration after it (`const speed=` in 723b5fa, `const pos=…moving=` in eb3f005): the file
// still parses, node tests never load main.mjs, and the game throws a ReferenceError every frame. A comment whose text
// holds a minified declaration (`const x=`, no space before the `=` as prose would have) is flagged.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

// The // comment text of a line, or null. Skips quotes and template literals (escapes included); a regex literal
// holding // is not expected in these files.
export function lineComment(line){
 let q=null;
 for(let i=0;i<line.length;i++){
  const c=line[i];
  if(q){if(c==='\\')i++;else if(c===q)q=null;continue;}
  if(c==='"'||c==="'"||c==='`')q=c;
  else if(c==='/'&&line[i+1]==='/')return line.slice(i+2);
  else if(c==='/'&&line[i+1]==='*'){const e=line.indexOf('*/',i+2);if(e<0)return null;i=e+1;}
 }
 return null;
}
// No word boundary before the keyword: in eb3f005 the newline was lost too ("…no armourconst pos=…").
export const swallowed=text=>/(const|let|var)\s+[A-Za-z_$][\w$]*=[^=]/.test(text);

test('lineComment finds the comment outside strings',()=>{
 assert.equal(lineComment("a='http://x';b=1; // note"),' note');
 assert.equal(lineComment('const u=`//${a}`;'),null);
 assert.equal(lineComment('x=1;/* a // b */y=2;'),null);
 assert.ok(swallowed(' world clock const speed=3,b=2;'));
 assert.ok(swallowed(' a float, no armourconst pos=playerTarget.position,moving=1;'));
 assert.ok(!swallowed(' const x = 1 is prose-like'));
});

test('no // comment in browser/, bridge/ or central/ swallows a minified declaration',()=>{
 const bad=[];
 for(const dir of ['browser','bridge','central'])for(const f of readdirSync(path.join(root,dir)).filter(f=>f.endsWith('.mjs'))){
  readFileSync(path.join(root,dir,f),'utf8').split('\n').forEach((line,i)=>{
   const c=lineComment(line);if(c!==null&&swallowed(c))bad.push(`${dir}/${f}:${i+1}: //${c.slice(0,100)}`);
  });
 }
 assert.deepEqual(bad,[],'code after a // comment never runs; end the comment with a new line:\n'+bad.join('\n'));
});
