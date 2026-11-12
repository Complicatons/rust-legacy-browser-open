// Pure ports of the original sky/sea per-frame rules (no rendering). Sources, all statically recovered:
//  TOD_Sky.SetupScattering / SetupLightSource (sky colours) / SampleAtmosphere / SampleFogColor / Update (shader globals)
//  TOD_Animation.Update + OffsetUV (cloud scrolling), TOD_Camera (dome follows camera, scale 0.95 * far clip)
//  WaterColor.Update (_BaseColor/_ReflectionColor from the fog and ambient colours)
// Colours are plain [r,g,b,a] arrays in Unity's gamma space (PlayerSettings colour space = gamma). Directions are
// Unity world space (x east, y up, z north); the browser scene uses z = -Unity z.
const D=Math.PI/180;
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v)),clamp01=v=>clamp(v,0,1);
// Mathf.Lerp / Color.Lerp clamp t to [0,1].
const lerp=(a,b,t)=>a+(b-a)*clamp01(t);
const lerpColor=(a,b,t)=>a.map((v,i)=>lerp(v,b[i],t));
const max3=(a,b,c)=>a>=b&&a>=c?a:(b>=c?b:c);
const rgba=c=>Array.isArray(c)?[c[0],c[1],c[2],c[3]??1]:[c.r,c.g,c.b,c.a??1];
const scale=(c,s)=>c.map(v=>v*s);
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const normalize=v=>{const l=Math.hypot(v[0],v[1],v[2])||1;return [v[0]/l,v[1]/l,v[2]/l];};
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];

// TOD_Sky.OrbitalToLocal.
export const orbitalToLocal=(theta,phi)=>[Math.sin(theta)*Math.sin(phi),Math.cos(theta),Math.sin(theta)*Math.cos(phi)];

// TOD_Sky.SetupScattering: Rayleigh/Mie coefficients used by SampleAtmosphere and the Atmosphere vertex program.
export function scattering({Atmosphere,World}){
 const r=0.001+Atmosphere.RayleighMultiplier*Atmosphere.ScatteringColor.r,g=0.001+Atmosphere.RayleighMultiplier*Atmosphere.ScatteringColor.g,b=0.001+Atmosphere.RayleighMultiplier*Atmosphere.ScatteringColor.b;
 const k=3/(16*Math.PI),betaRayleigh=[5.8e-6*r,1.35e-5*g,3.31e-5*b],betaRayleighTheta=[0.000116*r*k,0.00027*g*k,0.00066200003*b*k];
 const mr=0.001+Atmosphere.MieMultiplier*Atmosphere.ScatteringColor.r,mg=0.001+Atmosphere.MieMultiplier*Atmosphere.ScatteringColor.g,mb=0.001+Atmosphere.MieMultiplier*Atmosphere.ScatteringColor.b;
 const dir=Atmosphere.Directionality,phase=3/(4*Math.PI)*(1-dir*dir)/(2+dir*dir);
 const betaMie=[2e-6*mr,2e-6*mg,2e-6*mb],betaMieTheta=[4e-5*mr*phase,4e-5*mg*phase,4e-5*mb*phase],betaMiePhase=[1+dir*dir,2*dir];
 const opticalDepth=[8000*Math.exp(-World.ViewerHeight*50000/8000),1200*Math.exp(-World.ViewerHeight*50000/1200)];
 const oneOverBeta=betaMie.map((v,i)=>1/(v+betaRayleigh[i]));
 const p=Math.pow(betaMiePhase[0],1.5),betaNight=betaRayleighTheta.map((v,i)=>(v+betaMieTheta[i]/p)*oneOverBeta[i]);
 return {opticalDepth,oneOverBeta,betaRayleigh,betaRayleighTheta,betaMie,betaMieTheta,betaMiePhase,betaNight};
}

