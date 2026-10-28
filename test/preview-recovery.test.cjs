const {test}=require('node:test'),assert=require('node:assert/strict');
// core bundles the recovery helper; compile this pure module for unit coverage.
const {previewRepair}=require('../dist/preview-recovery');
test('Undefined root commands can be skipped without changing source line or column offsets',()=>{
 const source='\\begin{document}\nHello \\tyop world.\n\\end{document}';
 const fixed=previewRepair(source,'! Undefined control sequence.\nl.2 Hello \\tyop\n world.');
 assert.equal(fixed.source,source.replace('\\tyop','     '));assert.equal(source.includes('\\tyop'),true);
 assert.equal(previewRepair(source,'! Undefined control sequence.\nl.2 <argument> \\tyop'),undefined);
 assert.equal(previewRepair(source,'! Undefined control sequence.\n\\tyop ->\\brokenExpansion\nl.2 Hello \\tyop'),undefined);
 const repeated=source.replace(' world.',' \\tyop.');
 assert.equal(previewRepair(repeated,'! Undefined control sequence.\nl.2 Hello \\tyop').source,repeated.replace('\\tyop','     '));
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
