const counts={Client_OnKilled:0,Client_OnKilledBy:1,Client_OnKilledShot:3,Client_OnKilledShotBy:4};
export function deathShot(call){
 if(call?.args?.class!=='DeathTransfer'||!Object.hasOwn(counts,call.name))return null;
 const args=call.args.values;if(!Array.isArray(args)||args.length!==counts[call.name])return null;
 const by=call.name.endsWith('By');if(by&&(!Number.isInteger(args[0])||args[0]<0))return null;
 // attacker: the killer's NetworkViewID (the By variants); DeathTransfer runs a death the local player caused at once.
 const killer=by?{attacker:args[0]}:{};
 if(!call.name.includes('Shot'))return {shot:null,...killer};
 const [point,normal,bodyPart]=args.slice(by?1:0);
 if(!Array.isArray(point)||point.length!==3||!point.every(Number.isFinite)||!Number.isFinite(normal?.pitch)||!Number.isFinite(normal?.yaw)||!Number.isInteger(bodyPart)||bodyPart<0||bodyPart>255)return null;
 const pitch=normal.pitch*Math.PI/180,yaw=normal.yaw*Math.PI/180;
 return {shot:{point:[...point],bodyPart,direction:[Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch)]},...killer};
}
