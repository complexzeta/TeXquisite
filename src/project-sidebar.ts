import {documentOutline} from './document-outline';
type ProjectState={root?:string;active?:string;projectSidebar?:boolean;supportFolders?:string[];docs:{path:string;text:string}[]};
export class ProjectSidebar{
 private state:ProjectState={docs:[]};private key='';private epoch=0;private outlineText:string|undefined;private outlineFile:string|undefined;private timer=0;private filterTimer=0;
 private host=document.getElementById('projectSidebar')!;private files=document.getElementById('projectFiles')!;private outline=document.getElementById('documentOutline')!;
 constructor(private call:(method:string,...args:unknown[])=>Promise<any>,private open:(file:string)=>void,private jump:(file:string,text:string,at:number)=>void){
  document.getElementById('refreshProject')!.onclick=()=>void this.refresh();
  document.getElementById('projectFileFilter')!.oninput=()=>{window.clearTimeout(this.filterTimer);this.filterTimer=window.setTimeout(()=>void this.refresh(),200);};
 }
 update(state:ProjectState){
  this.state=state;this.host.hidden=!state.projectSidebar;const toggle=document.getElementById('toggleProject')!;toggle.setAttribute('aria-expanded',String(!!state.projectSidebar));
  if(!state.projectSidebar){window.clearTimeout(this.timer);this.outlineFile=undefined;return;}
  const root=document.getElementById('projectRoot')!;root.textContent=state.root?'Root: '+state.root.split(/[\\/]/).at(-1):'Open a root document to browse its project';root.title=state.root??'';
  const key=JSON.stringify([state.root,state.supportFolders]);if(key!==this.key){this.key=key;void this.refresh();}
  for(const button of this.files.querySelectorAll<HTMLButtonElement>('[data-project-file]')){button.classList.toggle('active',button.dataset.projectFile===state.active);button.setAttribute('aria-current',button.dataset.projectFile===state.active?'page':'false');}
  const doc=state.docs.find(d=>d.path===state.active);if(doc?.path===this.outlineFile&&doc?.text===this.outlineText)return;this.outlineFile=doc?.path;this.outlineText=doc?.text;window.clearTimeout(this.timer);this.timer=window.setTimeout(()=>this.renderOutline(),200);
 }
 private renderOutline(){
  const doc=this.state.docs.find(d=>d.path===this.state.active);this.outline.replaceChildren();document.getElementById('outlineFile')!.textContent=doc?.path.split(/[\\/]/).at(-1)??'';
  if(!doc)return;const file=doc.path,text=doc.text,entries=documentOutline(text);
  for(const item of entries){const button=document.createElement('button');button.textContent=(item.kind==='environment'?'↳ ':'')+item.label;button.title=`${item.kind==='section'?'Heading':'Environment'} · line ${item.line}`;button.style.paddingLeft=8+Math.min(item.level,5)*8+'px';button.dataset.outlineAt=String(item.at);button.onclick=()=>this.jump(file,text,item.at);this.outline.append(button);}
  if(!entries.length){const empty=document.createElement('p');empty.textContent='No headings or supported environments in this file.';this.outline.append(empty);}
 }
 async refresh(){
  const epoch=++this.epoch;this.files.replaceChildren();if(!this.state.projectSidebar)return;
  try{const result=await this.call('projectFolders');if(epoch!==this.epoch)return;
   for(const folder of result.folders){const group=document.createElement('details'),label=document.createElement('summary'),children=document.createElement('div');label.textContent=folder===result.folders[0]&&result.root?'Project folder':folder.split(/[\\/]/).at(-1);label.title=folder;group.append(label,children);this.files.append(group);let loaded=false;group.ontoggle=()=>{if(group.open&&!loaded){loaded=true;void this.load(folder,children,epoch);}};group.open=folder===result.folders[0];}
  }catch(e){if(epoch===this.epoch)this.files.textContent=String(e);}
 }
 private async load(folder:string,host:HTMLElement,epoch:number){
  try{const filter=(document.getElementById('projectFileFilter') as HTMLInputElement).value,result=await this.call('projectFiles',folder,filter);if(epoch!==this.epoch||!host.isConnected)return;host.replaceChildren();
   for(const entry of result.entries){if(entry.directory){const group=document.createElement('details'),summary=document.createElement('summary'),children=document.createElement('div');summary.textContent=entry.name;group.append(summary,children);host.append(group);let loaded=false;group.ontoggle=()=>{if(group.open&&!loaded){loaded=true;void this.load(entry.path,children,epoch);}};}
    else{const button=document.createElement('button');button.textContent=entry.name+(entry.path===this.state.root?' (root)':'');button.title=entry.path;button.dataset.projectFile=entry.path;button.classList.toggle('active',entry.path===this.state.active);button.onclick=()=>this.open(entry.path);host.append(button);}}
   if(result.limited){const message=document.createElement('p');message.textContent='Showing up to 500 entries. Filter file names to narrow this folder.';host.append(message);}
   else if(!result.entries.length){const message=document.createElement('p');message.textContent='No matching source files.';host.append(message);}
  }catch(e){if(epoch===this.epoch)host.textContent=String(e);}
 }
}
