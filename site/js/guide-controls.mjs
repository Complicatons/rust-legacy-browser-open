// The How to play controls table, read from the game's own default bindings (browser/key-bindings.mjs).
const NAMES={Mouse0:'Left mouse',Mouse1:'Right mouse',Mouse2:'Middle mouse',Mouse3:'Mouse back',Mouse4:'Mouse forward',LeftControl:'Ctrl',RightControl:'Ctrl',
 LeftShift:'Shift',RightShift:'Shift',LeftAlt:'Alt',Return:'Enter',Space:'Space',Tab:'Tab',Escape:'Esc'};
export const keyLabel=k=>NAMES[k]??(/^Alpha\d$/.test(k)?k.slice(5):k);

export function controlRows({DEFAULT_CONFIG,INPUT_MANAGER_AXES}){
 const bind={};for(const line of DEFAULT_CONFIG.split('\n')){const [,button,a,b]=line.trim().split(/\s+/);bind[button]=[a,b].filter(k=>k&&k!=='None');}
 const keys=button=>(bind[button]??[]).map(keyLabel);
 const belt=Object.keys(INPUT_MANAGER_AXES).filter(k=>/^UseItem\d$/.test(k)).map(k=>keyLabel(INPUT_MANAGER_AXES[k][0]));
 return [
  {action:'Move',keys:['Up','Left','Down','Right'].flatMap(keys)},
  {action:'Sprint',keys:keys('Sprint')},{action:'Jump',keys:keys('Jump')},{action:'Crouch',keys:keys('Duck')},
  {action:'Use',keys:INPUT_MANAGER_AXES.WorldUse.filter(k=>k!=='None').map(keyLabel)},
  {action:'Inventory',keys:keys('Inventory')},{action:'Belt',keys:belt.length?[`${belt[0]}–${belt.at(-1)}`]:[]},
  {action:'Fire',keys:keys('Fire')},{action:'Aim',keys:keys('AltFire')},{action:'Reload',keys:keys('Reload')},
  {action:'Flashlight',keys:keys('Flashlight')},{action:'Laser',keys:keys('Laser')},
  {action:'Chat',keys:keys('Chat')},{action:'Voice',keys:keys('Voice')},
  {action:'Console',keys:['F1']},{action:'Menu',keys:['Esc']},
 ];
}
