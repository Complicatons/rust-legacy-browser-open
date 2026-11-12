// Synthetic native-format GNUP fixtures, shaped from the statically recovered serializers. Not packet captures.
import {BitWriter} from '../../bridge/ulink/bits.mjs';
export function inventoryFixture(catalogue,{capacity=40,full=true,slots=[],updates=[]}={}){
 const w=new BitWriter().u8(capacity).u8(full?1:0),entries=full?Array.from({length:capacity},(_,i)=>[i,slots[i]??null]):updates;
 if(!full)w.u8(entries.length);
 for(const [index,s]of entries){w.u8(s?1:0);if(!full)w.u8(index);if(!s)continue;
  const [key,item]=Object.entries(catalogue.items).find(([k,i])=>k===s.item||i.data.m_Name===s.name)??[];if(!key)throw Error('Unknown fixture item '+s.name);
  const d=item.data;w.i32(d._uniqueID).u8(s.uses??1);if(d.doesLoseCondition)w.f32(s.condition??1).f32(s.maxCondition??1);
  if('_viewModelPrefab' in d){w.u8(s.totalModSlots??0).u8(s.mods?.length??0);for(const uid of s.mods??[])w.i32(uid);}
 }return w.toBytes();
}
