import * as fs from 'node:fs';
import * as path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
export {buildTikzMathPlan} from './tikz-math-plan';
const {buildMathReference}=require('../scripts/tikz-math-reference.cjs');
type Definition={params:string;body:string};
type Entry={key:string;expression:string;result:string};
const primitives='if ifcat ifodd ifx ifnum ifdim ifcase ifcsname ifvmode iftrue iffalse else or fi let def gdef edef xdef long global expandafter noexpand csname endcsname begingroup endgroup bgroup egroup relax advance multiply divide afterassignment the number numexpr dimexpr futurelet string meaning detokenize pdfmdfivesum pdfescapehex write immediate catcode count dimen toks space ignorespaces endinput globaldefs everyeof endlinechar'.split(' ');
const refName=(n:number)=>'TxqMathRef'+String(n).replace(/\d/g,c=>'ABCDEFGHIJ'[Number(c)]);
export class TikzMathCache {
  static create(assets:string,index:Map<string,string>){
    if(process.env.PERSISTENT_TEX_DISABLE_TIKZ_MATH_CACHE==='1')return;
    try{
      const metadata=JSON.parse(fs.readFileSync(path.join(assets,'tikz-math.json'),'utf8'));
      if(metadata.schema!==1||!Array.isArray(metadata.files)||metadata.files.length!==5)return;
      const sources=metadata.files.map(({name,sha256}:{name:string;sha256:string})=>{
        const file=index.get(name);if(!file)throw Error('Missing PGF source');const bytes=fs.readFileSync(file);
        if(createHash('sha256').update(bytes).digest('hex')!==sha256)throw Error('Different PGF source');return bytes.toString('utf8');
      });
      return new TikzMathCache(buildMathReference(sources));
    }catch{return;}
  }
  private entries=new Map<string,Entry>();
  private values=new Map<string,Entry>();
  private intermediateValues=new Map<string,string>();
  private intermediateDisabled=false;
  private intermediateHits=0;
  private blocked=new Set<string>();
  private prefix='TXQMATH'+randomBytes(12).toString('hex');
  // Provisional numerical facts are visible only during one native execution.
  // Successful collect() still controls admission to the ordinary cache.
  private provisional=new Map<string,Entry>();
  private provisionalHits=0;
  private partial='';
  private provisionalDisabled=false;
  private provisionalEnabled=process.env.PERSISTENT_TEX_DISABLE_PROVISIONAL_MATH!=='1';
  private reference:string;
  private nativePairs:string;
  
