const {test}=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {capturePreviewFocus,previewFocusTarget}=require('../dist/navigation-query');
const digest=s=>createHash('sha256').update(s.replace(/\r\n/g,'\n')).digest('hex');
const file='main.tex',source='Before.\nTarget text.\n\\end{document}\n',nav={schema:1,sources:{[file]:digest(source)},regions:[[file,2,2,40,80,12,10]],characters:[[file,2,6,2,40,80,12,10,116]]},focus={line:2,column:7};
for(const change of ['word','delete','unicode','prefix','newline','far','footer','file','map','geometry'])test('Display-only focus is bound to the captured frame and source prefix: '+change,async()=>{
 const hint=capturePreviewFocus(nav,file,source,focus,digest);assert.ok(hint);let text=source,at=source.indexOf('text')+1,input=file,map=nav;
 if(change==='word'){text=source.replace('Target','Target newer');at=text.indexOf('text')+1;}
 if(change==='delete'){text=source.replace('Target','Tar');at=text.indexOf('text')+1;}
 if(change==='unicode'){text=source.replace('Target','Target é');at=text.indexOf('text')+1;}
 if(change==='prefix')text=source.replace('Before','Changed');
 if(change==='newline'){text=source.replace('Target','New\nTarget');at=text.indexOf('text')+1;}
 if(change==='far'){text=source.replace('Target','Target'+'x'.repeat(100));at=text.indexOf('text');}
 if(change==='footer')at=source.indexOf('\\end{document}');
 if(change==='file')input='other.tex';
 if(change==='map')map={...nav,sources:{[file]:'wrong'}};
 if(change==='geometry')hint.region[4]=NaN;
 const row=await previewFocusTarget(hint,map,input,text,at,async s=>digest(s));assert.equal(!!row,['word','delete','unicode'].includes(change));assert.equal(nav.sources[file],digest(source),'A hint never relabels the frame as current source');
});
test('Capturing focus rejects missing maps, outputless lines, invalid cursor and nearby footer fallback',()=>{
 assert.equal(capturePreviewFocus(undefined,file,source,focus,digest),undefined);
 for(const pos of [{line:3,column:1},{line:0,column:0},{line:2,column:999}])assert.equal(capturePreviewFocus(nav,file,source,pos,digest),undefined);
 assert.equal(capturePreviewFocus({...nav,characters:[],regions:[[file,3,2,40,800,12,10]]},file,source,focus,digest),undefined);
 assert.equal(capturePreviewFocus({...nav,sources:{[file]:'changed'}},file,source,focus,digest),undefined);
});

test('Real full frames carry their own captured focus without granting newer-source navigation',{timeout:60000},async t=>{
 const fs=require('node:fs/promises'),path=require('node:path'),{BuildController,ArtifactStore}=require('../dist/core');
 const dir=require('../scripts/test-artifacts.cjs').testDirectory('frame-focus'),root=path.join(dir,'source','main.tex'),text='\\documentclass{article}\n\\begin{document}\n\nTarget ordinary text.\n\n\\end{document}\n';await fs.mkdir(path.dirname(root),{recursive:true});await fs.writeFile(root,text);
 let entered,release;const began=new Promise(r=>entered=r),gate=new Promise(r=>release=r),frames=[];
 const controller=new BuildController(new ArtifactStore(path.join(dir,'store')),{prepare:async(bundle,pdf,map,hint)=>{frames.push({bundle,map,hint});if(frames.length===1){entered();await gate;}},commit:()=>{},discard:()=>{}},()=>{},()=>{});t.after(async()=>{release();await controller.dispose();});
 const options={root,sourceText:text,engine:'pdflatex',executable:'latexmk',characterMapping:true,automatic:true,timeoutMs:30000,focus:{line:4,column:6}},first=controller.request(options);await began;
 const newer=text.replace('Target','Target newest'),second=controller.request({...options,sourceText:newer});release();await Promise.all([first,second]);assert.equal(frames.length,2);
 for(const [i,f]of frames.entries()){const expected=i?newer:text;assert.equal(f.bundle.sourceHash,digest(expected));assert.equal(f.map.sources[root],digest(expected));assert.equal(f.hint.sourceHash,digest(expected));assert.equal(f.hint.line,4);assert.equal(f.hint.region[1],4);}
 const old=frames[0],at=newer.indexOf('newest')+6;assert.ok(await previewFocusTarget(old.hint,old.map,root,newer,at,async s=>digest(s)));
 assert.equal(old.map.sources[root],digest(text));assert.notEqual(old.map.sources[root],digest(newer),'Exact navigation identity remains stale for the newer editor source');
 const changed=newer.replace('article','report');assert.equal(await previewFocusTarget(old.hint,old.map,root,changed,changed.indexOf('newest')+6,async s=>digest(s)),undefined);
});

test('Display context permits continued typing on the checked line, but rejects intervening prefix changes',async()=>{
 const {previewFocusPrefix}=require('../dist/navigation-query'),hint=capturePreviewFocus(nav,file,source,focus,digest),at=source.indexOf('text')+1,checked=previewFocusPrefix(hint,file,source,at);
 let current=source,head=at;const pending=previewFocusTarget(hint,nav,file,source,at,async value=>{current=source.replace('Target','Target newer');head=current.indexOf('text')+1;return digest(value);});assert.ok(await pending);assert.equal(previewFocusPrefix(hint,file,current,head),checked);
 const changed=current.replace('Before','Changed');assert.notEqual(previewFocusPrefix(hint,file,changed,changed.indexOf('text')+1),checked);
 assert.equal(previewFocusPrefix(hint,file,current,current.indexOf('\\end{document}')),undefined);
});
test('CRLF frame focus can follow the editor LF line prefixes',async()=>{
 const windows=source.replaceAll('\n','\r\n'),hint=capturePreviewFocus(nav,file,windows,focus,digest);assert.ok(hint);assert.ok(await previewFocusTarget(hint,nav,file,source,source.indexOf('text')+1,async value=>digest(value)));
});
