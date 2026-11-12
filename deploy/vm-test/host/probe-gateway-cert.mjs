// HOST helper for Start-TestBrowser.ps1: reads the VM gateway's test certificate (live TLS handshake, or a .cer/.pem
// file exported from the VM) and prints {fingerprint, spki} as JSON. fingerprint = SHA-256 of the certificate DER
// (what 09-New-GatewayCert.ps1 prints in the VM); spki = base64 SHA-256 of the SubjectPublicKeyInfo, the value Chromium's
// --ignore-certificate-errors-spki-list expects. Trust is decided by the owner comparing fingerprints, not by this probe.
//   node deploy/vm-test/host/probe-gateway-cert.mjs 192.168.56.10 28443
//   node deploy/vm-test/host/probe-gateway-cert.mjs --file gateway-cert.cer
import {connect} from 'node:tls';
import {X509Certificate,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

export function describeCertificate(cert){
 const x=cert instanceof X509Certificate?cert:new X509Certificate(cert);
 return {fingerprint:createHash('sha256').update(x.raw).digest('hex').toUpperCase(),spki:createHash('sha256').update(x.publicKey.export({type:'spki',format:'der'})).digest('base64'),subject:x.subject,subjectAltName:x.subjectAltName??null,validTo:x.validTo};
}

function probe(host,port){
 return new Promise((resolve,reject)=>{
  // rejectUnauthorized:false only to read the self-signed certificate; nothing is sent over this connection.
  const s=connect({host,port,rejectUnauthorized:false,timeout:5000},()=>{const c=s.getPeerX509Certificate();s.end();c?resolve(describeCertificate(c)):reject(Error('no certificate'));});
  s.on('timeout',()=>{s.destroy();reject(Error('timeout'));});s.on('error',reject);
 });
}

if(process.argv[1]&&import.meta.url.endsWith(process.argv[1].replace(/\\/g,'/').split('/').pop())){
 const [a,b]=process.argv.slice(2);
 try{console.log(JSON.stringify(a==='--file'?describeCertificate(readFileSync(b)):await probe(a,Number(b))));}
 catch(e){console.error('probe failed:',e.message);process.exit(1);}
}
