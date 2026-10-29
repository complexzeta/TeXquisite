const {test}=require('node:test'),assert=require('node:assert/strict');
// core bundles the recovery helper; compile this pure module for unit coverage.
const {previewRepair}=require('../dist/preview-recovery');
const {previewRegionRepair}=require('../dist/preview-recovery');
test('Undefined root commands can be skipped without changing source line or column offsets',()=>{
 const source='\\begin{document}\nHello \\tyop world.\n\\end{document}';
 const fixed=previewRepair(source,'! Undefined control sequence.\nl.2 Hello \\tyop\n world.');
 assert.equal(fixed.source,source.replace('\\tyop','     '));assert.equal(source.includes('\\tyop'),true);
 assert.equal(previewRepair(source,'! Undefined control sequence.\nl.2 <argument> \\tyop'),undefined);
 assert.equal(previewRepair(source,'! Undefined control sequence.\n\\tyop ->\\brokenExpansion\nl.2 Hello \\tyop'),undefined);
 const repeated=source.replace(' world.',' \\tyop.');
 assert.equal(previewRepair(repeated,'! Undefined control sequence.\nl.2 Hello \\tyop').source,repeated.replace('\\tyop','     '));
});

test('Bounded structural repairs close math groups before delimiters and match literal environments',()=>{
 const cases=[
  ['$\\frac{1}{2$ words.','$\\frac{1}{2}$ words.'],
  ['$\\sqrt{x$ words.','$\\sqrt{x}$ words.'],
  ['$\\left(x$ words.','$\\left(x\\right.$ words.'],
  ['\\[\\sqrt{x\\] words.','\\[\\sqrt{x}\\] words.'],
  ['$\\frac{1}{2','$\\frac{1}{2}$'],
  ['$\\frac{1}$','$\\frac{1}{}$'],
  ['$\\frac$','$\\frac{}{}$'],
  ['\\begin{equation}\\frac{1}{2\\end{equation}','\\begin{equation}\\frac{1}{2}\\end{equation}'],
  ['\\begin{equation}\\left(x\\end{equation}','\\begin{equation}\\left(x\\right.\\end{equation}'],
  ['\\begin{equation}\\sqrt{x\\end{align}','\\begin{equation}\\sqrt{x}\\end{equation}'],
  ['\\begin{equation}x=1\\end{align}','\\begin{equation}x=1\\end{equation}'],
  ['$x % } ignored\n+y','$x % } ignored\n+y$'],
  ['$x % } ignored','$x $% } ignored'],
  ['$\\{x\\}$ words.','$\\{x\\}$ words.'],
 ];
 for(const [raw,want]of cases){const prefix='Before.\n\n',suffix='After.\n',source=prefix+raw+'\n\n'+suffix;
  const repaired=previewRegionRepair(source,'Local paragraph needs input beyond its boundary.',{from:prefix.length,to:source.length-suffix.length});
  if(raw===want)assert.equal(repaired,undefined);else assert.equal(repaired.source,prefix+want+'\n\n'+suffix,raw);
 }
});

test('Structural recovery refuses unbounded, multi-paragraph, opaque and unrelated input',()=>{
 for(const raw of ['\\textbf{unfinished','\\def\\x{$} $x','\\catcode`!=0 $x','\\begin{verbatim}$x','First $x\n\nSecond','x'.repeat(16001)+'$x','\\begin{document}$x','$x\\]']){
  const source=raw+'\n\n';assert.equal(previewRegionRepair(source,'Local paragraph needs input beyond its boundary.',{from:0,to:source.length}),undefined,raw.slice(0,40));
 }
 const source='$x\n\n';assert.equal(previewRegionRepair(source,'Worker stopped',{from:0,to:source.length}),undefined);
 assert.equal(previewRegionRepair(source,'Local paragraph needs input beyond its boundary.',{from:-1,to:source.length}),undefined);
});

test('Cursor narrows an expanded window to one complete paragraph',()=>{
 const source='Stable words.\n\nMath $\\sqrt{x$ words.\n\nLater words.\n\n',range={from:0,to:source.length},log='! Missing } inserted.';
 assert.equal(previewRegionRepair(source,log,range,source.indexOf('words.',20)).source,source.replace('x$','x}$'));
 assert.equal(previewRegionRepair(source,log,range,2),undefined);
 assert.equal(previewRegionRepair(source,log,range,source.length),undefined);
});
test('Only exact document-end diagnostics allow temporary closing tokens',()=>{
 const source='\\begin{document}\nMath $x\n\\end{document}';
 const fixed=previewRepair(source,'! Missing $ inserted.\nl.3 \\end{document}');
 assert.equal(fixed.source,source.replace('\\end{document}','$\\end{document}'));
 assert.equal(previewRepair(source,'! Missing $ inserted.\nl.2 Math'),undefined);
 assert.equal(previewRepair(source,'! File missing.\nl.3 \\end{document}'),undefined);
 const paragraph='Math $x\n\n\\end{document}';
 assert.equal(previewRepair(paragraph,'! Missing $ inserted.\nl.2 \n').source,'Math $x\n$\n\\end{document}');
 assert.equal(previewRepair('Hello_world','! Missing $ inserted.\nl.1 Hello_').source,'Hello\\_world');
});
