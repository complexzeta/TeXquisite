export interface OutlineItem {at:number;line:number;level:number;label:string;kind:'section'|'environment';}
export function documentOutline(source:string):OutlineItem[]{
 // Mask comments and literal environments without shifting source positions.
 const masked=source;
 const items:OutlineItem[]=[];let line=1;
 const levels:Record<string,number>={part:0,chapter:1,section:2,subsection:3,subsubsection:4,paragraph:5,subparagraph:6};
 for(let at=0;at<masked.length&&items.length<1000;at++){
  if(masked[at]==='\n'){line++;continue;}if(masked[at]==='%'){while(at<masked.length&&masked[at]!=='\n')at++;line++;continue;}
  if(masked[at]!=='\\')continue;
  if(masked[at+1]==='\\'){at++;continue;}
  if(masked[at+1]&&!/[a-zA-Z]/.test(masked[at+1])){at++;continue;}
  const verb=/^\\verb\*?([^\w\s])/.exec(masked.slice(at,at+8));if(verb){const end=masked.indexOf(verb[1],at+verb[0].length);if(end>=0)at=end;continue;}
  const command=/^\\([a-zA-Z]+)\*?\s*/.exec(masked.slice(at,at+40));if(!command)continue;
  const name=command[1];if(!(name in levels)&&name!=='begin')continue;
  let from=at+command[0].length;if(masked[from]==='['){const end=masked.indexOf(']',from+1);if(end<0)continue;from=end+1;while(/\s/.test(masked[from]??'')&&from<masked.length)from++;}
  if(masked[from]!=='{')continue;let end=from+1,depth=1;
  for(;end<masked.length&&depth;end++){if(masked[end]==='\\'){end++;continue;}if(masked[end]==='{')depth++;if(masked[end]==='}')depth--;}
  if(depth)continue;const title=source.slice(from+1,end-1).replace(/\s+/g,' ').trim().slice(0,160);
  if(name==='begin'){if(/^(verbatim\*?|Verbatim|lstlisting|minted|comment)$/.test(title)){const closing='\\end{'+title+'}',last=masked.indexOf(closing,end),stop=last<0?masked.length:last+closing.length;line+=(masked.slice(at,stop).match(/\n/g)||[]).length;at=stop-1;continue;}if(!/^[a-zA-Z][\w*:@-]*$/.test(title))continue;items.push({at,line,level:7,label:title,kind:'environment'});}
  else items.push({at,line,level:levels[name],label:title||'Untitled '+name,kind:'section'});
 }
 return items;
}
