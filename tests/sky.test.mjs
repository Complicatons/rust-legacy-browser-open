import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {TimeOfDay} from '../browser/tod.mjs';
import {waterSettings,scattering,skyState,sampleAtmosphere,fogColor,materialValues,CloudAnimation,unityEuler,sunBasis,moonBasis,waterColors,gerstnerOffset,orbitalToLocal} from '../browser/sky-model.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';

const scene=hasRecovered?(JSON.parse(await readFile(new URL('../browser/assets/recovered/scene/manifest.json',import.meta.url)))):null;
const sky=hasRecovered?(await readFile(new URL('../browser/assets/recovered/sky/manifest.json',import.meta.url)).then(JSON.parse,()=>null)):null;
const params=hasRecovered?(scene.world.tod):null,stars={Tiling:3,Density:0.7};
const close=(a,b,e=1e-6,msg)=>assert.ok(Math.abs(a-b)<=e*Math.max(1,Math.abs(b)),msg??`${a} != ${b}`);
const at=h=>{const t=new TimeOfDay(params);t.hour=h;return t;};
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];

test('SetupScattering coefficients follow the recovered Rayleigh 1.5 / Mie 1 / directionality 0.5 atmosphere',needsAssets,()=>{
 const s=scattering(params),r=0.001+1.5,m=0.001+1;
 close(s.betaRayleigh[0],5.8e-6*r);close(s.betaRayleigh[2],3.31e-5*r);close(s.betaRayleighTheta[1],0.00027*r*3/(16*Math.PI));
 close(s.betaMie[0],2e-6*m);close(s.betaMieTheta[0],4e-5*m*(3/(4*Math.PI))*(1-0.25)/(2+0.25));
 assert.deepEqual(s.betaMiePhase,[1.25,1]);assert.deepEqual(s.opticalDepth,[8000,1200]);// ViewerHeight 0
 close(s.oneOverBeta[1],1/(s.betaMie[1]+s.betaRayleigh[1]));
 close(s.betaNight[2],(s.betaRayleighTheta[2]+s.betaMieTheta[2]/Math.pow(1.25,1.5))*s.oneOverBeta[2]);
});

test('sky state: sun/moon forward vectors, unnormalised light lerp and renderer switches through a day',needsAssets,()=>{
 const noon=skyState(at(12),{...params,Stars:stars}),night=skyState(at(23),{...params,Stars:stars});
 assert.equal(noon.lerpValue,1);assert.ok(noon.sunPos[1]>0.95);assert.deepEqual(noon.sunDirection,noon.sunPos.map(v=>-v));
 assert.deepEqual(noon.moonPos.map(v=>+v.toFixed(12)),noon.sunPos.map(v=>+(-v).toFixed(12)));
 // LightDirection = Lerp(Moon, Sun, L^2): the sun's forward vector at noon, the moon's at night.
 for(let i=0;i<3;i++){close(noon.lightDirection[i],noon.sunDirection[i],1e-9);close(night.lightDirection[i],night.moonDirection[i],1e-9);}
 assert.ok(noon.sunVisible&&!noon.moonVisible&&!noon.spaceVisible&&noon.cloudsVisible);
 assert.ok(night.moonVisible&&night.spaceVisible&&night.lerpValue===0);
 // Halo grows at night (alpha = max rgb after premultiplying by the recovered 0.1 alpha), additive stays black.
 assert.equal(noon.moonHaloColor[3],0);{const k=1-Math.abs(night.moonPhase);close(night.moonHaloColor[2],0.6078431606292725*k*0.10000000149011612*k,1e-6);}
 assert.deepEqual(noon.additiveColor,[0,0,0,0]);
 // CloudColor = cloudMultiplier * 1.25 * brightness * lerp(grey, lerp(Moon, Sun, L), CloudColoring); alpha = multiplier.
 const s=noon.sunColor,grey=(s[0]+s[1]+s[2])/3;close(noon.cloudColor[0],1.25*(grey+(s[0]-grey)*0.9),1e-6);assert.equal(noon.cloudColor[3],1);
 assert.equal(night.cloudColor[3],params.Night.CloudMultiplier);
});

