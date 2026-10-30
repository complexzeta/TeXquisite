import {RetainedLayout,RetainedSlice} from './retained-layout';

/** Experimental lecture compositor. It consumes already checked native tiles;
 * it does not authorize source edits, reuse TeX checkpoints, or export a PDF. */
export class RetainedPage{
  private baseline:HTMLCanvasElement;
  private blocks=new Map<string,HTMLCanvasElement>();
  private strips=new Map<string,HTMLCanvasElement>();
  private disposed=false;
  layout:RetainedLayout;
  constructor(private host:HTMLElement,baseline:HTMLCanvasElement,private viewport:HTMLElement,private ratio=1,private pixelLimit=16000000){
    if(!Number.isFinite(ratio)||ratio<=0||!Number.isSafeInteger(pixelLimit)||pixelLimit<1||!baseline.width||!baseline.height||baseline.width*baseline.height>pixelLimit)throw Error('Invalid retained page raster.');
    this.layout=new RetainedLayout(baseline.height);
    this.baseline=this.copy(baseline,0,baseline.height);this.host.replaceChildren(this.baseline);
  }
  private make(height:number){const c=document.createElement('canvas');c.width=this.baseline?.width??0;c.height=height;c.style.width=c.width/this.ratio+'px';c.style.height=height/this.ratio+'px';c.style.display='block';return c;}
  private copy(source:HTMLCanvasElement,from:number,height:number){const c=document.createElement('canvas');c.width=source.width;c.height=height;c.style.width=c.width/this.ratio+'px';c.style.height=height/this.ratio+'px';c.style.display='block';if(height)c.getContext('2d')!.drawImage(source,0,from,source.width,height,0,0,source.width,height);return c;}
  private check(next:RetainedLayout){if(this.disposed)throw Error('Retained page was disposed.');if(next.height*this.baseline.width>this.pixelLimit)throw Error('Retained page exceeds its raster budget.');}
  private anchor(){const rect=this.host.getBoundingClientRect(),v=this.viewport.getBoundingClientRect(),y=(v.top-rect.top)*this.ratio;return {top:this.viewport.scrollTop,left:this.viewport.scrollLeft,offset:rect.top-v.top,y,height:this.layout.height,inside:this.layout.inverse(y)};}
  private restore(anchor:ReturnType<RetainedPage['anchor']>){
    const old=anchor.inside,slice=old?.id===undefined?undefined:this.layout.slices.find(s=>s.id===old.id);
    const newY=old?this.layout.forward(slice?Math.min(old.y,slice.height-1):old.y,old.id):anchor.y>=anchor.height?anchor.y+this.layout.height-anchor.height:undefined;
    // Keep an unchanged source pixel at the viewport edge when a preceding
    // block grows, including a viewport on a following page. A source pixel
    // removed from a live block anchors to the end of that block instead.
    const delta=newY===undefined?0:newY/this.ratio+anchor.offset;
    this.viewport.scrollTop=anchor.top+delta;this.viewport.scrollLeft=anchor.left;
  }
  patch(slice:Omit<RetainedSlice,'height'>,tile:HTMLCanvasElement){
    if(this.disposed)throw Error('Retained page was disposed.');
    const next=this.layout.updated({...slice,height:tile.height});this.check(next);
    if(tile.width!==this.baseline.width||!tile.height||tile===this.baseline||[...this.strips.values(),...this.blocks.values()].includes(tile))throw Error('Invalid retained tile.');
    const anchor=this.anchor(),old=this.blocks.get(slice.id),canvas=old?.height===tile.height?old:this.make(tile.height);
    // Prepare the new strip partition before touching the visible page.
    const strips=new Map<string,HTMLCanvasElement>(),nodes:HTMLCanvasElement[]=[];let at=0;
    try{for(const s of next.slices){if(s.from>at){const key=at+':'+s.from,c=this.strips.get(key)??this.copy(this.baseline,at,s.from-at);strips.set(key,c);nodes.push(c);}nodes.push(s.id===slice.id?canvas:this.blocks.get(s.id)!);at=s.to;}
      if(at<this.baseline.height){const key=at+':'+this.baseline.height,c=this.strips.get(key)??this.copy(this.baseline,at,this.baseline.height-at);strips.set(key,c);nodes.push(c);}
      const ctx=canvas.getContext('2d')!;ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(tile,0,0);
    }catch(error){for(const [key,c]of strips)if(!this.strips.has(key))c.width=c.height=0;if(canvas!==old)canvas.width=canvas.height=0;throw error;}
    this.blocks.set(slice.id,canvas);this.layout=next;
    // Ordinary character edits preserve the attached canvas and every strip.
    const current=[...this.host.children];if(current.length!==nodes.length||nodes.some((n,i)=>n!==current[i]))this.host.replaceChildren(...nodes);
    for(const [key,c]of this.strips)if(!strips.has(key))c.width=c.height=0;
    this.strips=strips;if(old&&old!==canvas)old.width=old.height=0;this.restore(anchor);return canvas;
  }
  /** Return a snapshot for pixel tests/export experiments, never on each edit. */
  snapshot(){if(this.disposed)throw Error('Retained page was disposed.');const c=this.make(this.layout.height),ctx=c.getContext('2d')!;let y=0;for(const node of this.host.children){const part=node as HTMLCanvasElement;ctx.drawImage(part,0,y);y+=part.height;}return c;}
  dispose(){if(this.disposed)return;this.disposed=true;for(const c of new Set([this.baseline,...this.strips.values(),...this.blocks.values()]))c.width=c.height=0;this.strips.clear();this.blocks.clear();this.host.replaceChildren();}
}
