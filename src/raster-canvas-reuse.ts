// Tokens identify immutable native rasters in one PDF worker lifetime. Only the
// worker's exact resource/content cache comparison may authorize a reuse reply.
export class RasterCanvasReuse<T extends {width:number;height:number;isConnected:boolean}>{
 private entries=new WeakMap<T,{id:number;width:number;height:number}>();
 remember(canvas:T,id:unknown){this.entries.delete(canvas);if(typeof id==='number'&&Number.isSafeInteger(id)&&id>0&&canvas.width>0&&canvas.height>0)this.entries.set(canvas,{id,width:canvas.width,height:canvas.height});}
 token(canvas:T|undefined){if(!canvas)return;const e=this.entries.get(canvas);return e&&canvas.isConnected&&canvas.width===e.width&&canvas.height===e.height?e.id:undefined;}
 accept(canvas:T|undefined,reply:{rasterReuse?:boolean;rasterId?:number;width:number;height:number}){const token=this.token(canvas);return canvas&&token!==undefined&&reply.rasterReuse===true&&token===reply.rasterId&&canvas.width===reply.width&&canvas.height===reply.height?canvas:undefined;}
}
