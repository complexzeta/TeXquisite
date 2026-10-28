import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const root=(process.env.PERSISTENT_TEX_ENGINE_SOURCE_ROOT??'.research/swift-source/pdftex.wasm').replaceAll('\\','/').replace(/\/$/,'')+'/';
const baseline=process.env.PERSISTENT_TEX_ENGINE_BASELINE??'.research/swift-source';
async function patch(file,from,to){const source=execFileSync('git',['show','HEAD:pdftex.wasm/'+file],{cwd:baseline,encoding:'utf8'}).replace(/\r\n/g,'\n');if(!source.includes(from))throw new Error('Unexpected upstream source: '+file);const result=source.replace(from,to);if(await readFile(root+file,'utf8')!==result)await writeFile(root+file,result);}
await patch('tex/pdftexd.h','#define TeX','#define TeX\n#ifdef WEBASSEMBLY_BUILD\nextern int persistent_tex_checkpoint_cs;\nextern int persistent_tex_resuming;\nvoid persistent_tex_register_checkpoint(void);\nint persistent_tex_should_checkpoint(void);\nint persistent_tex_should_boundary(void);\nvoid persistent_tex_suspend_boundary(void);\nvoid persistent_tex_suspend(void);\n#endif');
await patch('tex/pdftex0.c','  if ( eqtb [27165 ].hh .v.RH != -268435455L ) \n  begintokenlist ( eqtb [27165 ].hh .v.RH , 12 ) ;\n  lab60: getxtoken () ;',`  #ifdef WEBASSEMBLY_BUILD
  if (!persistent_tex_resuming) persistent_tex_register_checkpoint();
  if (!persistent_tex_resuming)
  #endif
  if ( eqtb [27165 ].hh .v.RH != -268435455L )
  begintokenlist ( eqtb [27165 ].hh .v.RH , 12 ) ;
  #ifdef WEBASSEMBLY_BUILD
  persistent_tex_resuming = 0;
  #endif
  lab60:
  #ifdef WEBASSEMBLY_BUILD
  if (persistent_tex_should_boundary()) persistent_tex_suspend_boundary();
  #endif
  getxtoken () ;
  #ifdef WEBASSEMBLY_BUILD
  if (persistent_tex_should_checkpoint())
    persistent_tex_suspend();
  #endif`);
