// ArmorModelRenderer.Censored (censor.nudity, [Client][User], not saved): true at every start. While censored a model with a
// censoredModel binds that instead (BindArmorModelCheckedNonNull); the exports name the censored model in defaults/items and
// keep the original as models[key].uncensored (tools/unity_armor.py). Setting it rebinds every ArmorModelRenderer and
// sleeper (SleepingAvatar.RebindAllRenderers): listeners here.
export const censorship={censored:true,listeners:new Set(),
 set(value){value=Boolean(value);if(value===this.censored)return;this.censored=value;for(const fn of this.listeners)try{fn(value);}catch(e){console.warn(e);}},
 onChange(fn){this.listeners.add(fn);return ()=>this.listeners.delete(fn);}};
// CFAR and SleepingAvatar.SAAM use item unique IDs in Feet, Legs, Torso, Head order.
export function armorKeys(armor,uids=[],censored=censorship.censored){return armor.slots.map((slot,i)=>{
 const item=armor.items[String(uids[i]??0)],key=item?.slot===slot?item.model:armor.defaults[slot];
 return censored?key:armor.models[key]?.uncensored??key;
});}
export function decodeArmor(data){
 const bytes=data instanceof Uint8Array?data:data?.base64?Uint8Array.from(atob(data.base64),c=>c.charCodeAt(0)):null;
 if(!bytes||bytes.byteLength!==16)throw Error('Invalid CFAR armour state');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);return Array.from({length:4},(_,i)=>view.getInt32(i*4,true));
}