// Everything TOD_Sky.Update publishes for one time of day. `tod` is a browser/tod.mjs TimeOfDay (its cycle, theta/phi,
// LerpValue, SunColor, MoonColor and AmbientColor already follow SetupSunAndMoon/SetupLightSource).
export function skyState(tod,params=tod.p){
 const {Day,Night,Light,Atmosphere,Clouds}=params,L=tod.lerpValue,phase=tod.cycle.MoonPhase;
 const sunPos=orbitalToLocal(tod.theta,tod.phi),moonPos=orbitalToLocal(tod.theta+Math.PI,tod.phi);
 // SunTransform/MoonTransform look at the dome centre: their forward vectors point away from the bodies.
 const sunDirection=scale(sunPos,-1),moonDirection=scale(moonPos,-1),l2=L*L;
 const lightDirection=moonDirection.map((v,i)=>v+(sunDirection[i]-v)*clamp01(l2)); // Vector3.Lerp(Moon, Sun, L*L), unnormalised
 const sunColor=[tod.sunColor.r,tod.sunColor.g,tod.sunColor.b,L],moonColor=[tod.moonColor.r,tod.moonColor.g,tod.moonColor.b,1-L];
 const halo=scale(rgba(Night.MoonHaloColor),(1-L)*(1-Math.abs(phase))*Atmosphere.Brightness);
 const moonHaloColor=[halo[0]*halo[3],halo[1]*halo[3],halo[2]*halo[3],0];moonHaloColor[3]=max3(moonHaloColor[0],moonHaloColor[1],moonHaloColor[2]);
 const b5=lerpColor(moonColor,sunColor,L),cloudMultiplier=lerp(Night.CloudMultiplier,Day.CloudMultiplier,L),grey=(b5[0]+b5[1]+b5[2])/3;
 const cloudRGB=lerpColor([grey,grey,grey,grey],b5,Light.CloudColoring).map(v=>v*cloudMultiplier*1.25*Clouds.Brightness);
 const cloudColor=[cloudRGB[0],cloudRGB[1],cloudRGB[2],cloudMultiplier];
 const add=lerpColor(rgba(Night.AdditiveColor),rgba(Day.AdditiveColor),L);
 const additiveColor=[add[0]*add[3],add[1]*add[3],add[2]*add[3],0];additiveColor[3]=max3(additiveColor[0],additiveColor[1],additiveColor[2]);
 const ambientColor=[tod.ambientColor.r,tod.ambientColor.g,tod.ambientColor.b,1];
 const state={lerpValue:L,sunZenith:tod.sunZenith,moonPhase:phase,sunPos,moonPos,sunDirection,moonDirection,lightDirection,sunColor,moonColor,moonHaloColor,cloudColor,additiveColor,ambientColor,
  scattering:scattering(params),params};
 // SetupSunAndMoon renderer switches.
 state.sunVisible=sunPos[1]>-0.5;state.moonVisible=moonPos[1]>-0.1;state.spaceVisible=sampleAtmosphere([0,1,0],state,false)[3]<1.1;state.cloudsVisible=Clouds.Density>0;
 return state;
}

// TOD_Sky.SampleAtmosphere (the same expression the Atmosphere vertex program evaluates per dome vertex).
export function sampleAtmosphere(direction,state,clampAlpha=true){
 const {Atmosphere,World}=state.params,s=state.scattering,p=Atmosphere.Contrast*0.45454544;
 const sun=state.sunDirection,moon=state.moonDirection,mu=Math.max(0,-dot(direction,sun));
 const f=clamp(direction[1]+World.HorizonOffset,0.001,1),h=Math.pow(f,Atmosphere.Haziness),base=(1-h)*190000;
 const sr=base+h*(s.opticalDepth[0]-base),sm=base+h*(s.opticalDepth[1]-base),phase=1+mu*mu;
 const ext=[0,1,2].map(i=>s.betaRayleigh[i]*sr+s.betaMie[i]*sm);
 const theta=[0,1,2].map(i=>s.betaRayleighTheta[i]+s.betaMieTheta[i]/Math.pow(s.betaMiePhase[0]-s.betaMiePhase[1]*mu,1.5));
 const sc=state.sunColor,mc=state.moonColor,out=[0,0,0,0];
 for(let i=0;i<3;i++)out[i]=(1-Math.exp(-ext[i]))*(sc[i]*phase*theta[i]*s.oneOverBeta[i]+mc[i]*s.betaNight[i]);
 out[3]=10*max3(out[0],out[1],out[2]);
 const halo=Math.pow(Math.max(0,-dot(direction,moon)),10);
 for(let i=0;i<4;i++)out[i]+=state.moonHaloColor[i]*halo+state.additiveColor[i];
 for(let i=0;i<3;i++)out[i]=lerp(out[i],state.cloudColor[i],Atmosphere.Fogginess);
 out[3]+=Atmosphere.Fogginess;if(clampAlpha)out[3]=clamp01(out[3]);
 return out.map(v=>Math.pow(v,p));
}

