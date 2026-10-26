/* Bounded affected-page output. Restore the same immutable checkpoint for
   every edit and let TeX's real page builder/output routine ship the page.
   No synthetic end-document tokens or suffix-page reuse claims. */
static int persistent_page_enabled,persistent_page_target,persistent_page_end;
static int persistent_page_limit,persistent_page_phase;
static int persistent_page_first;
static int persistent_page_end_command;
static halfword persistent_page_end_meaning;
static long persistent_page_positions[1024];
static int persistent_page_read_bytes;
EM_JS(int,persistent_local_superseded,(),{
 return typeof persistentLocalSuperseded==='function'&&persistentLocalSuperseded()?1:0;
});
static unsigned persistent_local_poll_ticks;
void persistent_local_poll(void){
 /* A newer editor buffer can interrupt obsolete speculative work without
    terminating the resident worker. Never seal or publish this partial state;
    the next request restores its immutable checkpoint. */
 if((persistent_page_enabled||persistent_region_enabled)&&!(++persistent_local_poll_ticks&1023)&&persistent_local_superseded())uexit(110);
}
int persistentPageConfigure(int end,int target,int limit) {
  persistent_region_enabled=0;
  persistent_page_read_bytes=0;memset(persistent_page_positions,0,sizeof(persistent_page_positions));
  for(int i=1;i<=inopen&&i<1024;i++)if(inputfile[i])persistent_page_positions[i]=ftell(inputfile[i]);
  persistent_page_first=totalpages+1;
  if(target<persistent_page_first||target>persistent_page_first+2)return 106;
  persistent_page_enabled=1;persistent_page_target=persistent_page_first;
  persistent_page_end=end;persistent_page_limit=limit;persistent_page_phase=0;
  persistent_page_end_command=-1;persistent_page_end_meaning=0;
  for(int cs=514;cs<=hashtop;cs++){
    strnumber name=hash[cs].v.RH;
    if(name>0&&name<strptr&&strstart[name+1]-strstart[name]==11&&!memcmp(strpool+strstart[name],"enddocument",11)){
      persistent_page_end_command=zeqtb[cs].hh.b0;persistent_page_end_meaning=zeqtb[cs].hh.v.RH;break;
    }
  }
  return 0;
}
int persistent_page_stop(void) {
  if(!persistent_page_enabled)return 0;
  /* Input limits are checked immediately before and after reading each line.
     Inspecting ftell on every expanded macro crossed into MEMFS millions of
     times for a dense TikZ picture, although no page could stop in that mode. */
  if(totalpages>persistent_page_first+2||persistent_page_target>persistent_page_first+2)uexit(106);
  if(outputactive||scannerstatus!=0||curlist.modefield!=1)return 0;
  int selected=persistent_input_index();
  int safe=persistent_input_name[0]?(selected>0?inopen==selected:inopen==1):inopen==1;
  if(!persistent_page_phase&&safe&&selected>0&&inputfile[selected]&&ftell(inputfile[selected])>=persistent_page_end)persistent_page_phase=1;
  /* A paragraph can ship several pages before main control resumes. Wait
     until its contribution list is drained, then ship the page containing
     the remaining lines. One conservative extra page is preferable to
     claiming that an unshipped paragraph tail has been rendered. */
  if(persistent_page_phase==1&&safe&&zmem[memtop-1].hh.v.RH==-268435455L){persistent_page_phase=2;persistent_page_target=totalpages+1;}
  return persistent_page_phase==2&&totalpages>=persistent_page_target&&safe;
}
void persistent_page_after_input(int index) {
  if(!persistent_page_enabled||persistent_input_name[0]||index!=1||!inputfile[1]||curinput.namefield<=19)return;
  if(ftell(inputfile[1])>persistent_page_limit)uexit(104);
}
void persistent_page_input(int index) {
  if(!persistent_page_enabled||index<1||index>=1024||!inputfile[index])return;
  long at=ftell(inputfile[index]);
  if(persistent_input_name[0]){
    long delta=at-persistent_page_positions[index];if(delta>0)persistent_page_read_bytes+=delta;
    persistent_page_positions[index]=at;
    if(persistent_page_read_bytes>65536)uexit(104);
    if(index!=persistent_input_index())return;
  }else if(index!=1)return;
  if(at>=persistent_page_limit||(!persistent_page_phase&&at>=persistent_page_end))uexit(104);
}
void persistent_page_token(int cs) {
  if(!persistent_page_enabled)return;
  /* Intercept the LaTeX end-document macro before expansion, including a
     macro that calls it. The primitive stop command is fenced as well. */
  if(curcmd==14)uexit(105);
  if(curcmd>112&&curcmd==persistent_page_end_command&&curchr==persistent_page_end_meaning)uexit(105);
  if(cs<514)return;
  strnumber name=hash[cs].v.RH;
  if(name>0&&name<strptr&&strstart[name+1]-strstart[name]==11&&!memcmp(strpool+strstart[name],"enddocument",11))uexit(105);
}
int persistentPagePdf(void) {
  if(!persistent_page_stop()||totalpages<persistent_page_target||totalpages>persistent_page_first+2)return 102;
  persistent_page_enabled=0;exit_code=0;
  if(setjmp(jmpenv)==0){
    closefilesandterminate();persistent_navigation_finish();readyalready=0;
    uexit(history>1?1:0);
  }
  return exit_code;
}
int persistentPageFirst(void){return persistent_page_first;}
int persistentPageLast(void){return (int)totalpages;}
/* Temporarily remove the local page fence while the host snapshots an
   ordinary root-input boundary. Restoring that snapshot can continue the real
   document; the live preview reenables its fence before doing any more work.
   The ordinary checkpoint loop already accepts vertical and horizontal mode;
   retaining an in-picture boundary uses those same suspended-input guarantees.
   No finalization, synthetic tokens or format/node changes are involved. */
int persistentPageCheckpoint(int resume) {
  int horizontal=resume>=2,enable=resume&1;
  if((persistent_tex_checkpoint_kind!=1&&persistent_tex_checkpoint_kind!=3)||
     persistent_input_name[0]||inopen!=1||!inputfile[1]||feof(inputfile[1])||
     outputactive||scannerstatus!=0||(abs(curlist.modefield)!=1&&!(horizontal&&abs(curlist.modefield)==104)))return 102;
  if(enable){if(persistent_page_enabled)return 102;persistent_page_enabled=1;}
  else {if(!persistent_page_enabled)return 102;persistent_page_enabled=0;}
  return 0;
}
