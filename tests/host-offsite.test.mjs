// Off-site backups (host/offsite.mjs): one set = the newest good save + the userdata player folder + the sidecar's
// identity map, sent to a folder or an S3-compatible bucket (a local fake that checks every SigV4 signature),
// encrypted with the owner's passphrase, kept by retention, and restored only with the server and sidecar stopped.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,readdirSync,statSync,openSync,writeSync,closeSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createOffsite,retained,offsiteConfigErrors} from '../host/offsite.mjs';
import {writeTar,readTar,encryptFile,decryptFile} from '../host/offsite-files.mjs';
import {startFakeS3} from './helpers/fake-s3.mjs';

function world(root){
 const server=join(root,'Rust Server','rust_server_Data'),savePath=join(server,'rust_island_2013.sav'),userdataDir=join(server,'userdata');
 mkdirSync(join(userdataDir,'76561190000000301'),{recursive:true});mkdirSync(join(userdataDir,'90000000000000101'),{recursive:true});
 writeFileSync(join(userdataDir,'76561190000000301','avatar.bin'),Buffer.from('desktop avatar'));
 writeFileSync(join(userdataDir,'90000000000000101','avatar.bin'),Buffer.from('browser avatar'));
 writeFileSync(savePath,'live world v1');
 const good=join(root,'backups','last-good');mkdirSync(good,{recursive:true});writeFileSync(join(good,'kept.sav'),'good world v1');
 const identityFile=join(root,'sidecar','identities.json');mkdirSync(join(root,'sidecar'),{recursive:true});
 writeFileSync(identityFile,JSON.stringify({version:1,entries:[{subject:'p1',backendId:'90000000000000101'}]}));
 return {savePath,userdataDir,identityFile,backupDir:join(root,'backups'),lastGood:()=>({file:join(good,'kept.sav'),name:'kept.sav',at:1,objects:42})};
}

