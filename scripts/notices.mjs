import {readFile,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
const lock=JSON.parse(await readFile('package-lock.json','utf8'));
let output='THIRD-PARTY NOTICES\nProject code: UNLICENSED; no public release license selected.\n\nElectron includes Chromium/Node components; see LICENSE and LICENSES.chromium.html shipped in the runtime.\n\n';
output+='PDFium core BSD license, authors and component notices are shipped in media/vendor/licenses/. PDFium wrapper MIT license is included below.\n\n';
output+='Resident compiler: modified SwiftLaTeX/pdfTeX. Upstream repository license and corresponding source are in engine/resident/UPSTREAM-LICENSE and upstream-source.zip. Individual TeX, pdfTeX, xpdf and interface files retain their own copyright/license notices. Checkpoint modifications and build scripts are shipped under scripts/; application and worker source is shipped under src/.\n\n';
for(const [directory,pkg] of Object.entries(lock.packages)){
  if(!directory||!/(codemirror|lezer|@hyzyla\/pdfium|pdf-lib|pako|tslib|style-mod|w3c-keyname|crelt|node_modules\/electron$)/.test(directory))continue;
  output+=`\n${'='.repeat(72)}\n${directory} ${pkg.version} (${pkg.license??'see below'})\n`;
  for(const file of await readdir(directory))if(/^licen[sc]e(?:\.|$)/i.test(file))output+='\n'+await readFile(path.join(directory,file),'utf8')+'\n';
}
await writeFile('THIRD-PARTY-NOTICES.txt',output);
