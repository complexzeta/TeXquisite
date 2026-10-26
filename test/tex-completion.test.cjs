const {test}=require('node:test'),assert=require('node:assert/strict');
const {EditorState,Transaction}=require('@codemirror/state');
const {history,undo,redo,isolateHistory}=require('@codemirror/commands');
const {completeTex,surroundTex,texCompletion}=require('../dist/tex-completion');
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
