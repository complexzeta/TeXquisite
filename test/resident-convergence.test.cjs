const {test}=require('node:test'),assert=require('node:assert/strict'),{residentConvergence}=require('../dist/resident-convergence');
const files=text=>[['main.aux',Buffer.from(text)]];
test('Stable unresolved chapter references keep a resident preview available',()=>{
 const log="LaTeX Warning: Reference `ch:8' on page 3 undefined.\nLaTeX Warning: There were undefined references.";
 assert.equal(residentConvergence(true,log,files('\\relax\n')),'ready');assert.equal(residentConvergence(false,log,files('\\newlabel{x}{{1}{2}}')),'retry');
 assert.equal(residentConvergence(true,'LaTeX Warning: There were undefined references. Rerun to get cross-references right.',files('')),'ready');
});
test('External bibliography/index work and missing output retain fallback',()=>{
 for(const log of ['Please (re)run Biber','No file main.bbl.','No file main.ind.','No file main.gls.'])assert.equal(residentConvergence(true,log,files('')),'external');
 const log="LaTeX Warning: Citation `missing' on page 1 undefined.\nLaTeX Warning: There were undefined references.";
 assert.equal(residentConvergence(true,log,files('\\bibdata{refs}')),'external');assert.equal(residentConvergence(true,log,[['main.bcf',Buffer.from('<bcf/>')]]),'external');
 assert.equal(residentConvergence(false,log,files('\\bibdata{refs}')),'retry','A present bbl can resolve its citation on the next pass');
 assert.equal(residentConvergence(true,log,files('\\relax')),'ready','An isolated citation without a bibliography request is a warning');
 assert.equal(residentConvergence(true,'No pages of output.',files('')),'retry');
});
