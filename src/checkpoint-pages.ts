// Per-capture pool. Samples only select candidates; sharing requires all bytes.
export class CheckpointPages {
  private buckets=new Map<string,Buffer[]>();
  private allocated=0;
  constructor(private limit=8*1024*1024){}
  intern(page:Buffer):Buffer|undefined{
    const key=[0,64,1024,16384,32768,page.length-4].map(at=>page.readUInt32LE(Math.min(at,page.length-4))).join(':');
    const bucket=this.buckets.get(key)??[],same=bucket.find(saved=>page.equals(saved));
    if(same)return same;
    if(bucket.length>=8||this.allocated+page.length>this.limit)return;
    const saved=Buffer.from(page);bucket.push(saved);this.buckets.set(key,bucket);this.allocated+=saved.length;return saved;
  }
}
