/* Live paragraph output. No TeX end tokens, document hooks or output routine
   are evaluated to obtain this fragment. All mutation occurs after a restorable
   worker checkpoint; sealing the PDF container is deliberately separate. */
#include <emscripten.h>
EM_JS(int, persistent_region_digest, (const void *bytes, int length), {
  if (typeof persistentStateDigest !== 'function') return 0;
  return persistentStateDigest(HEAPU8.subarray(bytes, bytes + length)) ? 1 : 0;
});
static int persistent_region_enabled, persistent_region_first, persistent_region_last;
static int persistent_region_end, persistent_region_count, persistent_region_unsafe;
static int persistent_region_flow;
static halfword persistent_region_nodes = -268435455L;
static halfword persistent_region_live_tail = -268435455L;

int persistentRegionConfigure(int first, int last, int end) {
  persistent_region_enabled=1;persistent_region_flow=0;persistent_region_first=first;persistent_region_last=last;
  persistent_region_end=end;persistent_region_count=0;persistent_region_unsafe=0;
  persistent_region_nodes=-268435455L;return 0;
}
int persistentFlowConfigure(int first,int last,int end){persistentRegionConfigure(first,last,end);persistent_region_flow=1;persistent_region_live_tail=-268435455L;return 0;}
int persistent_flow_holds_page(void){return persistent_region_enabled&&persistent_region_flow&&persistent_region_count>0;}
int persistent_region_stop(void) {
  /* Expanded PGF commands spend most of their time in restricted horizontal
     mode. No region can stop there; avoid repeated libc/MEMFS seeks. */
  if(!persistent_region_enabled||curlist.modefield!=1||outputactive||scannerstatus!=0)return 0;
  int selected=persistent_input_index();
  return selected>0&&inopen==selected&&inputfile[selected]&&ftell(inputfile[selected])>=persistent_region_end;
}
void persistent_region_input(int index) {
  /* An unfinished argument/math group must not scan the unchanged suffix while
     looking for its closing token. Abort this speculative pass, not the document;
     its next attempt restores the original checkpoint. */
  if(persistent_region_enabled&&index==persistent_input_index()&&index>0&&inputfile[index]&&ftell(inputfile[persistent_input_index()])>=persistent_region_end)uexit(104);
}
static int persistent_region_safe(halfword p,int depth,int *budget) {
  if(depth>64)return 0;
  for(;p!=-268435455L;p=zmem[p].hh.v.RH) {
    if(--*budget<0)return 0;
    if(p>=himemmin)continue;
    int type=zmem[p].hh.b0;
    if(type==0||type==1){if(!persistent_region_safe(zmem[p+5].hh.v.RH,depth+1,budget))return 0;}
    else if(type==6){if(!persistent_region_safe(zmem[p+1].hh.v.RH,depth+1,budget))return 0;}
    else if(type==10){if(zmem[p+1].hh.v.RH!=-268435455L)return 0;} /* no leaders */
    else if(type!=2&&type!=7&&type!=9&&type!=11&&type!=12)return 0;
  }
  return 1;
}
void persistent_region_paragraph(halfword previous,int display) {
  if(!persistent_region_enabled||line<persistent_region_first||line>persistent_region_last||inopen!=persistent_input_index()||!persistent_input_index())return;
  if((display&&!persistent_region_flow)||curlist.modefield!=1||outputactive){persistent_region_unsafe=1;return;}
  if(++persistent_region_count!=1&&!persistent_region_flow){persistent_region_unsafe=1;return;}
  halfword first=zmem[persistent_region_flow&&persistent_region_live_tail!=-268435455L?persistent_region_live_tail:previous].hh.v.RH;int budget=100000;
  if(first==-268435455L||!persistent_region_safe(first,0,&budget)){persistent_region_unsafe=1;return;}
  halfword copy=copynodelist(first);
  if(persistent_region_nodes==-268435455L)persistent_region_nodes=copy;
  else{halfword last=persistent_region_nodes;while(zmem[last].hh.v.RH!=-268435455L)last=zmem[last].hh.v.RH;zmem[last].hh.v.RH=copy;}
  persistent_region_live_tail=curlist.tailfield;
}
int persistentRegionPdf(void) {
  if(!persistent_region_enabled||persistent_region_unsafe||(!persistent_region_flow&&persistent_region_count!=1)||persistent_region_nodes==-268435455L)return 102;
  if(persistent_region_flow&&persistent_region_live_tail!=-268435455L){
    halfword rest=zmem[persistent_region_live_tail].hh.v.RH;int budget=100000;
    if(!persistent_region_safe(rest,0,&budget))return 102;
    if(rest!=-268435455L){halfword last=persistent_region_nodes;while(zmem[last].hh.v.RH!=-268435455L)last=zmem[last].hh.v.RH;zmem[last].hh.v.RH=copynodelist(rest);}
  }
  persistent_region_enabled=0;exit_code=0;
  if(setjmp(jmpenv)==0){
    FILE *info=fopen("/work/.persistent-tex/region.json","wb");
    if(!info)return 103;
    fputs("{\"shape\":[",info);int separator=0,lines=0;
    for(halfword p=persistent_region_nodes;p!=-268435455L;p=zmem[p].hh.v.RH){
      int type=zmem[p].hh.b0;if(separator++)fputc(',',info);
      if(type==0||type==1){lines++;fprintf(info,"[%d,%ld,%ld,%ld,%ld]",type,(long)zmem[p+1].cint,(long)zmem[p+3].cint,(long)zmem[p+2].cint,(long)zmem[p+4].cint);}
      else if(type==10){halfword q=zmem[p+1].hh.v.LH;fprintf(info,"[10,%ld,%ld,%ld,%d,%d]",(long)zmem[q+1].cint,(long)zmem[q+2].cint,(long)zmem[q+3].cint,zmem[q].hh.b0,zmem[q].hh.b1);}
      else if(type==11||type==12)fprintf(info,"[%d,%ld]",type,(long)zmem[p+1].cint);
      else fprintf(info,"[%d]",type);
    }
    /* Remove only leading inter-paragraph/baseline glue from the fragment.
       It remains in shape, so placement can reject a changed footprint. */
    halfword first=persistent_region_nodes;
    while(first!=-268435455L&&zmem[first].hh.b0!=0&&zmem[first].hh.b0!=1)first=zmem[first].hh.v.RH;
    if(first==-268435455L){fclose(info);return 102;}
    halfword box=vpackage(copynodelist(first),0,1,1073741823L);
    scaled padding=1048576L; /* 16 TeX points; compositor crops this margin. */
    fprintf(info,"],\"lines\":%d,\"widthSp\":%ld,\"heightSp\":%ld,\"depthSp\":%ld,\"paddingSp\":%ld,\"page\":%ld",lines,(long)zmem[box+1].cint,(long)zmem[box+3].cint,(long)zmem[box+2].cint,(long)padding,(long)totalpages+1);
    if(persistent_region_flow){
      fputs(",\"everypar\":[",info);halfword p=zeqtb[27160].hh.v.RH;int tokens=0;
      if(p!=-268435455L)p=zmem[p].hh.v.RH;
      while(p!=-268435455L){if(tokens>=100000){fclose(info);return 102;}if(tokens++)fputc(',',info);fprintf(info,"%ld",(long)zmem[p].hh.v.LH);p=zmem[p].hh.v.RH;}
      fputc(']',info);
    }
    fputc('}',info);fclose(info);
    /* Hash the exact same table at the exact same point, before page-local
       overrides. The host reads this heap view synchronously without copying
       it through stdio/MEMFS. Standalone probes retain the file fallback. */
    if(!persistent_region_digest(zeqtb,((size_t)eqtbtop+1)*sizeof(memoryword))){
      FILE *state=fopen("/work/.persistent-tex/region-eqtb.bin","wb");
      if(!state)return 103;
      fwrite(zeqtb,sizeof(memoryword),(size_t)eqtbtop+1,state);fclose(state);
    }
    /* The worker is restored for the next edit. These page-local overrides
       never enter normal document compilation. */
    zeqtb[29913].cint=padding;zeqtb[29914].cint=padding;
    zeqtb[29916].cint=0;zeqtb[29917].cint=0;
    zeqtb[29918].cint=zmem[box+1].cint+2*padding;
    zeqtb[29919].cint=zmem[box+3].cint+zmem[box+2].cint+2*padding;
    pdfshipout(box,true);
    /* Finalize PDF resources/xref only. No finalcleanup/maincontrol/end hooks. */
    closefilesandterminate();persistent_navigation_finish();readyalready=0;
    uexit(history>1?1:0);
  }
  return exit_code;
}
