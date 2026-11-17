const {test}=require('node:test'),assert=require('node:assert/strict');
const {EditorState,Transaction}=require('@codemirror/state');
const {history,undo,redo,isolateHistory}=require('@codemirror/commands');
const {completeTex,surroundTex,texCompletion,nextTexArgument,wrapTexCommand}=require('../dist/tex-completion');
function editor(doc='',at=doc.length){
 let enabled=true;
 const view={state:EditorState.create({doc,selection:{anchor:at},extensions:[history(),texCompletion(()=>enabled)]}),dispatch:spec=>{view.state=spec instanceof Transaction?spec.state:view.state.update(spec).state;}};
 return {view,type(text){for(const ch of text)view.dispatch({...completeTex(view.state,ch,enabled),annotations:[Transaction.userEvent.of('input.type'),isolateHistory.of('full')]});},text:()=>view.state.doc.toString(),at:()=>view.state.selection.main.head,enable(value){enabled=value;}};
}
test('nested math and typed closers are atomic without duplicates',()=>{
 const e=editor();e.type('$');assert.equal(e.text(),'$$');e.type('\\sqrt{');assert.equal(e.text(),'$\\sqrt{}$');e.type('\\pi}$');assert.equal(e.text(),'$\\sqrt{\\pi}$');assert.equal(e.at(),e.text().length);
 const b=editor();b.type('{stuff}');assert.equal(b.text(),'{stuff}');
});
test('backslash math delimiters close and skip generated characters',()=>{
 for(const [open,close] of [['\\[','\\]'],['\\(','\\)']]){const e=editor();e.type(open);assert.equal(e.text(),open+close);e.type('x'+close);assert.equal(e.text(),open+'x'+close);assert.equal(e.at(),5);}
});
test('multiple command arguments complete and navigate without duplicating braces',()=>{
 for(const command of ['frac','binom']){
  const e=editor();e.type('\\'+command+'{');
  assert.equal(e.text(),'\\'+command+'{}{}');assert.equal(e.at(),command.length+2);
  e.type('x_{1}');
  e.view.dispatch(nextTexArgument(e.view.state));
  e.type('y');
  e.view.dispatch(nextTexArgument(e.view.state,true));
  assert.equal(e.at(),command.length+2);
  e.view.dispatch(nextTexArgument(e.view.state));
  e.view.dispatch(nextTexArgument(e.view.state));
  assert.equal(e.at(),e.text().length);
  const typed=editor();typed.type('\\'+command+'{a}{b}');
  assert.equal(typed.text(),'\\'+command+'{a}{b}');
 }
});
test('command wrapping keeps selected content and puts the caret in the next argument',()=>{
 const e=editor('a+b');e.view.dispatch({selection:{anchor:0,head:3}});e.view.dispatch(wrapTexCommand(e.view.state,'\\frac'));
 assert.equal(e.text(),'\\frac{a+b}{}');assert.equal(e.at(),11);
 e.type('c}');assert.equal(e.text(),'\\frac{a+b}{c}');
 assert.ok(undo(e.view));assert.ok(undo(e.view));assert.equal(e.text(),'a+b');
 const single=editor('x');single.view.dispatch({selection:{anchor:0,head:1}});
 single.view.dispatch(wrapTexCommand(single.view.state,'\\single',{single:1}));assert.equal(single.text(),'\\single{x}');assert.equal(single.at(),single.text().length);
});
test('custom argument counts support optional defaults, xparse, nesting, history and disabled completion',()=>{
 for(const definition of ['\\newcommand{\\custom}[3]{#1#2#3}','\\NewDocumentCommand{\\custom}{O{a} m +m m}{#2#3#4}','\\def\\custom#1#2#3{#1#2#3}']){
  const e=editor(definition+'\n');e.type('\\custom{');
  assert.ok(e.text().endsWith('\\custom{}{}{}'));
  const complete=e.text();assert.ok(undo(e.view));assert.ok(redo(e.view));assert.equal(e.text(),complete);
   e.view.dispatch({selection:{anchor:definition.length+1+'\\custom{'.length}});
  e.type('one');e.view.dispatch(nextTexArgument(e.view.state));e.type('\\frac{a');
  e.view.dispatch(nextTexArgument(e.view.state));e.type('b');e.view.dispatch(nextTexArgument(e.view.state));
  e.view.dispatch(nextTexArgument(e.view.state));e.type('three');
  assert.ok(e.text().endsWith('\\custom{one}{\\frac{a}{b}}{three}'));
 }
 const optional=editor('\\newcommand{\\custom}[4][default]{#1#2#3#4}\n');optional.type('\\custom{');assert.ok(optional.text().endsWith('\\custom{}{}{}'));
 const off=editor();off.enable(false);off.type('\\frac{');assert.equal(off.text(),'\\frac{');assert.equal(nextTexArgument(off.view.state,false,false),undefined);
 const ordinary=editor('text');assert.equal(nextTexArgument(ordinary.view.state),undefined);
 const explicit=editor();explicit.view.dispatch(completeTex(explicit.view.state,'\\unknown',true));explicit.view.dispatch(completeTex(explicit.view.state,'{',true,{unknown:4}));assert.equal(explicit.text(),'\\unknown{}{}{}{}');
 const detached=editor();detached.type('\\frac{');detached.view.dispatch({changes:{from:6,to:7,insert:''}});assert.equal(nextTexArgument(detached.view.state),undefined);
});
test('math openers can become environments by replacement or incremental typing',()=>{
 for(const open of ['\\[','\\(']){
  const close=open==='\\['?'\\]':'\\)';
  const e=editor(open+'x+1'+close);
  e.view.dispatch({changes:{from:0,to:2,insert:'\\begin{align*}'},annotations:isolateHistory.of('full')});
  assert.equal(e.text(),'\\begin{align*}x+1\\end{align*}');
  assert.ok(undo(e.view));assert.equal(e.text(),open+'x+1'+close);
  assert.ok(redo(e.view));assert.equal(e.text(),'\\begin{align*}x+1\\end{align*}');
  e.view.dispatch({changes:{from:7,to:13,insert:'equation'}});
  assert.equal(e.text(),'\\begin{equation}x+1\\end{equation}');
  const typed=editor(open+'x+1'+close);
  typed.view.dispatch({selection:{anchor:0,head:2}});
  typed.type('\\begin{equation}');
  assert.equal(typed.text(),'\\begin{equation}x+1\\end{equation}');
  const partial=editor(open+'x'+close);
  partial.view.dispatch({changes:{from:1,to:2,insert:'begin'},selection:{anchor:6}});
  partial.type('{align}');
  assert.equal(partial.text(),'\\begin{align}x\\end{align}');
 }
});
test('forwarding wrappers infer remaining arguments through genfrac and custom helper chains',()=>{
 const definitions='\\DeclareRobustCommand{\\sstirling}{\\genfrac\\{\\}{0pt}{}}\n\\DeclareRobustCommand{\\fstirling}{\\genfrac[]{0pt}{}}\n\\DeclareRobustCommand{\\eulerian}{\\genfrac\\langle\\rangle{0pt}{}}\n\\newcommand{\\triplehelper}[3]{#1#2#3}\n\\newcommand{\\forwarded}{\\triplehelper{fixed}}\n\\newcommand{\\alias}{\\forwarded}\n';
 for(const name of ['sstirling','fstirling','eulerian','forwarded','alias']){
  const e=editor(definitions);e.type('\\'+name+'{');assert.ok(e.text().endsWith('\\'+name+'{}{}'));
  e.type('n');e.view.dispatch(nextTexArgument(e.view.state));e.type('k');
  assert.ok(e.text().endsWith('\\'+name+'{n}{k}'));
 }
});
test('environments convert back into math delimiters, including typing, nested pairs and history',()=>{
 for(const open of ['\\[','\\(']){
  const close=open==='\\['?'\\]':'\\)',start='\\begin{align*}',text=start+'x+1\\end{align*}';
  const e=editor(text);e.view.dispatch({changes:{from:0,to:start.length,insert:open},annotations:isolateHistory.of('full')});
  assert.equal(e.text(),open+'x+1'+close);assert.ok(undo(e.view));assert.equal(e.text(),text);assert.ok(redo(e.view));assert.equal(e.text(),open+'x+1'+close);
  const typed=editor(text);typed.view.dispatch({selection:{anchor:0,head:start.length}});typed.type(open);
  assert.equal(typed.text(),open+'x+1'+close);
  const nested=editor('\\begin{equation}\\begin{split}x\\end{split}\\end{equation}');
  nested.view.dispatch({changes:{from:16,to:29,insert:open}});
  assert.equal(nested.text(),'\\begin{equation}'+open+'x'+close+'\\end{equation}');
  const off=editor(text);off.enable(false);off.view.dispatch({changes:{from:0,to:start.length,insert:open}});
  assert.equal(off.text(),open+'x+1\\end{align*}');
 }
});
test('dollar math converts to and from other math openers by replacing or deleting the opener',()=>{
 const forms=[['\\[','\\]'],['\\(','\\)'],['\\begin{align*}','\\end{align*}']];
 for(const [open,close]of forms){
  for(const removeFirst of [false,true]){
   const e=editor('$a+b$');
   if(removeFirst)e.view.dispatch({changes:{from:0,to:1,insert:''},selection:{anchor:0}});
   else e.view.dispatch({selection:{anchor:0,head:1}});
   e.type(open);assert.equal(e.text(),open+'a+b'+close);
   if(removeFirst)e.view.dispatch({changes:{from:0,to:open.length,insert:''},selection:{anchor:0}});
   else e.view.dispatch({selection:{anchor:0,head:open.length}});
   e.type('$');assert.equal(e.text(),'$a+b$');
  }
  const pasted=editor('$a+b$');pasted.view.dispatch({changes:{from:0,to:1,insert:open},annotations:isolateHistory.of('full')});
  assert.equal(pasted.text(),open+'a+b'+close);assert.ok(undo(pasted.view));assert.equal(pasted.text(),'$a+b$');assert.ok(redo(pasted.view));assert.equal(pasted.text(),open+'a+b'+close);
 }
 const generated=editor();generated.type('$a+b$');generated.view.dispatch({selection:{anchor:0,head:1}});generated.type('\\[');assert.equal(generated.text(),'\\[a+b\\]');
 const bulk=editor();bulk.view.dispatch(completeTex(bulk.view.state,'Text $a+b$ text'));bulk.view.dispatch({changes:{from:5,to:6,insert:'\\('}});assert.equal(bulk.text(),'Text \\(a+b\\) text');
});
test('dollar links respect escapes, comments, verbatim, display dollars, disabled mode and independent formulas',()=>{
 for(const original of ['\\$a+b$','% $a+b$','\\begin{verbatim}\n$a+b$\n\\end{verbatim}','\\verb|$a+b$|','$$a+b$$']){
  const e=editor(original),at=original.indexOf('$');e.view.dispatch({changes:{from:at,to:at+1,insert:'\\['}});
  assert.equal(e.text(),original.slice(0,at)+'\\['+original.slice(at+1));
 }
 const e=editor('$a$ and $b$');e.view.dispatch({changes:{from:8,to:9,insert:'\\begin{equation}'}});assert.equal(e.text(),'$a$ and \\begin{equation}b\\end{equation}');
 const adjacent=editor('$a$$b$');adjacent.view.dispatch({changes:{from:3,to:4,insert:'\\['}});assert.equal(adjacent.text(),'$a$\\[b\\]');
 const off=editor('$a+b$');off.enable(false);off.view.dispatch({changes:{from:0,to:1,insert:'\\['}});assert.equal(off.text(),'\\[a+b$');
 const manual=editor('$a+b$');manual.view.dispatch({changes:{from:4,to:5,insert:'!'}});manual.view.dispatch({changes:{from:0,to:1,insert:'\\['}});assert.equal(manual.text(),'\\[a+b!');
});
test('math conversion respects nested pairs, manual closers, comments and disabled matching',()=>{
 const e=editor('\\[a+\\(b\\)\\]');
 e.view.dispatch({changes:{from:4,to:6,insert:'\\begin{aligned}'}});
 assert.equal(e.text(),'\\[a+\\begin{aligned}b\\end{aligned}\\]');
 for(const original of ['% \\[x\\]','\\begin{verbatim}\n\\[x\\]\n\\end{verbatim}']){
  const x=editor(original),at=original.indexOf('\\[');
  x.view.dispatch({changes:{from:at,to:at+2,insert:'\\begin{align}'}});
  assert.ok(x.text().includes('x\\]'));
 }
 const off=editor('\\[x\\]');off.enable(false);
 off.view.dispatch({changes:{from:0,to:2,insert:'\\begin{align}'}});
 assert.equal(off.text(),'\\begin{align}x\\]');
 const manual=editor('\\[x\\]');manual.view.dispatch({changes:{from:3,to:5,insert:'\\)'}});
 manual.view.dispatch({changes:{from:0,to:2,insert:'\\begin{align}'}});
 assert.equal(manual.text(),'\\begin{align}x\\)');
 const generated=editor();generated.type('\\[x');
 generated.view.dispatch({selection:{anchor:0,head:2}});generated.type('\\begin{align}');
 assert.equal(generated.text(),'\\begin{align}x\\end{align}');
});
test('environments nest, support stars, and skip generated ends',()=>{
 const e=editor();e.type('\\begin{align*}');assert.equal(e.text(),'\\begin{align*}\\end{align*}');e.type('\\begin{split}x\\end{split}\\end{align*}');assert.equal(e.text(),'\\begin{align*}\\begin{split}x\\end{split}\\end{align*}');assert.equal(e.at(),e.text().length);
});
test('commands sharing an environment closer prefix remain intact',()=>{
 for(const command of ['\\eta','\\epsilon','\\endless','\\\\end','\\begin{split}x\\end{split}']){const e=editor();e.type('\\begin{align}');e.type(command+'\\end{align}');assert.equal(e.text(),'\\begin{align}'+command+'\\end{align}');}
});
test('comments, escaped commands, disabled mode and bulk input remain literal',()=>{
 for(const text of ['\\$','% $ { \\begin{foo}','\\\\begin{foo}']){const e=editor();e.type(text);assert.equal(e.text(),text);}
 const e=editor();e.enable(false);e.type('$ { \\[');assert.equal(e.text(),'$ { \\[');const paste='\\begin{foo}\n$x$\n\\end{foo}';e.view.dispatch(completeTex(e.view.state,paste));assert.equal(e.text(),'$ { \\['+paste);
 const even=editor('\\\\');even.type('$');assert.equal(even.text(),'\\\\$$');
});
test('existing math and escaped closing characters behave correctly',()=>{
 const e=editor('$x');e.type('$');assert.equal(e.text(),'$x$');const b=editor();b.type('{\\}');assert.equal(b.text(),'{\\}}');b.type('}');assert.equal(b.text(),'{\\}}');const d=editor();d.type('$\\$');assert.equal(d.text(),'$\\$$');d.type('$');assert.equal(d.text(),'$\\$$');
});
test('undo and redo restore generated closer provenance',()=>{
 for(const [token,closer]of [['{','}'],['$','$'],['\\[','\\]'],['\\begin{align}','\\end{align}']]){const e=editor();e.type(token);const completed=e.text();assert.ok(undo(e.view));assert.ok(redo(e.view));assert.equal(e.text(),completed);e.view.dispatch({selection:{anchor:token.length}});e.type('x'+closer);assert.equal(e.text(),token+'x'+closer);}
});
test('closers map across edits and invalidate when replaced',()=>{
 const e=editor();e.type('{');e.view.dispatch({changes:{from:0,insert:'before '}});e.type('text}');assert.equal(e.text(),'before {text}');const f=editor();f.type('{');f.view.dispatch({changes:{from:1,to:2,insert:'other'}});f.type('}');assert.equal(f.text(),'{}other');
});
test('undo restores a deleted pair and selections can wrap',()=>{
 const e=editor();e.type('{');e.view.dispatch({changes:{from:0,to:2},annotations:isolateHistory.of('full')});assert.ok(undo(e.view));e.view.dispatch({selection:{anchor:1}});e.type('x}');assert.equal(e.text(),'{x}');const w=editor('word');w.view.dispatch({selection:{anchor:0,head:4}});w.type('{');assert.equal(w.text(),'{word}');assert.equal(w.view.state.selection.main.from,1);assert.equal(w.view.state.selection.main.to,5);
});
test('all ordinary opening delimiters pair and skip complete named closers',()=>{
 for(const [left,right]of [['(',')'],['[',']'],['{','}'],['\\{','\\}'],['\\langle','\\rangle'],['\\lfloor','\\rfloor'],['\\lceil','\\rceil'],['\\lbrace','\\rbrace'],['\\lbrack','\\rbrack'],['\\lvert','\\rvert'],['\\lVert','\\rVert'],['\\lmoustache','\\rmoustache'],['\\lgroup','\\rgroup'],['\\|','\\|']]){
  const e=editor(),space=/[A-Za-z]$/.test(left)?' ':'';e.type(left);assert.equal(e.text(),left+space+right+space);e.type('x'+right);assert.equal(e.text(),left+space+'x'+right+space);assert.equal(e.at(),e.text().length);
 }
 const e=editor();e.type('([x])');assert.equal(e.text(),'([x])');
});
test('left delimiters generate matching rights and skip typed closers',()=>{
 for(const [left,right]of [['(',')'],['[',']'],['.','.'],['|','|'],['\\{','\\}'],['\\lfloor','\\rfloor'],['\\lceil','\\rceil'],['\\langle','\\rangle'],['\\lVert','\\rVert'],['\\backslash','\\backslash']]){const e=editor(),space=/[A-Za-z]$/.test(left)?' ':'';e.type('\\left'+left);assert.equal(e.text(),'\\left'+left+space+'\\right'+right+space);e.type('x\\right'+right);assert.equal(e.text(),'\\left'+left+space+'x\\right'+right+space);e.type('z');assert.equal(e.text(),'\\left'+left+space+'x\\right'+right+space+'z');}
});
test('sized closers allow different delimiters and preserve body commands',()=>{
 for(const [left,closing]of [['(','\\right]'],['\\lfloor','\\right\\rangle '],['.','\\right)'],['[','\\right\\}']]){const e=editor();e.type('\\left'+left);e.type('x'+closing);assert.equal(e.text(),'\\left'+left+(/[A-Za-z]$/.test(left)?' ':'')+'x'+closing);}
 const e=editor();e.type('\\left(\\left[x\\right]\\right)');assert.equal(e.text(),'\\left(\\left[x\\right]\\right)');
 for(const command of ['\\rho','\\rightarrow','\\rightleftharpoons']){const f=editor();f.type('\\left(');f.type(command+'\\right)');assert.equal(f.text(),'\\left('+command+'\\right)');}
});
test('sized completion respects comments, mode, paste and history',()=>{
 const comment=editor();comment.type('% \\left(');assert.equal(comment.text(),'% \\left(');const literal=editor();literal.type('\\\\left(');assert.equal(literal.text(),'\\\\left()');const disabled=editor();disabled.enable(false);disabled.type('\\left\\lfloor');assert.equal(disabled.text(),'\\left\\lfloor');const paste=editor();paste.view.dispatch(completeTex(paste.view.state,'\\left(x'));assert.equal(paste.text(),'\\left(x');
 const e=editor();e.type('\\left(');assert.ok(undo(e.view));assert.ok(redo(e.view));e.view.dispatch({selection:{anchor:6}});e.type('x\\right)');assert.equal(e.text(),'\\left(x\\right)');
});
test('generated environment names stay linked through edits and history',()=>{
 const e=editor();e.type('\\begin{align}');e.view.dispatch({selection:{anchor:12}});e.type('*');assert.equal(e.text(),'\\begin{align*}\\end{align*}');assert.ok(undo(e.view));assert.equal(e.text(),'\\begin{align}\\end{align}');assert.ok(redo(e.view));assert.equal(e.text(),'\\begin{align*}\\end{align*}');
 e.view.dispatch({changes:{from:7,to:13,insert:'equation'},annotations:isolateHistory.of('full')});assert.equal(e.text(),'\\begin{equation}\\end{equation}');e.view.dispatch({selection:{anchor:16}});e.type('x\\end{equation}');assert.equal(e.text(),'\\begin{equation}x\\end{equation}');
});
test('nested environment renames affect only their own ends',()=>{
 const e=editor();e.type('\\begin{align}\\begin{split}x\\end{split}\\end{align}');let at=e.text().indexOf('split');e.view.dispatch({changes:{from:at,to:at+5,insert:'aligned'}});assert.equal(e.text(),'\\begin{align}\\begin{aligned}x\\end{aligned}\\end{align}');e.view.dispatch({changes:{from:12,insert:'*'}});assert.equal(e.text(),'\\begin{align*}\\begin{aligned}x\\end{aligned}\\end{align*}');
});
test('manual end edits detach links and disabled mode never renames',()=>{
 const e=editor();e.type('\\begin{align}');e.enable(false);e.view.dispatch({changes:{from:12,insert:'*'}});assert.equal(e.text(),'\\begin{align*}\\end{align}');const f=editor();f.type('\\begin{align}');const at=f.text().lastIndexOf('align');f.view.dispatch({changes:{from:at,to:at+5,insert:'split'}});f.view.dispatch({changes:{from:12,insert:'*'}});assert.equal(f.text(),'\\begin{align*}\\end{split}');
 for(const text of ['([{$\\{\\langle\\left(','% ([{\\langle']){const d=editor();d.enable(false);d.type(text);assert.equal(d.text(),text);}
 const old=editor('\\begin{align}x\\end{align}');old.view.dispatch({changes:{from:12,insert:'*'}});assert.equal(old.text(),'\\begin{align*}x\\end{align*}');
});
test('selection wrappers are atomic; typos and disabled mode preserve source',()=>{
 for(const [open,close]of [['(',')'],['[',']'],['{','}'],['\\{','\\}'],['\\langle','\\rangle'],['\\lfloor','\\rfloor'],['\\lceil','\\rceil'],['\\left(','\\right)']]){const text='\u03b1 + \u03b2',e=editor(text);e.view.dispatch({selection:{anchor:0,head:5}});assert.equal(surroundTex(e.view.state,'\\lagnle'),undefined);assert.equal(e.text(),text);assert.equal(surroundTex(e.view.state,open,false),undefined);e.view.dispatch({...surroundTex(e.view.state,open),annotations:isolateHistory.of('full')});const space=/[A-Za-z]$/.test(open)?' ':'';assert.equal(e.text(),open+space+text+close+space);assert.equal(e.view.state.sliceDoc(e.view.state.selection.main.from,e.view.state.selection.main.to),text);assert.ok(undo(e.view));assert.equal(e.text(),text);assert.ok(redo(e.view));assert.equal(e.text(),open+space+text+close+space);}
});

test('opened and pasted environments link literal nested pairs, skipping comments and verbatim contents',()=>{
 const text='\\begin{align}\n% \\end{align}\n\\begin{split}x\\end{split}\n\\end{align}',e=editor(text);e.view.dispatch({changes:{from:12,insert:'*'}});assert.equal(e.text(),text.replace('\\begin{align}','\\begin{align*}').replace(/\\end\{align\}$/, '\\end{align*}'));
 const p=editor();p.view.dispatch(completeTex(p.view.state,'\\begin{equation}x\\end{equation}'));p.view.dispatch({changes:{from:15,insert:'*'}});assert.equal(p.text(),'\\begin{equation*}x\\end{equation*}');
 const v=editor('\\begin{verbatim}\n\\begin{align}x\\end{align}\n\\end{verbatim}');v.view.dispatch({changes:{from:29,insert:'*'}});assert.ok(v.text().includes('\\end{align}'));
});
