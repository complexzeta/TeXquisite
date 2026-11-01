export interface BuildDiagnostic {id:string;root:string;editId?:string;severity?:'error'|'warning';kind:'tex'|'build';message:string;file?:string;line?:number;sourceHash?:string;}
export interface DiagnosticInput {file:string;aliases:string[];}
type DiagnosticDocument={length:number;lines:number;line:(n:number)=>{from:number;text:string};lineAt:(at:number)=>{from:number;text:string}};
// UI freshness only: this grants no compiler, navigation or export authority.
export class DiagnosticTracker {
 private anchors=new Map<string,{issue:BuildDiagnostic;at:number;text:string;pending:boolean}>();
 private same(a:BuildDiagnostic|undefined,b:BuildDiagnostic){return !!a&&a.id===b.id&&a.root===b.root&&a.file===b.file&&a.line===b.line&&a.editId===b.editId&&a.sourceHash===b.sourceHash&&a.message===b.message;}
 sync(issues:readonly BuildDiagnostic[],file:string,editId:string|undefined,doc?:DiagnosticDocument){
  const live=new Set(issues.map(i=>i.id));for(const id of this.anchors.keys())if(!live.has(id))this.anchors.delete(id);
  if(!doc)return;
  for(const issue of issues){if(issue.severity==='warning'||issue.file!==file||issue.editId!==editId||!issue.line||issue.line>doc.lines||this.same(this.anchors.get(issue.id)?.issue,issue))continue;
   const line=doc.line(issue.line);this.anchors.set(issue.id,{issue,at:line.from,text:line.text,pending:false});
  }
 }
 changed(file:string,mapPosition:(at:number)=>number,doc:DiagnosticDocument){
  for(const anchor of this.anchors.values())if(anchor.issue.file===file){anchor.at=Math.max(0,Math.min(doc.length,mapPosition(anchor.at)));anchor.pending=doc.lineAt(anchor.at).text!==anchor.text;}
 }
 pending(issue:BuildDiagnostic){const anchor=this.anchors.get(issue.id);return !!anchor&&this.same(anchor.issue,issue)&&anchor.pending;}
}
// Resolve only captured input aliases. Compiler output never grants arbitrary
// filesystem access, and ambiguous/wrapped filenames remain non-clickable.
export function parseDiagnostic(text:string,inputs:DiagnosticInput[]=[]):Pick<BuildDiagnostic,'kind'|'message'|'file'|'line'>{
  text=text.replace(/\r\n?/g,'\n');
  const postscript=/^Error:\s+(.+)$/m.exec(text);
  if(postscript&&/Ghostscript[^\n]*(?:Unrecoverable error|exit code)/i.test(text))return {kind:'build',message:compact('PostScript conversion failed: '+postscript[1])};
  const bibliography=/I couldn't open (?:style|database) file (.+)/.exec(text);
  if(bibliography)return {kind:'build',message:compact('Bibliography file not found: '+bibliography[1])};
  const firstError=/^!\s+(?!==>)(.+)$/m.exec(text);
  // MiKTeX can print an unlocated, useful LaTeX error before a located generic
  // Emergency stop. Keep the captured location, but explain the first cause.
  const messageFor=(message:string)=>compact(/Undefined control sequence/.test(message)&&/\\PSTricks\b[\s\S]{0,100}_Not_Configured_For_This_Format/.test(text)?'PSTricks is not configured for the selected TeX engine.':/^(?:Emergency stop|Fatal error)/i.test(message)&&firstError&&!/^(?:Emergency stop|Fatal error)/i.test(firstError[1])?firstError[1]:message);
  const normalize=(name:string)=>{name=name.replace(/^"|"$/g,'').replace(/\\/g,'/').replace(/^\.\//,'');return process.platform==='win32'?name.toLowerCase():name;};
  const aliases=new Map<string,string>();
  for(const input of inputs)for(const alias of input.aliases)aliases.set(normalize(alias),input.file);
  const resolve=(name:string)=>aliases.get(normalize(name.trim()));
  for(const match of text.matchAll(/^(.+?):(\d+):\s*(.+)$/gm)){
    const file=resolve(match[1]);if(file)return {kind:'tex',message:messageFor(match[3]),file,line:Number(match[2])};
    if(/\.(tex|sty|cls|ltx|def|cfg|clo|fd|bib|bst|aux|nav|snm|toc|out|bbl|vrb)["']?$/.test(match[1]))return {kind:'tex',message:messageFor(match[3])};
  }
  const error=firstError;
  if(error){
    const after=text.slice(error.index+error[0].length),line=/^l\.(\d+)\s/m.exec(after);
    let file:string|undefined,unknownFile=false;
    // TeX's input stack is printed with parentheses. Track all nesting, not
    // just known files, so a closed include cannot become the next error link.
    const stack:({file?:string;unknownFile?:boolean})[]=[];
    const names=inputs.flatMap(input=>input.aliases.flatMap(alias=>[alias,'"'+alias+'"'].map(value=>({alias:value.replace(/\\/g,'/'),file:input.file})))).sort((a,b)=>b.alias.length-a.alias.length);
    const prefix=text.slice(0,error.index).replace(/\\/g,'/');
    for(let at=0;at<prefix.length;at++){
      if(prefix[at]==='('){
        const rest=prefix.slice(at+1),known=names.find(({alias})=>rest.startsWith(alias)&&/[\s)]/.test(rest[alias.length]??' '));
        stack.push(known?{file:known.file}:{unknownFile:/^(?:[^()\n]*\.(?:tex|sty|cls|ltx|def|cfg|clo|fd|bib|bst)(?:[\s)"]|$)|"?(?:\.{0,2}\/|[a-z]:\/)|[^\s()]+\n)/i.test(rest)});
        if(known)at+=known.alias.length;
      }else if(prefix[at]===')')stack.pop();
    }
    for(const item of stack){if(item.file){file=item.file;unknownFile=false;}else if(item.unknownFile){file=undefined;unknownFile=true;}}
    // A resumed root checkpoint omits its original file-open log entry.
    if(!file&&!unknownFile)file=inputs[0]?.file;
    return {kind:'tex',message:messageFor(error[1]),...(file&&line?{file,line:Number(line[1])}:{})};
  }
  return {kind:'build',message:compact(text.split('\n').find(line=>line.trim())??'Compilation did not finish. Open the build log for details.')};
}
function compact(text:string){return text.replace(/^Error:\s*/,'').replace(/\s+/g,' ').trim().slice(0,300);}

// Read only the final TeX pass: resolved first-pass citations must disappear.
export function parseWarnings(text:string,inputs:DiagnosticInput[]=[],processorLog=''):Omit<BuildDiagnostic,'id'|'root'|'editId'|'sourceHash'>[]{
 text=text.replace(/\r\n?/g,'\n');const issues:Omit<BuildDiagnostic,'id'|'root'|'editId'|'sourceHash'>[]=[],seen=new Set<string>();
 const add=(issue:Omit<BuildDiagnostic,'id'|'root'|'editId'|'sourceHash'>)=>{const key=JSON.stringify([issue.file,issue.line,issue.message]);if(!seen.has(key)&&issues.length<200){seen.add(key);issues.push({...issue,severity:'warning'});}};
 for(const match of text.matchAll(/^(?:LaTeX(?: Font)?|Package [\w.-]+|Class [\w.-]+) Warning:\s*([^\n]+)((?:\n(?!\s*$|(?:LaTeX|Package|Class|!|\[))[^\n]+){0,6})/gm)){
  const message=compact(match[1]+match[2]);
  if(/There were undefined references|Label\(s\) may have changed/.test(message))continue;
  const line=/on input line (\d+)/.exec(message);
  const parsed=line?parseDiagnostic(text.slice(0,match.index)+'! '+message+'\nl.'+line[1]+' probe\n',inputs):{kind:'tex' as const,message};
  add(parsed);
 }
 for(const match of processorLog.replace(/\r\n?/g,'\n').matchAll(/Bib file\(s\) not found in search path:\n((?:[ \t]+[^\n]+\n?)+)/g))for(const name of match[1].trim().split('\n'))add({kind:'build',message:'Bibliography file not found: '+name.trim()});
 return issues;
}

function commandSuggestion(command:string){
 const choices=['int','iint','iiint','oint','sum','prod','lim','frac','sqrt','text','emph','begin','end','left','right','langle','rangle','lfloor','rfloor','lceil','rceil','alpha','beta','gamma','theta','pi','infty'];
 const name=command.slice(1),oneEdit=(target:string)=>{if(Math.abs(target.length-name.length)>1||target===name)return false;let i=0,j=0,edits=0;while(i<name.length&&j<target.length){if(name[i]===target[j]){i++;j++;continue;}if(++edits>1)return false;if(name.length>=target.length)i++;if(target.length>=name.length)j++;}return edits+(name.length-i)+(target.length-j)===1;};
 const adjacentSwap=(target:string)=>{if(target.length!==name.length)return false;let i=0;while(i<name.length&&name[i]===target[i])i++;return i+1<name.length&&name[i]===target[i+1]&&name[i+1]===target[i]&&name.slice(i+2)===target.slice(i+2);};
 const matches=choices.filter(target=>oneEdit(target)||adjacentSwap(target));return matches.length===1?'\\'+matches[0]:undefined;
}
export function diagnosticSuggestion(message:string):{command:string;replacement:string}|undefined{
 const command=/undefined command (\\[A-Za-z]+)(?:[.\s]|$)/i.exec(message)?.[1],replacement=command?commandSuggestion(command):undefined;
 return command&&replacement?{command,replacement}:undefined;
}
// Never guess between repeated occurrences, command prefixes, or comments.
// The caller must also verify the diagnostic's source hash before dispatching.
export function diagnosticRepair(message:string,text:string,line:number):{from:number;to:number;insert:string}|undefined{
 const suggestion=diagnosticSuggestion(message);if(!suggestion||!Number.isInteger(line)||line<1)return;
 let from=0;for(let i=1;i<line;i++){const end=text.indexOf('\n',from);if(end<0)return;from=end+1;}
 const end=text.indexOf('\n',from),row=text.slice(from,end<0?text.length:end),matches:number[]=[];
 for(const token of row.matchAll(/\\[A-Za-z]+|\\[^A-Za-z]|%/g)){if(token[0]==='%')break;if(token[0]===suggestion.command)matches.push(from+token.index!);}
 if(matches.length!==1)return;
 return {from:matches[0],to:matches[0]+suggestion.command.length,insert:suggestion.replacement};
}
export function diagnosticAdvice(message:string):string|undefined{
 if(/PostScript conversion failed/.test(message))return 'The PostScript converter rejected the diagram output. Open the build log for details; legacy PSTricks commands may need updating.';
 if(/Bibliography file not found/.test(message))return 'Check the .bib or .bst filename and add its folder through Support files.';
 if(/PSTricks is not configured/.test(message))return 'Open Build → Settings and select LaTeX → PostScript → PDF (PSTricks). This uses the installed latex, dvips and ps2pdf tools.';
 if(/Undefined control sequence|skipped undefined command/i.test(message)){const suggestion=diagnosticSuggestion(message);return (suggestion?'Did you mean '+suggestion.replacement+'? ':'')+'Check the command spelling. If it belongs to a package or local macro, check the preamble and support files.';}
 if(/temporarily balanced unfinished math|temporarily closed math/i.test(message))return 'Check the nearby math delimiters, braces and environment endings. Match pairs can complete them while typing.';
 if(/escaped a text-only/i.test(message))return 'Escape literal underscores and carets in text, or put the intended formula inside math delimiters.';
 if(/Missing \$ inserted/i.test(message))return 'Check nearby math delimiters ($…$, \\(…\\), or \\[…\\]). The mistake can be before the reported line.';
 if(/Missing [}]/i.test(message)||/File ended while scanning|Runaway argument|Paragraph ended before/i.test(message))return 'Check for an unclosed brace or command argument before this line. Match pairs can help prevent incomplete input.';
 if(/Extra [}]|Too many }/i.test(message))return 'Check for an extra closing brace or a missing opening brace before this line.';
 if(/ended by \\end|\\begin.*ended by/i.test(message))return 'Check that the begin and end environment names match and that nested environments close in order.';
 if(/Missing \\right|Extra \\right/i.test(message))return 'Check the nearby \\left and \\right delimiters. Use a dot for an intentionally invisible delimiter.';
 if(/File .*not found|I can't find file/i.test(message))return 'Check the filename, project folder and Support files folders. A required package may also be missing from TeX Live.';
 if(/Emergency stop|Fatal error/i.test(message))return 'An earlier message in the build log may explain the cause. The last good preview is retained.';
 return;
}
