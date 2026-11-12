import {Vector3,Color,Matrix3} from 'three';
// Ports of decompiled EnvironmentControlCenter.Update (game clock: env.daylength 45 / env.nightlength 15 real minutes per
// 24 h, chosen by whether it is night) and TOD_Sky.SetupSunAndMoon/SetupLightSource (sun position from the recovered
// latitude/longitude/date, LerpValue, IsNight, light colour/intensity, ambient). Directions use Unity world space.
const D=Math.PI/180,clamp01=v=>Math.min(1,Math.max(0,v)),lerp=(a,b,t)=>a+(b-a)*clamp01(t),max3=(a,b,c)=>Math.max(a,b,c);
const pingPong=(t,len)=>{t=((t%(2*len))+2*len)%(2*len);return len-Math.abs(t-len);};
const daysInMonth=(y,m)=>new Date(Date.UTC(y,m,0)).getUTCDate();
const clamp=(v,min,max)=>Math.min(max,Math.max(min,v));
// TOD_Sky.OrbitalToLocal
export const orbitalToLocal=(theta,phi)=>new Vector3(Math.sin(theta)*Math.sin(phi),Math.cos(theta),Math.sin(theta)*Math.cos(phi));

export class TimeOfDay {
 constructor(tod,{daylength=45,nightlength=15}={}){this.p=tod;this.cycle={...tod.Cycle};this.daylength=daylength;this.nightlength=nightlength;this.lightIntensity=tod.Day.SunLightIntensity;
  // Older exports include the dome's scale in this matrix. Directions use only its rotation.
  this.domeRotation=new Matrix3().fromArray(tod.domeRotation??[1,0,0,0,1,0,0,0,1]);const a=this.domeRotation.elements;
  for(let i=0;i<9;i+=3){const length=Math.hypot(a[i],a[i+1],a[i+2]);for(let j=i;j<i+3;j++)a[j]/=length;}
  this.compute();}
 get hour(){return this.cycle.Hour;}
 set hour(h){this.cycle.Hour=h;this.compute();}
 get isNight(){return this.lerpValue===0;}
 // EnvironmentControlCenter.Update
 update(dt){const c=this.cycle,length=(this.isNight?this.nightlength:this.daylength)*60;c.Hour+=dt/(length/24);c.MoonPhase+=dt/(30*length)*2;
  if(c.MoonPhase<-1)c.MoonPhase+=2;else if(c.MoonPhase>1)c.MoonPhase-=2;
  if(c.Hour>=24){c.Hour=0;if(++c.Day>daysInMonth(c.Year,c.Month)){c.Day=1;if(++c.Month>12){c.Month=1;c.Year++;}}}
  this.compute();}
 // TOD_Sky.SetupSunAndMoon (the low-precision solar position it ships with).
 compute(){const c=this.cycle;
  // TOD_CycleParameters.CheckRange, called by TOD_Sky.Update (including env.time changes).
  c.Year=clamp(c.Year,1,9999);c.Month=clamp(c.Month,1,12);c.Day=clamp(c.Day,1,daysInMonth(c.Year,c.Month));c.Hour=((c.Hour%24)+24)%24;
  c.Longitude=clamp(c.Longitude,-180,180);c.Latitude=clamp(c.Latitude,-90,90);c.MoonPhase=clamp(c.MoonPhase,-1,1);
  const lat=D*c.Latitude,sl=Math.sin(lat),cl=Math.cos(lat);
  const d=367*c.Year-Math.trunc(7*(c.Year+Math.trunc((c.Month+9)/12))/4)+Math.trunc(275*c.Month/9)+c.Day-730530,h=c.Hour-c.UTC;
  const ecl=D*(23.4393-3.563e-7*d),w=282.9404+4.70935e-5*d,e=0.016709-1.151e-9*d,M=356.047+0.98560023*d;
  const E=M+e*57.29578*Math.sin(D*M)*(1+e*Math.cos(D*M)),xv=Math.cos(D*E)-e,yv=Math.sin(D*E)*Math.sqrt(1-e*e);
  const v=57.29578*Math.atan2(yv,xv),r=Math.sqrt(xv*xv+yv*yv),lon=D*(v+w),xs=r*Math.cos(lon),ys=r*Math.sin(lon);
  const xe=xs,ye=ys*Math.cos(ecl),ze=ys*Math.sin(ecl),ra=57.29578*Math.atan2(ye,xe),dec=Math.atan2(ze,Math.sqrt(xe*xe+ye*ye));
  const ha=D*(v+w+180+h*15+c.Longitude-ra),x=Math.cos(ha)*Math.cos(dec),y=Math.sin(ha)*Math.cos(dec),z=Math.sin(dec);
  const xh=x*sl-z*cl,yh=y,zh=x*cl+z*sl,phi=Math.atan2(yh,xh)+Math.PI,alt=Math.atan2(zh,Math.sqrt(xh*xh+yh*yh)),theta=Math.PI/2-alt;
  this.theta=theta;this.phi=phi;this.sunZenith=57.29578*theta;this.moonZenith=pingPong(this.sunZenith+180,180);
  this.sunDirection=orbitalToLocal(theta,phi).applyMatrix3(this.domeRotation);this.setupLightSource(theta,phi);this.lightDirection.applyMatrix3(this.domeRotation);}
 // TOD_Sky.SetupLightSource
 setupLightSource(theta,phi){const {Day,Night,Light,Atmosphere}=this.p,c=this.cycle;
  const k=Math.cos(Math.pow(theta/(Math.PI*2),2-Light.Falloff)*2*Math.PI),m=Math.sqrt(501264*k*k+1416+1)-708*k;
  // Mathf.Exp returns a float. Its underflow to zero defines IsNight; a JS double would prolong twilight.
  const ext=l=>Math.fround(Math.exp(-0.008735*Math.pow(l,-4.08*m)));let r=Math.fround(Day.SunLightColor.r*ext(0.68)),g=Math.fround(Day.SunLightColor.g*ext(0.55)),b=Math.fround(Day.SunLightColor.b*ext(0.44));
  this.lerpValue=clamp01(1.1*max3(r,g,b));const L=this.lerpValue;
  const moon=new Color(Night.MoonLightColor.r,Night.MoonLightColor.g,Night.MoonLightColor.b),sun=new Color(Day.SunLightColor.r*lerp(1,r,Light.Coloring),Day.SunLightColor.g*lerp(1,g,Light.Coloring),Day.SunLightColor.b*lerp(1,b,Light.Coloring));
  const mixed=moon.clone().lerp(sun,clamp01(max3(sun.r,sun.g,sun.b))),ambient=lerp(Night.AmbientIntensity,Day.AmbientIntensity,L);this.ambientColor=mixed.multiplyScalar(ambient);
  this.sunColor=new Color(Day.SunLightColor.r*L,Day.SunLightColor.g*L,Day.SunLightColor.b*L).lerp(new Color(r,g,b),Light.SkyColoring).multiplyScalar(Atmosphere.Brightness*Day.SkyMultiplier*lerp(1,0.1,Math.sqrt(this.sunZenith/90)-0.25));
  this.moonColor=moon.clone().multiplyScalar((1-L)*0.5*Atmosphere.Brightness*Night.SkyMultiplier);
  // SunShaftColor (TOD_SunShafts _SunColor): Day.SunShaftColor tinted by the same extinction, Light.ShaftColoring.
  const shaft=Day.SunShaftColor??{r:1,g:1,b:1};this.sunShaftColor=new Color(shaft.r*lerp(1,r,Light.ShaftColoring??0),shaft.g*lerp(1,g,Light.ShaftColoring??0),shaft.b*lerp(1,b,Light.ShaftColoring??0));
  if(L>0.2){this.lightIntensity=lerp(0,Day.SunLightIntensity,(L-0.2)/0.8);this.lightColor=sun;this.lightDirection=orbitalToLocal(Math.min(theta,(1-Light.MinimumHeight)*Math.PI/2),phi);}
  else {this.lightIntensity=lerp(0,Night.MoonLightIntensity*(1-Math.abs(c.MoonPhase)),(0.2-L)/0.2);this.lightColor=moon;this.lightDirection=orbitalToLocal(Math.max(theta+Math.PI,(1+Light.MinimumHeight)*Math.PI/2+Math.PI),phi);}}
}

