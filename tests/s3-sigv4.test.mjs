// AWS Signature Version 4 signer (host/s3.mjs), checked against AWS's own published examples, plus the client's URL
// rules (path or virtual-host style, https unless loopback).
import test from 'node:test';
import assert from 'node:assert/strict';
import {signV4,hashHex,s3Url} from '../host/s3.mjs';

const EMPTY='e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

// Source: the AWS Signature Version 4 test suite, case "get-vanilla" (aws-sig-v4-test-suite.zip, linked from the AWS
// General Reference "Signature Version 4 test suite"; the same files are in botocore's tests/unit/auth/aws4_testsuite).
// Request "GET / HTTP/1.1, Host:example.amazonaws.com, X-Amz-Date:20150830T123600Z", credential AKIDEXAMPLE,
// region us-east-1, service "service".
test('sigv4: AWS test suite get-vanilla',()=>{
 const s=signV4({method:'GET',url:'https://example.amazonaws.com/',headers:{},payloadHash:EMPTY,region:'us-east-1',service:'service',
  accessKeyId:'AKIDEXAMPLE',secretAccessKey:'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',date:new Date('2015-08-30T12:36:00Z')});
 assert.equal(s.canonicalRequest,'GET\n/\n\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\nhost;x-amz-date\n'+EMPTY);
 assert.equal(s.headers.authorization,'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31');
});

// Source: Amazon S3 API Reference, "Signature Calculations for the Authorization Header: Transferring Payload in a
// Single Chunk (AWS Signature Version 4)", section "Examples" (bucket examplebucket, us-east-1, 24 May 2013,
// credential AKIAIOSFODNN7EXAMPLE / wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY).
const S3={region:'us-east-1',service:'s3',accessKeyId:'AKIAIOSFODNN7EXAMPLE',secretAccessKey:'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',date:new Date('2013-05-24T00:00:00Z')};
const sig=s=>/Signature=([0-9a-f]{64})$/.exec(s.headers.authorization)[1];
test('sigv4: S3 example GET Object (range)',()=>{
 const s=signV4({...S3,method:'GET',url:'https://examplebucket.s3.amazonaws.com/test.txt',headers:{range:'bytes=0-9','x-amz-content-sha256':EMPTY},payloadHash:EMPTY});
 assert.match(s.headers.authorization,/SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,/);
 assert.equal(sig(s),'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
});
test('sigv4: S3 example PUT Object (a $ in the key, Date and storage-class headers)',()=>{
 const body='Welcome to Amazon S3.',h=hashHex(body);
 assert.equal(h,'44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072');
 const s=signV4({...S3,method:'PUT',url:'https://examplebucket.s3.amazonaws.com/test$file.text',headers:{date:'Fri, 24 May 2013 00:00:00 GMT','x-amz-storage-class':'REDUCED_REDUNDANCY','x-amz-content-sha256':h},payloadHash:h});
 assert.match(s.canonicalRequest,/^PUT\n\/test%24file\.text\n/);
 assert.equal(sig(s),'98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd');
});
test('sigv4: S3 example GET Bucket Lifecycle (?lifecycle)',()=>{
 const s=signV4({...S3,method:'GET',url:'https://examplebucket.s3.amazonaws.com/?lifecycle',headers:{'x-amz-content-sha256':EMPTY},payloadHash:EMPTY});
 assert.match(s.canonicalRequest,/^GET\n\/\nlifecycle=\n/);
 assert.equal(sig(s),'fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543');
});
test('sigv4: S3 example GET Bucket (List Objects, query sorted)',()=>{
 const s=signV4({...S3,method:'GET',url:'https://examplebucket.s3.amazonaws.com/?max-keys=2&prefix=J',headers:{'x-amz-content-sha256':EMPTY},payloadHash:EMPTY});
 assert.equal(sig(s),'34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7');
});

test('s3 urls: path style, virtual-host style, https required except loopback',()=>{
 assert.equal(s3Url({endpoint:'https://s3.eu-central-003.backblazeb2.com',bucket:'my-saves',pathStyle:true},'a/b c.tar').href,'https://s3.eu-central-003.backblazeb2.com/my-saves/a/b%20c.tar');
 assert.equal(s3Url({endpoint:'https://s3.us-east-1.amazonaws.com',bucket:'my-saves',pathStyle:false},'x').href,'https://my-saves.s3.us-east-1.amazonaws.com/x');
 assert.equal(s3Url({endpoint:'http://127.0.0.1:9000',bucket:'bkt',pathStyle:true},'').href,'http://127.0.0.1:9000/bkt/');
 assert.throws(()=>s3Url({endpoint:'http://s3.example.com',bucket:'bkt'},'x'),/https/);
 assert.throws(()=>s3Url({endpoint:'https://s3.example.com/path?q',bucket:'bkt'},'x'),/endpoint/);
 assert.throws(()=>s3Url({endpoint:'https://s3.example.com',bucket:'B_ad/x'},'x'),/bucket/);
});
