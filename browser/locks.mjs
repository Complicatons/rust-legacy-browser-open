// Original door code locks: LockableObject / PasswordLockableObject, BasicDoor context menu and the
// lockentry.passwordentry console command (decompiled server). Prefabs with the lock: ;deploy_wood_door,
// ;deploy_metal_door, ;deploy_woodgate. Messages are the original Notice texts.
export const DOOR_ACTIONS={open:'Open',close:'Close',enterCode:'Enter Code',lock:'Lock',unlock:'Unlock',changeLock:'Change Lock'};
export const hasCodeLock=prefab=>Boolean(prefab?.components?.PasswordLockableObject);

export class CodeLock{
 constructor(){this.password='';this.users=new Set();this.active=true;this.lastFail=-100;} // LockableObject.lockActive defaults true
 hasAccess(userId){return this.users.has(String(userId));}
 setPassword(p){this.password=p;this.users=new Set();}       // SetPassword clears the authorised users
 checkPassword(p){return this.password!==''&&p===this.password;}
 canCheckYet(time){return time-this.lastFail>5;}               // 5 s after a wrong code
 save(){return {password:this.password,users:[...this.users],active:this.active};}
 static load(s){const l=new CodeLock();l.password=s?.password??'';l.users=new Set(s?.users??[]);l.active=s?.active??true;return l;}
}

// BasicDoor.ContextQueryMenu: which options a user sees. isOwner = DeployableObject.ownerID == user.
export function doorMenu({lock,isOwner,open,userId}){
 const unlockedForUser=Boolean(lock)&&(lock.hasAccess(userId)||isOwner);
 const locked=Boolean(lock)&&lock.active;
 const out=[];
 if(!lock||isOwner||unlockedForUser||!locked)out.push(open?DOOR_ACTIONS.close:DOOR_ACTIONS.open);
 if(!unlockedForUser)out.push(DOOR_ACTIONS.enterCode);
 if(lock&&isOwner)out.push(locked?DOOR_ACTIONS.unlock:DOOR_ACTIONS.lock,DOOR_ACTIONS.changeLock);
 return out;
}
// BasicDoor.ToggleStateServer(controllable): owner, no lock, inactive lock, or an authorised user may toggle.
export function canToggleDoor({lock,isOwner,userId}){return isOwner||!lock||!lock.active||lock.hasAccess(userId);}
export const LOCKED_MESSAGE='The door is locked!';

// lockentry.passwordentry <code> <changing>: exactly four digits; changing needs ownership; wrong codes back off 5 s.
export function enterCode({lock,code,changing,isOwner,userId,time}){
 if(!lock||typeof code!=='string'||!/^\d{4}$/.test(code))return {ok:false,message:null};
 if(changing){
  if(!isOwner)return {ok:false,message:null};
  lock.setPassword(code);return {ok:true,message:'Password is now : '+code};
 }
 if(!lock.canCheckYet(time))return {ok:false,message:'Too fast! Try again later.'};
 if(lock.checkPassword(code)){lock.users.add(String(userId));return {ok:true,message:'You can now access this door!'};}
 lock.lastFail=time;return {ok:false,message:'Incorrect password.'};
}
// Lock/Unlock menu actions (owner only, per doorMenu).
export function setLockActive(lock,active){lock.active=active;return 'Door is now '+(active?'locked.':'unlocked');}
