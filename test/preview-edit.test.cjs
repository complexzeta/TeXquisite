const {test}=require('node:test'),assert=require('node:assert/strict');
const {proseLine,proseSpans,nearestCaret,caretBox,textChange,ordinaryText}=require('../dist/preview-edit');
const {ResidentCompiler}=require('../dist/resident');
const {makeNavigation}=require('../dist/navigation');
const {validatePdf,runProcess,hash}=require('../dist/core');
test('Literal editing requires complete unique glyph coverage and actual PDF geometry',()=>{
 const file='main.tex',source='Hello world.\n',glyphs=[];let x=10;
 for(let i=0;i<source.trim().length;i++){if(source[i]===' '){x+=4;continue;}glyphs.push([file,1,i,1,x,20,5,8,source.charCodeAt(i)]);x+=5;}
 const nav={schema:1,sources:{},regions:[[file,1,1,10,20,x-10,8]],characters:glyphs},pdf=glyphs.map(g=>[g[8],g[4]+.2,g[5]+.1,g[6]-.3,g[7]-.2]),mapped=proseLine(nav,file,1,1,source,pdf);assert.ok(mapped);
 const w=glyphs.find(g=>g[2]===6);assert.equal(nearestCaret(mapped,w[4]+.1,23),6);assert.equal(caretBox(mapped,5).x,glyphs[4][4]+5);assert.equal(caretBox(mapped,6).x,w[4]);
 assert.equal(proseLine({...nav,characters:glyphs.slice(1)},file,1,1,source,pdf),undefined,'Missing glyphs must not become guessed columns');
 assert.equal(proseLine(nav,file,1,1,source,pdf.map(p=>[p[0],p[1]+50,...p.slice(2)])),undefined,'Transformed coordinates must be rejected');
 assert.equal(proseLine(nav,file,1,1,source,[...pdf,pdf[0]]),undefined,'Overlapping text is ambiguous');
 assert.equal(proseLine({...nav,nativeInputs:{}},file,1,1,source,pdf),undefined);
 assert.equal(proseLine(nav,file,1,1,'$x+y$\n',pdf),undefined);
 assert.equal(proseLine({...nav,regions:[...nav.regions,['other.tex',2,1,10,20,8,8]]},file,1,1,source,pdf),undefined);
 const change=textChange(source,mapped,6,6,'brave ');assert.deepEqual(change,{from:6,to:6,insert:'brave ',head:12,end:18});
 assert.equal(textChange(source,mapped,0,0,'',true),undefined);assert.equal(textChange(source,mapped,12,12,'',false,true),undefined);
 for(const input of ['\\foo','$','%','{','\n'])assert.equal(ordinaryText(input),false);
});

test('Compiler character positions survive checkpoints and mode switches without changing PDF pixels',{timeout:90000},async t=>{
 const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
 const directory=path.resolve('.test-output','literal-engine-'+randomUUID());await fs.mkdir(directory,{recursive:true});
 const root=path.join(directory,'main.tex'),source='\\documentclass{article}\n\\begin{document}\n\nHello world.\n\n$x+y$\n\\newpage\nA simple chapter.\n\\end{document}\n',compiler=new ResidentCompiler();t.after(()=>compiler.stop());
 const compile=async(text,enabled)=>{const pdf=await compiler.compile(text,new AbortController().signal,60000,()=>{},{characterMapping:enabled});assert.ok(pdf);assert.equal(await validatePdf(pdf),2);return pdf;};
 const off=await compile(source,false);assert.doesNotMatch(compiler.navigation,/"glyph"/);
 const on=await compile(source,true),nav=makeNavigation(compiler.navigation,root,source,[],{'main.tex':root});
 for(const line of [4,8]){const text=source.split('\n')[line-1],characters=nav.characters.filter(g=>g[1]===line);assert.equal(characters.length,text.replace(/ /g,'').length);for(const g of characters)assert.equal(g[8],text.charCodeAt(g[2]));assert.ok(characters.some(g=>g[2]===0),'First paragraph character must retain its literal column');}
 assert.equal(nav.characters.filter(g=>g[1]===6).length,0,'Math must not claim ordinary-text character locations');
 await fs.writeFile(path.join(directory,'off.pdf'),off);await fs.writeFile(path.join(directory,'on.pdf'),on);
 for(const name of ['off','on'])await runProcess('pdftoppm',['-r','72',name+'.pdf',name],directory,30000,new AbortController().signal,()=>{});
 for(const page of [1,2])assert.equal(hash(await fs.readFile(path.join(directory,'off-'+page+'.ppm'))),hash(await fs.readFile(path.join(directory,'on-'+page+'.ppm'))));
 const changed=source.replace('Hello world.','Hello brave world.');await compile(changed,true);const next=makeNavigation(compiler.navigation,root,changed,[],{'main.tex':root});for(const g of next.characters.filter(g=>g[1]===4))assert.equal(g[8],changed.split('\n')[3].charCodeAt(g[2]));
 await assert.rejects(compile(changed.replace('A simple chapter.','\\undefinedPreviewDraft'),true),/Build failed/);await compile(changed,true);await compile(changed,false);assert.doesNotMatch(compiler.navigation,/"glyph"/,'Turning off editing must discard character-bearing body checkpoints');
});


