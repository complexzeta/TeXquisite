const {test}=require('node:test'),assert=require('node:assert/strict'),{flowLocations}=require('../dist/region-compositor'),{forwardPosition}=require('../dist/navigation-query');
test('Flow navigation maps UTF-8 columns to source offsets and excludes other inputs and pages',()=>{
 const source='Preamble\nabc π😀fi\nSuffix',from=source.indexOf('abc'),to=source.indexOf('\nSuffix'),glyph=(file,line,col,page,code,length)=>({glyph:[file,line,col,page,10,20,3,8,code,length]});
 const raw=[glyph('/work/main.tex',2,4,1,960,2),glyph('/work/main.tex',2,6,1,128512,4),glyph('/work/main.tex',2,10,1,64257,2),glyph('/work/other.tex',2,4,1,960,2),glyph('/work/main.tex',2,4,2,960,2),glyph('/work/main.tex',1,0,1,80,1),glyph('/work/main.tex',2,5,1,960,1)].map(JSON.stringify).join('\n');
 const actual=flowLocations(raw,source,'main',1,from,to);
 assert.deepEqual(actual.map(g=>source.slice(g.at,g.end)),['π','😀','fi']);assert.ok(actual.every(g=>g.x===10&&g.y===20&&g.height===8));
});
test('Source positions navigate to wrapped glyphs using byte columns and fall back to line regions',()=>{
 const nav={schema:1,sources:{},regions:[['main.tex',1,1,1,2,20,10]],characters:[['main.tex',1,0,1,10,10,3,8,960,2],['main.tex',1,3,2,20,80,4,9,120,1]]};
 assert.deepEqual(forwardPosition(nav,'MAIN.tex','π x',2),['main.tex',1,2,20,80,4,9]);
 assert.deepEqual(forwardPosition({...nav,characters:[]},'main.tex','π x',2),nav.regions[0]);
});
