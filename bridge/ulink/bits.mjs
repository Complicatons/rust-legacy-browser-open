// Lidgren gen2 NetBuffer as used by uLink 1.5.6 (ULINK-PROTOCOL.md "Lidgren message framing").
// Bits are packed LSB first: bit n is (byte n>>3, bit n&7); multi-byte values little-endian (O579).
export class BitWriter {
 constructor(capacity=64){this.bytes=new Uint8Array(capacity);this.bitLength=0;}
 ensure(bits){const need=(this.bitLength+bits+7)>>3;if(need>this.bytes.length){const b=new Uint8Array(Math.max(need,this.bytes.length*2));b.set(this.bytes);this.bytes=b;}}
 writeBits(value,count){ // value: number (<=32 bits) or bigint
  this.ensure(count);let v=BigInt.asUintN(count,BigInt(value));
  for(let i=0;i<count;i++,v>>=1n){const bit=this.bitLength++;if(v&1n)this.bytes[bit>>3]|=1<<(bit&7);}
  return this;
 }
 bool(v){return this.writeBits(v?1:0,1);}
 u8(v){return this.writeBits(v&0xff,8);}
 u16(v){return this.writeBits(v&0xffff,16);}
 i32(v){return this.writeBits(v|0,32);}
 u32(v){return this.writeBits(v>>>0,32);}
 u64(v){return this.writeBits(BigInt.asUintN(64,BigInt(v)),64);}
 i64(v){return this.u64(BigInt.asUintN(64,BigInt(v)));}
 varuint(v){v=v>>>0;do{let b=v&0x7f;v>>>=7;if(v)b|=0x80;this.u8(b);}while(v);return this;}
 raw(bytes){for(const b of bytes)this.u8(b);return this;} // O656: no length prefix, bit-aligned copy
 f32(v){const b=new Uint8Array(4);new DataView(b.buffer).setFloat32(0,v,true);return this.raw(b);}
 f64(v){const b=new Uint8Array(8);new DataView(b.buffer).setFloat64(0,v,true);return this.raw(b);}
 string(s){const b=new TextEncoder().encode(s??'');this.varuint(b.length);return this.raw(b);} // O149
 blob(b){this.varuint(b.length);return this.raw(b);} // BitStream O2272: varuint length + raw
 get byteLength(){return (this.bitLength+7)>>3;}
 toBytes(){return this.bytes.slice(0,this.byteLength);}
}

export class BitReader {
 constructor(bytes,bitLength=bytes.length*8,bitOffset=0){this.bytes=bytes;this.end=bitLength;this.pos=bitOffset;}
 get remainingBits(){return this.end-this.pos;}
 get remainingBytes(){return (this.end-this.pos)>>3;}
 readBits(count){
  if(this.pos+count>this.end)throw new RangeError('Read past end of buffer');
  let v=0n;for(let i=0;i<count;i++){const bit=this.pos++;if(this.bytes[bit>>3]&(1<<(bit&7)))v|=1n<<BigInt(i);}
  return v;
 }
 bool(){return this.readBits(1)===1n;}
 u8(){return Number(this.readBits(8));}
 u16(){return Number(this.readBits(16));}
 i32(){return Number(BigInt.asIntN(32,this.readBits(32)));}
 u32(){return Number(this.readBits(32));}
 u64(){return this.readBits(64);}
 i64(){return BigInt.asIntN(64,this.readBits(64));}
 varuint(){let v=0,shift=0,b;do{if(shift===35)throw new RangeError('Bad 7-bit encoded integer');b=this.u8();v|=(b&0x7f)<<shift;shift+=7;}while(b&0x80);return v>>>0;}
 raw(n){const out=new Uint8Array(n);for(let i=0;i<n;i++)out[i]=this.u8();return out;}
 f32(){return new DataView(this.raw(4).buffer).getFloat32(0,true);}
 f64(){return new DataView(this.raw(8).buffer).getFloat64(0,true);}
 string(){const n=this.varuint();if(n>this.remainingBytes)throw new RangeError('String longer than buffer');return new TextDecoder().decode(this.raw(n));}
 blob(){const n=this.varuint();if(n>this.remainingBytes)throw new RangeError('Byte array longer than buffer');return this.raw(n);}
}
