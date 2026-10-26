export type PanelMode='side-by-side'|'source-top'|'output-top';
export interface PanelPreferences {mode:PanelMode;side:number;stacked:number;}
export function panelPreferences(value:unknown):PanelPreferences{
  const saved=value&&typeof value==='object'?value as Partial<PanelPreferences>:{};
  const ratio=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?Math.max(.15,Math.min(.85,value)):.5;
  return {mode:saved.mode==='source-top'||saved.mode==='output-top'?saved.mode:'side-by-side',side:ratio(saved.side),stacked:ratio(saved.stacked)};
}

// Change grid tracks without moving or replacing either pane. Editor history,
// live PDF canvases, source selection and scroll containers stay attached.
export class PanelLayout{
  private preferences:PanelPreferences=panelPreferences(undefined);
  private drag?:{id:number;before:PanelPreferences};
  private observer:ResizeObserver;
  constructor(private host:HTMLElement,private divider:HTMLElement,private select:HTMLSelectElement,private save:(value:PanelPreferences)=>void,private resized:()=>void){
    select.addEventListener('change',()=>{const mode=panelPreferences({mode:select.value}).mode;this.cancel();this.preferences.mode=mode;this.apply();this.persist();});
    divider.addEventListener('pointerdown',event=>{
      if(event.button!==0||this.drag)return;
      event.preventDefault();divider.focus({preventScroll:true});
      this.drag={id:event.pointerId,before:{...this.preferences}};divider.setPointerCapture(event.pointerId);host.classList.add('resizing-panels');
    });
    divider.addEventListener('pointermove',event=>{
      if(this.drag?.id!==event.pointerId)return;
      const box=host.getBoundingClientRect(),vertical=this.stacked,extent=vertical?box.height:box.width,size=vertical?divider.offsetHeight:divider.offsetWidth;
      this.setFirst(((vertical?event.clientY-box.top:event.clientX-box.left)-size/2)/Math.max(1,extent-size));
    });
    divider.addEventListener('pointerup',event=>{if(this.drag?.id===event.pointerId)this.finish();});
    divider.addEventListener('pointercancel',()=>this.cancel());
    divider.addEventListener('lostpointercapture',()=>{if(this.drag)this.finish();});
    divider.addEventListener('dblclick',()=>{this.setFirst(.5);this.persist();});
    divider.addEventListener('keydown',event=>{
      if(event.key==='Escape'&&this.drag){event.preventDefault();this.cancel();return;}
      const keys=this.stacked?['ArrowUp','ArrowDown']:['ArrowLeft','ArrowRight'];
      let first=this.first;
      if(event.key===keys[0])first-=event.shiftKey?.1:.05;
      else if(event.key===keys[1])first+=event.shiftKey?.1:.05;
      else if(event.key==='Home')first=0;
      else if(event.key==='End')first=1;
      else return;
      event.preventDefault();this.setFirst(first);this.persist();
    });
    this.observer=new ResizeObserver(()=>this.apply());this.observer.observe(host);
  }
  restore(value:unknown){this.preferences=panelPreferences(value);this.apply();}
  private get stacked(){return this.preferences.mode!=='side-by-side';}
  private get first(){const source=this.stacked?this.preferences.stacked:this.preferences.side;return this.preferences.mode==='output-top'?1-source:source;}
  private limits(){const extent=this.stacked?this.host.clientHeight:this.host.clientWidth,size=8;const min=Math.min(.5,Math.max(.15,(this.stacked?180:200)/Math.max(1,extent-size)));return {min,max:1-min};}
  private setFirst(value:number){const {min,max}=this.limits(),first=Math.max(min,Math.min(max,value)),source=this.preferences.mode==='output-top'?1-first:first;if(this.stacked)this.preferences.stacked=source;else this.preferences.side=source;this.apply();}
  private apply(){
    this.host.dataset.panelLayout=this.preferences.mode;this.select.value=this.preferences.mode;
    const {min,max}=this.limits(),first=Math.max(min,Math.min(max,this.first)),source=this.preferences.mode==='output-top'?1-first:first;
    const tracks=`minmax(0, ${first}fr) 8px minmax(0, ${1-first}fr)`;
    this.host.style.gridTemplateColumns=this.stacked?'minmax(0, 1fr)':tracks;
    this.host.style.gridTemplateRows=this.stacked?tracks:'minmax(0, 1fr)';
    this.divider.setAttribute('aria-orientation',this.stacked?'horizontal':'vertical');
    this.divider.setAttribute('aria-valuemin',String(Math.round(min*100)));this.divider.setAttribute('aria-valuemax',String(Math.round(max*100)));
    this.divider.setAttribute('aria-valuenow',String(Math.round(source*100)));this.divider.setAttribute('aria-valuetext',`Source ${Math.round(source*100)}%, output ${Math.round((1-source)*100)}%`);
    this.resized();
  }
  private finish(){const drag=this.drag;if(!drag)return;this.drag=undefined;this.host.classList.remove('resizing-panels');if(this.divider.hasPointerCapture(drag.id))this.divider.releasePointerCapture(drag.id);this.persist();}
  private cancel(){const drag=this.drag;if(!drag)return;this.preferences=drag.before;this.drag=undefined;this.host.classList.remove('resizing-panels');if(this.divider.hasPointerCapture(drag.id))this.divider.releasePointerCapture(drag.id);this.apply();}
  private persist(){this.save({...this.preferences});}
}
