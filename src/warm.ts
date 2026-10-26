import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {spawn,ChildProcessWithoutNullStreams} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';

// Conservative acceleration: complete single-pass articles only. Documents that
// need dependency orchestration retain latexmk, rather than publishing an
// unresolved intermediate pass or substituting a paragraph approximation.
export function splitSimpleArticle(source:string) {
  if(!/\\documentclass(?:\[[^\]]*\])?\{article\}/.test(source))return;
  if(/\\(?:input|include|includegraphics|bibliography|addbibresource|printbibliography|cite\w*|ref|eqref|pageref|autoref|label|tableofcontents|listoffigures|listoftables|index|makeindex|printindex|write|openout|read|csname|directlua|jobname|externaldocument|nofiles)\b/.test(source))return;
  const allowed=new Set(['amsmath','amssymb','amsthm','amsfonts','mathtools','fontenc','inputenc','geometry','xcolor']);
  for(const match of source.matchAll(/\\(?:usepackage|RequirePackage)(?:\[[^\]]*\])?\{([^}]+)\}/g)){
    if(match[1].split(',').some(name=>!allowed.has(name.trim())))return;
  }
  const begin=/^\\begin\{document\}[^\S\r\n]*(?:%[^\r\n]*)?\r?$/m.exec(source);
  if(!begin||! /\\end\{document\}/.test(source))return;
  const end=begin.index+begin[0].length;
  return {preamble:source.slice(0,end),body:source.slice(end)};
}
type Slot={child:ChildProcessWithoutNullStreams;directory:string;ready:Promise<void>;done:Promise<number|null>;log:string;idle:NodeJS.Timeout;};
export class WarmCompiler {
  diagnosticLog="";
  private slots:Promise<Slot>[]=[];
  private key='';
  private epoch=0;
  private stopping:Promise<void>=Promise.resolve();
  constructor(private directory:string){}
  stop(){this.epoch++;const old=this.slots;this.slots=[];this.key='';this.stopping=Promise.allSettled([this.stopping,...old.map(promise=>promise.then(async s=>{clearTimeout(s.idle);s.child.kill();await s.done;await fs.rm(s.directory,{recursive:true,force:true});}))]).then(()=>{});return this.stopping;}
  private arm(preamble:string,engine:string,jobname:string) {
    const key=createHash('sha256').update(JSON.stringify([preamble,engine,jobname])).digest('hex');
    if(this.key!==key){this.stop();this.key=key;}
    while(this.slots.length<4){const next=this.create(preamble,engine,jobname);void next.catch(()=>{});this.slots.push(next);}
    return this.slots[0];
  }
  private async create(preamble:string,engine:string,jobname:string):Promise<Slot>{
    const directory=path.join(this.directory,randomUUID().slice(0,8));await fs.mkdir(directory,{recursive:true});
    const marker='PERSISTENTTEXREADY';
    // The '+' form loads the default font map now, preserving any mappings
    // already supplied by the document. Otherwise pdfTeX defers its expensive
    // map parsing until the first page is shipped after each edit.
    await fs.writeFile(path.join(directory,'driver.tex'),preamble+`\n\\pdfmapline{+}\n\\typeout{${marker}}\n\\scrollmode\\read-1 to\\PersistentTeXWakeToken\n\\nonstopmode\\input{body.tex}\n`);
    const child=spawn(engine,['-interaction=nonstopmode','-halt-on-error','-no-shell-escape','-jobname='+jobname,'driver.tex'],{cwd:directory,windowsHide:true,shell:false});
    let resolveReady:()=>void,rejectReady:(e:Error)=>void,readySeen=false;
    const ready=new Promise<void>((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});void ready.catch(()=>{});
    const slot:Slot={child,directory,ready,done:Promise.resolve(null),log:'',idle:setTimeout(()=>child.kill(),600000)};slot.idle.unref();
    child.stdout.on('data',data=>{slot.log+=data;if(!readySeen&&slot.log.includes(marker)){readySeen=true;resolveReady();}});
    child.stderr.on('data',data=>slot.log+=data);
    child.stdin.on('error',()=>{});
    slot.done=new Promise(resolve=>{
      child.once('error',e=>{rejectReady(e);resolve(null);});
      child.once('close',code=>{clearTimeout(slot.idle);if(!readySeen)rejectReady(new Error('Engine could not preload the document.'));resolve(code);});
    });
    return slot;
  }
  async compile(source:string,engine:string,jobname:string,signal:AbortSignal,timeoutMs:number,log:(s:string)=>void):Promise<Buffer|undefined>{
    const split=splitSimpleArticle(source);if(!split){this.stop();return;}
    const promise=this.arm(split.preamble,engine,jobname),epoch=this.epoch;
    this.slots.shift();
    const slot=await promise;
    const started=Date.now();let readyAt=started;
    const cancel=()=>slot.child.kill();signal.addEventListener('abort',cancel,{once:true});
    const timer=setTimeout(cancel,timeoutMs);
    try{
      if(signal.aborted)throw new Error('Build cancelled.');
      await slot.ready;if(signal.aborted)throw new Error('Build cancelled.');
      readyAt=Date.now();
      clearTimeout(slot.idle);
      if(this.epoch===epoch)this.arm(split.preamble,engine,jobname);
      // Idle engines expire after ten minutes. Use the standard build for this
      // edit while their replacements load, rather than writing to a dead pipe.
      if(slot.child.killed||slot.child.exitCode!==null||slot.child.signalCode!==null)return;
      await fs.writeFile(path.join(slot.directory,'body.tex'),split.body);
      slot.child.stdin.end('\n');
      const code=await slot.done;this.diagnosticLog=slot.log;log(slot.log);
      log(`Timing: engine readiness ${readyAt-started} ms; full body ${Date.now()-readyAt} ms.\n`);
      if(signal.aborted)throw new Error('Build cancelled.');
      if(code!==0)throw new Error('Build failed in the preloaded TeX engine. See build log.');
      // Packages can request a rerun despite our conservative source screen.
      // In that case the standard pipeline decides completion and publication.
      if(/Rerun|rerun|undefined references|undefined citations|No pages of output/i.test(slot.log))return;
      const pdf=await fs.readFile(path.join(slot.directory,jobname+'.pdf'));
      return pdf;
    }finally{
      clearTimeout(timer);signal.removeEventListener('abort',cancel);
      slot.child.kill();await slot.done;
      await fs.rm(slot.directory,{recursive:true,force:true}).catch(()=>{});
    }
  }
}
