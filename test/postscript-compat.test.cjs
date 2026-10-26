const {test}=require('node:test'),assert=require('node:assert/strict');
const {reorderPreviewSizes}=require('../dist/postscript-compat');
const prolog='/preview@version(14.0.6)def\n/preview@tightpage true def\n7{currentfile token\n',log='Preview: Tightpage -65536 -65536 65536 65536\n',size='-65536 -65536 65536 65536 100 200 300';
test('preview sizes move ahead of setup independently on each page, preserving all other bytes',()=>{
 const page=n=>`%%Page: ${n} ${n}\nTeXDict begin ${n} 0 bop 0 0 a\n/setup (untouched) def\n${size}\nDRAW\n`;
 const ps=prolog+page(1)+page(2),fixed=reorderPreviewSizes(ps,log);assert.ok(fixed);assert.equal(fixed,prolog+[1,2].map(n=>`%%Page: ${n} ${n}\nTeXDict begin ${n} 0 bop\n${size}\n 0 0 a\n/setup (untouched) def\n\nDRAW\n`).join(''));assert.equal(reorderPreviewSizes(fixed,log),undefined);
});
test('ambiguous, unconfirmed, ordinary and already-correct PostScript are never repaired',()=>{
 const page=`%%Page: 1 1\nTeXDict begin 1 0 bop 0 0 a\n${size}\n`;
 assert.equal(reorderPreviewSizes(page,log),undefined);assert.equal(reorderPreviewSizes(prolog+page,''),undefined);assert.equal(reorderPreviewSizes(prolog+page+size+'\n',log),undefined);assert.equal(reorderPreviewSizes(prolog+page.replace('65536 65536','65535 65536'),log),undefined);assert.equal(reorderPreviewSizes(prolog+page.replace('bop 0 0 a','bop'),log),undefined);
});
