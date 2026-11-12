import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {CodeLock,doorMenu,canToggleDoor,enterCode,setLockActive,hasCodeLock,DOOR_ACTIONS as A} from '../browser/locks.mjs';
import {needsAssets} from './helpers/assets.mjs';

test('only the original door and gate prefabs carry code locks',needsAssets, async()=>{
 const m=JSON.parse(await readFile(new URL('../browser/assets/recovered/deployables/manifest.json',import.meta.url)));
 assert.deepEqual(Object.entries(m.prefabs).filter(([,p])=>hasCodeLock(p)).map(([k])=>k).sort(),[';deploy_metal_door',';deploy_wood_door',';deploy_woodgate']);
});

test('owner menu, code entry, back-off and access follow BasicDoor/lockentry', ()=>{
 const lock=new CodeLock(),owner='1',guest='2';
 assert.deepEqual(doorMenu({lock,isOwner:true,open:false,userId:owner}),[A.open,A.unlock,A.changeLock]);
 assert.deepEqual(doorMenu({lock,isOwner:false,open:false,userId:guest}),[A.enterCode]);
 assert.equal(canToggleDoor({lock,isOwner:false,userId:guest}),false);
 // No password set yet: no code works.
 assert.equal(enterCode({lock,code:'1234',isOwner:false,userId:guest,time:10}).message,'Incorrect password.');
 assert.equal(enterCode({lock,code:'1234',changing:true,isOwner:false,userId:guest,time:20}).ok,false);
 assert.equal(enterCode({lock,code:'1234',changing:true,isOwner:true,userId:owner,time:20}).message,'Password is now : 1234');
 assert.equal(enterCode({lock,code:'9999',isOwner:false,userId:guest,time:30}).message,'Incorrect password.');
 assert.equal(enterCode({lock,code:'1234',isOwner:false,userId:guest,time:33}).message,'Too fast! Try again later.');
 assert.equal(enterCode({lock,code:'12a4',isOwner:false,userId:guest,time:40}).ok,false);
 assert.equal(enterCode({lock,code:'1234',isOwner:false,userId:guest,time:40}).message,'You can now access this door!');
 assert.equal(canToggleDoor({lock,isOwner:false,userId:guest}),true);
 assert.deepEqual(doorMenu({lock,isOwner:false,open:true,userId:guest}),[A.close]);
 // Changing the code removes everyone's access; unlocking opens the door to all.
 enterCode({lock,code:'5555',changing:true,isOwner:true,userId:owner,time:50});
 assert.equal(canToggleDoor({lock,isOwner:false,userId:guest}),false);
 assert.equal(setLockActive(lock,false),'Door is now unlocked');
 assert.equal(canToggleDoor({lock,isOwner:false,userId:guest}),true);
 assert.deepEqual(doorMenu({lock,isOwner:false,open:false,userId:guest}),[A.open,A.enterCode]);
 assert.deepEqual(CodeLock.load(lock.save()).save(),lock.save());
});
