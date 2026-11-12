// Markdown content indexes (tools/build-site.mjs) and the wiki's guide grouping (site/js/wiki-view.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {indexMarkdown,guideEntry} from '../tools/build-site.mjs';
import {groupGuides,GUIDE_GROUPS,featuredGuides} from '../site/js/wiki-view.mjs';

test('indexMarkdown reads front matter of every slug-named .md file',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'rlb-content-'));
 try{
  await writeFile(path.join(dir,'cooking.md'),'---\ntitle: Food and cooking\nsummary: "Fires: what cooks where"\ngroup: Survival\norder: 2\nimage: /site/generated/media/guides/campfire.jpg\n---\nBody');
  await writeFile(path.join(dir,'Bad Name.md'),'---\ntitle: Skipped\n---\n');
  await writeFile(path.join(dir,'notes.txt'),'ignored');
  assert.deepEqual(await indexMarkdown(dir),[{slug:'cooking',title:'Food and cooking',summary:'Fires: what cooks where',group:'Survival',order:2,image:'/site/generated/media/guides/campfire.jpg'}]);
  await writeFile(path.join(dir,'untitled.md'),'No front matter');
  await assert.rejects(indexMarkdown(dir,{required:['title']}),/untitled\.md: front matter needs title/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('guides group in the fixed group order, then by order and title',()=>{
 const g=groupGuides([{slug:'a',title:'Zed',group:'Survival',order:2},{slug:'b',title:'Alpha',group:'Survival',order:2},{slug:'c',title:'First',group:'Start here',order:1},{slug:'d',title:'Odd',group:'Elsewhere'}]);
 assert.deepEqual(g.map(([name,list])=>[name,list.map(x=>x.slug)]),[['Start here',['c']],['Survival',['b','a']],['Elsewhere',['d']]]);
 assert.equal(GUIDE_GROUPS[0],'Start here');
});

test('guide index entries carry an optional featured rank as a number',()=>{
 assert.deepEqual(guideEntry({slug:'raiding',title:'Raiding',group:'Combat & raiding',order:4,featured:'2'}),
  {slug:'raiding',title:'Raiding',summary:'',group:'Combat & raiding',order:4,featured:2,image:null,tags:''});
 assert.equal(guideEntry({slug:'decay',title:'Decay',group:'Building'}).featured,null);
});

test('featured guides are listed by rank, the rest left out',()=>{
 const list=[{slug:'a',title:'A',featured:2},{slug:'b',title:'B'},{slug:'c',title:'C',featured:1},{slug:'d',title:'D',featured:null}];
 assert.deepEqual(featuredGuides(list).map(g=>g.slug),['c','a']);
 assert.deepEqual(featuredGuides([]),[]);
});
