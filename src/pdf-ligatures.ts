export interface PdfTextClusterGlyph {code:number;object:number;box:readonly number[];}
// PDF text extraction can expand one drawn ligature into multiple Unicode
// characters. Only a shared physical cluster may select its ligature path.
export function ligaturePathCode(glyphs:readonly PdfTextClusterGlyph[]){
 const first=glyphs[0];if(!first||!first.object||first.box.length!==4||!first.box.every(Number.isFinite)||first.box[1]<=first.box[0]||first.box[3]<=first.box[2])return;
 const patterns:[[number[],number],...[number[],number][]]=[[[102,102,105],0xfb03],[[102,102,108],0xfb04],[[102,102],0xfb00],[[102,105],0xfb01],[[102,108],0xfb02],[[383,116],0xfb05],[[115,116],0xfb06]];
 for(const [codes,unicode]of patterns){if(glyphs.length<codes.length)continue;const cluster=glyphs.slice(0,codes.length);if(cluster.some((g,i)=>g.code!==codes[i]||g.object!==first.object||g.box.length!==4||!g.box.every(Number.isFinite)))continue;
  if(cluster.slice(1).every(g=>g.box[1]<=g.box[0]||g.box[3]<=g.box[2]||g.box.every((n,i)=>Math.abs(n-first.box[i])<=.02)))return unicode;
 }
}
