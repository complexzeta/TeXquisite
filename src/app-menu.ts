import {Menu,MenuItemConstructorOptions} from 'electron';
interface Preferences {projectSidebar?:boolean;onSave:boolean;backups?:boolean;autoClose?:boolean;followPreview?:boolean;previewEditing?:boolean;continuousPreview?:boolean;statusBar?:boolean;zoom?:number|'fit-width';panelLayout?:{mode:string};}
export function appMenu(state:Preferences,send:(action:string,value?:string)=>void){
 const action=(label:string,id:string):MenuItemConstructorOptions=>({label,id,click:()=>send(id)});
 const toggle=(label:string,id:string,checked:boolean):MenuItemConstructorOptions=>({...action(label,id),type:'checkbox',checked});
 const select=(label:string,id:string,value:string,checked:boolean):MenuItemConstructorOptions=>({label,id:id+'-'+value,type:'radio',checked,click:()=>send(id,value)});
 return Menu.buildFromTemplate([
  {label:'File',id:'file-menu',submenu:[action('New document…','new'),action('Open document…','open'),{type:'separator'},action('Save','save'),action('Save a copy…','saveCopy'),action('Reload disk version','reload'),{label:'Backups',submenu:[toggle('Automatic source backups','automaticBackups',state.backups!==false),action('Back up now','backupNow'),action('Browse and recover�','browseBackups')]},{type:'separator'},action('Add support folders…','support'),action('Use active file as root','root'),{type:'separator'},action('Export verified PDF…','export'),action('Show previous verified PDF','previous'),{type:'separator'},{role:'close',label:'Close window'}]},
  {label:'Edit',id:'edit-menu',submenu:[{...action('Find and replace in project…','projectSearch'),accelerator:'CmdOrCtrl+Shift+F'},{type:'separator'},{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},action('Paste image…','pasteImage'),{role:'selectAll'},{type:'separator'},toggle('Match pairs','autoClose',state.autoClose!==false)]},
  {label:'View',id:'view-menu',submenu:[toggle('Project files and outline','toggleProject',!!state.projectSidebar),
   {label:'Panel layout',submenu:[select('Side by side','panelLayout','side-by-side',!state.panelLayout||state.panelLayout.mode==='side-by-side'),select('Output above source','panelLayout','output-top',state.panelLayout?.mode==='output-top'),select('Source above output','panelLayout','source-top',state.panelLayout?.mode==='source-top')]},
   {label:'Preview layout',submenu:[select('Paged PDF','layoutMode','paged',!state.continuousPreview),select('Continuous scroll','layoutMode','continuous',!!state.continuousPreview)]},
   {label:'Zoom',submenu:[select('Fit width','zoom','fit-width',state.zoom==='fit-width'),...([.8,1,1.25,1.5,2].map(value=>select(`${value*100}%`,'zoom',String(value),(state.zoom??1)===value)))]},
   {type:'separator'},toggle('Follow typing','follow',!!state.followPreview),{...toggle('Edit verified preview','editPreview',!!state.previewEditing),enabled:!state.continuousPreview},action('Show source cursor in PDF','locate'),action('Previous PDF page','prevPage'),action('Next PDF page','nextPage'),
   {label:'Math editing',submenu:[action('Insert fraction','math-frac'),action('Insert square root','math-sqrt'),action('Insert superscript','math-sup'),action('Insert subscript','math-sub'),action('Insert pi','math-pi')]},
   {type:'separator'},toggle('Show status bar','toggleStatus',state.statusBar!==false),action('Show or hide problems','toggleProblems'),action('Show or hide build log','toggleLog'),{role:'togglefullscreen'},{role:'toggleDevTools'}]},
  {label:'Build',id:'build-menu',submenu:[action('Build now','build'),toggle('Automatically save and rebuild','live',state.onSave),action('Cancel build','cancel'),{type:'separator'},action('Settings…','settings')]}
 ]);
}
