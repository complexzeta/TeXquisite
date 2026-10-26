import type {Navigation,Region,Character} from './navigation';
// Compact only the IPC representation. Immutable on-disk maps stay readable
// and backward compatible; repeated source paths cross the context bridge once.
export function encodeNavigation(nav:Navigation|undefined):string|undefined{
 if(!nav)return;const files:string[]=[],ids=new Map<string,number>();
 const rows=(values:Region[]|Character[]|undefined)=>values?.map(([file,...rest])=>{let id=ids.get(file);if(id===undefined){id=files.length;files.push(file);ids.set(file,id);}return [id,...rest];});
 const regions=rows(nav.regions),characters=rows(nav.characters),mathCharacters=rows(nav.mathCharacters);
 return JSON.stringify({...nav,regions,characters,mathCharacters,files});
}
export function decodeNavigation(value:string|Navigation|undefined):Navigation|undefined{
 if(value===undefined||typeof value!=='string')return value;
 const nav=JSON.parse(value),files=nav.files;if(nav.schema!==1||!Array.isArray(files)||files.some(f=>typeof f!=='string'))throw Error('Invalid preview navigation.');
 const rows=(values:unknown)=>{if(values===undefined)return;if(!Array.isArray(values))throw Error('Invalid preview navigation rows.');return values.map(row=>{if(!Array.isArray(row)||!Number.isInteger(row[0])||row[0]<0||row[0]>=files.length)throw Error('Invalid preview source index.');return [files[row[0]],...row.slice(1)];});};
 const {files:_,...rest}=nav;return {...rest,regions:rows(nav.regions),characters:rows(nav.characters),mathCharacters:rows(nav.mathCharacters)} as Navigation;
}
