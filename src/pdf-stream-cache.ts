import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';

// Own both sides: the input normally points into a heap that TeX restores and
// overwrites on the next edit. Never retain a view of that heap as a cache key.
export class PdfStreamCache {
  private entries=new Map<string,{input:Buffer;output:Buffer}>();
  private retained=0;
  hits=0;misses=0;milliseconds=0;
  constructor(private maximumBytes=8*1024*1024,private maximumEntries=128){}
  resetTiming(){this.hits=this.misses=this.milliseconds=0;}
  compress(bytes:Uint8Array,level:number){
    const started=performance.now();
    try{
      const input=Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);
      const key=level+':'+createHash('sha256').update(input).digest('hex'),prior=this.entries.get(key);
      // Equality remains mandatory even if a digest were ever to collide.
      if(prior&&prior.input.equals(input)){
        this.entries.delete(key);this.entries.set(key,prior);this.hits++;return prior.output;
      }
      this.misses++;const output=deflateSync(input,{level}),size=input.length+output.length;
      if(size<=this.maximumBytes&&this.maximumEntries>0){
        if(prior){this.retained-=prior.input.length+prior.output.length;this.entries.delete(key);}
        while(this.retained+size>this.maximumBytes||this.entries.size>=this.maximumEntries){
          const oldest=this.entries.entries().next().value!;this.retained-=oldest[1].input.length+oldest[1].output.length;this.entries.delete(oldest[0]);
        }
        this.entries.set(key,{input:Buffer.from(input),output});this.retained+=size;
      }
      return output;
    }finally{this.milliseconds+=performance.now()-started;}
  }
  get retainedBytes(){return this.retained;}
}
