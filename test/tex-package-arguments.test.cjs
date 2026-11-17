const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {argumentPackages,packageArguments}=require('../dist/tex-package-arguments');

test('package declarations include custom signatures and dependency overrides without executing code',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'tex-argument-test-'));
 try{
  await fs.writeFile(path.join(directory,'example.sty'),'\\RequirePackage{dependency}\n\\newcommand{\\triple}[3]{#1#2#3}\n\\NewDocumentCommand\\custom{O{default} m m m m}{text}\n\\renewcommand{\\override}[3]{#1#2#3}');
  await fs.writeFile(path.join(directory,'dependency.sty'),'\\newcommand{\\override}[2]{#1#2}\n\\def\\dependent#1#2{#1#2}');
  const source='% \\usepackage{ignored}\n\\usepackage{example}',counts=await packageArguments(source,[directory],async()=>[]);
  assert.deepEqual(argumentPackages(source),['latex.ltx','example.sty']);
  assert.equal(counts.triple,3);assert.equal(counts.custom,4);assert.equal(counts.dependent,2);assert.equal(counts.override,3);
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});
