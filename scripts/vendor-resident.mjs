// Run after patch-checkpoint-engine.mjs and build-checkpoint-engine.mjs.
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const destination='engine/resident';await fs.mkdir(destination,{recursive:true});
const profile=process.env.PERSISTENT_TEX_ENGINE_LTO==='1'?'checkpoint-lto-build':'checkpoint-build';
for(const extension of ['js','wasm'])await fs.copyFile('.research/swift-source/pdftex.wasm/'+profile+'/checkpoint-pdftex.'+extension,path.join(destination,'pdftex.'+extension));
await fs.copyFile('.research/swiftlatex/pdflatex-2025.fmt',path.join(destination,'pdflatex.fmt'));
const files=['latex.ltx','expl3.ltx','ltluatex.tex','pdftexconfig.tex','language.dat','hyphen.cfg'];
const fingerprints={},locations={};
for(const file of files){const location=execFileSync('kpsewhich',[file],{encoding:'utf8',windowsHide:true}).trim();locations[file]=location;fingerprints[file]=createHash('sha256').update(await fs.readFile(location)).digest('hex');}
locations['pdftex.map']=execFileSync('kpsewhich',['pdftex.map'],{encoding:'utf8',windowsHide:true}).trim();
const texRoot=execFileSync('kpsewhich',['-var-value=TEXMFDIST'],{encoding:'utf8',windowsHide:true}).trim();
await fs.writeFile(path.join(destination,'format.json'),JSON.stringify({upstream:'https://github.com/SwiftLaTeX/SwiftLaTeX',commit:execFileSync('git',['rev-parse','HEAD'],{cwd:'.research/swift-source',encoding:'utf8'}).trim(),fingerprints},null,2));
execFileSync('git',['archive','--format=zip','--output='+path.resolve(destination,'upstream-source.zip'),'HEAD'],{cwd:'.research/swift-source',windowsHide:true});
await fs.copyFile('.research/swift-source/LICENSE',path.join(destination,'UPSTREAM-LICENSE'));
await fs.writeFile(path.join(destination,'README.txt'),'Modified SwiftLaTeX/pdfTeX compiler. Upstream source and license accompany this binary.\nCheckpoint additions are reproduced by scripts/patch-checkpoint-engine.mjs and scripts/build-checkpoint-engine.mjs using Emscripten 3.1.46.\nThe bundled format was generated from the locally installed TeX Live 2025 files; format.json records compatibility fingerprints.\nApplication and worker sources are included under src/. The compiler runs offline with read-only TeX resources.\n');
console.log('Vendored resident compiler, matching format, compatibility metadata and corresponding upstream source.');
