// Decay rules ported from the server's EnvDecay (deployables) and StructureMaster.DoDecay (structures).
// Pure logic: the world queries (upward/sideways raycasts, weight links) and the damage call are injected.
// Times are seconds. Defaults match the server's `decay` and `structure` console variables.
export const DECAY={deploy_maxhealth_sec:43200,decaytickrate:300,maxperframe:100,maxtestperframe:8};
export const STRUCTURE={minpercentdmg:0.1,decayRate:1};
// StructureMaster.GetDecayDelayForType / GetDecayTimeMaxHealthForType, indexed by MaterialType (UNSET, Wood, Metal, Brick, Concrete).
export const DECAY_DELAY=[0,172800,345600,259200,432000];
export const DECAY_TIME_MAX_HEALTH=[60,21600,43200,86400,259200];
export const FIRE_DECAY_RESET_RANGE=5; // FireBarrel.decayResetRange: burning fires/furnaces touch EnvDecay within this radius
const T={Pillar:0,Wall:1,Doorway:2,Ceiling:3,Stairs:4,Foundation:5,WindowWall:6,Ramp:7};

// EnvDecay: one per decaying deployable. Awake staggers the first tick by Random(0.2..2)×tickrate.
export class DeployableDecay {
 constructor({maxHealth,decayMultiplier=1,now=0,random=Math.random,vars=DECAY}){this.maxHealth=maxHealth;this.decayMultiplier=decayMultiplier;this.vars=vars;this.enabled=true;
  this.lastDecayThink=now+vars.decaytickrate*(0.2+random()*1.8);}
 // DecayTouch (opening a storage box, a nearby fire burning, an item placed on it) restarts the tick window.
 touch(now){this.enabled=true;this.lastDecayThink=now;}
 setEnabled(on,now){this.enabled=on;if(on)this.lastDecayThink=now;} // campfires stop decaying while lit
 // Returns the damage to apply this tick (0 if none). `sheltered()` = upward 10 m raycast from +0.25 m hits a
 // structure component or a decayProtector deployable; `carried` = sitting on a carrier (no decay, keeps ticking).
 think(now,{carried=false,sheltered=()=>false}={}){
  if(!this.enabled)return 0;
  if(carried){this.lastDecayThink=now;return 0;}
  const elapsed=now-this.lastDecayThink;
  if(elapsed<this.vars.decaytickrate)return 0;
  this.lastDecayThink=now;
  if(sheltered())return 0;
  return Math.min(Math.max(elapsed,0),this.vars.decaytickrate)/this.vars.deploy_maxhealth_sec*this.maxHealth*this.decayMultiplier;
 }
 // EnvDecay keeps nothing in the server save (no IServerSaveable): a loaded deployable runs Awake again, a fresh
 // Random(0.2..2) x tickrate stagger from the load, and a lit fire turns its own decay off again (FireBarrel.SetOn).
 // Older saves carried the previous session's absolute lastDecayThink (a performance.now() time, so decay stood still
 // for as long as that session had run): ignored.
 save(){return null;}
 load(){return this;}
}

// StructureMaster decay state. Touched() (building, repairing, a door being used, an object placed on it,
// `structure.touchall`) resets the material's full delay; after it runs out, decay time accumulates and is
// applied in chunks of at least `minpercentdmg` of the time-to-max-health.
export class StructureDecay {
 constructor({materialType,vars=STRUCTURE}){this.materialType=materialType;this.vars=vars;this.lastDecayTime=0;this.pentUp=0;this.delayRemaining=0;}
 delay(){return DECAY_DELAY[this.materialType]??0;}
 timeMaxHealth(){return DECAY_TIME_MAX_HEALTH[this.materialType]??60;}
 touched(){this.delayRemaining=this.delay();}
 // components: [{type,maxHealth}]. Returns {status, hits:[{component,damage}]}.
 //  sheltered(c): both 25 m raycasts (forward and back, from +2.5 m) hit a structure or door → walls take 0.2×.
 //  carryingWeight(c): something rests on this pillar/ceiling/foundation → it is spared.
 step(now,components,{random=Math.random,sheltered=()=>false,carryingWeight=()=>false,dt=0}={}){
  let elapsed=this.lastDecayTime!==0?now-this.lastDecayTime:dt;
  this.lastDecayTime=now;
  if(this.vars.decayRate<=0)return {status:'delaying',hits:[]};
  this.delayRemaining-=elapsed;elapsed=-this.delayRemaining;
  if(this.delayRemaining<0)this.delayRemaining=0;
  if(elapsed<=0)return {status:'delaying',hits:[]};
  this.pentUp+=elapsed;
  const frac=this.pentUp/this.timeMaxHealth();
  if(frac<this.vars.minpercentdmg)return {status:'pent-up',hits:[]};
  this.pentUp=0;
  const hits=[];
  for(const c of components){
   if(!(c.maxHealth>0))continue;
   let damage=c.maxHealth*frac*(0.75+random()*0.5)*this.vars.decayRate;
   if(c.type===T.Wall||c.type===T.Doorway||c.type===T.WindowWall){if(sheltered(c))damage*=0.2;}
   else if((c.type===T.Pillar||c.type===T.Ceiling||c.type===T.Foundation)&&carryingWeight(c))continue;
   hits.push({component:c,damage});
  }
  return {status:'decaying',hits};
 }
 // StructureMaster save: only SetDecayDelay(_decayDelayRemaining) (~1123, read back ~1135); _pentUpDecayTime and
 // _lastDecayTime start at 0 after a load.
 save(){return {delayRemaining:this.delayRemaining};}
 load(s){if(s&&Number.isFinite(s.delayRemaining))this.delayRemaining=s.delayRemaining;return this;}
}
// Recovered prefab data: {decayMultiplier, ambientDecay} from the EnvDecay component, or null if it never decays.
export const envDecayOf=prefab=>prefab?.components?.EnvDecay?.[0]?.data??null;
