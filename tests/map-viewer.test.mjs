// Island map viewer maths (site/js/map-viewer-math.mjs): north-up projection, zoom about the cursor, grid, tiles.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createView,worldToScreen,screenToWorld,zoomAt,clampView,gridLabel,tilesFor,fitAffine} from '../site/js/map-viewer-math.mjs';

const W={x0:4000,x1:7400,z0:2600,z1:6000};
const close=(a,b,e=1e-6)=>Math.abs(a-b)<e;

test('north-up projection round-trips',()=>{
 const v=createView({window:W,width:1000,height:800});
 assert.ok(close(v.scale,800/3400));
 const [x,y]=worldToScreen(v,[4000,2600]);assert.ok(close(x,500-1700*v.scale)&&close(y,0),'north-west corner at the top');
 assert.ok(worldToScreen(v,[5000,5900])[1]>worldToScreen(v,[5000,3000])[1],'larger z (south) is lower on screen');
 for(const p of [[4123.5,2711.25],[7000,5999]]){const back=screenToWorld(v,worldToScreen(v,p));assert.ok(close(back[0],p[0])&&close(back[1],p[1]));}
});

test('zoomAt keeps the point under the cursor fixed and clamps at 16x',()=>{
 const v=createView({window:W,width:1000,height:800}),cursor=[300,200],before=screenToWorld(v,cursor);
 const z=zoomAt(v,2.5,cursor),after=screenToWorld(z,cursor);
 assert.ok(close(before[0],after[0],1e-6)&&close(before[1],after[1],1e-6));assert.ok(close(z.scale,v.scale*2.5));
 assert.ok(close(zoomAt(v,1000,cursor).scale,v.scale*16));assert.ok(close(zoomAt(v,.01,cursor).scale,v.scale));
});

test('clampView keeps the island on screen',()=>{
 const v=clampView({...zoomAt(createView({window:W,width:1000,height:800}),4,[500,400]),cx:100000,cz:-5000});
 assert.ok(v.cx<=W.x1&&v.cx>=W.x0&&v.cz<=W.z1&&v.cz>=W.z0);
});

test('gridLabel names 16 x 16 squares, A1 at the north-west',()=>{
 assert.equal(gridLabel([4000,2600],W),'A1');
 assert.equal(gridLabel([7399,5999],W),'P16');
 assert.equal(gridLabel([4000+212.5*2+1,2600+212.5*4+1],W),'C5');
 assert.equal(gridLabel([3000,2600],W),null);
});

test('tilesFor picks a level and only the visible tiles',()=>{
 const manifest={size:3400,tile:256,levels:4,mpp:1};
 const v=createView({window:W,width:1000,height:800});
 const t=tilesFor(v,manifest,{base:'/m/'});
 assert.ok(t.length>0);assert.ok(t.every(x=>x.z===t[0].z));assert.ok(t[0].z<4,'the whole island does not need the finest level');
 assert.match(t[0].url,/^\/m\/\d\/\d+_\d+\.jpg$/);
 const deep=tilesFor(zoomAt(v,16,[500,400]),manifest,{base:'/m/'});
 assert.ok(deep.every(x=>x.z===4));assert.ok(deep.length<=30,'zoomed in, few tiles');
 for(const x of deep){assert.ok(x.left+x.size>0&&x.top+x.size>0&&x.left<1000&&x.top<800);}
});

test('fitAffine recovers the image-to-world transform from control points',()=>{
 const f=(u,v)=>[4000+u*2+v*.1,2600+v*2-u*.05];
 const pts=[[0,0],[1000,0],[0,1000],[600,700]].map(([u,v])=>({image:[u,v],world:f(u,v)}));
 const [a,b,c,d,e,g]=fitAffine(pts);
 for(const [u,v] of [[10,20],[900,950]]){const [x,z]=f(u,v);assert.ok(close(a*u+b*v+c,x,1e-6)&&close(d*u+e*v+g,z,1e-6));}
});