  private originalParse:string;
  private originalEnd:string;
  private patchedParse:string;
  private patchedEnd:string;
  revision=0;
  get size(){return this.entries.size;}
  reset(){this.entries.clear();this.values.clear();this.intermediateValues.clear();this.intermediateDisabled=false;this.blocked.clear();this.discardProvisional();this.revision++;}
  discardProvisional(){this.provisional.clear();this.provisionalHits=0;this.intermediateHits=0;this.partial='';this.provisionalDisabled=false;}
  intermediate(key:string,mode:number){return this.intermediateDisabled?undefined:this.intermediateValues.get(mode+':'+key);}
  usedIntermediate(count:number){this.intermediateHits+=count;}
  private pattern(){return new RegExp(this.prefix+'EXPR\\|([0-9A-F]{32}:[01])\\|([0-9A-Fa-f\\r\\n ]+)\\r?\\n'+this.prefix+'VALUE\\|\\1\\|([\\s\\S]*?)\\r?\\n'+this.prefix+'END\\r?\\n?','g');}
  private decoded(key:string,hex:string,result:string):Entry|undefined{
    result=result.replace(/\s/g,'');
    const expression=Buffer.from(hex.replace(/\s/g,''),'hex').toString('utf8');
    if(expression.length<=128&&/^(?:sin|cos|[0-9+*/.,(){} \t-])+$/.test(expression)&&/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(result)&&result.length<=32)return {key,expression,result};
  }
  observeOutput(chunk:string){
    if(!this.provisionalEnabled||this.provisionalDisabled)return;
    if(!chunk||!this.partial&&chunk.endsWith('\n')&&!chunk.includes(this.prefix))return;
    // TeX can wrap a record over several stdout lines. Keep only a bounded
    // tail; incomplete/truncated records simply retain ordinary calculation.
    this.partial=(this.partial+chunk).slice(-2048);
    const pattern=this.pattern();let match:RegExpExecArray|null,last=0;
    while((match=pattern.exec(this.partial))){
      last=pattern.lastIndex;const entry=this.decoded(match[1],match[2],match[3]);
      if(!entry||this.blocked.has(entry.key))continue;
      const key=entry.key.slice(-1)+':'+entry.expression,prior=this.provisional.get(key);
      if(prior&&prior.result!==entry.result){this.provisional.clear();this.provisionalDisabled=true;break;}
      if(!prior&&this.provisional.size>=512)this.provisional.delete(this.provisional.keys().next().value!);
      this.provisional.set(key,entry);
    }
    if(last)this.partial=this.partial.slice(last);
    const marker=this.prefix+'EXPR|',start=this.partial.indexOf(marker);
    if(start>=0)this.partial=this.partial.slice(start);
    else{
      // Retain only a possible split marker, not unrelated progress output.
      let carry=0;for(let n=Math.min(marker.length-1,this.partial.length);n>0;n--)if(marker.startsWith(this.partial.slice(-n))){carry=n;break;}
      this.partial=carry?this.partial.slice(-carry):'';
    }
  }
  lookup(expression:string,mode:number){
    const key=mode+':'+expression,entry=this.values.get(key);
    if(entry){this.entries.delete(entry.key);this.entries.set(entry.key,entry);return entry.result;}
    const fresh=this.provisional.get(key);if(fresh&&!this.provisionalDisabled&&!this.blocked.has(fresh.key)){this.provisionalHits++;return fresh.result;}
  }
  private forget(key:string,entry:Entry){
    this.entries.delete(key);const valueKey=key.slice(-1)+':'+entry.expression;
    if(this.values.get(valueKey)===entry)this.values.delete(valueKey);
  }
  constructor(model:{definitions:[string,Definition][];operators:string[]}){
    const excluded=new Set(['pgfmath@ifnextchar','pgfmath@ifnch','pgfmath@ifundefined','pgfmath@PackageWarning','pgfmath@PackageError','pgfmath@operatorlist']);
    const definitions=model.definitions.filter(([name])=>!excluded.has(name));
    let code='',guard='',bind='';const refs=new Map<string,string>();
    for(const [name,{params,body}]of definitions){
      const ref=refName(refs.size);refs.set(name,ref);code+='\\gdef\\'+ref+(params&&/^[A-Za-z@]/.test(params)?' ':'')+params+'{'+body+'}\n';
      guard+='\\expandafter\\TxqMathIfx\\csname '+name+'\\endcsname\\'+ref+'\\TxqMathElse\\TxqMathLet\\TxqMathOK\\TxqMathZero\\TxqMathFi\n';
      bind+='\\expandafter\\global\\expandafter\\let\\expandafter\\'+ref+'\\csname '+name+'\\endcsname\n';
    }
    // Operator discovery is also semantic input: adding a new operator must
    // not reinterpret a previously cached literal expression.
    code+='\\gdef\\TxqMathOperatorList{}\n';
    model.operators.forEach((op,i)=>code+='\\xdef\\TxqMathOperatorList{'+(i?'\\TxqMathOperatorList,':'')+'{\\string '+op+'}}\n');
    guard+='\\TxqMathIfx\\pgfmath@operatorlist\\TxqMathOperatorList\\TxqMathElse\\TxqMathLet\\TxqMathOK\\TxqMathZero\\TxqMathFi\n';
    code+='\\long\\gdef\\TxqMathFirst#1#2{#1}\\long\\gdef\\TxqMathSecond#1#2{#2}\\gdef\\TxqMathEmpty{}\n';
    code+='\\gdef\\TxqMathToNumber#1{\\expandafter\\Pgf@geT\\the#1}\n';
    code+='{\\catcode`\\p=12\\catcode`\\t=12\\gdef\\TxqPT#1pt{#1}}\n';
    code+='\\xdef\\TxqMathPt{\\detokenize{pt}}\n';
    for(const [actual,expected]of [['pgfutil@firstoftwo','TxqMathFirst'],['pgfutil@secondoftwo','TxqMathSecond'],['pgfutil@empty','TxqMathEmpty'],['pgfmath@tonumber','TxqMathToNumber'],['pgf@sys@tonumber','TxqMathToNumber'],['Pgf@geT','TxqPT'],['pgfmath@pt','TxqMathPt'],['pgfmathpostparse','TxqMathRelax'],['ifpgfmathfloat','TxqMathIffalse'],['ifpgfmath@octalparsing','TxqMathIftrue'],['pgfmath@sptoken','TxqMathSpace'],['pgf@let@space@token','TxqMathSpace']])
      guard+='\\TxqMathIfx\\'+actual+'\\'+expected+'\\TxqMathElse\\TxqMathLet\\TxqMathOK\\TxqMathZero\\TxqMathFi\n';
    // Plain's newif creates switch setters outside the source definition list.
    // Division uses these helpers; replacing one must retain its effects.
    for(const [suffix,condition]of [['true','iftrue'],['false','iffalse']]){
      code+='\\gdef\\TxqMathDivide'+suffix+'{\\let\\ifpgfmath@divide@period\\'+condition+'}\n';
      guard+='\\TxqMathIfx\\pgfmath@divide@period'+suffix+'\\TxqMathDivide'+suffix+'\\TxqMathElse\\TxqMathLet\\TxqMathOK\\TxqMathZero\\TxqMathFi\n';
    }
    // Numeric registers are established by PGF's checked allocator. Their
    // identities must remain fixed; macro aliases may not replace registers.
    const registers=['pgfmath@x','pgfmath@xa','pgfmath@xb','pgfmath@xc','pgfmath@y','pgfmath@ya','pgfmath@yb','pgfmath@yc','pgfmath@tempdima','pgfmath@tempdimb','c@pgfmath@counta','c@pgfmath@countb','c@pgfmath@countc','c@pgfmath@countd','pgfmath@count','pgfmath@dimen','pgfmath@toks'];
    registers.forEach((name,i)=>{code+='\\expandafter\\global\\expandafter\\let\\expandafter\\TxqMathRegister'+refName(i)+'\\csname '+name+'\\endcsname\n';guard+='\\TxqMathIfx\\'+name+'\\TxqMathRegister'+refName(i)+'\\TxqMathElse\\TxqMathLet\\TxqMathOK\\TxqMathZero\\TxqMathFi\n';});
    for(let i=0;i<primitives.length;i++)guard+='\\TxqMathIfx\\'+primitives[i]+'\\TxqMathPrimitive'+refName(i)+'\\TxqMathElse\\TxqMathLet\\TxqMathOK\\TxqMathZero\\TxqMathFi\n';
    // These wrappers only record PGF's actual intermediate result. Their
    // identities participate in the same native guard as the stock evaluator.
    code+='\\long\\gdef\\TxqMathSubSin#1#2{\\pgfmathsin@{#1}\\TxqMathRecordIntermediate{#2}}\n';
    code+='\\long\\gdef\\TxqMathSubCos#1#2{\\pgfmathcos@{#1}\\TxqMathRecordIntermediate{#2}}\n';
    code+='\\gdef\\TxqMathRecordIntermediate#1{\\immediate\\write16{'+this.prefix+'SUB|\\pgfmath@trig@format@choice|#1|\\pgfmathresult}\\immediate\\write16{'+this.prefix+'ENDSUB}}\n';
    for(const name of ['TxqMathSubSin','TxqMathSubCos','TxqMathRecordIntermediate']){
      code+='\\global\\let\\'+name+'Reference\\'+name+'\n';
      guard+='\\TxqMathIfx\\'+name+'\\'+name+'Reference\\TxqMathElse\\TxqMathLet\\TxqMathOK\\TxqMathZero\\TxqMathFi\n';
    }
    const nativeNames=guard.split('\n').map(line=>{const dynamic=/\\TxqMathIfx\\csname ([^\\]+)\\endcsname/.exec(line),literal=/\\TxqMathIfx\\([A-Za-z@]+)\\/.exec(line);return dynamic?.[1]??literal?.[1];}).filter((name):name is string=>!!name);
    this.nativePairs=nativeNames.map((name,i)=>['pgfmath@sptoken','pgf@let@space@token'].includes(name)?'\\global\\let\\TxqMathNative'+refName(i)+'= \\TxqMathSpace\n':'\\expandafter\\global\\expandafter\\let\\expandafter\\TxqMathNative'+refName(i)+'\\csname '+name+'\\endcsname\n').join('')+
      '\\xdef\\TxqMathNativePairs{'+nativeNames.map((name,i)=>'\\expandafter\\noexpand\\csname '+name+'\\endcsname\\noexpand\\TxqMathNative'+refName(i)+' ').join('')+'}\n';
    code+='\\gdef\\TxqMathCheck{\\TxqMathLet\\TxqMathOK\\TxqMathOne\n'+guard+'}\n';
    const parse=model.definitions.find(([name])=>name==='pgfmathparse@@')![1];
    const end=model.definitions.find(([name])=>name==='pgfmath@parse@end')![1];
    const oldTail='\\expandafter\\pgfmath@bgroup@strip\\expandafter{\\pgfmath@expression}\\expandafter\\pgfmath@parse@@operand\\pgfmath@bgroup@stripped @@@@\\pgfmath@parse@stop';
    if(!parse.body.includes(oldTail)||!end.body.includes('\\pgfmathpostparse'))throw Error('Unknown PGF parser');
    this.originalParse=refs.get('pgfmathparse@@')!;this.originalEnd=refs.get('pgfmath@parse@end')!;
    this.patchedParse='\\gdef\\pgfmathparse@@'+parse.params+'{'+parse.body.replace(oldTail,'\\TxqMathTry')+'}\n';
    this.patchedEnd='\\gdef\\pgfmath@parse@end'+end.params+'{'+end.body.replace('\\pgfmathpostparse','\\TxqMathRecord\\pgfmathpostparse')+'}\n';
    code+='\\gdef\\TxqMathMiss{'+oldTail+'}\n';
    code+='\\gdef\\TxqMathBind{'+bind+'}\n';
    this.reference=code;
  }
  primitives(){
    let code='\\begingroup\\catcode64=11\n';primitives.forEach((name,i)=>code+='\\global\\let\\TxqMathPrimitive'+refName(i)+'\\'+name+'\n');
    code+='\\global\\let\\TxqMathIfx\\ifx\\global\\let\\TxqMathIfnum\\ifnum\\global\\let\\TxqMathIftrue\\iftrue\\global\\let\\TxqMathIffalse\\iffalse\\global\\let\\TxqMathElse\\else\\global\\let\\TxqMathFi\\fi\\global\\let\\TxqMathLet\\let\\global\\let\\TxqMathRelax\\relax\\global\\let\\TxqMathEndInput\\endinput\n';
    code+='\\global\\let\\TxqMathBeginGroup\\begingroup\\global\\let\\TxqMathEndGroup\\endgroup\\global\\let\\TxqMathEveryEOF\\everyeof\\global\\let\\TxqMathGlobalDefs\\globaldefs\\global\\let\\TxqMathIfVMode\\ifvmode\\global\\let\\TxqMathInput\\@@input\\global\\let\\TxqMathEndlineChar\\endlinechar\n';
    code+='\\gdef\\TxqMathOne{1}\\gdef\\TxqMathZero{0}\\def\\:{\\global\\let\\TxqMathSpace= }\\:\n\\endgroup\n';return code;
  }
  install(native=false,live=false,plans=false){
    if(!native)return '';
    const precheck=primitives.map((name,i)=>'\\TxqMathIfx\\'+name+'\\TxqMathPrimitive'+refName(i)+'\\TxqMathElse\\TxqMathEndInput\\TxqMathFi\n').join('');
    let table='';for(const {key,expression,result}of this.entries.values())table+='\\expandafter\\gdef\\csname TxqMathExpr@'+key+'\\endcsname{'+expression+'}\\expandafter\\gdef\\csname TxqMathValue@'+key+'\\endcsname{'+result+'}\n';
    const trace=process.env.PERSISTENT_TEX_TIKZ_MATH_TRACE==='1';
    const slots=plans?Array.from({length:16},(_,i)=>'\\gdef\\TxqMathStack'+String.fromCharCode(65+i)+'{}\n').join(''):'';
    return precheck+'\\begingroup\\catcode64=11\\catcode37=14\\catcode35=6\\catcode123=1\\catcode125=2\\catcode58=12\\catcode44=12\\catcode43=12\\catcode45=12\\catcode42=12\\catcode47=12\\catcode46=12\n\\ifcsname pgfmathparse@@\\endcsname\\else\\endgroup\\TxqMathEndInput\\fi\n'+this.reference+String.raw`
\gdef\TxqMathText#1->#2\TxqMathStop{#2}
\gdef\TxqMathSkip#1\TxqMathStop{}
\gdef\TxqMathChars#1{%
\ifx#1\TxqMathStop\let\TxqMathScanNext\relax\else
\ifnum\TxqMathBudget<1 \let\TxqMathEligible\TxqMathZero\let\TxqMathScanNext\TxqMathSkip\else
\edef\TxqMathBudget{\number\numexpr\TxqMathBudget-1\relax}%
\ifcsname TxqMathAllowed@\string#1\endcsname\let\TxqMathScanNext\TxqMathChars\else\let\TxqMathEligible\TxqMathZero\let\TxqMathScanNext\TxqMathSkip\fi\fi\fi\TxqMathScanNext}
\gdef\TxqMathTry{%
\TxqMathLet\TxqMathEligible\TxqMathZero\TxqMathLet\TxqMathOK\TxqMathZero\TxqMathLet\TxqMathNext\TxqMathMiss
\TxqMathIfx\ifpgfpicture\TxqMathIftrue
\TxqMathCheck
\TxqMathIfx\TxqMathOK\TxqMathOne
`+(live?'\\TxqMathIfx\\TxqMathNativeValue\\TxqMathEmpty\n':'')+String.raw`
\def\TxqMathModeZero{0}\def\TxqMathModeOne{1}%
\ifx\pgfmath@trig@format@choice\TxqMathModeZero\let\TxqMathEligible\TxqMathOne\else
\ifx\pgfmath@trig@format@choice\TxqMathModeOne\let\TxqMathEligible\TxqMathOne\fi\fi
\ifx\TxqMathEligible\TxqMathOne
\edef\TxqMathExpression{\expandafter\TxqMathText\meaning\pgfmath@expression\TxqMathStop}%
\ifx\TxqMathEligible\TxqMathOne
\edef\TxqMathKey{\pdfmdfivesum{\meaning\pgfmath@expression}:\pgfmath@trig@format@choice}%
\ifcsname TxqMathExpr@\TxqMathKey\endcsname
\expandafter\ifx\csname TxqMathExpr@\TxqMathKey\endcsname\pgfmath@expression
\let\TxqMathNext\TxqMathHit\fi\fi\fi\fi
`+(plans?'\\TxqMathIfx\\TxqMathNext\\TxqMathMiss\\TxqMathIfx\\TxqMathNativePlan\\TxqMathEmpty\\TxqMathElse\\let\\TxqMathNext\\TxqMathPlanHit\\TxqMathFi\\TxqMathFi\n':'')+(live?'\\TxqMathElse\\let\\TxqMathNext\\TxqMathNativeHit\\TxqMathFi\n':'')+String.raw`\TxqMathFi\TxqMathFi\TxqMathNext}
\gdef\TxqMathPlanHit{\TxqMathNativePlan\pgfmath@parse@end\pgfmath@parse@stop}
\gdef\TxqMathNativeHit{\let\pgfmathresult\TxqMathNativeValue
`+(trace?'\\immediate\\write16{'+this.prefix+'HIT}%\n':'')+String.raw`\pgfmath@parse@end\pgfmath@parse@stop}
\gdef\TxqMathHit{\expandafter\let\expandafter\pgfmathresult\csname TxqMathValue@\TxqMathKey\endcsname
`+(trace?'\\immediate\\write16{'+this.prefix+'HIT}%\n':'')+String.raw`\pgfmath@parse@end\pgfmath@parse@stop}
\gdef\TxqMathRecord{%
\TxqMathIfx\TxqMathEligible\TxqMathOne\TxqMathIfx\TxqMathNext\TxqMathHit\TxqMathElse\TxqMathIfx\TxqMathNext\TxqMathNativeHit\TxqMathElse\TxqMathRecordUnits\TxqMathFi\TxqMathFi\TxqMathFi}
\gdef\TxqMathRecordUnits{\TxqMathIfx\ifpgfmathunitsdeclared\TxqMathIffalse\TxqMathRecordMathUnits\TxqMathFi}
\gdef\TxqMathRecordMathUnits{\TxqMathIfx\ifpgfmathmathunitsdeclared\TxqMathIffalse
`+'\\immediate\\write16{'+this.prefix+'EXPR|\\TxqMathKey|\\pdfescapehex{\\TxqMathExpression}}%\n'+
      '\\immediate\\write16{'+this.prefix+'VALUE|\\TxqMathKey|\\pgfmathresult}%\n\\immediate\\write16{'+this.prefix+'END}%\n'+String.raw`\TxqMathFi}
`+Array.from(new Set('-+*/.,(){} 0123456789sincos')).filter(c=>c!==' ').map(c=>'\\expandafter\\gdef\\csname TxqMathAllowed@\\string '+c+'\\endcsname{}\n').join('')+
      table+'\\TxqMathCheck\n\\TxqMathIfx\\TxqMathOK\\TxqMathOne\\TxqMathElse\\endgroup\\TxqMathEndInput\\TxqMathFi\n\\TxqMathBind\n'+this.patchedParse+this.patchedEnd+
      '\\global\\let\\'+this.originalParse+'\\pgfmathparse@@\\global\\let\\'+this.originalEnd+'\\pgfmath@parse@end\n'+slots+(native?this.nativePairs+'\\global\\let\\TxqMathCheck\\relax\\global\\let\\TxqMathCapture\\relax\\TxqMathCapture\n':'')+'\\endgroup\n';
  }
  collect(log:string,successful:boolean){
    let records=0,hits=0,intermediateLearned=0;const tag=this.prefix;
    log=log.replace(new RegExp(tag+'SUB\\|([01])\\|([0-9A-Fa-f\\r\\n ]+)\\|([\\s\\S]*?)\\r?\\n'+tag+'ENDSUB\\r?\\n?','g'),(_all,mode,hex,result)=>{
      const key=Buffer.from(hex.replace(/\s/g,''),'hex').toString('utf8');result=result.replace(/\s/g,'');
      if(successful&&!this.intermediateDisabled&&key.length<=128&&/^(?:v[0-9.]+|[scn+*/-])(?:;(?:v[0-9.]+|[scn+*/-]))*$/.test(key)&&/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(result)&&result.length<=32&&Math.abs(Number(result))<=2){
        const id=mode+':'+key,old=this.intermediateValues.get(id);
        if(old!==undefined&&old!==result){this.intermediateValues.clear();this.intermediateDisabled=true;}
        else {if(old===undefined){while(this.intermediateValues.size>=2048)this.intermediateValues.delete(this.intermediateValues.keys().next().value!);intermediateLearned++;}else this.intermediateValues.delete(id);this.intermediateValues.set(id,result);}
      }return '';
    });
    const expression=this.pattern();
    const cleaned=log.replace(expression,(_all,key,hex,result)=>{
      result=result.replace(/\s/g,'');
      if(successful&&!this.blocked.has(key)){
        const decoded=this.decoded(key,hex,result);
        if(decoded){
          const text=decoded.expression;result=decoded.result;
          const old=this.entries.get(key);if(!old){
            while(this.entries.size>=2048){const [oldKey,entry]=this.entries.entries().next().value!;this.forget(oldKey,entry);}
            const entry={key,expression:text,result};this.entries.set(key,entry);this.values.set(key.slice(-1)+':'+text,entry);this.revision++;records++;
          }else if(old.expression!==text||old.result!==result){this.forget(key,old);this.blocked.add(key);this.revision++;}
          else{this.entries.delete(key);this.entries.set(key,old);}
        }
      }return '';
    }).replace(new RegExp(tag+'HIT\\r?\\n','g'),()=>{hits++;return '';});
    const provisionalHits=this.provisionalHits,intermediateHits=this.intermediateHits;this.discardProvisional();
    return {log:cleaned,records,provisionalHits,intermediateHits,intermediateLearned,intermediateEntries:this.intermediateValues.size,hits:process.env.PERSISTENT_TEX_TIKZ_MATH_TRACE==='1'?hits:undefined,entries:this.size};
  }
}