// EnvironmentControlCenter.CL_UpdateSkyState(uLink.BitStream) payload (untyped, little-endian): float daylength,
// float nightlength, float MoonPhase, Vector4 CloudUV, int Year, byte Month, byte Day, float Hour. Throws on bad input.
export function readSkyState(bytes){
 if(!(bytes instanceof Uint8Array)||bytes.byteLength!==38)throw Error('Bad sky state length');
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),f=at=>v.getFloat32(at,true);
 const state={daylength:f(0),nightlength:f(4),moonPhase:f(8),cloudUV:[f(12),f(16),f(20),f(24)],year:v.getInt32(28,true),month:v.getUint8(32),day:v.getUint8(33),hour:f(34)};
 if(![state.daylength,state.nightlength,state.moonPhase,...state.cloudUV,state.hour].every(Number.isFinite))throw Error('Non-finite sky state');
 return state;
}
// CL_UpdateSkyState body: env.daylength/nightlength, Cycle.MoonPhase/Year/Month/Day and Animation.CloudUV are taken as
// sent; the hour only snaps when it is off by more than one game minute and the local hour is past 0.05 (as written).
// The local clock then keeps advancing in EnvironmentControlCenter.Update with the server's day/night lengths.
export function applySkyState(tod,state){
 tod.daylength=state.daylength;tod.nightlength=state.nightlength;const c=tod.cycle;
 c.MoonPhase=state.moonPhase;c.Year=state.year;c.Month=state.month;c.Day=state.day;
 const snapped=Math.abs(c.Hour-state.hour)>1/60&&c.Hour>0.05;if(snapped)c.Hour=state.hour;
 tod.compute();return {snapped,cloudUV:state.cloudUV};
}

// RadiationZone.GetExposureForPos summed over the zones the player stands in; Radiation.CalculateExposure armour scaling.
export function radiationExposure(zones,posU,radArmor=0){let n=0;for(const z of zones){const d=posU.distanceTo(z.position);if(d>z.radius)continue;n+=z.strongerAtCenter?z.exposurePerMin*(1-clamp01(d/z.radius)):z.exposurePerMin;}
 if(radArmor>0)n*=1-Math.min(1,Math.max(0,radArmor/200));return n;}
