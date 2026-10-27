const {test}=require('node:test'),assert=require('node:assert/strict'),{GlyphLookup}=require('../dist/local-raster');
function reference(glyphs,code,box){
 const ranked=glyphs.filter(g=>g[0]===code).map(g=>({g,d:(g[1]+g[3]/2-box[0]-box[2]/2)**2+(g[2]+g[4]/2-box[1]-box[3]/2)**2})).sort((a,b)=>a.d-b.d);
 if(!ranked.length||ranked[0].d>4||ranked[1]&&ranked[1].d-ranked[0].d<.01)return;return ranked[0].g;
}
test('Glyph lookup retains distance, ambiguity and character boundaries',()=>{
 const a=[65,0,0,1,1],b=[65,10,0,1,1],unicode=[0x1d465,0,0,1,1],lookup=new GlyphLookup([a,b,unicode]);
 assert.equal(lookup.nearest(65,[0,0,1,1]),a);assert.equal(lookup.nearest(65,[2,0,1,1]),a);assert.equal(lookup.nearest(65,[2.00001,0,1,1]),undefined);
 assert.equal(lookup.nearest(0x1d465,[0,0,1,1]),unicode);assert.equal(lookup.nearest(66,[0,0,1,1]),undefined);
 assert.equal(new GlyphLookup([a,[...a]]).nearest(65,[0,0,1,1]),undefined);assert.equal(lookup.nearest(NaN,[0,0,1,1]),undefined);
});
test('Indexed calibration choices match the original sorted search across dense repeated glyphs',()=>{
 let seed=731;const random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/2**32),glyphs=Array.from({length:1200},()=>[32+Math.floor(random()*64),random()*500,random()*700,random()*12+.1,random()*12+.1]);
 glyphs.push([...glyphs[0]],[glyphs[1][0],glyphs[1][1]+.0001,...glyphs[1].slice(2)]);
 const lookup=new GlyphLookup(glyphs);
 for(let n=0;n<2400;n++){const g=glyphs[n%glyphs.length],box=[g[1]+(random()-.5)*4.1,g[2]+(random()-.5)*4.1,g[3],g[4]];assert.equal(lookup.nearest(g[0],box),reference(glyphs,g[0],box));}
});