await patch('main.c','int compileLaTeX() {',`// Persistent TeX experimental checkpoint/resume additions.
int persistent_tex_checkpoint_cs = 0;
int persistent_tex_resuming = 0;
int persistent_tex_enabled = 0;
int persistent_tex_body_ready = 0;
int persistent_tex_body_offset = 0;
int persistent_tex_checkpoint_kind = 0;
int persistentCheckpointOffset(void) { return persistent_tex_body_offset; }
int persistentCheckpointKind(void) { return persistent_tex_checkpoint_kind; }
int persistentEnableCheckpoint(int enabled) {
  persistent_tex_enabled = enabled;
  return 0;
}
void persistent_tex_register_checkpoint(void) {
  persistent_tex_checkpoint_cs = 0;
  persistent_tex_body_ready = 0;
  persistent_tex_body_offset = 0;
}
int persistent_tex_should_checkpoint(void) {
  if (!persistent_tex_enabled || curcs < 514 || curcmd != 0) return 0;
  if (persistent_tex_checkpoint_cs) return curcs == persistent_tex_checkpoint_cs;
  strnumber name = hash[curcs].v.RH;
  if (name <= 0 || name >= strptr) return 0;
  int length = strstart[name + 1] - strstart[name];
  if (length != 23 || memcmp(strpool + strstart[name], "PersistentTeXCheckpoint", 23)) return 0;
  persistent_tex_checkpoint_cs = curcs;
  return 1;
}
void persistent_tex_suspend(void) {
  persistent_tex_checkpoint_kind = 0;
  persistent_tex_body_ready = 1;
  // Discard libc input read-ahead before snapshotting: later source bytes may
  // change, while the byte prefix ending at this checkpoint remains identical.
  for (int i = 1; i <= inopen; i++) {
    if (inputfile[i]) {
      long position = ftell(inputfile[i]);
      if (position >= 0) fseek(inputfile[i], position, SEEK_SET);
    }
  }
  fflush(NULL);
  uexit(100);
}
int persistent_tex_should_boundary(void) {
  if (!persistent_tex_enabled || !persistent_tex_body_ready || inopen != 1 ||
      (abs(curlist.modefield) != 1 && abs(curlist.modefield) != 104) ||
      curinput.statefield == 0 || outputactive || scannerstatus != 0)
    return 0;
  // The prefix includes the entire input line, including TeX's unread buffer.
  // The host may reuse this state only when all those bytes are unchanged.
  return ftell(inputfile[1]) > persistent_tex_body_offset;
}
void persistent_tex_suspend_boundary(void) {
  persistent_tex_checkpoint_kind = 1;
  persistent_tex_body_offset = (int)ftell(inputfile[1]);
  for (int i = 1; i <= inopen; i++) {
    if (inputfile[i]) {
      long position = ftell(inputfile[i]);
      if (position >= 0) fseek(inputfile[i], position, SEEK_SET);
    }
  }
  fflush(NULL);
  uexit(100);
}
int persistentResume(void) {
  persistent_tex_resuming = 1;
  exit_code = 0;
  if (setjmp(jmpenv) == 0) {
    maincontrol();
    finalcleanup();
    closefilesandterminate();
    readyalready = 0;
    uexit(history > 1 ? 1 : 0);
  }
  return exit_code;
}

int compileLaTeX() {`);
console.log('Checkpoint patch applied.');
// Extend the pristine-source-based checkpoint patch with provenance stored in
// separate arrays. All arrays, FILE state and output streams participate in
// the same checkpoint/restore mechanism as the compiler.
async function extend(file,replacements){let source=await readFile(root+file,'utf8');for(const [from,to,all]of replacements){if(!source.includes(from))throw Error('Unexpected navigation patch: '+file+' '+from.slice(0,60));source=all?source.replaceAll(from,to):source.replace(from,to);}await writeFile(root+file,source);}
await extend('tex/pdftexd.h',[['extern int persistent_tex_checkpoint_cs;',`void persistent_navigation_clear(int);
void persistent_navigation_control_token(void);
void persistent_navigation_math(int);
void persistent_navigation_scanned_math(int,int);
void persistent_native_zip_begin(void);
void persistent_navigation_frame_clear(int);
void persistent_navigation_backed_origin(int,int *);
void persistent_navigation_origin(int,int *);
void persistent_navigation_expansion_begin(int *);
void persistent_navigation_expansion_end(int *);
void persistent_navigation_hyphen_store(int,int,int);
void persistent_navigation_hyphen_restore(int,int,int);
void persistent_navigation_reset_token(void);
void persistent_navigation_read_token(int);
void persistent_navigation_list_token(int);
void persistent_navigation_store_token(int,int);
void persistent_navigation_ligature(int,int);
void persistent_navigation_character(int);
void persistent_navigation_tag(int);
void persistent_navigation_copy(int,int);
void persistent_navigation_glyph(int,int,int);
void persistent_navigation_flush(void);
void persistent_navigation_finish(void);
extern int persistent_tex_checkpoint_cs;`]]);
await extend('main.c',[
 ['    closefilesandterminate();','    closefilesandterminate();\n    persistent_navigation_finish();']
]);
// Keep token provenance beside TeX's token scanner so the optimizer can inline
// its small guards and sparse lookups without whole-program optimization.
await extend('tex/pdftex0.c',[
 ['#include "pdftexd.h"','#include "pdftexd.h"\nextern int persistent_tex_body_ready;\n'+await readFile('scripts/navigation-engine.c','utf8')]
]);
await extend('tex/pdftex0.c',[
 ['  Result = p ;\n  return Result ;\n} \nvoid \nzflushlist', '  persistent_navigation_tag(p);\n  Result = p ;\n  return Result ;\n} \nvoid \nzflushlist'],
 ['  Result = r ;\n  return Result ;\n} \nvoid \nzfreenode','  persistent_navigation_tag(r);\n  Result = r ;\n  return Result ;\n} \nvoid \nzfreenode'],
 ['    mem [q ].hh .v.RH = r ;\n    q = r ;\n    p = mem [p ].hh .v.RH ;','    persistent_navigation_copy(p,r);\n    mem [q ].hh .v.RH = r ;\n    q = r ;\n    p = mem [p ].hh .v.RH ;'],
 ['  mem [p ].hh.b0 = 6 ;\n  mem [p + 1 ].hh.b0 = f ;','  persistent_navigation_ligature(q,p);\n  mem [p ].hh.b0 = 6 ;\n  mem [p + 1 ].hh.b0 = f ;'],
 ['  mem [ligstack ].hh.b0 = mainf ;','  persistent_navigation_character(ligstack);\n  mem [ligstack ].hh.b0 = mainf ;',true],
 ['    pdfbeginstring ( f ) ;\n\t    pdfprintchar ( f , c ) ;','    persistent_navigation_glyph(p,f,c);\n            pdfbeginstring ( f ) ;\n\t    pdfprintchar ( f , c ) ;'],
 ['\tmem [memtop - 12 ]= mem [p + 1 ];','\tpersistent_navigation_copy(p,memtop-12);\n\tmem [memtop - 12 ]= mem [p + 1 ];',true],
 ['  if ( shippingpage ) \n  incr ( totalpages ) ;','  if ( shippingpage ) {persistent_navigation_flush();}\n  if ( shippingpage ) \n  incr ( totalpages ) ;']
]);
// Track the original literal tokens through argument collection and backinput.
await extend('tex/pdftex0.c',[
 ['  lab20: curcs = 0 ;','  lab20: persistent_navigation_reset_token(); curcs = 0 ;'],
 ['      lab21: curcmd = eqtb [27741 + curchr ].hh .v.RH ;','      lab21: curcmd = eqtb [27741 + curchr ].hh .v.RH ;\n      persistent_navigation_read_token(curcmd*256+curchr);'],
 ['    t = mem [curinput .locfield ].hh .v.LH ;','    persistent_navigation_list_token(curinput.locfield);\n    t = mem [curinput .locfield ].hh .v.LH ;']
]);
// Inlined free-list allocation must clear old provenance too.
{const file=root+'tex/pdftex0.c';let source=await readFile(file,'utf8');
 source=source.replace(/avail = mem \[([a-z]+) \]\.hh \.v.RH ;/g,(match,node)=>node==='avail'?match:match+' persistent_navigation_tag('+node+');');
 await writeFile(file,source);
}
// These functions allocate token-list cells, never visible character nodes.
// Preserve TeX's allocation exactly, clearing stale provenance without doing
// glyph/source-file classification. Ordinary glyph/box allocators keep their
// line tags (including generated math delimiters and line-navigation fallback).
{const file=root+'tex/pdftex0.c';let source=await readFile(file,'utf8');
 const a=source.indexOf('halfword \ngetavail ( void )'),b=source.indexOf('void \nzflushlist',a);
 if(a<0||b<0)throw Error('Token allocator boundaries');
 const allocator=source.slice(a,b).replace('halfword \ngetavail ( void )','static halfword \npersistent_token_getavail ( void )').replace('persistent_navigation_tag(p);','persistent_navigation_clear(p);');
 source=source.slice(0,b)+allocator+source.slice(b);
 for(const [start,end]of [['backinput ( void )','void \nbackerror'],['macrocall ( void )','void \nexpand'],['zstrtoks (','halfword \nthetoks'],['thetoks (','void \ninsthetoks'],['zscantoks (','void \nzreadtoks']]){
  const from=source.indexOf('\n'+start)+1,to=source.indexOf(end,from);if(from<1||to<0)throw Error('Token allocator scope: '+start);
  const section=source.slice(from,to).replace(/\bgetavail \(\)/g,'persistent_token_getavail ()').replace(/persistent_navigation_tag\(([a-z]+)\);/g,'persistent_navigation_clear($1);');
  source=source.slice(0,from)+section+source.slice(to);
 }
 await writeFile(file,source);
}
// Deliberately restrict writes to argument scanning and token backup. Definitions
// and token-producing primitives must not make their output directly editable.
{let file=root+'tex/pdftex0.c',source=await readFile(file,'utf8');
 for(const [start,end]of [['backinput ( void )','void \nbackerror'],['macrocall ( void )','void \nexpand']]){
  const a=source.indexOf(start),b=source.indexOf(end,a);if(a<0||b<0)throw Error('Token provenance boundaries');
  let segment=source.slice(a,b).replace(/mem \[([pq]) \]\.hh \.v.LH = curtok ;/g,'mem [$1 ].hh .v.LH = curtok ; persistent_navigation_store_token($1,curtok);');
  if(start==='backinput ( void )')segment=segment.replace('  halfword p  ;','  halfword p  ;\n  int persistent_unicode_origin[4]; persistent_navigation_expansion_begin(persistent_unicode_origin);').replace('persistent_navigation_store_token(p,curtok);','persistent_navigation_store_token(p,curtok); persistent_navigation_backed_origin(p,persistent_unicode_origin);');
  if(start==='macrocall ( void )')segment=segment.replace('  savescannerstatus = scannerstatus ;','  int persistent_unicode_origin[4]; persistent_navigation_expansion_begin(persistent_unicode_origin);\n  savescannerstatus = scannerstatus ;').replace('  begintokenlist ( refcount , 5 ) ;','  begintokenlist ( refcount , 5 ) ; persistent_navigation_expansion_end(persistent_unicode_origin);');
  source=source.slice(0,a)+segment+source.slice(b);
 }
 await writeFile(file,source);
}
await patch('tex/pdftexini.c','hu [hn ]= c ;','hu [hn ]= c ; persistent_navigation_hyphen_store(hn,s,c);');
// amsmath collects its body in a token register before replaying it. Preserve
// existing argument origins through scans/copies; fresh file definitions and
// generated tokens still do not acquire inferred provenance.
{const file=root+'tex/pdftex0.c';let source=await readFile(file,'utf8');
 const a=source.indexOf('zscantoks ('),b=source.indexOf('void \nzreadtoks',a);if(a<0||b<0)throw Error('Token scan boundaries');
 const section=source.slice(a,b).replaceAll('mem [q ].hh .v.LH = curtok ;','mem [q ].hh .v.LH = curtok ; persistent_navigation_scanned_math(q,curtok);');
 source=source.slice(0,a)+section+source.slice(b);
 const c=source.indexOf('thetoks ( void )'),d=source.indexOf('void \ninsthetoks',c);if(c<0||d<0)throw Error('Token register boundaries');
 const copy=source.slice(c,d).replace('mem [q ].hh .v.LH = mem [r ].hh .v.LH ;','mem [q ].hh .v.LH = mem [r ].hh .v.LH ; persistent_navigation_copy(r,q);');
 await writeFile(file,source.slice(0,c)+copy+source.slice(d));
}
await extend('tex/pdftexini.c',[
 ['hu [j ]= c ;','hu [j ]= c ; persistent_navigation_hyphen_store(j,q,c);']
]);
{const file=root+'tex/pdftex0.c';let source=await readFile(file,'utf8'),a=source.indexOf('zreconstitute ('),b=source.indexOf('void \nhyphenate',a);
 const section=source.slice(a,b)
 .replace('mem [t ].hh.b1 = mem [p ].hh.b1 ;','mem [t ].hh.b1 = mem [p ].hh.b1 ; persistent_navigation_copy(p,t);')
 .replace('mem [t ].hh.b1 = curl ;','mem [t ].hh.b1 = curl ; persistent_navigation_hyphen_restore(j,t,curl);')
 .replace('mem [p ].hh.b1 = hu [j + 1 ];','mem [p ].hh.b1 = hu [j + 1 ]; persistent_navigation_hyphen_restore(j+1,p,hu[j+1]);')
 .replace('mem [t ].hh.b1 = curr ;','mem [t ].hh.b1 = curr ; persistent_navigation_hyphen_restore(j+1,t,curr);');
 await writeFile(file,source.slice(0,a)+section+source.slice(b));
}
{const file=root+'tex/pdftex0.c';let source=await readFile(file,'utf8'),a=source.indexOf('makeaccent ( void )'),b=source.indexOf('void \nalignerror',a);
 const section=source.slice(a,b).replace('  scancharnum () ;','  int persistent_unicode_origin[4]; persistent_navigation_expansion_begin(persistent_unicode_origin);\n  scancharnum () ;')
 .replace('p = newcharacter ( f , curval ) ;','p = newcharacter ( f , curval ) ; persistent_navigation_origin(p,persistent_unicode_origin);')
 .replace('q = newcharacter ( f , curchr ) ;','{q = newcharacter ( f , curchr ) ; persistent_navigation_origin(q,persistent_unicode_origin);}')
 .replace('q = newcharacter ( f , curval ) ;','q = newcharacter ( f , curval ) ; persistent_navigation_origin(q,persistent_unicode_origin);');
 await writeFile(file,source.slice(0,a)+section+source.slice(b));
}
await extend('tex/pdftex0.c',[
 ['incr ( inputptr ) ;','incr ( inputptr ) ; persistent_navigation_frame_clear(inputptr);',true],
 ['  endtokenlist_regmem','  endtokenlist_regmem\n  persistent_navigation_frame_clear(inputptr);']
]);
// Preserve math-field provenance through conversion to final character nodes.
await extend('tex/pdftex0.c',[
 ['  lab40: curcmd = eqtb [curcs ].hh.b0 ;','  lab40: persistent_navigation_control_token(); curcmd = eqtb [curcs ].hh.b0 ;'],
 ['  mem [p + 2 ].hh = emptyfield ;','  mem [p + 2 ].hh = emptyfield ;\n  persistent_navigation_clear(p+1);persistent_navigation_clear(p+2);persistent_navigation_clear(p+3);'],
 ['  mem [p ].hh .v.RH = 1 ;\n  mem [p ].hh.b1 = c % 256 ;','  persistent_navigation_math(p);\n  mem [p ].hh .v.RH = 1 ;\n  mem [p ].hh.b1 = c % 256 ;'],
 ['    mem [p + 1 ].hh .v.RH = 1 ;\n    mem [p + 1 ].hh.b1 = c % 256 ;','    persistent_navigation_math(p+1);\n    mem [p + 1 ].hh .v.RH = 1 ;\n    mem [p + 1 ].hh.b1 = c % 256 ;'],
 ['      mem [curmlist + 1 ]= mem [p ];','      mem [curmlist + 1 ]= mem [p ]; persistent_navigation_copy(p,curmlist+1);'],
 ['p = newcharacter ( curf , curc ) ;','p = newcharacter ( curf , curc ) ; persistent_navigation_copy(q+1,p);'],
 ['mem [q + 3 ]= mem [p + 3 ];','mem [q + 3 ]= mem [p + 3 ]; persistent_navigation_copy(p+3,q+3);'],
 ['mem [q + 2 ]= mem [p + 2 ];','mem [q + 2 ]= mem [p + 2 ]; persistent_navigation_copy(p+2,q+2);'],
 ['mem [savestack [saveptr + 0 ].cint ].hh = mem [p + 1 ]\n\t\t.hh ;','mem [savestack [saveptr + 0 ].cint ].hh = mem [p + 1 ]\n\t\t.hh ; persistent_navigation_copy(p+1,savestack[saveptr].cint);']
]);
if(process.argv.includes('--debug-glyphs')){
 await patch('pdftexdir/tounicode.c','    aa = avl_probe(glyph_unicode_tree, gu);',`    if (!strcmp(buf,"A") || !strcmp(buf,"B") || !strcmp(buf,"Z")) fprintf(stderr,"GLYPH %s %s %ld %p\\n",buf,p,gu->code,gu);
    aa = avl_probe(glyph_unicode_tree, gu);`);
}else{
 await patch('pdftexdir/tounicode.c','    aa = avl_probe(glyph_unicode_tree, gu);','    aa = avl_probe(glyph_unicode_tree, gu);');
}
// Keep pdfTeX's requested compression level, but run its completed Flate streams
// through native zlib in the Node host. No TeX primitive or layout is changed.
await patch('pdftexdir/writezip.c','#define ZIP_BUF_SIZE  32768',await readFile('scripts/native-compression.c','utf8')+'\n#define ZIP_BUF_SIZE  32768');
await extend('pdftexdir/writezip.c',[
 ['    cur_file_name = NULL;','    cur_file_name = NULL;\n#ifdef WEBASSEMBLY_BUILD\n    if (persistent_native_zip_available()) {persistent_writezip(finish,level);return;}\n#endif'],
 ['void zip_free(void)\n{','void zip_free(void)\n{\n#ifdef WEBASSEMBLY_BUILD\n    free(persistent_zip_input);persistent_zip_input=NULL;persistent_zip_length=persistent_zip_capacity=0;\n#endif']
]);
await extend('tex/pdftex0.c',[
 ['  pdfstreamlength = 0 ;','  pdfstreamlength = 0 ; persistent_native_zip_begin();']
]);
// Paragraph fragments are copied from real post-linebreak output, before the
// page builder consumes it. Normal compilation keeps these hooks disabled.
await extend('tex/pdftexd.h',[
 ['extern int persistent_tex_checkpoint_cs;','int persistent_region_stop(void);\nvoid persistent_region_input(int);\nvoid persistent_region_paragraph(int,int);\nextern int persistent_tex_checkpoint_cs;']
]);
await extend('main.c',[
 ['int persistent_tex_should_boundary(void) {','int persistent_tex_should_boundary(void) {\n  if(persistent_region_stop())return 1;'],
 ['  persistent_tex_checkpoint_kind = 1;','  persistent_tex_checkpoint_kind = persistent_region_stop()?2:1;'],
 ['int compileLaTeX() {',await readFile('scripts/region-engine.c','utf8')+'\nint compileLaTeX() {']
]);
await extend('tex/pdftexini.c',[
 ['  postlinebreak ( d ) ;','  halfword persistent_paragraph_tail=curlist.tailfield;\n  postlinebreak ( d ) ;\n  persistent_region_paragraph(persistent_paragraph_tail,d);']
]);
await extend('tex/pdftex0.c',[
 ['\t    if ( inputln ( inputfile [curinput .indexfield ], true ) )','\t    persistent_region_input(curinput.indexfield);\n\t    if ( inputln ( inputfile [curinput .indexfield ], true ) )']
]);
await extend('tex/pdftexd.h',[
 ['int persistent_region_stop(void);','int persistent_page_stop(void);\nvoid persistent_page_input(int);\nvoid persistent_page_after_input(int);\nvoid persistent_page_token(int);\nint persistent_region_stop(void);']
]);
await extend('main.c',[
 ['  if(persistent_region_stop())return 1;','  persistent_local_poll();\n  if(persistent_page_stop()||persistent_region_stop())return 1;'],
 ['persistent_tex_checkpoint_kind = persistent_region_stop()?2:1;','persistent_tex_checkpoint_kind = persistent_page_stop()?3:persistent_region_stop()?2:1;'],
 ['int compileLaTeX() {',await readFile('scripts/page-engine.c','utf8')+'\nint compileLaTeX() {']
]);
await extend('tex/pdftexd.h',[['int persistent_page_stop(void);','void persistent_local_poll(void);\nint persistent_page_stop(void);']]);
await extend('tex/pdftex0.c',[
 ['persistent_region_input(curinput.indexfield);','persistent_region_input(curinput.indexfield);persistent_page_input(curinput.indexfield);'],
 ['firmuptheline ( void ) \n{','firmuptheline ( void ) \n{\n  persistent_page_after_input(curinput.indexfield);'],
 ['} \nvoid \nfirmuptheline ( void )','  persistent_page_token(curcs);\n} \nvoid \nfirmuptheline ( void )']
]);
await extend('tex/pdftexd.h', [['int persistent_region_stop(void);','int persistent_flow_holds_page(void);\nint persistent_region_stop(void);']]);
await extend('tex/pdftex0.c', [['buildpage ( void ) \n{','buildpage ( void ) \n{\n  if(persistent_flow_holds_page())return;']]);
await extend('tex/pdftexd.h',[['int persistent_region_stop(void);','void persistent_prefix_input(int);\nint persistent_prefix_active(void);\nint persistent_prefix_check(void);\nint persistent_prefix_take(void);\nint persistent_region_stop(void);']]);
await extend('main.c',[
 ['  if(persistent_page_stop()||persistent_region_stop())return 1;','  if(persistent_page_stop()||persistent_region_stop())return 1;\n  if(persistent_prefix_active())return persistent_prefix_check();'],
 ['  persistent_tex_checkpoint_kind = persistent_page_stop()?3:persistent_region_stop()?2:1;\n  persistent_tex_body_offset = (int)ftell(inputfile[1]);','  int prefix=persistent_prefix_take();\n  persistent_tex_checkpoint_kind = prefix>=0?4:persistent_page_stop()?3:persistent_region_stop()?2:1;\n  persistent_tex_body_offset = prefix>=0?prefix:(int)ftell(inputfile[1]);'],
 ['int compileLaTeX() {',await readFile('scripts/prefix-engine.c','utf8')+'\nint compileLaTeX() {']
]);
await extend('tex/pdftex0.c',[
 ['persistent_region_input(curinput.indexfield);persistent_page_input(curinput.indexfield);','persistent_region_input(curinput.indexfield);persistent_page_input(curinput.indexfield);persistent_prefix_input(curinput.indexfield);'],
 ['    if ( inputln ( inputfile [curinput .indexfield ], false ) )','    persistent_prefix_input(curinput.indexfield);\n    if ( inputln ( inputfile [curinput .indexfield ], false ) )']
]);


