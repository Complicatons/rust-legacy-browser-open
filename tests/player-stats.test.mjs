// Gateway leaderboard counts (bridge/player-stats.mjs) from server messages, as game-bridge emits them.
import test from 'node:test';
import assert from 'node:assert/strict';
import {PlayerStats,speciesOf,PLACE_MS,MAX_STEP_SPEED} from '../bridge/player-stats.mjs';

// Our player is uLink player 7 with character view 100; another player (8) has view 200; a wolf is view 300.
function setup(){
 const clock={s:0,ms:1_800_000_000_000},views=new Map([[100,{prefab:':player_soldier',owner:7}],[200,{prefab:':player_soldier',owner:8}],[300,{prefab:':wolf',owner:0}],[301,{prefab:':mutant_bear_prefab',owner:0}],[150,{prefab:'CraftingInventory',owner:7}]]);
 const st=new PlayerStats({subject:'s',client:{playerId:7},views,now:()=>clock.s,wallNow:()=>clock.ms});
 st.observe({type:'create',mine:true,prefab:':player_soldier',viewId:100});
 const rpc=(viewId,name,values,cls)=>st.observe({type:'rpc',viewId,name,args:{class:cls,values}});
 return {st,clock,rpc,views};
}

test('kills and deaths come from the server death calls and their attacker view', () => {
 const {st,rpc}=setup();
 rpc(300,'ClientDeath',[[1,2,3],100],'BasicWildLifeAI');
 rpc(300,'ClientDeath',[[1,2,3],100],'BasicWildLifeAI'); // the same animal twice: once
 rpc(301,'ClientDeath',[[1,2,3],200],'HostileWildlifeAI'); // someone else's kill
 rpc(200,'Client_OnKilledShotBy',[100,[0,0,0],[0,0],9],'DeathTransfer'); // we shot player 8
 rpc(200,'Client_OnKilledBy',[100],'DeathTransfer'); // the same death again: once
 rpc(100,'Client_OnKilled',[],'DeathTransfer'); // we died
 assert.deepEqual(st.drain(),{'animal:wolf':1,pvp:1,death:1});
 assert.equal(st.drain(),null);
 assert.equal(speciesOf(':mutant_bear_prefab'),'mutant-bear');
});

test('gathering from the server inventory notices; other console text is ignored', () => {
 const {st,rpc}=setup();
 rpc(997,'CL_ConsoleMessage',['notice.inventory "10 x Wood"'],'ConsoleNetworker');
 rpc(997,'CL_ConsoleMessage',['notice.inventory "3 x Metal Ore"'],'ConsoleNetworker');
 rpc(997,'CL_ConsoleMessage',['notice.popup 5 q "10 x Wood"'],'ConsoleNetworker');
 rpc(996,'CL_ConsoleMessage',['notice.inventory "10 x Wood"'],'ConsoleNetworker');
 assert.deepEqual(st.drain(),{'gather:wood':10,'gather:metal-ore':3});
});

test('crafting counts when the progress reaches the duration, not when it is cancelled', () => {
 const {st,rpc,clock}=setup();
 rpc(150,'CRFU',[0,10,1,0,555,2],'CraftingInventory');clock.s+=10;rpc(150,'CRFC',[],'CraftingInventory');
 rpc(150,'CRFU',[0,10,1,0,555,1],'CraftingInventory');clock.s+=3;rpc(150,'CRFC',[],'CraftingInventory'); // left the workbench
 rpc(150,'CRFU',[0,10,1,0,555,1],'CraftingInventory');st.command({type:'rpc',viewId:150,name:'CRFX'});clock.s+=20;rpc(150,'CRFC',[],'CraftingInventory');
 rpc(150,'CRFU',[0,10,2,0,555,1],'CraftingInventory');clock.s+=5;rpc(150,'CRFC',[],'CraftingInventory'); // workbench speed 2
 assert.deepEqual(st.drain(),{craft:3});
});

test('building needs the place command and the server instantiating that kind of piece nearby, soon', () => {
 const {st,clock}=setup();
 st.command({type:'item',action:'structure-place',data:{position:[10,0,10]}});
 st.observe({type:'ngc-create',prefab:';struct_wood_wall',position:[10.5,0,10]});
 st.observe({type:'ngc-create',prefab:';struct_wood_wall',position:[10.5,0,10]}); // no second command: not ours
 st.command({type:'item',action:'deployable-place',data:{origin:[0,1.6,0]}});
 st.observe({type:'ngc-create',prefab:';deploy_wood_box',position:[100,0,0]}); // too far
 clock.ms+=PLACE_MS+1;st.observe({type:'ngc-create',prefab:';deploy_wood_box',position:[1,0,1]}); // too late
 st.command({type:'item',action:'deployable-place',data:{origin:[0,1.6,0]}});st.observe({type:'ngc-create',prefab:';deploy_wood_box',position:[1,0,1]});
 assert.deepEqual(st.drain(),{'build:structure':1,'build:deployable':1});
});

test('distance sums allowed moves, capped per step; corrections and respawns start a new trail', () => {
 const {st,clock,rpc}=setup();
 const move=(x,z)=>st.command({type:'move',origin:[x,0,z]});
 move(0,0);clock.s+=1;move(3,4);clock.s+=1;move(100,4); // 5 m, then a jump capped at 10.5 m
 rpc(100,'ReadClientMove',[[0,0,0],0,0,0],'Character');move(500,500); // after a correction: no step
 clock.s+=1;move(500,506);
 st.observe({type:'create',mine:true,prefab:':player_soldier',viewId:101});clock.s+=1;move(0,0);
 assert.deepEqual(st.drain(),{distance:5+MAX_STEP_SPEED+0.5+6});
});