test('SampleAtmosphere: blue zenith by day, transparent night sky that shows the stars, gamma contrast 1/2.2',needsAssets,()=>{
 const noon=skyState(at(12)),night=skyState(at(23)),dusk=skyState(at(18.15));
 const up=sampleAtmosphere([0,1,0],noon),horizon=sampleAtmosphere([1,0,0],noon);
 assert.ok(up[2]>up[1]&&up[1]>up[0],JSON.stringify(up));assert.equal(up[3],1);
 assert.ok(horizon[0]>up[0],'horizon is whiter than the zenith');
 const n=sampleAtmosphere([0,1,0],night,false);assert.ok(n[3]<0.5,JSON.stringify(n));
 // Toward the setting sun the sky is warmer than away from it.
 const toward=sampleAtmosphere([dusk.sunPos[0],0.05,dusk.sunPos[2]],dusk),away=sampleAtmosphere([-dusk.sunPos[0],0.05,-dusk.sunPos[2]],dusk);
 assert.ok(toward[0]/toward[2]>away[0]/away[2]);
 // Unclamped alpha may exceed 1 (SetupSunAndMoon compares it with 1.1); clamped it may not.
 assert.ok(sampleAtmosphere([0,0,1],noon,false)[3]>1);assert.equal(sampleAtmosphere([0,0,1],noon,true)[3],1);
 // Contrast exponent: halving contrast moves every channel toward 1.
 const flat=skyState(at(12),{...params,Atmosphere:{...params.Atmosphere,Contrast:0.5}});assert.ok(sampleAtmosphere([0,1,0],flat)[0]>up[0]);
});

test('SampleFogColor: unnormalised lerp of the flat camera forward toward up by FogColorBias, premultiplied by alpha',needsAssets,()=>{
 const noon=skyState(at(12)),forward=[0.6,-0.8,0];
 const c=sampleAtmosphere([0.6*0.9,0.1,0],noon),f=fogColor(forward,noon);
 for(let i=0;i<3;i++)close(f[i],c[i]*c[3]);assert.equal(f[3],1);
 // Looking straight down still samples (0, 0.1, 0); night fog is darker than day fog.
 const down=fogColor([0,-1,0],noon),night=fogColor(forward,skyState(at(23)));close(down[0],sampleAtmosphere([0,0.1,0],noon)[0]*sampleAtmosphere([0,0.1,0],noon)[3]);
 assert.ok(night[0]+night[1]+night[2]<0.2*(f[0]+f[1]+f[2]));
});

test('TOD_Sky.Update material values: star subtract, sun/moon mesh scales, glows and sun colour',needsAssets,()=>{
 const noon=skyState(at(12)),v=materialValues(noon,{gamma:2.2,stars}),night=materialValues(skyState(at(23)),{stars});
 close(v.starSubtract,1-Math.pow(0.7,0.1));assert.equal(v.starTiling,3);
 close(v.sunScale,8*Math.tan(Math.PI/360));close(v.moonScale,4*Math.tan(Math.PI/360));
 close(v.contrast,1/2.2);assert.equal(v.sunGlow,1);close(v.moonGlow,0.6);assert.equal(night.sunGlow,0);
 assert.deepEqual(v.sunColor.map(x=>+x.toFixed(6)),[1,0.913725,0.705882,1]);assert.deepEqual(night.sunColor,[0,0,0,0]);
});

test('TOD_Animation cloud UV: wind speed/100 along WindDegrees +-15, C# remainder by the cloud scales, dome offset',()=>{
 const clouds={Scale1:{x:3,y:3},Scale2:{x:4,y:4}},a=new CloudAnimation({WindDegrees:0,WindSpeed:5},clouds);
 for(let i=0;i<10;i++)a.update(1);const k=0.05*10,c=Math.cos(15*Math.PI/180),s=Math.sin(15*Math.PI/180);
 close(a.uv[0],k*c);close(a.uv[1],k*s);close(a.uv[2],k*c);close(a.uv[3],-k*s);
 a.update(100);assert.ok(Math.abs(a.uv[0])<3&&Math.abs(a.uv[2])<4);assert.ok(a.uv[3]<0,'negative remainders keep their sign');
 assert.deepEqual(CloudAnimation.offset([5700,300,-11400],5700),[-1,2,-1,2]);
});

test('sun quad roll and moon sphere basis are orthonormal and face the dome centre',()=>{
 assert.deepEqual(unityEuler([0,0,0,1]).map(v=>+v.toFixed(9)),[0,0,0]);
 const yaw=unityEuler([0,Math.sin(Math.PI/4),0,Math.cos(Math.PI/4)]);close(yaw[1],90,1e-9);
 const pitch=unityEuler([Math.sin(-Math.PI/12),0,0,Math.cos(-Math.PI/12)]);close(pitch[0],330,1e-9);
 const sun=orbitalToLocal(0.7,2.1),b0=sunBasis(sun,0),b=sunBasis(sun,35);
 for(const v of [b.right,b.up]){close(Math.hypot(...v),1,1e-9);close(dot(v,sun),0,1e-9);}
 close(dot(b.right,b.up),0,1e-9);close(dot(b.right,b0.right),Math.cos(35*Math.PI/180),1e-9);
 const m=moonBasis(sun);close(dot(m.forward,sun),-1,1e-9);close(dot(m.right,m.up),0,1e-9);assert.ok(m.right[1]===0||Math.abs(m.right[1])<1e-12);
});

