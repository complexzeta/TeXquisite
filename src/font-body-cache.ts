import {createHash} from 'node:crypto';

// Complete exact inputs remain the authority; the digest only selects a candidate.
export class FontBodyCache {
  private entries=new Map<string,{input:Buffer;output:Buffer}>();
  private retained=0;
  hits=0;misses=0;
  constructor(private maximumBytes=16*1024*1024,private maximumEntries=128){}
  resetTiming(){this.hits=this.misses=0;}
  get(input:Buffer){
    const key=createHash('sha256').update(input).digest('hex'),entry=this.entries.get(key);
    if(!entry||!entry.input.equals(input)){this.misses++;return;}
    this.entries.delete(key);this.entries.set(key,entry);this.hits++;return entry.output;
  }
  put(input:Buffer,output:Buffer){
    const size=input.length+output.length;if(size>this.maximumBytes||this.maximumEntries<1)return;
    const key=createHash('sha256').update(input).digest('hex'),prior=this.entries.get(key);
    if(prior){this.retained-=prior.input.length+prior.output.length;this.entries.delete(key);}
    while(this.retained+size>this.maximumBytes||this.entries.size>=this.maximumEntries){const [old,entry]=this.entries.entries().next().value!;this.entries.delete(old);this.retained-=entry.input.length+entry.output.length;}
    this.entries.set(key,{input:Buffer.from(input),output:Buffer.from(output)});this.retained+=size;
  }
  get retainedBytes(){return this.retained;}
}
