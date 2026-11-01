// Experimental MiKTeX adapter. Not imported by application/runtime code.
const path=require('node:path');
const key=name=>process.platform==='win32'?name.toLowerCase():name;
const validName=name=>typeof name==='string'&&!!name&&!name.startsWith('-')&&!/[\\/\0:\r\n]/.test(name);
const warning=line=>/^kpsewhich: (security risk: running with elevated privileges|major issue: So far, you have not checked for MiKTeX updates\.)$/.test(line);
function lookup(names,run,isFile){
 if(!Array.isArray(names)||!names.length||names.some(n=>!validName(n)))throw Error('Invalid MiKTeX lookup names');
 const invoke=(group,tex)=>{
  const r=run(tex?['--format=tex',...group]:group);
  if(r.error)throw r.error;
  if(typeof r.stdout!=='string'||typeof r.stderr!=='string'||r.stderr.split(/\r?\n/).filter(Boolean).some(l=>!warning(l)))throw Error('Unexpected MiKTeX lookup diagnostic: '+String(r.stderr).slice(-1000));
  const files=r.stdout.trim()?r.stdout.trim().split(/\r?\n/):[];
  if(files.some(file=>!path.isAbsolute(file)||!isFile(file)))throw Error('Invalid MiKTeX lookup result');
  const absent=group.length-files.length;
  // MiKTeX's implementation returns the number absent, clamped to 1
  // above 255. Check this before interpreting a partial batch response.
  if(absent<0||r.status!==(absent>255?1:absent))throw Error('Unexpected MiKTeX lookup exit status: '+r.status);
  return files;
 };
 const batch=(group,tex)=>{
  const files=invoke(group,tex);
  if(!files.length)return group.map(()=>'');
  if(files.length===group.length){
   // Native lookup emits one ordered result per found request. For a full
   // response, positions are unambiguous even when a name is an alias.
   // Independently verify only unexpected basenames (also catches reordering).
   return files.map((file,i)=>group.length===1||key(path.basename(file))===key(group[i])?file:invoke([group[i]],tex)[0]??'');
  }
  // A sparse response cannot safely be aligned just by basename: an alias
  // might resolve to the basename of another, missing request. Subdivide it
  // until the positions are established by full or empty native responses.
  const middle=Math.floor(group.length/2);
  return [...batch(group.slice(0,middle),tex),...batch(group.slice(middle),tex)];
 };
 const result=[];
 for(let at=0;at<names.length;at+=80){const group=names.slice(at,at+80),files=batch(group,false),unfound=[];
  for(let i=0;i<group.length;i++)if(!files[i])unfound.push(i);
  if(unfound.length){const fallback=batch(unfound.map(i=>group[i]),true);for(let i=0;i<unfound.length;i++)files[unfound[i]]=fallback[i];}
  result.push(...files);
 }
 return result;
}
module.exports={lookup};
