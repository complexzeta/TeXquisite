import {createHash} from 'node:crypto';
export const FORMAT_FINGERPRINT_POLICY='texlive-language-header-v1';
export function formatFingerprint(name:string,input:Uint8Array,policy?:string){
 if(policy!==undefined&&policy!==FORMAT_FINGERPRINT_POLICY)throw Error('Unsupported format fingerprint policy.');
 let bytes=Buffer.from(input.buffer,input.byteOffset,input.byteLength);
 if(policy===FORMAT_FINGERPRINT_POLICY&&name==='language.dat'){
  // TeX Live generates this line-based hyphenation configuration. Its first
  // comment records the installer path and date, neither of which executes.
  // Keep every configuration entry and all other comments significant.
  const normalized=Buffer.allocUnsafe(bytes.length);let length=0;
  for(let i=0;i<bytes.length;i++)if(bytes[i]!==13||bytes[i+1]!==10)normalized[length++]=bytes[i];
  bytes=normalized.subarray(0,length);
  if(bytes.subarray(0,12).equals(Buffer.from('% Generated '))){const end=bytes.indexOf(10);bytes=end<0?Buffer.alloc(0):bytes.subarray(end+1);}
 }
 return createHash('sha256').update(bytes).digest('hex');
}
