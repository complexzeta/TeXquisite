const {test}=require('node:test'),assert=require('node:assert/strict'),{ResidentCompiler}=require('../dist/resident'),{buildTikzMathPlan}=require('../dist/tikz-math-cache');
const signal=()=>new AbortController().signal;
test('Numerical plan grammar accepts only the supported operation order and bounded decimal literals',()=>{
 assert.equal(buildTikzMathPlan('3*cos(17*3)'),'C*|17|3|3');assert.equal(buildTikzMathPlan('{sin(0.02345*180)/3}'),'S/|0.02345|180|3');
 for(const text of ['3*cos(017*3)','3*cos(1e2*3)','sin(17*3)/0','sin(17*3)/0.000001','3*cos(17000*3)','3*cos(17pt*3)','3*cos(17*\\count0)','3*cos(17*3);bad','3* cos(17*3)','3*cos(17*3){}','1/(2+3)','sin(2,3)','--3','2^3','2<3','{3}*cos(17*3)','sin({3})'])assert.equal(buildTikzMathPlan(text),undefined,text);
});

test('Extended plans preserve grouping, unary negation and left associativity within bounded budgets',()=>{
 assert.equal(buildTikzMathPlan('2+3*cos(-17*3)'),'P|v2;v3;v17;n;v3;*;c;*;+');
 assert.equal(buildTikzMathPlan('8/2/2'),'P|v8;v2;/;v2;/');
 assert.equal(buildTikzMathPlan('8-2-1'),'P|v8;v2;-;v1;-');
 for(const text of ['3*cos(17+3)','3*cos(17*3)+1','(3)*cos(17*3)','sin(cos(2)*3)','-(2+3)','1+-2'])assert.ok(buildTikzMathPlan(text)?.startsWith('P|'),text);
 for(const text of ['('.repeat(20)+'1+2'+')'.repeat(20),Array(20).fill('1').join('+'),'10000+10000','1/sin(2)','0.001/0.0001'])assert.equal(buildTikzMathPlan(text),undefined,text);
});

test('Negative, offset and nested plans match exact ordinary-PGF results',{timeout:120000},async t=>{
 const expressions=[],values=['-12.34567','-2.4','-0.333333333','-0.00001','0','0.00001','0.125','0.333333333','1','2.4','10.12345'];
 for(const mode of [0,1])for(const x of values){const forms=['2+3*cos(('+x+')*3)','1+2*sin((('+x+')-1)*2)','0.5+sin((('+x+')+1)*3)/2','-3*cos(('+x+')*2)','-(2+sin('+x+'))','sin(cos('+x+')*2)','(2+sin('+x+'))*(1+cos('+x+'))','cos('+x+')/(-1.23456)','8/2/2+sin('+x+')','8-2-1+cos('+x+')','1+-2+sin('+x+')','sin('+x+')*-2','(3)*cos(('+x+')*3)'];for(const text of forms){assert.ok(buildTikzMathPlan(text),text);expressions.push({mode,text});}}
 const source='\\documentclass{article}\n\\usepackage{tikz}\n\\begin{document}\n\nBefore.\n\n\\begin{tikzpicture}\n'+expressions.map(({mode,text},i)=>'\\pgfkeys{/pgf/trig format='+(mode?'rad':'deg')+'}\\pgfmathparse{'+text+'}\\typeout{EXTVALUE:'+i+'=\\pgfmathresult}\n').join('')+'\\node {Done};\\end{tikzpicture}\n\n\\end{document}\n',results=[];
 for(const disabled of [false,true]){const previous=process.env.PERSISTENT_TEX_DISABLE_TIKZ_MATH_CACHE;if(disabled)process.env.PERSISTENT_TEX_DISABLE_TIKZ_MATH_CACHE='1';const c=new ResidentCompiler();t.after(()=>c.stop());let log='';try{assert.ok(await c.compile(source,signal(),60000,s=>log+=s,{characterMapping:true}));const lines=[...log.matchAll(/EXTVALUE:(\d+)=(-?[\d.]+)/g)].map(m=>m[1]+'='+m[2]);assert.ok(lines.length>=expressions.length);results.push(lines.slice(-expressions.length));}finally{if(previous===undefined)delete process.env.PERSISTENT_TEX_DISABLE_TIKZ_MATH_CACHE;else process.env.PERSISTENT_TEX_DISABLE_TIKZ_MATH_CACHE=previous;}}
 assert.equal(expressions.length,286);for(let i=0;i<expressions.length;i++)assert.equal(results[0][i],results[1][i],JSON.stringify(expressions[i]));
});
test('Planned new calculations match the ordinary parser exactly in degrees and radians',{timeout:120000},async t=>{
 const values=['0','0.00001','0.00002','0.001','0.125','0.333333333','0.99999','1','1.00002','2.4','12.34567','89.99999','180','359.99999','720'],expressions=[];
 for(const mode of [0,1])for(const x of values)for(const fn of ['sin','cos']){if(mode&&Number(x)>12)continue;for(const scale of ['0.5','1','3.14159']){expressions.push({mode,text:'2.4*'+fn+'('+x+'*'+scale+')'});expressions.push({mode,text:fn+'('+x+'*'+scale+')/1.23456'});}}
 const source='\\documentclass{article}\n\\usepackage{tikz}\n\\begin{document}\n\nBefore.\n\n\\begin{tikzpicture}\n'+expressions.map(({mode,text},i)=>'\\pgfkeys{/pgf/trig format='+(mode?'rad':'deg')+'}\\pgfmathparse{'+text+'}\\typeout{PLANVALUE:'+i+'=\\pgfmathresult}\n').join('')+'\\node {Done};\\end{tikzpicture}\n\n\\end{document}\n',results=[];
 for(const disabled of [false,true]){const previous=process.env.PERSISTENT_TEX_DISABLE_TIKZ_MATH_CACHE;if(disabled)process.env.PERSISTENT_TEX_DISABLE_TIKZ_MATH_CACHE='1';const c=new ResidentCompiler();t.after(()=>c.stop());let log='';try{assert.ok(await c.compile(source,signal(),60000,s=>log+=s,{characterMapping:true}));const lines=[...log.matchAll(/PLANVALUE:(\d+)=(-?[\d.]+)/g)].map(m=>m[1]+'='+m[2]);assert.ok(lines.length>=expressions.length);results.push(lines.slice(-expressions.length));}finally{if(previous===undefined)delete process.env.PERSISTENT_TEX_DISABLE_TIKZ_MATH_CACHE;else process.env.PERSISTENT_TEX_DISABLE_TIKZ_MATH_CACHE=previous;}}
 assert.equal(expressions.length,300);assert.deepEqual(results[0],results[1]);
});
