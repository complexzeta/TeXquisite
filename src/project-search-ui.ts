import type {SearchMatch} from './project-search';
export class ProjectSearchUI{
 private dialog=document.getElementById('projectSearchDialog') as HTMLDialogElement;private preview?:{id:string;matches:SearchMatch[];folders?:string[]};private selected=new Set<string>();private generation=0;private applying=false;
 private get status(){return document.getElementById('projectSearchStatus')!;}
 private get apply(){return document.getElementById('applyProjectSearch') as HTMLButtonElement;}
 constructor(private call:(method:string,...args:unknown[])=>Promise<any>,private flush:()=>Promise<void>,private navigate:(result:any)=>void,private replace:(result:any)=>void){
  document.getElementById('projectSearch')!.onclick=()=>{this.dialog.showModal();document.getElementById('projectSearchQuery')!.focus();};
  this.dialog.addEventListener('cancel',e=>{if(this.applying)e.preventDefault();});
  document.getElementById('closeProjectSearch')!.onclick=()=>{if(!this.applying)this.dialog.close();};
  for(const id of ['projectSearchQuery','projectSearchReplacement','projectSearchRegex','projectSearchCase','projectSearchSupport'])document.getElementById(id)!.addEventListener('input',()=>{this.generation++;this.preview=undefined;this.selected.clear();this.update();this.status.textContent='Search again to refresh the preview.';});
  document.getElementById('projectSearchForm')!.onsubmit=e=>{e.preventDefault();void this.search();};
  document.getElementById('selectSearchAll')!.onclick=()=>{this.selected=new Set(this.preview?.matches.map(m=>m.id));this.render();};document.getElementById('selectSearchNone')!.onclick=()=>{this.selected.clear();this.render();};
  this.apply.onclick=()=>void this.applySelected();
 }
 private update(){this.apply.disabled=this.applying||!this.preview||!this.selected.size;const empty=!(document.getElementById('projectSearchReplacement') as HTMLInputElement).value;this.apply.textContent=`${empty?'Delete selected matches':'Replace selected'} (${this.selected.size})`;}
 private async search(){
  const generation=++this.generation;this.preview=undefined;this.selected.clear();this.update();this.status.textContent='Searching…';
  try{await this.flush();const value=(id:string)=>(document.getElementById(id) as HTMLInputElement).value,checked=(id:string)=>(document.getElementById(id) as HTMLInputElement).checked;
   const result=await this.call('projectSearch',{query:value('projectSearchQuery'),replacement:value('projectSearchReplacement'),regex:checked('projectSearchRegex'),caseSensitive:checked('projectSearchCase'),support:checked('projectSearchSupport')});if(generation!==this.generation)return;
   this.preview=result;this.selected=new Set(result.matches.map((m:SearchMatch)=>m.id));this.status.textContent=`${result.matches.length} matches · ${result.scanned} files searched${result.skipped?' · '+result.skipped+' unreadable or unsupported entries skipped':''}${result.limited?' · Results limited; narrow the search to find more.':''}`;this.render();
  }catch(e){if(generation===this.generation)this.status.textContent=String(e);}
 }
 private render(){
  const list=document.getElementById('projectSearchResults')!;list.replaceChildren();for(const match of this.preview?.matches??[]){const row=document.createElement('div');row.className='search-result';row.setAttribute('role','listitem');const check=document.createElement('input');check.type='checkbox';check.checked=this.selected.has(match.id);check.setAttribute('aria-label','Select '+match.file.split(/[\\/]/).at(-1)+' line '+match.line);check.onchange=()=>{check.checked?this.selected.add(match.id):this.selected.delete(match.id);this.update();};
   const link=document.createElement('button');const normalized=match.file.replace(/\\/g,'/'),folder=this.preview?.folders?.find(f=>normalized.toLowerCase().startsWith(f.replace(/\\/g,'/').toLowerCase()+'/')),relative=folder?normalized.slice(folder.length+1):normalized;link.textContent=(folder&&folder!==this.preview?.folders?.[0]?'Support: ':'')+relative+' · line '+match.line;link.title=match.file;link.onclick=()=>void this.open(match);
   const context=document.createElement('div');context.textContent=match.context;const change=document.createElement('code');change.textContent=(match.before||'∅')+' → '+(match.after?match.after.slice(0,300)+(match.after.length>300?'…':''):'∅');change.title=match.after.slice(0,2000);row.append(check,link,context,change);list.append(row);
  }this.update();
 }
 private async open(match:SearchMatch){try{if(!this.preview)return;await this.flush();const result=await this.call('searchLocation',this.preview.id,match.id);this.dialog.close();this.navigate(result);}catch(e){this.status.textContent=String(e);}}
 private async applySelected(){
  if(!this.preview||this.applying)return;this.applying=true;this.status.textContent="Checking files and backing up original text…";this.update();for(const input of this.dialog.querySelectorAll<HTMLInputElement|HTMLButtonElement>('input,button'))input.disabled=true;
  try{await this.flush();const result=await this.call('applyProjectReplace',this.preview.id,[...this.selected]);this.replace(result);this.preview=undefined;this.selected.clear();document.getElementById('projectSearchResults')!.replaceChildren();this.status.textContent=`Replaced matches in ${result.changes.length} files. Original text was backed up.${result.state.onSave?' Saving and rebuilding…':' Live is paused; changes remain unsaved drafts.'}`;await this.call('finishProjectReplace',result.editId);
  }catch(e){this.status.textContent=String(e);}finally{this.applying=false;for(const input of this.dialog.querySelectorAll<HTMLInputElement|HTMLButtonElement>('input,button'))input.disabled=false;this.update();}
 }
}