test('offsite files: tar round trip, unsafe entries refused; encryption round trip, wrong passphrase and tampering refused',async()=>{
 const root=mkdtempSync(join(tmpdir(),'rlb-osf-'));
 try{
  const src=join(root,'src');mkdirSync(join(src,'a','b'),{recursive:true});writeFileSync(join(src,'a','b','avatar.bin'),Buffer.alloc(1300,7));writeFileSync(join(src,'top.txt'),'x');
  const tar=join(root,'u.tar');assert.deepEqual(writeTar(src,'userdata',tar),{files:2,bytes:1301});
  assert.deepEqual(readTar(tar,'userdata',join(root,'out')),{files:2,bytes:1301});
  assert.deepEqual(readFileSync(join(root,'out','a','b','avatar.bin')),Buffer.alloc(1300,7));
  assert.deepEqual(writeTar(join(root,'missing'),'userdata',join(root,'empty.tar')),{files:0,bytes:0}); // no folder yet: an empty archive
  // A hand-made archive with ../ in a name never writes outside the target.
  const bad=readFileSync(tar);bad.write('userdata/../../evil.txt\0',512*1,'utf8');
  let sum=0;for(let i=512;i<1024;i++)sum+=i>=512+148&&i<512+156?32:bad[i];bad.write(sum.toString(8).padStart(6,'0')+'\0 ',512+148);
  writeFileSync(join(root,'bad.tar'),bad);
  assert.throws(()=>readTar(join(root,'bad.tar'),'userdata',join(root,'out2')),/outside the folder/);
  assert.ok(!existsSync(join(root,'evil.txt')));
  const big=join(root,'big.bin');writeFileSync(big,Buffer.alloc(3<<20,9));
  await encryptFile(big,big+'.enc','correct horse battery');
  assert.notDeepEqual(readFileSync(big+'.enc').subarray(40,80),Buffer.alloc(40,9));
  await decryptFile(big+'.enc',big+'.out','correct horse battery');assert.deepEqual(readFileSync(big+'.out'),readFileSync(big));
  await assert.rejects(decryptFile(big+'.enc',join(root,'wrong.out'),'wrong horse battery'),/Wrong passphrase/);assert.ok(!existsSync(join(root,'wrong.out')));
  const fd=openSync(big+'.enc','r+');writeSync(fd,Buffer.from([0]),0,1,1000);closeSync(fd);
  await assert.rejects(decryptFile(big+'.enc',join(root,'t.out'),'correct horse battery'),/changed after it was made/);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('offsite retention: newest N, plus the newest set of each day for D days',()=>{
 const day=86400e3,now=Date.UTC(2026,9,24,12),id=t=>'rlb-'+new Date(t).toISOString().replace(/[-:]/g,'').replace('T','-').replace(/\.(\d{3})Z$/,'-$1');
 const ids=[];for(let d=0;d<20;d++)for(const h of [1,7,13])if(now-d*day-(12-h)*3600e3<=now)ids.push(id(now-d*day-(12-h)*3600e3));
 const keep=retained(ids,{keepRecent:3,keepDays:5},now);
 // 3 newest (today 13:00 is in the future of "now", so today 07:00, 01:00 and yesterday 13:00) + newest of days 1..5.
 assert.ok(keep.has(id(now-5*3600e3))&&keep.has(id(now-11*3600e3))&&keep.has(id(now-day+3600e3)));
 for(let d=2;d<=4;d++)assert.ok(keep.has(id(now-d*day+3600e3)),'daily '+d);
 assert.ok(!keep.has(id(now-day-5*3600e3)),'an older set of a kept day goes');
 assert.ok(!keep.has(id(now-10*day+3600e3)),'past keepDays goes');
 assert.equal(keep.size,7);
 assert.deepEqual(offsiteConfigErrors({folder:'D:/Backups',target:'folder'}),[]);
 assert.match(offsiteConfigErrors({target:'s3',s3:{endpoint:'http://s3.example.com',bucket:'bkt',accessKeyId:'AKIA1234'}}).join(),/https/);
});

test('offsite to a folder: a set with save, players and identities; schedule; retention; restore rules and set aside',async()=>{
 const root=mkdtempSync(join(tmpdir(),'rlb-osd-')),folder=join(root,'OneDrive','RLB backups');mkdirSync(folder,{recursive:true});
 const w=world(root),logs=[];let t=Date.UTC(2026,9,24,10,0,0),blocked='Stop the game server first';
 const o=createOffsite({dataDir:join(root,'data'),...w,config:{folder},canRestore:()=>blocked,now:()=>t,log:m=>logs.push(m)});
 try{
  assert.equal((await o.status()).settings.target,'off');
  assert.equal(o.tick(),false,'off means no runs');
  assert.throws(()=>o.saveSettings({target:'s3'}),/endpoint/);
  o.saveSettings({target:'folder',everyHours:6,dailyHour:4,keepRecent:2,keepDays:3});
  const st=await o.status();assert.equal(st.settings.encrypt,false,'a folder is not encrypted unless asked');assert.equal(st.nextAt,t,'first run at once');
  const r=await o.backupNow();assert.equal(r.ok,true);assert.equal(r.identities,1);assert.equal(r.userdataFiles,2);
  const sets=readdirSync(folder);assert.equal(sets.length,1);
  assert.deepEqual(readdirSync(join(folder,sets[0])).sort(),['identities.json','set.json','userdata.tar','world.sav']);
  assert.equal(readFileSync(join(folder,sets[0],'world.sav'),'utf8'),'good world v1','the guard\'s good copy, not the live file');
  const m=JSON.parse(readFileSync(join(folder,sets[0],'set.json'),'utf8'));assert.equal(m.save.objects,42);assert.equal(m.objects.length,3);
  // Schedule: next run 6 hours later; nothing due before.
  assert.equal((await o.status()).nextAt,t+6*3600e3);t+=3600e3;assert.equal(o.tick(),false);
  // Encrypted from now on; passphrase is write-only.
  assert.throws(()=>o.saveSettings({encrypt:true,passphrase:'short'}),/10 to 200/);
  o.saveSettings({encrypt:true,passphrase:'a long owner passphrase'});
  const s2=await o.status({refresh:true});assert.deepEqual(s2.secrets,{s3SecretKey:false,passphrase:true});assert.ok(!JSON.stringify(s2).includes('a long owner passphrase'));
  for(let i=0;i<4;i++){t+=7*3600e3;await o.backupNow();}
  const after=(await o.status({refresh:true})).sets;
  // keepRecent 2 + newest of each of the last 3 days.
  assert.ok(after.length>=3&&after.length<=4,`kept ${after.length}`);assert.ok(after[0].encrypted);
  assert.ok(readdirSync(join(folder,after[0].id)).includes('world.sav.enc'));
  // Restore: refused while the server runs.
  await assert.rejects(o.restore(after[0].id),/Stop the game server first/);
  blocked=null;
  writeFileSync(w.savePath,'live world v2');writeFileSync(join(w.userdataDir,'76561190000000301','avatar.bin'),'changed');writeFileSync(w.identityFile,'{"version":1,"entries":[]}');
  const back=await o.restore(after[0].id);
  assert.equal(readFileSync(w.savePath,'utf8'),'good world v1');
  assert.equal(readFileSync(join(w.userdataDir,'76561190000000301','avatar.bin'),'utf8'),'desktop avatar');
  assert.equal(JSON.parse(readFileSync(w.identityFile,'utf8')).entries.length,1);
  assert.deepEqual(back.moved.sort(),['identities.json','rust_island_2013.sav','userdata']);
  assert.equal(readFileSync(join(back.setAside,'rust_island_2013.sav'),'utf8'),'live world v2','the replaced save is set aside, not deleted');
  assert.match(back.setAside,/backups[\\/]replaced-\d{8}-\d{6}-\d{3}$/);
  // A changed file in the folder is refused before anything is touched; so is a wrong passphrase.
  writeFileSync(w.savePath,'live world v3');
  const f=join(folder,after[0].id,'world.sav.enc'),b=readFileSync(f);b[b.length-20]^=1;writeFileSync(f,b);
  await assert.rejects(o.restore(after[0].id),/does not match its set/);
  await assert.rejects(o.restore(after[1].id,{passphrase:'not the passphrase!'}),/Wrong passphrase/);
  assert.equal(readFileSync(w.savePath,'utf8'),'live world v3');
  await assert.rejects(o.restore('../../etc'),/unknown set/);
  // The folder disappearing (a share offline) is a clear failure, recorded for the page.
  rmSync(folder,{recursive:true,force:true});
  await assert.rejects(o.backupNow(),/not there|ENOENT/);
  assert.equal((await o.status()).last.ok,false);
 }finally{o.stop();rmSync(root,{recursive:true,force:true});}
});

test('offsite to S3 (signed requests, paging): encrypted by default, list, prune, restore; bad secret refused',async()=>{
 const root=mkdtempSync(join(tmpdir(),'rlb-oss-')),w=world(root);let t=Date.UTC(2026,9,24,10);
 const s3=await startFakeS3({bucket:'rlb-saves',accessKeyId:'AKIATESTKEY0001',secretAccessKey:'test-secret-key-0001',region:'eu-central-003',pageSize:2});
 const o=createOffsite({dataDir:join(root,'data'),...w,canRestore:()=>null,now:()=>t});
 try{
  o.saveSettings({target:'s3',keepRecent:2,keepDays:0,s3:{endpoint:s3.endpoint,region:'eu-central-003',bucket:'rlb-saves',prefix:'host-a',accessKeyId:'AKIATESTKEY0001'},s3SecretKey:'test-secret-key-0001'});
  await assert.rejects(o.backupNow(),/set a passphrase/);
  o.saveSettings({passphrase:'bucket passphrase 123'});
  const st=await o.status();assert.equal(st.settings.encrypt,true);assert.equal(st.settings.s3.prefix,'host-a/');assert.ok(!JSON.stringify(st).includes('test-secret-key'));
  for(let i=0;i<3;i++){await o.backupNow();t+=3600e3;}
  const sets=(await o.status({refresh:true})).sets;
  assert.equal(sets.length,2,'retention removed the oldest set (listing went over several pages)');
  assert.ok([...s3.objects.keys()].every(k=>k.startsWith('host-a/rlb-')));
  assert.ok([...s3.objects.keys()].some(k=>k.endsWith('/world.sav.enc')));
  assert.ok(s3.log.some(l=>l.startsWith('DELETE ')));
  writeFileSync(w.savePath,'live world v2');rmSync(w.userdataDir,{recursive:true});
  const r=await o.restore(sets[1].id);
  assert.equal(readFileSync(w.savePath,'utf8'),'good world v1');
  assert.ok(existsSync(join(w.userdataDir,'90000000000000101','avatar.bin')));
  assert.deepEqual(r.moved.sort(),['identities.json','rust_island_2013.sav']);
  // A wrong secret: the store refuses the signature, and the page gets the store's own words.
  o.saveSettings({s3SecretKey:'wrong-secret-key-9'});
  await assert.rejects(o.backupNow(),/403 SignatureDoesNotMatch/);
  assert.match((await o.status({refresh:true})).listError,/SignatureDoesNotMatch/);
  // Only https or loopback endpoints.
  assert.throws(()=>o.saveSettings({s3:{endpoint:'http://s3.example.com'}}),/https/);
 }finally{o.stop();await s3.close();rmSync(root,{recursive:true,force:true});}
});
