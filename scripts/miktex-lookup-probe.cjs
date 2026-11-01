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
 const singles=(group,tex)=>group.map(name=>invoke([name],tex)[0]??'');
 const batch=(group,tex)=>{
  if(group.length===1)return singles(group,tex);
  const files=invoke(group,tex),positions=new Map();
  for(let i=0;i<group.length;i++){const k=key(group[i]);if(positions.has(k))return singles(group,tex);positions.set(k,i);}
  const result=group.map(()=>''),seen=new Set();let previous=-1;
  for(const file of files){const at=positions.get(key(path.basename(file)));
   // Aliases and extensionless names can resolve to another basename.
   // Re-query individually rather than guessing which request they answer.
   if(at===undefined||at<=previous||seen.has(at))return singles(group,tex);
   previous=at;seen.add(at);result[at]=file;
  }
  return result;
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
