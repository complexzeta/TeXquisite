// The accepted PDF supplies immutable surrounding content. A live TeX block
// replaces only its old vertical slice; browser flow moves everything below it.
// PDF pages are lazy images here, not units of live pagination.
export class ContinuousView{
  id='';private epoch=0;private observer?:IntersectionObserver;
  private entries=new Map<number,{element:HTMLDivElement;canvas?:HTMLCanvasElement;pieces?:HTMLCanvasElement[];block?:HTMLCanvasElement;top?:number;bottom?:number;size:any;busy?:boolean;patched?:boolean;band?:HTMLCanvasElement[];coveredBy?:number}>();
  private pdf:any;private scale=1;private ratio=1;
  constructor(private host:HTMLElement,private viewport:HTMLElement){}
  // Capture immediately before a layout swap, so scrolling while a PDF is
  // being prepared remains authoritative. Anchor to a page, not document ratio.
  private position(){
    const top=this.viewport.getBoundingClientRect().top;
    const entry=[...this.entries].find(([,e])=>e.coveredBy===undefined&&e.element.getBoundingClientRect().bottom>top);
    return {top:this.viewport.scrollTop,left:this.viewport.scrollLeft,page:entry?.[0],offset:entry?entry[1].element.getBoundingClientRect().top-top:0};
  }
  private restore(position:ReturnType<ContinuousView['position']>){
    const entry=position.page===undefined?undefined:this.entries.get(position.page);
    this.viewport.scrollTop=entry?this.viewport.scrollTop+entry.element.getBoundingClientRect().top-this.viewport.getBoundingClientRect().top-position.offset:position.top;
    this.viewport.scrollLeft=position.left;
  }
  get visiblePage(){return this.position().page;}
  private dispose(entries:typeof this.entries,keep?:HTMLCanvasElement){for(const e of entries.values())for(const c of [...(e.band??[]),...(e.pieces??[]),...(e.canvas?[e.canvas]:[]),...(e.block?[e.block]:[])])if(c!==keep)c.width=c.height=0;}
  clear(){this.epoch++;this.id='';this.observer?.disconnect();for(const e of this.entries.values())for(const c of [...(e.band??[]),...(e.pieces??[]),...(e.canvas?[e.canvas]:[]),...(e.block?[e.block]:[])])c.width=c.height=0;this.entries.clear();}
  matchesScale(scale:number,ratio:number){return Math.abs(this.scale-scale)<1e-7&&Math.abs(this.ratio-ratio)<1e-7;}
  // Keep the latest live pixels attached while a new raster/proof is prepared.
  // The product scale*ratio still describes their original bitmap resolution.
  rescale(scale:number){
    if(!this.entries.size||Math.abs(scale-this.scale)<1e-7)return;
    const position=this.position(),factor=scale/this.scale,raster=this.scale*this.ratio;
    this.scale=scale;this.ratio=raster/scale;position.offset*=factor;
    this.host.querySelectorAll('.navigation-marker').forEach(node=>node.remove());
    for(const e of this.entries.values()){
      e.element.style.width=e.size.originalWidth*scale+'px';
      if(!e.block&&!e.band)e.element.style.minHeight=e.size.originalHeight*scale+'px';
      for(const canvas of new Set([...(e.band??[]),...(e.pieces??[]),...(e.canvas?[e.canvas]:[]),...(e.block?[e.block]:[])])){
        canvas.style.width=e.size.originalWidth*scale+'px';canvas.style.height=canvas.height/this.ratio+'px';
      }
    }
    this.restore(position);
  }
  async show(id:string,pdf:any,canvas:HTMLCanvasElement,page:number,scale:number,ratio:number,reconcileBands=false){
    if(this.id===id&&this.scale===scale&&this.ratio===ratio)return;
    const epoch=++this.epoch;
    const sizes=await pdf.sizes();if(epoch!==this.epoch)return;
    const position=this.position(),previous=this.entries;
    // A matching complete build numbers following pages after the resized band.
    // Preserve the same visible content when retiring the provisional wrappers.
    if(reconcileBands&&position.page!==undefined){
      const originalPage=position.page;let delta=0;
      for(const [first,e]of previous){if(!e.band)continue;
        const covered=[...previous.values()].filter(item=>item.coveredBy===first).length+1;
        if(originalPage>first)delta+=e.band.length-covered;
        else if(originalPage===first){
          const height=e.size.originalHeight*this.scale,inside=Math.min(e.band.length-1,Math.max(0,Math.floor(-position.offset/height)));
          position.page+=inside;position.offset+=inside*height;
        }
      }
      position.page=Math.max(1,Math.min(sizes.length,position.page+delta));
    }
    this.observer?.disconnect();this.entries=new Map();this.id=id;this.pdf=pdf;this.scale=scale;this.ratio=ratio;
    const children:HTMLDivElement[]=[];
    for(const [index,size]of sizes.entries()){
      const element=document.createElement('div');element.className='flow-page';element.dataset.page=String(index+1);element.style.width=size.originalWidth*scale+'px';element.style.minHeight=size.originalHeight*scale+'px';
      const entry={element,size,canvas:index+1===page?canvas:undefined};if(entry.canvas)element.append(entry.canvas);this.entries.set(index+1,entry);children.push(element);
    }
    this.host.replaceChildren(...children);this.restore(position);this.dispose(previous,canvas);
    this.observer=new IntersectionObserver(rows=>{for(const row of rows)if(row.isIntersecting)void this.ensure(Number((row.target as HTMLElement).dataset.page),epoch);},{root:this.viewport,rootMargin:'400px'});
    for(const e of this.entries.values())this.observer.observe(e.element);
  }
  private async ensure(page:number,epoch=this.epoch){
    const e=this.entries.get(page);if(!e||e.canvas||e.block||e.busy||e.patched||e.coveredBy!==undefined)return;e.busy=true;
    try{const canvas=await this.pdf.render(page,this.scale,this.ratio);if(epoch!==this.epoch||e.block||e.patched||e.coveredBy!==undefined){canvas.width=canvas.height=0;return;}e.canvas=canvas;e.element.replaceChildren(canvas,...e.element.querySelectorAll('.navigation-marker'));
      canvas.style.width=e.size.originalWidth*this.scale+'px';canvas.style.height=canvas.height/this.ratio+'px';
      // Retain only the nearby raster images. A patched block owns its strips
      // independently and is never evicted while it is the live edited block.
      const viewport=this.viewport.getBoundingClientRect();
      for(const [other,item]of this.entries)if(Math.abs(other-page)>1&&item.canvas&&!item.patched){
        const bounds=item.element.getBoundingClientRect();
        // A late offscreen render must not evict the page just revealed by
        // navigation. Keep its marker even when a distant bitmap is retired.
        if(bounds.bottom>=viewport.top-400&&bounds.top<=viewport.bottom+400)continue;
        item.canvas.width=item.canvas.height=0;item.canvas=undefined;item.element.replaceChildren(...item.element.querySelectorAll('.navigation-marker'));
      }
    }catch{/* The next accepted document can retry an unavailable image. */}finally{e.busy=false;}
  }
  patchPages(first:number,canvases:HTMLCanvasElement[]){
    const entries=canvases.map((canvas,i)=>{const e=this.entries.get(first+i);if(!e||Math.abs(parseFloat(canvas.style.width)-e.size.originalWidth*this.scale)>.01||Math.abs(parseFloat(canvas.style.height)-e.size.originalHeight*this.scale)>.01)throw new Error('Affected page geometry changed.');return e;});
    const position=this.position();
    for(const [i,e]of entries.entries()){
      const old=[...(e.band??[]),...(e.pieces??[]),...(e.canvas?[e.canvas]:[]),...(e.block?[e.block]:[])];
      e.canvas=canvases[i];e.patched=true;e.band=undefined;e.coveredBy=undefined;e.element.hidden=false;e.pieces=undefined;e.block=undefined;e.top=e.bottom=undefined;
      e.element.style.minHeight=e.size.originalHeight*this.scale+'px';e.element.replaceChildren(canvases[i]);this.observer?.unobserve(e.element);
      for(const canvas of old)if(canvas!==canvases[i])canvas.width=canvas.height=0;
    }
    this.restore(position);
  }
  patchBand(span:{first:number;last:number},canvases:HTMLCanvasElement[]){
    const first=this.entries.get(span.first);
    if(!first||span.last<span.first||span.last-span.first>=3||!canvases.length||canvases.length>3)throw new Error('Invalid continuous page band.');
    const entries=Array.from({length:span.last-span.first+1},(_,i)=>this.entries.get(span.first+i));
    // Keep ordinary one-canvas-per-page wrappers when pagination is unchanged.
    // This also restores wrappers covered by an earlier expanded live band.
    if(canvases.length===entries.length){this.patchPages(span.first,canvases);return;}
    const valid=(c:HTMLCanvasElement)=>Number.isFinite(parseFloat(c.style.width))&&Number.isFinite(parseFloat(c.style.height))&&Math.abs(parseFloat(c.style.width)-first.size.originalWidth*this.scale)<.01&&Math.abs(parseFloat(c.style.height)-first.size.originalHeight*this.scale)<.01;
    if(entries.some(e=>!e||Math.abs(e.size.originalWidth-first.size.originalWidth)>.01||Math.abs(e.size.originalHeight-first.size.originalHeight)>.01)||canvases.some(c=>!valid(c)))throw new Error('Page band geometry changed.');
    const position=this.position();
    if(position.page!==undefined&&position.page>=span.first&&position.page<=span.last){position.page=span.first;position.offset=first.element.getBoundingClientRect().top-this.viewport.getBoundingClientRect().top;}
    for(const [i,item]of entries.entries()){
      const e=item!,old=[...(e.band??[]),...(e.pieces??[]),...(e.canvas?[e.canvas]:[]),...(e.block?[e.block]:[])];
      e.canvas=undefined;e.band=undefined;e.pieces=undefined;e.block=undefined;e.top=e.bottom=undefined;e.patched=true;e.coveredBy=i?span.first:undefined;
      e.element.hidden=i>0;e.element.replaceChildren();this.observer?.unobserve(e.element);
      for(const c of old)if(!canvases.includes(c))c.width=c.height=0;
    }
    first.canvas=canvases[0];first.band=[...canvases];first.element.style.minHeight='0';first.element.replaceChildren(...canvases);this.restore(position);
  }
  patch(page:number,base:HTMLCanvasElement,tile:any,flow:any){
    const e=this.entries.get(page);if(!e)throw new Error('Continuous baseline is unavailable.');
    const factor=this.scale*this.ratio,start=Math.max(0,Math.floor(flow.rect.y*factor)),end=Math.min(base.height,Math.ceil((flow.rect.y+flow.rect.height)*factor));
    if(end<=start||start>=base.height)throw new Error('Continuous block is outside its baseline.');
    const make=(height:number)=>{const c=document.createElement('canvas');c.width=base.width;c.height=height;c.style.width=e.size.originalWidth*this.scale+'px';c.style.height=height/this.ratio+'px';return c;};
    if(!e.pieces){
      const top=make(start),bottom=make(base.height-end);if(start)top.getContext('2d')!.drawImage(base,0,0,base.width,start,0,0,base.width,start);if(bottom.height)bottom.getContext('2d')!.drawImage(base,0,end,base.width,bottom.height,0,0,base.width,bottom.height);
      e.pieces=[top,bottom];e.top=start;e.bottom=end;
    }else if(e.top!==start||e.bottom!==end)throw new Error('Continuous block baseline changed.');
    const height=Math.max(1,Math.ceil(flow.leading*factor)+tile.patchHeight),oldBlock=e.block;
    const block=oldBlock?.height===height&&oldBlock.width===base.width?oldBlock:make(height),ctx=block.getContext('2d')!;
    const position=this.position(),oldCanvas=e.canvas;
    ctx.fillStyle='white';ctx.fillRect(0,0,block.width,block.height);
    const draw=(image:CanvasImageSource)=>ctx.drawImage(image,tile.sourceX,tile.sourceY,tile.patchWidth,tile.patchHeight,Math.floor(flow.rect.x*factor),Math.ceil(flow.leading*factor),tile.patchWidth,tile.patchHeight);
    if(tile.image){try{draw(tile.image);}finally{tile.image.close();}}
    else{
      const image=document.createElement('canvas');image.width=tile.width;image.height=tile.height;
      image.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(tile.data.buffer,tile.data.byteOffset,tile.data.byteLength),tile.width,tile.height),0,0);
      draw(image);image.width=image.height=0;
    }
    e.block=block;e.canvas=undefined;e.element.style.minHeight='0';
    // Keep unchanged strips attached. Moving them through replaceChildren on
    // every character invalidates large visible canvas layers. Reuse the live
    // canvas too when line count/geometry stay unchanged.
    if(oldBlock&&oldBlock.parentElement===e.element){if(oldBlock!==block)oldBlock.replaceWith(block);}
    else e.element.replaceChildren(e.pieces[0],block,e.pieces[1]);
    this.restore(position);this.observer?.unobserve(e.element);
    if(oldBlock&&oldBlock!==block)oldBlock.width=oldBlock.height=0;if(oldCanvas)oldCanvas.width=oldCanvas.height=0;
    return block;
  }
  mark(page:number,box:{x:number;y:number;width:number;height:number},live=false){
    const e=this.entries.get(page);if(!e)return false;
    let y=box.y;
    if(!live&&e.block){
      const factor=this.scale*this.ratio,top=e.top!/factor,bottom=e.bottom!/factor;
      if(y>=bottom)y+=(e.block.height-(e.bottom!-e.top!))/factor;
      else if(y+box.height>top)return false;
    }
    this.host.querySelectorAll('.navigation-marker').forEach(e=>e.remove());
    const marker=document.createElement('div');marker.className='navigation-marker';
    marker.style.cssText=`left:${box.x*this.scale}px;top:${y*this.scale}px;width:${Math.max(4,box.width*this.scale)}px;height:${Math.max(5,box.height*this.scale)}px`;
    const target=live?e.block:e.element;if(!target)return false;
    if(live){marker.style.top=(e.top!/(this.scale*this.ratio)+y)*this.scale+'px';}
    e.element.append(marker);this.reveal(e.element,live?e.top!/(this.scale*this.ratio)+y:y);
    const left=marker.getBoundingClientRect().left,view=this.viewport.getBoundingClientRect();
    if(left<view.left+24)this.viewport.scrollLeft+=left-view.left-24;else if(left>view.right-24)this.viewport.scrollLeft+=left-view.right+24;
    return true;
  }
  scroll(page:number){this.entries.get(page)?.element.scrollIntoView({block:'start'});}
  revealPage(page:number){const entry=this.entries.get(page),element=entry?.coveredBy===undefined?entry?.element:this.entries.get(entry.coveredBy)?.element;if(!element)return;const box=element.getBoundingClientRect(),view=this.viewport.getBoundingClientRect();if(box.bottom<=view.top+24||box.top>=view.bottom-24)element.scrollIntoView({block:'nearest'});}
  reveal(canvas:HTMLElement,y:number,scale=this.scale){const point=canvas.getBoundingClientRect().top+y*scale,view=this.viewport.getBoundingClientRect();if(point>view.bottom-24)this.viewport.scrollTop+=point-view.bottom+24;else if(point<view.top+24)this.viewport.scrollTop+=point-view.top-24;}
}
