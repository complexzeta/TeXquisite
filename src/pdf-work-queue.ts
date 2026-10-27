type Work={priority:number;run:()=>Promise<void>};
// PDFium is not reentrant. Yield between operations so incoming edit requests
// can overtake queued verification, while each individual operation stays atomic.
export class PdfWorkQueue{
 private pending:Work[]=[];
 private active=false;
 private scheduled=false;
 constructor(private schedule:(run:()=>void)=>void=run=>setTimeout(run,0)){}
 enqueue<T>(priority:number,run:()=>Promise<T>):Promise<T>{
  return new Promise((resolve,reject)=>{
   this.pending.push({priority,run:async()=>{try{resolve(await run());}catch(error){reject(error);}}});
   this.request();
  });
 }
 private request(){
  if(this.active||this.scheduled||!this.pending.length)return;
  this.scheduled=true;this.schedule(()=>{this.scheduled=false;void this.drain();});
 }
 private async drain(){
  if(this.active||!this.pending.length)return;
  let next=0;for(let i=1;i<this.pending.length;i++)if(this.pending[i].priority<this.pending[next].priority)next=i;
  const [work]=this.pending.splice(next,1);this.active=true;
  try{await work.run();}finally{this.active=false;this.request();}
 }
}