await patch('pdftexdir/utils.c','void fb_flush(void)',`void persistent_fb_write(const unsigned char *bytes,int length){
 alloc_array(fb,length,SMALL_ARRAY_SIZE);memcpy(fb_ptr,bytes,length);fb_ptr+=length;
}

void fb_flush(void)`);
await patch('pdftexdir/ptexlib.h','extern void fb_putchar(eightbits b);','extern void fb_putchar(eightbits b);\nextern void persistent_fb_write(const unsigned char *,int);');
await patch('pdftexdir/writet1.c','void writet1(fd_entry *fd)',await readFile('scripts/font-body-engine.c','utf8')+'\n'+await readFile('scripts/font-program-engine.c','utf8')+'\nstatic void persistent_original_writet1(fd_entry *fd)');
await extend('pdftexdir/writet1.c',[
 ['#include <string.h>','#include <string.h>\nstatic int persistent_encoding_fast;\nstatic int persistent_encoding_pair(const char *,int *,char *);\nstatic char **persistent_builtin_encoding(void);'],
 ['    glyph_names = t1_builtin_enc();','    glyph_names = persistent_builtin_encoding();'],
 ['sscanf(p, "dup %i%255s put", &i, t1_buf_array) == 2','(persistent_encoding_fast&&persistent_encoding_pair(p,&i,t1_buf_array)||sscanf(p, "dup %i%255s put", &i, t1_buf_array) == 2)'],
 ['    t1_subset_ascii_part();\n    t1_start_eexec();','    int program_history=history;\n    if(persistent_font_program_get(fd)){t1_close_font_file(">");return;}\n    t1_subset_ascii_part();\n    int body_start=fb_offset(),body_history=history;\n    char *body_fontname=xstrdup(fd->fontname);\n    if(persistent_font_body_get(fd)){if(history==program_history)persistent_font_program_save(fd);free(body_fontname);t1_close_font_file(">");return;}\n    t1_start_eexec();'],
 ['    t1_subset_end();\n    t1_close_font_file(">");','    t1_subset_end();\n    if(history==body_history&&strcmp(body_fontname,fd->fontname)==0)persistent_font_body_save(fd,body_start);\n    if(history==program_history&&strcmp(body_fontname,fd->fontname)==0)persistent_font_program_save(fd);\n    free(body_fontname);\n    t1_close_font_file(">");'],
 ['void t1_free(void)','void writet1(fd_entry *fd){persistent_encoding_fast=persistent_font_optimization_enabled();persistent_font_phase(0);persistent_original_writet1(fd);persistent_font_phase(1);persistent_encoding_fast=0; }\n\nvoid t1_free(void)']
]);