// TOD_Sky.SampleFogColor (World.SetFogColor = 1 copies it to RenderSettings.fogColor every frame). `forward` is the
// camera's Unity-space forward vector; the lerped direction is deliberately not normalised, as in the original.
export function fogColor(forward,state){
 const bias=state.params.World.FogColorBias,flat=[forward[0],0,forward[2]];
 const d=[flat[0]*(1-bias),flat[1]+(1-flat[1])*bias,flat[2]*(1-bias)];
 const c=sampleAtmosphere(d,state,true);return [c[3]*c[0],c[3]*c[1],c[3]*c[2],1];
}

// TOD_Sky.Update: per-material values.
export function materialValues(state,{gamma=2.2,stars}={}){
 const {Atmosphere,Day,Night,Clouds}=state.params,L=state.lerpValue,phase=state.moonPhase;
 const sunMesh=rgba(Day.SunMeshColor).map(v=>v*L*(1-Atmosphere.Fogginess));
 return {
  gamma,oneOverGamma:1/gamma,
  contrast:Atmosphere.Contrast*(1/gamma),haziness:Atmosphere.Haziness,fogginess:Atmosphere.Fogginess,horizon:state.params.World.HorizonOffset,
  sunGlow:(1-Atmosphere.Fogginess)*L,moonGlow:(1-Atmosphere.Fogginess)*0.6*(1-Math.abs(phase)),
  cloudDensity:Clouds.Density,cloudSharpness:Clouds.Sharpness,cloudScale1:[Clouds.Scale1.x,Clouds.Scale1.y],cloudScale2:[Clouds.Scale2.x,Clouds.Scale2.y],
  starTiling:stars?.Tiling??null,starSubtract:stars?1-Math.pow(stars.Density,0.1):null,
  sunColor:sunMesh,moonColor:rgba(Night.MoonMeshColor),moonPhase:phase,
  // SetupSunAndMoon: transform scales in dome units (Quad is 2 x 2, Sphere has radius 1).
  sunScale:2*4*Math.tan(Math.PI/360*Day.SunMeshSize),moonScale:2*2*Math.tan(Math.PI/360*Night.MoonMeshSize),
 };
}

// TOD_Animation: CloudUV advances with the wind each frame (modulo the cloud scales); OffsetUV moves it with the dome.
export class CloudAnimation {
 constructor({WindDegrees=0,WindSpeed=3}={},clouds){this.windDegrees=WindDegrees;this.windSpeed=WindSpeed;this.clouds=clouds;this.uv=[0,0,0,0];}
 update(dt){const a=D*(this.windDegrees+15),b=D*(this.windDegrees-15),k=this.windSpeed/100,s1=this.clouds.Scale1,s2=this.clouds.Scale2;
  const v=[Math.cos(a),Math.sin(a),Math.cos(b),Math.sin(b)].map(x=>x*k*dt);
  // C# % keeps the dividend's sign.
  this.uv=[(this.uv[0]+v[0])%s1.x,(this.uv[1]+v[1])%s1.y,(this.uv[2]+v[2])%s2.x,(this.uv[3]+v[3])%s2.y];return this.uv;}
 // OffsetUV for a dome (rotation identity) at Unity position p with uniform scale `radius`.
 static offset(p,radius){return [-p[0]/radius,-p[2]/radius,-p[0]/radius,-p[2]/radius];}
}