test('WaterColor: reflection colour 0.8 x lerp(lerp(fog, ambient, .5), colorMain, colorLerp), base 0.8 x that',()=>{
 const wc={colorMain:{r:0,g:0.32549020648002625,b:0.48627451062202454,a:1},colorLerp:0.3};
 const {reflectionColor:r,baseColor:b}=waterColors([0.8,0.9,1,1],[0.4,0.4,0.4,1],wc);
 close(r[0],0.8*(0.6*0.7));close(r[2],0.8*(0.7*0.7+0.48627451062202454*0.3));assert.equal(r[3],0.1);
 for(let i=0;i<3;i++)close(b[i],r[i]*0.8);assert.equal(b[3],0.75);
});

test('Water4 Gerstner offsets: steepness-weighted horizontal cosines and amplitude-weighted vertical sines',()=>{
 const m={_GAmplitude:{r:1,g:0,b:0,a:0},_GFrequency:{r:0.5,g:1,b:1,a:1},_GSteepness:{r:2,g:0,b:0,a:0},_GSpeed:{r:1,g:0,b:0,a:0},_GDirectionAB:{r:1,g:0,b:0,a:1},_GDirectionCD:{r:0,g:1,b:1,a:0}};
 const o=gerstnerOffset([Math.PI,0],0,m);close(o[0],2*Math.cos(Math.PI/2),1e-12);close(o[1],1,1e-12);close(o[2],0,1e-12);
 const t=gerstnerOffset([0,0],Math.PI,m);close(t[0],-2,1e-12);close(t[1],0,1e-12);
 if(sky){const real=gerstnerOffset([10,20],3,sky.water.material.colors),amp=sky.water.material.colors._GAmplitude;
  assert.ok(Math.abs(real[1])<=amp.r+amp.g+amp.b+amp.a);}
});

test('exported sky/sea settings match the recovered scene (skipped when the gitignored export is absent)',{skip:!sky},()=>{
 assert.equal(sky.colorSpace,'gamma');assert.equal(sky.camera.far,6000);close(sky.camera.todCamera.DomeScaleFactor*sky.camera.far,5700,1e-6);
 assert.equal(sky.renderSettings.fog,true);assert.equal(sky.renderSettings.fogMode,1);assert.equal(sky.renderSettings.linearFogStart,0);assert.equal(sky.renderSettings.linearFogEnd,4000);
 assert.deepEqual(sky.tod.Stars,{Tiling:3,Density:0.699999988079071});assert.deepEqual(sky.animation,{WindDegrees:0,WindSpeed:5});
 assert.equal(sky.tod.CloudQuality,2);assert.equal(sky.materials.clouds.shader,'Time of Day/Cloud Layers (Bumped)');assert.equal(sky.materials.moon.floats._Contrast,0.75);
 for(const k of ['Atmosphere','Day','Night','Light','Clouds','World'])assert.deepEqual(JSON.parse(JSON.stringify(sky.tod[k])),JSON.parse(JSON.stringify(params[k])),k);
 assert.equal(sky.water.material.shader,'FX/Water4');assert.equal(sky.water.waterBase.waterQuality,2);assert.equal(sky.water.waterBase.edgeBlend,true);
 assert.deepEqual(sky.water.reflectionMask,{on:13111296,off:8388608});assert.equal(sky.layers[23],'Skybox');
 // on-mask layers: CULL500, Terrain, MeshBatched, Skybox; off: Skybox only.
 const bits=m=>[...Array(32).keys()].filter(i=>m&(1<<i));assert.deepEqual(bits(13111296),[12,19,22,23]);assert.deepEqual(bits(8388608),[23]);
 close(sky.water.tile.worldY,252.39999389648438);assert.equal(sky.water.tile.gridX,51);close(sky.water.writeZPlane.worldY,250.39999389648438);
});

test('WaterSettings: render.level picks High (+edge blend) above 0.8, Medium above 0.5, else Low; water.level overrides',()=>{
 assert.deepEqual(waterSettings(1),{waterQuality:2,edgeBlend:true});assert.deepEqual(waterSettings(0.8),{waterQuality:1,edgeBlend:false});
 assert.deepEqual(waterSettings(0.6),{waterQuality:1,edgeBlend:false});assert.deepEqual(waterSettings(0.4),{waterQuality:0,edgeBlend:false});
 assert.deepEqual(waterSettings(0,3),{waterQuality:2,edgeBlend:false});assert.deepEqual(waterSettings(1,2),{waterQuality:1,edgeBlend:true});assert.deepEqual(waterSettings(1,0),{waterQuality:0,edgeBlend:false});
});