await extend('tex/pdftexd.h',[['int persistent_prefix_take(void);','int persistent_prefix_take(void);\nint persistent_font_memory_initial(void);\nint persistent_font_memory_reserve(int);']]);
await extend('main.c',[['int compileLaTeX() {',await readFile('scripts/font-memory-engine.c','utf8')+'\nint compileLaTeX() {']]);
await patch('kpseemu.c','*var = 8000000;','*var = persistent_font_memory_initial();');
await extend('tex/pdftex0.c',[
 ['if ( fmemptr == fontmemsize )','if ( ! persistent_font_memory_reserve(fmemptr+1) )'],
 ['if ( ( fontptr == fontmax ) || ( fmemptr + lf > fontmemsize ) )','if ( ( fontptr == fontmax ) || !persistent_font_memory_reserve(fmemptr+lf) )'],
 ['if ( ( fmemptr + nw + ni + nk >= fontmemsize ) )','if ( !persistent_font_memory_reserve(fmemptr+nw+ni+nk+1) )'],
 ['if ( ( fmemptr + lf >= fontmemsize ) )','if ( !persistent_font_memory_reserve(fmemptr+lf+1) )']
]);

// Actual included-file frames share the existing heap/stream snapshot machinery.
await extend('main.c',[
 ['int persistentCheckpointOffset(void)',(await readFile('scripts/input-engine.c','utf8'))+'\nint persistentCheckpointOffset(void)'],
 ['!persistent_tex_body_ready || inopen != 1 ||','!persistent_tex_body_ready || !persistent_checkpoint_input() || inopen != persistent_checkpoint_input() ||'],
 ['return ftell(inputfile[1]) > persistent_tex_body_offset;','return ftell(inputfile[persistent_checkpoint_input()]) > persistent_tex_body_offset;'],
 ['prefix>=0?prefix:(int)ftell(inputfile[1]);','prefix>=0?prefix:(int)ftell(inputfile[persistent_region_stop()?persistent_input_index():persistent_checkpoint_input()]);']
]);

// A native identity check replaces only the repeated stock-math guard loop.
await extend('tex/pdftexd.h', [['extern int persistent_tex_checkpoint_cs;', 'void persistent_math_command(void);\nvoid persistent_math_reset(void);\nextern int persistent_tex_checkpoint_cs;']]);
await extend('main.c', [['int compileLaTeX() {', (await readFile('scripts/tikz-math-engine.c','utf8'))+'\nint compileLaTeX() {'], ['void persistent_tex_register_checkpoint(void) {','void persistent_tex_register_checkpoint(void) {\n  persistent_math_reset();']]);
await extend('tex/pdftex0.c', [['  if (persistent_tex_should_checkpoint())','  persistent_math_command();\n  if (persistent_tex_should_checkpoint())']]);
