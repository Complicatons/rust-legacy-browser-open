// Transport for local port validation; never presents itself as legacy-server compatible.
export class LocalSession {
 constructor(){this.id=null;this.token=null;this.seq=0;}
 async request(path,method='GET',data){const headers={};if(this.id){headers['x-session-id']=this.id;headers.authorization='Bearer '+this.token;}if(data)headers['content-type']='application/json';const response=await fetch('/api/'+path,{method,headers,body:data?JSON.stringify(data):undefined,cache:'no-store'}),result=await response.json();if(!response.ok)throw Error(result.error||'Local session request failed');return result;}
 async join(name){if(this.id)throw Error('Already joined');const result=await this.request('session','POST',{name});if(result.protocol!=='local-port-test-v1')throw Error('Unsupported local protocol');this.id=result.id;this.token=result.token;return {id:this.id,protocol:result.protocol};}
 async input({forward=0,right=0,yaw=0,pitch=0,sprint=false,crouch=false,jump=false}={}){return this.request('input','POST',{seq:this.seq++,forward,right,yaw,pitch,sprint,crouch,jump});}
 state(){return this.request('state');}
 async leave(){if(!this.id)return;await this.request('session','DELETE');this.id=null;this.token=null;}
}
