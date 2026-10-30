import {createHash} from 'node:crypto';
import {mathRanges,parseMath} from './math-edit';
export type Region=[file:string,line:number,page:number,x:number,y:number,width:number,height:number];
export type Character=[file:string,line:number,column:number,page:number,x:number,y:number,width:number,height:number,character:number,length?:number];
export interface Navigation {characters?:Character[];mathCharacters?:Character[];schema:1;sources:Record<string,string>;regions:Region[];nativeInputs?:Record<string,string>;recovery?:{excluded:Record<string,number[]>;blocked:Region[]};}
export const textHash=(text:string)=>createHash('sha256').update(text.replace(/\r\n/g,'\n')).digest('hex');
export function sourceIdentities(root:string,source:string,resources:[string,Uint8Array][],origins:Record<string,string>){
 const sources:Record<string,string>={[root]:textHash(source)};
 for(const [name,bytes]of resources){const file=origins[name];if(!file||! /\.(tex|sty|cls|ltx)$/i.test(name))continue;try{sources[file]=textHash(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{}}
 return sources;
}
export function makeNavigation(raw:string,root:string,source:string,resources:[string,Uint8Array][],origins:Record<string,string>):Navigation|undefined{
 const sources:Record<string,string>={[root]:textHash(source)},regions:Region[]=[],characters:Character[]=[],mathCharacters:Character[]=[];
 const texts=new Map(resources);
 for(const line of raw.split('\n')){
  if(!line)continue;
  const decoded=JSON.parse(line);
  if(decoded&&typeof decoded==='object'&&!Array.isArray(decoded)&&(Array.isArray(decoded.glyph)||Array.isArray(decoded.mathGlyph))){
    const glyph=(decoded.glyph??decoded.mathGlyph) as Character;
    if((glyph.length!==9&&glyph.length!==10)||typeof glyph[0]!=='string'||!glyph.slice(1).every(value=>typeof value==='number'&&Number.isFinite(value))||!glyph.slice(1,4).every(Number.isInteger)||glyph[1]<1||glyph[2]<0||glyph[3]<1||glyph[6]<=0||glyph[7]<=0||(glyph[9]!==undefined&&(!Number.isInteger(glyph[9])||glyph[9]<1||glyph[9]>16)))continue;
    const name=glyph[0].replace(/^\/(?:work|project-resources)\//,'').replace(/^\.\//,''),file=origins[name];if(!file)continue;
    if(!sources[file]){const bytes=texts.get(name);if(!bytes)continue;try{sources[file]=textHash(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{continue;}}
    (decoded.mathGlyph?mathCharacters:characters).push([file,...glyph.slice(1)] as Character);continue;
  }
  const row=decoded as Region;
  if(!Array.isArray(row)||row.length!==7||typeof row[0]!=='string'||!row.slice(1).every(n=>typeof n==='number'&&Number.isFinite(n))||row[1]<1||row[2]<1||row[5]<0||row[6]<0)throw Error('Invalid compiler source mapping.');
  const name=row[0].replace(/^\/(?:work|project-resources)\//,'').replace(/^\.\//,'');
  const file=origins[name];if(!file)continue;
  if(!sources[file]){const bytes=texts.get(name);if(!bytes)continue;try{sources[file]=textHash(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{continue;}}
  regions.push([file,...row.slice(1)] as Region);
 }
 // Unsupported formulas cannot be edited visually. Avoid carrying their glyph
 // records through durable storage and renderer IPC on every keystroke.
 const editable=new Map<string,Set<string>>();
 for(const glyph of mathCharacters){const file=glyph[0];if(editable.has(file))continue;
  let text=file===root?source:undefined;
  if(text===undefined){const name=Object.keys(origins).find(name=>origins[name]===file&&texts.has(name));if(name)try{text=new TextDecoder('utf-8',{fatal:true}).decode(texts.get(name));}catch{}}
  const intervals=new Set<string>();editable.set(file,intervals);if(text===undefined)continue;
  const starts=[0];for(let i=0;i<text.length;i++)if(text[i]==='\n')starts.push(i+1);
  for(const range of mathRanges(text)){const formula=parseMath(text,range.from,range.to);if(!formula)continue;
   for(const leaf of formula.leaves){let low=0,high=starts.length;while(low+1<high){const mid=(low+high)>>>1;if(starts[mid]<=leaf.from)low=mid;else high=mid;}
    intervals.add(`${low+1}:${Buffer.byteLength(text.slice(starts[low],leaf.from))}:${Buffer.byteLength(text.slice(leaf.from,leaf.to))}`);
   }
  }
 }
 const math=mathCharacters.filter(g=>editable.get(g[0])?.has(`${g[1]}:${g[2]}:${g[9]??1}`));
 return regions.length?{schema:1,sources,regions,...(characters.length?{characters}:{}),...(math.length?{mathCharacters:math}:{})}:undefined;
}
