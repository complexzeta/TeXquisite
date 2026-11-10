// These literal environments are scheduling hints. The compiler and raster
// checks still decide whether a checkpoint or local update can be used.
export const drawingStart=/\\begin\{(?:tikzpicture|forest)\}/;

export function drawingBoundaries(source:string){
  return source.matchAll(/\\(begin|end)\{(tikzpicture|forest)\}/g);
}