// SetupSunAndMoon: the sun quad looks at the dome centre and its roll is 2*Time.time + |camera euler x|+|y|+|z| degrees.
export function unityEuler(q){ // Unity eulerAngles (degrees, 0..360) of a Unity-space quaternion [x,y,z,w].
 const [x,y,z,w]=q,m12=2*(y*z-w*x),m02=2*(x*z+w*y),m22=1-2*(x*x+y*y),m10=2*(x*y+w*z),m11=1-2*(x*x+z*z);
 const wrap=v=>((v%360)+360)%360;
 return [wrap(Math.asin(clamp(-m12,-1,1))/D),wrap(Math.atan2(m02,m22)/D),wrap(Math.atan2(m10,m11)/D)];
}
export function sunBasis(sunPos,rollDegrees){
 const f=scale(sunPos,-1),right0=normalize(cross([0,1,0],f)),up0=cross(f,right0),r=D*rollDegrees,c=Math.cos(r),s=Math.sin(r);
 return {right:[0,1,2].map(i=>c*right0[i]+s*up0[i]),up:[0,1,2].map(i=>-s*right0[i]+c*up0[i])};
}
// MoonTransform.LookAt(dome centre, MoonTransform.up): Quaternion.LookRotation(forward, previous up) every frame, so the
// moon keeps rolling from its serialized rotation (RustSky/Moon, render-extras.json moon.up). LookRotationToMatrix:
// z = forward, x = normalize(cross(up, z)), y = cross(z, x); when forward or x degenerate (|v| < 1e-5) LookAt keeps the
// previous rotation (previous: {right, up, forward}).
export function moonBasis(moonPos,previousUp=[0,1,0],previous=null){
 const f=scale(moonPos,-1),fl=Math.hypot(f[0],f[1],f[2]);if(fl<1e-5)return previous??{right:[1,0,0],up:[0,1,0],forward:[0,0,1]};
 const z=scale(f,1/fl),x=cross(previousUp,z),xl=Math.hypot(x[0],x[1],x[2]);if(xl<1e-5)return previous??{right:normalize(cross([0,1,0],z)),up:cross(z,normalize(cross([0,1,0],z))),forward:z};
 const right=scale(x,1/xl);return {right,up:cross(z,right),forward:z};}
// Unity quaternion [x,y,z,w] applied to a vector (Unity space).
export function rotateVector(q,v){const [x,y,z,w]=q,t=[2*(y*v[2]-z*v[1]),2*(z*v[0]-x*v[2]),2*(x*v[1]-y*v[0])];
 return [v[0]+w*t[0]+y*t[2]-z*t[1],v[1]+w*t[1]+z*t[0]-x*t[2],v[2]+w*t[2]+x*t[1]-y*t[0]];}

// WaterColor.Update: the Water4 material's _ReflectionColor and _BaseColor follow the sky.
export function waterColors(fog,ambient,{colorMain,colorLerp}){
 const a=lerpColor(rgba(fog),rgba(ambient),0.5);a[3]=1;
 const color=lerpColor(a,rgba(colorMain),colorLerp).map(v=>v*0.8);color[3]=0.1;
 const base=color.map(v=>v*0.8);base[3]=0.75;
 return {reflectionColor:color,baseColor:base};
}

// WaterSettings.RefreshSettings: render.level (0..1) picks the WaterBase quality; water.level (-1 = follow render.level)
// overrides it with Clamp(level - 1, 0, 2) and turns edge blending on only for level 2.
export function waterSettings(renderLevel,waterLevel=-1){
 let waterQuality,edgeBlend;
 if(renderLevel>0.8){waterQuality=2;edgeBlend=true;}else if(renderLevel>0.5){waterQuality=1;edgeBlend=false;}else{waterQuality=0;edgeBlend=false;}
 if(waterLevel!==-1){waterQuality=clamp(waterLevel-1,0,2);edgeBlend=waterLevel===2;}
 return {waterQuality,edgeBlend};
}

// Gerstner offsets the Water4 vertex program adds (WATER_VERTEX_DISPLACEMENT_ON), for tests and CPU queries.
export function gerstnerOffset(xz,time,m){
 const A=m._GAmplitude,F=m._GFrequency,S=m._GSteepness,V=m._GSpeed,AB=m._GDirectionAB,CD=m._GDirectionCD,c=['r','g','b','a'];
 const dots=[AB.r*xz[0]+AB.g*xz[1],AB.b*xz[0]+AB.a*xz[1],CD.r*xz[0]+CD.g*xz[1],CD.b*xz[0]+CD.a*xz[1]];
 const phase=dots.map((d,i)=>F[c[i]]*d+time*V[c[i]]),C=phase.map(Math.cos),Sn=phase.map(Math.sin);
 const t7=[S.r*A.r*AB.r,S.r*A.r*AB.g,S.g*A.g*AB.b,S.g*A.g*AB.a],t8=[S.b*A.b*CD.r,S.b*A.b*CD.g,S.a*A.a*CD.b,S.a*A.a*CD.a];
 return [C[0]*t7[0]+C[1]*t7[2]+C[2]*t8[0]+C[3]*t8[2],Sn[0]*A.r+Sn[1]*A.g+Sn[2]*A.b+Sn[3]*A.a,C[0]*t7[1]+C[1]*t7[3]+C[2]*t8[1]+C[3]*t8[3]];
}
