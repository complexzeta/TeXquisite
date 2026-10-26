import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const names=['pgfmathutil.code.tex','pgfmathparser.code.tex','pgfmathfunctions.code.tex','pgfmathfunctions.basic.code.tex','pgfmathfunctions.trigonometric.code.tex'];
const files=[];for(const name of names){const file=execFileSync('kpsewhich',[name],{encoding:'utf8',windowsHide:true}).trim();files.push({name,sha256:createHash('sha256').update(await fs.readFile(file)).digest('hex')});}
await fs.writeFile('engine/resident/tikz-math.json',JSON.stringify({schema:1,files},null,2)+'\n');console.log('Recorded stock PGF math fingerprints.');
