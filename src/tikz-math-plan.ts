// A deliberately small grammar. Values still go through PGF's own fixed-point
// multiply, sine/cosine and divide functions, in the parser's operation order.
const number='(?:0|[1-9][0-9]*)(?:[.][0-9]+)?';
const radius=new RegExp('^('+number+')\\*(sin|cos)\\(('+number+')\\*('+number+')\\)$');
const curve=new RegExp('^(sin|cos)\\(('+number+')\\*('+number+')\\)/('+number+')$');
export function buildTikzMathPlan(expression:string,intermediate?: (key:string)=>string|undefined){
  if(expression.length>128)return;
  while(expression.startsWith('{')&&expression.endsWith('}')&&!/[{}]/.test(expression.slice(1,-1)))expression=expression.slice(1,-1);
  if(intermediate){const planned=buildStackPlan(expression,intermediate);if(planned&&planned.length<=512)return planned;}
  const r=radius.exec(expression),c=curve.exec(expression);
  if(!r&&!c)return buildStackPlan(expression);
  const fn=r?r[2]:c![1],values=r?[r[3],r[4],r[1]]:[c![2],c![3],c![4]];
  if(values.some(n=>n.length>18||!Number.isFinite(Number(n))||Number(n)>10000)||Number(values[0])*Number(values[1])>10000||c&&Number(values[2])<0.00002)return;
  return (fn==='sin'?'S':'C')+(r?'*':'/')+'|'+values.join('|');
}

type Value={code:string[];original:string[];bound:number;literal?:number;ops:number};
// The generic plan records operation order, never computed output values.
// Bounds only decide whether to keep the normal parser for extreme inputs.
function buildStackPlan(text:string,intermediate?: (key:string)=>string|undefined){
  let at=0,depth=0;
  const value=(code:string[],bound:number,ops:number,literal?:number,original=code):Value=>{if(bound>10000||ops>16)throw Error('budget');return {code,original,bound,ops,literal};};
  const primary=():Value=>{
    if(++depth>12)throw Error('depth');let result:Value;
    const fn=/^(sin|cos)\(/.exec(text.slice(at));
    if(fn){at+=fn[0].length;const arg=sum();if(text[at++]!==')')throw Error('function');const op=fn[1]==='sin'?'s':'c',original=[...arg.original,op],key=original.join(';'),saved=intermediate?.(key);
      const reusable=typeof saved==='string'&&saved.length<=32&&/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(saved)&&Math.abs(Number(saved))<=2;
      const instruction=intermediate&&key.length<=128?op+Buffer.from(key).toString('hex'):op;
      result=value(reusable?['r'+saved]:[...arg.code,instruction],1,arg.ops+1,undefined,original);}
    else if(text[at]==='('){at++;result=sum();if(text[at++]!==')')throw Error('group');}
    else{const n=new RegExp('^'+number).exec(text.slice(at));if(!n||n[0].length>18)throw Error('number');at+=n[0].length;result=value(['v'+n[0]],Number(n[0]),0,Number(n[0]));}
    depth--;return result;
  };
  const unary=():Value=>{if(text[at]!=='-')return primary();at++;const x=primary();return value([...x.code,'n'],x.bound,x.ops+1,x.literal===undefined?undefined:-x.literal,[...x.original,'n']);};
  const product=():Value=>{let a=unary();while(text[at]==='*'||text[at]==='/'){const op=text[at++],b=unary();if(op==='/'&&(b.literal===undefined||Math.abs(b.literal)<0.001))throw Error('divisor');a=value([...a.code,...b.code,op],op==='*'?a.bound*b.bound:a.bound/Math.abs(b.literal!),a.ops+b.ops+1,undefined,[...a.original,...b.original,op]);}return a;};
  const sum=():Value=>{let a=product();while(text[at]==='+'||text[at]==='-'){const op=text[at++],b=product();a=value([...a.code,...b.code,op],a.bound+b.bound,a.ops+b.ops+1,undefined,[...a.original,...b.original,op]);}return a;};
  try{const result=sum();if(at!==text.length||!result.ops||result.code.length>48)return;return 'P|'+result.code.join(';');}catch{return;}
}
