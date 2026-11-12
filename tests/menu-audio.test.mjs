import test from 'node:test';import assert from 'node:assert/strict';import {existsSync,readFileSync} from 'node:fs';
import {rolloffGain,browserPosition,MUTE_KEY} from '../browser/menu-audio.mjs';
import {MusicState} from '../browser/audio.mjs';
import {present} from './helpers/assets.mjs';
const audioPath=new URL('../browser/assets/recovered/audio/manifest.json',import.meta.url),bgPath=new URL('../browser/assets/recovered/menu-background/manifest.json',import.meta.url);

test('menu scene audio data: MusicPlayer 2D track and the two playOnAwake 3D loops on the Main Camera listener',{skip:!present(audioPath)&&'audio export missing'},()=>{
 const m=JSON.parse(readFileSync(audioPath)),menu=m.menu;assert.equal(menu.music.length,1);const music=menu.music[0];
 assert.deepEqual([music.path,music.startDelay,music.targetVolume,music.timeBetweenTracks,music.tracks.length],['Menu Background/MusicPlayer',3,Math.fround(0.2),0,1]);
 assert.equal(m.clips[music.tracks[0]]?.is3D??Object.values(m.clips).find(c=>c.file===music.tracks[0]).is3D,false,'music clip is 2D');
 assert.deepEqual(menu.loops.map(l=>[l.path,l.playOnAwake,l.loop,l.rolloffMode,l.minDistance,l.maxDistance]),[['Menu Background/wind',true,true,0,1,500],['Menu Background/FireBarrel',true,true,0,1,500]]);
 assert.equal(MUTE_KEY,'rlb-music-mute','MusicPlayer.settings.mute is shared with the island player');
 // MusicPlayer.Start: nextMusicTime = Time.time + 3 + startDelay; a track waits until it is decoded (the browser gesture).
 const s=new MusicState(music,{time:10,rng:()=>0});assert.equal(s.nextMusicTime,16);assert.deepEqual(s.update(17,0.1,{lengthOf:()=>null}),[],'not decoded yet: deferred');
 assert.deepEqual(s.update(30,0.1,{lengthOf:()=>120}),[{type:'stop'},{type:'play',track:music.tracks[0]}]);assert.equal(s.nextMusicTime,150,'length + timeBetweenTracks 0');
 if(!present(bgPath))return;
 // Logarithmic rolloff from the Main Camera (the menu scene's only enabled AudioListener) to each source.
 const cam=JSON.parse(readFileSync(bgPath)).camera.matrix,eye=[cam[12],cam[13],cam[14]];
 const gains=menu.loops.map(l=>{const p=browserPosition(l.position);return l.volume*rolloffGain(Math.hypot(p[0]-eye[0],p[1]-eye[1],p[2]-eye[2]),l);});
 assert.ok(gains[0]>0.009&&gains[0]<0.013,'wind about 4 m away: '+gains[0]);assert.ok(gains[1]>0.05&&gains[1]<0.065,'fire barrel about 10 m away: '+gains[1]);
});

test('Unity rolloff curves used by the menu sources',()=>{
 assert.equal(rolloffGain(0.5,{minDistance:1}),1);assert.equal(rolloffGain(4,{minDistance:1}),0.25);assert.equal(rolloffGain(10,{minDistance:2}),0.2);
 assert.equal(rolloffGain(250.5,{minDistance:1,rolloffMode:1}),0.5);assert.equal(rolloffGain(900,{minDistance:1,rolloffMode:1}),0);assert.deepEqual(browserPosition([1,2,3]),[1,2,-3]);
});