test('Literal spans beside inline math preserve every surrounding TeX byte',()=>{
 const file='main.tex',source='Hello $x+y$ world\n',characters=[];
 for(const column of [0,1,2,3,4,12,13,14,15,16])characters.push([file,1,column,1,10+6*column,20,5,8,source.charCodeAt(column)]);
 const nav={schema:1,sources:{},regions:[[file,1,1,10,20,110,8]],characters},pdf=characters.map(g=>[g[8],g[4],g[5],g[6],g[7]]),spans=proseSpans(nav,file,1,1,source,pdf);
 assert.equal(spans.length,2);assert.equal(spans[0].to,6);assert.equal(spans[1].from,12);assert.equal(nearestCaret(spans[0],53,24),undefined);assert.equal(nearestCaret(spans[1],53,24),undefined,'Math is not an editable gap between text spans');
 const edit=textChange(source,spans[0],5,5,'!');assert.ok(edit);assert.equal(source.slice(0,edit.from)+edit.insert+source.slice(edit.to),'Hello! $x+y$ world\n');
 assert.equal(textChange(source,spans[0],6,6,'',false,true),undefined,'Deletion cannot cross into the math delimiter');assert.equal(textChange(source,spans[1],12,12,'',true),undefined);
});
const {textBoundary,visualMove}=require('../dist/preview-edit');
test('UTF-8 columns, Unicode clusters, and ligature interiors preserve source boundaries',()=>{
 const file='main.tex',source='caf\u00e9 office',characters=[],pdf=[];
 const add=(column,length,code,x,y,w,h,unicode)=>{characters.push([file,1,column,1,x,y,w,h,code,length]);pdf.push([unicode??code,x+.2,y+.1,w-.3,h-.2]);};
 add(0,1,99,10,20,5,8);add(1,1,97,15,20,5,8);add(2,1,102,20,20,5,8);
 // Accent and base have the same exact UTF-8 interval, but different glyphs.
 add(3,2,19,25,18,5,10,180);pdf.pop();pdf.push([180,27,18,2,2]);add(3,2,101,25,22,5,6,101);
 add(6,1,111,34,20,5,8);add(7,3,14,39,20,12,8,0xfb03);add(10,1,99,51,20,5,8);add(11,1,101,56,20,5,8);
 const nav={schema:1,sources:{},regions:[[file,1,1,10,18,51,10]],characters},spans=proseSpans(nav,file,1,1,source,pdf);assert.equal(spans.length,1);const span=spans[0];assert.equal(span.to,source.length);
 assert.equal(nearestCaret(span,43.1,24),7,'A click one third through ffi points between its first two source letters');
 assert.equal(caretBox(span,7).x,43);assert.equal(ordinaryText('caf\u00e9 na\u00efve'),true);
 assert.deepEqual(textChange(source,span,4,4,'',true),{from:3,to:4,insert:'',head:3,end:10});
 assert.equal(textBoundary('a\ud83d\ude00b',3,-1),1);assert.equal(textBoundary('e\u0301b',0,1),2);
 const repeated={...nav,characters:[...characters,characters[0]]};assert.equal(proseLine(repeated,file,1,1,source,pdf),undefined);
 const wrong=pdf.map(p=>p[0]===180?[96,...p.slice(1)]:p);assert.equal(proseLine(nav,file,1,1,source,wrong),undefined,'An incorrect accent cannot be guessed from the nearby source');
 const badByte={...nav,characters:characters.map(g=>g[2]===3?[...g.slice(0,2),4,...g.slice(3)]:g)};assert.equal(proseLine(badByte,file,1,1,source,pdf),undefined,'A UTF-8 continuation byte is never a caret offset');
});

test('Visual arrows and Home/End use wrapped rows without crossing TeX boundaries',()=>{
 const glyphs=[];for(let i=0;i<10;i++)glyphs.push(['main.tex',1,i,1,10+(i%5)*5,20+Math.floor(i/5)*14,5,8,97,1]);
 const span={file:'main.tex',line:1,page:1,from:0,to:10,glyphs};const down=visualMove(span,2,'ArrowDown');assert.equal(down.head,7);assert.equal(down.box.y,34);assert.equal(visualMove(span,7,'ArrowUp',down.x,down.box).head,2);assert.equal(visualMove(span,2,'Home').head,0);assert.equal(visualMove(span,2,'End').head,5);assert.equal(visualMove(span,0,'ArrowUp'),undefined);
});

