export type CommandArguments=Record<string,number>;

// Commands whose public argument contract includes arguments consumed by a
// helper macro, rather than by the first macro's parameter list.
export const standardArguments:CommandArguments={frac:2,dfrac:2,tfrac:2,cfrac:2,binom:2,dbinom:2,tbinom:2,overset:2,underset:2,stackrel:2,genfrac:6};

export function texWithoutComments(text:string){
 return text.replace(/(\\.)|%[^\r\n]*/g,(match,escaped)=>escaped??' '.repeat(match.length));
}
function group(text:string,from:number,open='{',close='}'){
 if(text[from]!==open)return;
 let depth=1;
 for(let at=from+1;at<text.length;at++){
  if(text[at]==='\\'){at++;continue;}
  if(text[at]===open)depth++;
  if(text[at]===close&&!--depth)return {text:text.slice(from+1,at),end:at+1};
 }
}
function documentArguments(spec:string){
 let count=0;
 for(let at=0;at<spec.length;at++){
  const token=spec[at];
  if(/\s|[+!]/.test(token))continue;
  if(token==='m'){count++;continue;}
  if(token==='o'||token==='s')continue;
  if(token==='O'||token==='>'){
   while(/\s/.test(spec[at+1]??''))at++;
   const value=group(spec,at+1);if(!value)return;
   at=value.end-1;continue;
  }
  if(token==='t'&&at+1<spec.length){at++;continue;}
  // Delimited, verbatim and body arguments have a different insertion syntax.
  return;
 }
 return count;
}
function forwardedArguments(body:string,known:CommandArguments){
 const helper=/^\s*\\([A-Za-z@]+)/.exec(body);if(!helper)return;
 const count=known[helper[1]];if(!Number.isInteger(count))return;
 let at=helper[0].length,consumed=0;
 while(at<body.length){
  if(/\s/.test(body[at])){at++;continue;}
  const value=group(body,at);
  if(value){at=value.end;consumed++;continue;}
  if(body[at]==='\\'){
   const token=/^\\(?:[A-Za-z@]+|[^A-Za-z@])/.exec(body.slice(at));if(!token)return;
   at+=token[0].length;
  }else{if(body[at]==='#'||body[at]==='}')return;at++;}
  consumed++;
 }
 if(consumed<=count)return count-consumed;
}
export function definedArguments(source:string,known:CommandArguments={}):CommandArguments{
 const text=texWithoutComments(source).replace(/\\begin\{(verbatim\*?|Verbatim|lstlisting|minted|comment)\}[\s\S]*?\\end\{\1\}/g,match=>' '.repeat(match.length));
 const result:CommandArguments={},aliases:{name:string;body:string}[]=[];
 const definitions=/\\(newcommand|renewcommand|providecommand|DeclareRobustCommand|(?:New|Renew|Provide|Declare)(?:Expandable)?DocumentCommand)\*?\s*(?:\{\s*\\([A-Za-z@]+)\s*\}|\\([A-Za-z@]+))/g;
 for(const match of text.matchAll(definitions)){
  const name=match[2]??match[3];let at=match.index!+match[0].length;
  while(/\s/.test(text[at]??''))at++;
  if(match[1].includes('DocumentCommand')){
   const spec=group(text,at),count=spec&&documentArguments(spec.text);
   if(count!==undefined)result[name]=count;
  }else{
   const args=group(text,at,'[',']');
   if(!args){const body=group(text,at);if(body)aliases.push({name,body:body.text});continue;}
   if(!/^[0-9]$/.test(args.text))continue;
   at=args.end;while(/\s/.test(text[at]??''))at++;
   result[name]=Number(args.text)-(group(text,at,'[',']')?1:0);
  }
 }
 for(const match of text.matchAll(/\\(?:def|gdef|edef|xdef)\s*\\([A-Za-z@]+)((?:#[1-9])+)\s*\{/g)){
  const parameters=match[2];
  if(parameters===Array.from({length:parameters.length/2},(_,i)=>'#'+(i+1)).join(''))result[match[1]]=parameters.length/2;
 }
 // genfrac's public contract includes two arguments consumed by its helper.
 if(result.genfrac===4)result.genfrac=6;
 const signatures={...standardArguments,...known,...result};
 for(let pass=0;pass<aliases.length;pass++){
  let changed=false;
  for(const alias of aliases){
   const count=forwardedArguments(alias.body,signatures);
   if(count!==undefined&&result[alias.name]!==count){result[alias.name]=count;signatures[alias.name]=count;changed=true;}
  }
  if(!changed)break;
 }
 return result;
}
export function multiArgumentCount(before:string,source:string,packages:CommandArguments={}){
 const match=/\\([A-Za-z@]+)\*?(?:\[[^\]\r\n]*\])?$/.exec(before);if(!match)return;
 const count=({...standardArguments,...packages,...definedArguments(source,packages)})[match[1]];
 return Number.isInteger(count)&&count>1&&count<=9?{name:match[1],count,from:match.index}:undefined;
}
