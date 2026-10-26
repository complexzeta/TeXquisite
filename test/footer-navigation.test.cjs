const {test}=require('node:test'),assert=require('node:assert/strict'),{forwardPosition}=require('../dist/navigation-query');
const body=['main.tex',1,1,80,140,150,10],footer=['main.tex',6,1,304,727,4,5];
test('Blank lines and document end never follow a generated page number',()=>{
 const text='Ordinary body.\n\\begin{tikzpicture}\n\\draw (0,0)--(1,1);\n\\end{tikzpicture}\n\n\\end{document}',nav={schema:1,sources:{},regions:[body,footer]};
 for(const at of [text.indexOf('\n\n')+1,text.indexOf('\\end{document}'),text.length])assert.equal(forwardPosition(nav,'main.tex',text,at),undefined);
 assert.deepEqual(forwardPosition(nav,'main.tex',text,3),body);
});
test('A nearby footer is excluded when a real source line needs region fallback',()=>{
 const text='Body.\nA macro-generated diagram.\n\\end{document} % flush',nav={schema:1,sources:{},regions:[body,['main.tex',3,1,304,727,4,5]]};
 assert.deepEqual(forwardPosition(nav,'main.tex',text,text.indexOf('diagram')),body);
});
test('Real text sharing a line with a flush command retains its glyph target',()=>{
 const text='Last words. \\end{document}',glyph=['main.tex',1,0,1,80,140,5,10,76],nav={schema:1,sources:{},regions:[footer],characters:[glyph]};
 assert.deepEqual(forwardPosition(nav,'main.tex',text,1),['main.tex',1,1,80,140,5,10]);
 assert.equal(forwardPosition({...nav,regions:[body]},'main.tex','% comment',4),undefined);
});