test('Compiler preserves argument, UTF-8, ligature, and reconstructed word origins',{timeout:90000},async t=>{
 const compiler=new ResidentCompiler();t.after(()=>compiler.stop());
 const source='\\documentclass{article}\n\\begin{document}\n\nHello \\textbf{bold office} and \\emph{italic file}.\n\nUnicode caf\u00e9 next and \\textbf{r\u00e9sum\u00e9}.\n\n'+('Ordinary words fill this wrapped paragraph with useful text. '.repeat(8))+'\n\n\\newcommand{\\twice}[1]{#1 #1}\\twice{reuse}\n\\newcommand{\\generated}{Invented}\\generated\n\\end{document}\n';
 const run=async text=>{await compiler.compile(text,new AbortController().signal,60000,()=>{},{characterMapping:true});return makeNavigation(compiler.navigation,'main.tex',text,[],{'main.tex':'main.tex'});};
 for(const text of [source,source.replace('bold office','bold offices')]){
  const nav=await run(text),line=text.split('\n')[3],utf8=text.split('\n')[5];
  assert.ok(nav.characters.some(g=>g[1]===4&&g[2]===line.indexOf('bold')&&g[8]===98));assert.ok(nav.characters.some(g=>g[1]===4&&g[9]===3),'ffi must retain three source bytes');
  for(const at of [utf8.indexOf('\u00e9'),utf8.indexOf('\u00e9',utf8.indexOf('textbf')),utf8.lastIndexOf('\u00e9')])assert.ok(nav.characters.some(g=>g[1]===6&&g[2]===Buffer.byteLength(utf8.slice(0,at))&&g[9]===2),'Unicode in ordinary and formatted text needs its exact UTF-8 interval');
  const columns=new Set(nav.characters.filter(g=>g[1]===8).flatMap(g=>Array.from({length:g[9]??1},(_,i)=>g[2]+i))),paragraph=text.split('\n')[7];for(let i=0;i<paragraph.length;i++)if(paragraph[i]!==' ')assert.ok(columns.has(i),'Reconstructed paragraph lost column '+i);
  assert.equal(nav.characters.filter(g=>g[1]===11).length,0,'Macro replacement text must not be assigned guessed editable columns');
  const reuse=nav.characters.filter(g=>g[1]===10&&g[2]===36);assert.equal(reuse.length,2,'Repeated arguments retain the ambiguity instead of claiming a unique location');
  if(text===source){
   const fs=require('node:fs/promises'),path=require('node:path'),directory=path.resolve('.test-output','prose-pixel-'+require('node:crypto').randomUUID());await fs.mkdir(directory,{recursive:true});
   const on=await compiler.compile(text,new AbortController().signal,60000,()=>{},{characterMapping:true}),off=await compiler.compile(text,new AbortController().signal,60000,()=>{},{characterMapping:false});await fs.writeFile(path.join(directory,'on.pdf'),on);await fs.writeFile(path.join(directory,'off.pdf'),off);
   for(const name of ['on','off'])await runProcess('pdftoppm',['-r','72',name+'.pdf',name],directory,30000,new AbortController().signal,()=>{});
   const files=(await fs.readdir(directory)).filter(name=>name.startsWith('on-')&&name.endsWith('.ppm'));assert.ok(files.length);for(const name of files)assert.equal(hash(await fs.readFile(path.join(directory,name))),hash(await fs.readFile(path.join(directory,name.replace('on-','off-')))),'Formatted text, Unicode and reconstructed words retain exact PDF pixels');
  }

 }
});
const {pageProse,visualMoveAcross}=require('../dist/preview-edit');
test('Display-row navigation can move between physical source lines without extending edit ranges',()=>{
 const file='main.tex',source='abc\ndef',characters=[],pdf=[];for(let line=1;line<=2;line++)for(let c=0;c<3;c++){const code=source.split('\n')[line-1].charCodeAt(c),g=[file,line,c,1,10+c*5,20+(line-1)*14,5,8,code,1];characters.push(g);pdf.push([code,...g.slice(4,8)]);}
 const nav={schema:1,sources:{},regions:[[file,1,1,10,20,15,8],[file,2,1,10,34,15,8]],characters},spans=pageProse(nav,file,1,source,pdf),move=visualMoveAcross(spans,spans[0],1,'ArrowDown');assert.equal(move.head,5);assert.equal(move.span.line,2);assert.equal(textChange(source,move.span,1,5,'x'),undefined,'A cross-line selection cannot delete the source newline');assert.equal(textChange(source,move.span,5,5,'x').from,5);
});
