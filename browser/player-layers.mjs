// Sampler.SetWeights: role totals, dynamic legacy layers and their conditional weights.
// Keep the shipped branch expressions, including the asymmetric running-jump scores.
// CreationContext.Solidify remaps the StateContext layers once: aimUp/aimDown 6/7 -> 1, upperBody 10 -> 2,
// so both additive channels sit below the 3..5 locomotion layers (additive states never claim blend weight).
export function playerLayers(samples,aimAllow=1){
 const sum=role=>samples.filter(p=>role.includes(p.role)).reduce((n,p)=>n+p.weight,0);
 let ns=sum(['north','south']),ew=sum(['east','west']),idle=sum(['idle']);
 const running=sum(['movingJump']),jump=sum(['idleJump'])+running,aim=sum(['up','down']),upper=sum(['upper']);
 const idleScore=idle+jump;let nsScore,ewScore;
 if(ns===0){nsScore=0;ewScore=ew===0?0:ew-running;}
 else if(ew===0){ewScore=0;nsScore=running;}
 else if(ns>ew){const ratio=ns/ew;ewScore=ew-running*ratio;nsScore=ns-running*(1-ratio);}
 else{const ratio=ew/ns;nsScore=ns-running*ratio;ewScore=ew-running*(1-ratio);}
 let il,nl,el;
 if(idleScore>nsScore){
  if(idleScore>ewScore){il=5;if(nsScore>ewScore){nl=4;el=3;}else{nl=3;el=4;}}
  else{el=5;il=4;nl=3;}
 }else if(nsScore>ewScore){nl=5;if(idle>ewScore){il=4;el=3;}else{el=4;il=3;}}
 else{el=5;nl=4;il=3;}
 idle=idleScore;
 switch(il){
  case 5:idle+=ns+ew;if(el===4)ew+=ns;else if(el===3)ns+=ew;break;
  case 4:if(el===5){ew+=ns+idle;idle+=ns;}else if(el===3){ns+=ew+idle;idle+=ew;}break;
  case 3:if(el===5){ew+=ns+idle;ns+=idle;}else if(el===4){ns+=ew+idle;ew+=idle;}break;
 }
 return samples.map(p=>{
  let denominator,layer;
  switch(p.role){
   case 'north':case 'south':denominator=ns;layer=nl;break;
   case 'east':case 'west':denominator=ew;layer=el;break;
   case 'idle':case 'idleJump':case 'movingJump':denominator=idle;layer=il;break;
   case 'up':case 'down':denominator=aim;layer=1;break;
   case 'upper':denominator=upper;layer=2;break;
   default:return p;
  }
  return {...p,layer,weight:denominator>0?p.weight/denominator*(p.role==='up'||p.role==='down'?aimAllow:1):0};
 }).filter(p=>p.weight>0);
}
