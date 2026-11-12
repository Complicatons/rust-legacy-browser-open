// Shared sign-in helpers (browser and node tests).

// A redirect target after sign-in: only same-origin absolute paths, never protocol-relative or backslash tricks.
export function safeNext(value){
 if(typeof value!=='string'||!value.startsWith('/'))return '/servers';
 let decoded=value;try{decoded=decodeURIComponent(value);}catch{return '/servers';}
 if(/^\/[\/\\]/.test(decoded)||/^\/[\/\\]/.test(value)||decoded.includes('\\'))return '/servers';
 return value;
}
