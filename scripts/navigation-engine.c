/* Application-owned line navigation metadata; no changes to TeX nodes or PDF. */
/* Allocate provenance only for node ranges actually used by this document. */
static int **persistent_nav_chunks;
static int *persistent_navigation_entry(int p,int create) {
  if(p<memmin||p>memmax)return NULL;
  int index=p-memmin,chunk=index/256;
  if(!persistent_nav_chunks&&create)persistent_nav_chunks=calloc((size_t)(memmax-memmin+256)/256,sizeof(int *));
  if(!persistent_nav_chunks)return NULL;
  if(!persistent_nav_chunks[chunk]&&create)persistent_nav_chunks[chunk]=calloc(1024,sizeof(int));
  return persistent_nav_chunks[chunk]?persistent_nav_chunks[chunk]+4*(index%256):NULL;
}
static int persistent_origin[4],persistent_origin_token;
static int persistent_utf8[4],persistent_utf8_start,persistent_utf8_end,persistent_utf8_effective[4];
static int *persistent_utf8_frames;
static int persistent_utf8_frame_count;
void persistent_navigation_frame_clear(int depth) {
  if(persistent_utf8_frames&&depth>=0&&depth<=stacksize){
    if(persistent_utf8_frames[depth*4])persistent_utf8_frame_count--;
    persistent_utf8_frames[depth*4]=0;
  }
}
static int persistent_utf8_context(void) {
  /* The sparse frame array survives after an accent's expansion ends. Most
     subsequent macro tokens have no live Unicode owner: do not walk the
     entire input stack merely because that array was allocated earlier. */
  if(persistent_utf8_frames&&persistent_utf8_frame_count)for(int depth=inputptr;depth>=0;depth--){
    int *frame=persistent_utf8_frames+depth*4;
    if(frame[0]){memcpy(persistent_utf8_effective,frame,4*sizeof(int));return 1;}
  }
  if(!persistent_utf8[0])return 0;
  if(persistent_utf8_start){
    instaterecord origin=curinput;int level=inputptr;
    while(1){if(origin.statefield==0&&origin.startfield==persistent_utf8_start&&origin.locfield==persistent_utf8_end){memcpy(persistent_utf8_effective,persistent_utf8,4*sizeof(int));return 1;}if(level==0)break;origin=inputstack[--level];}
  }
  if(inopen<1||fullsourcefilenamestack[inopen]!=persistent_utf8[0]||line!=persistent_utf8[1])return 0;
  instaterecord origin=curinput;
  int level=inputptr;while(origin.statefield==0&&level>0)origin=inputstack[--level];
  if(origin.statefield!=0&&origin.locfield-origin.startfield==persistent_utf8[2]+persistent_utf8[3]){memcpy(persistent_utf8_effective,persistent_utf8,4*sizeof(int));return 1;}
  return 0;
}
void persistent_navigation_expansion_begin(int *origin) {
  origin[0]=0;
  if(persistent_origin[0]&&persistent_origin[3]>1){memcpy(origin,persistent_origin,4*sizeof(int));return;}
  int leading=persistent_origin_token>=4290&&persistent_origin_token<=4340&&persistent_origin[0]==persistent_utf8[0]&&persistent_origin[1]==persistent_utf8[1]&&persistent_origin[2]==persistent_utf8[2];
  if(persistent_utf8[0]&&leading)memcpy(origin,persistent_utf8,4*sizeof(int));
  else if((persistent_utf8_frame_count||persistent_utf8[0])&&persistent_utf8_context())memcpy(origin,persistent_utf8_effective,4*sizeof(int));
}
void persistent_navigation_expansion_end(int *origin) {
  if(origin[0]&&inputptr>=0&&inputptr<=stacksize){
    if(!persistent_utf8_frames)persistent_utf8_frames=calloc((size_t)stacksize+1,4*sizeof(int));
    if(persistent_utf8_frames){
      if(!persistent_utf8_frames[inputptr*4])persistent_utf8_frame_count++;
      memcpy(persistent_utf8_frames+inputptr*4,origin,4*sizeof(int));
    }
  }
}
void persistent_navigation_origin(int p,int *origin) {
  if(origin[0]&&abs(curlist.modefield)==104){int *entry=persistent_navigation_entry(p,1);if(entry)memcpy(entry,origin,4*sizeof(int));}
}
void persistent_navigation_backed_origin(int p,int *origin) {
  int *entry=persistent_navigation_entry(p,0);
  if(entry&&entry[0]&&entry[2]>=0)return;
  persistent_navigation_origin(p,origin);
}
void persistent_navigation_reset_token(void) {persistent_origin[0]=0;}
void persistent_navigation_read_token(int token) {
  persistent_origin[0]=0;
  if(persistent_tex_body_ready&&inopen>0&&curinput.locfield>curinput.startfield){
    int column=curinput.locfield-curinput.startfield-1,c=buffer[curinput.locfield-1];
    if(!(persistent_utf8[0]==fullsourcefilenamestack[inopen]&&persistent_utf8[1]==line&&column>persistent_utf8[2]&&column<persistent_utf8[2]+persistent_utf8[3])){
      persistent_utf8[0]=0;persistent_utf8_start=0;
      int length=c>=0xc2&&c<=0xdf?2:c>=0xe0&&c<=0xef?3:c>=0xf0&&c<=0xf4?4:0;
      if(token/256==13&&length&&curinput.locfield+length-2<=curinput.limitfield){
        int valid=1;for(int i=1;i<length;i++)if((buffer[curinput.locfield-1+i]&0xc0)!=0x80)valid=0;
        if(valid){persistent_utf8[0]=fullsourcefilenamestack[inopen];persistent_utf8[1]=line;persistent_utf8[2]=column;persistent_utf8[3]=length;}
      }
    }
  }
  if(!persistent_tex_body_ready||inopen<1||curinput.locfield<=curinput.startfield)return;
  int name=fullsourcefilenamestack[inopen];if(!name)return;
  persistent_origin[0]=name;persistent_origin[1]=line;
  persistent_origin[2]=curinput.locfield-curinput.startfield-1;persistent_origin[3]=1;
  persistent_origin_token=token/256==13?4096+token%256:token;
}
void persistent_navigation_list_token(int p) {
  if(!persistent_tex_body_ready){persistent_origin[0]=0;return;}
  int *entry=persistent_navigation_entry(p,0);persistent_origin[0]=0;
  if(entry&&entry[0]&&entry[2]>=0){
    memcpy(persistent_origin,entry,4*sizeof(int));persistent_origin_token=zmem[p].hh.v.LH;
    int byte=persistent_origin_token-4096,length=byte>=0xc2&&byte<=0xdf?2:byte>=0xe0&&byte<=0xef?3:byte>=0xf0&&byte<=0xf4?4:0;
    if(length){
      int node=p,valid=1;
      for(int i=0;i<length;i++){
        int *part=persistent_navigation_entry(node,0),value=node!=-268435455L?zmem[node].hh.v.LH-4096:-1;
        if(!part||part[0]!=entry[0]||part[1]!=entry[1]||part[2]!=entry[2]+i||(i>0&&(value<0x80||value>0xbf))){valid=0;break;}
        node=zmem[node].hh.v.RH;
      }
      if(valid){memcpy(persistent_utf8,entry,4*sizeof(int));persistent_utf8[3]=length;persistent_utf8_start=curinput.startfield;persistent_utf8_end=node;}
    }
  }
  if(!persistent_origin[0]&&(persistent_utf8_frame_count||persistent_utf8[0])&&persistent_utf8_context()){
    memcpy(persistent_origin,persistent_utf8_effective,4*sizeof(int));persistent_origin_token=zmem[p].hh.v.LH;
  }
}
void persistent_navigation_store_token(int p,int token) {
  /* Only literal letter/other tokens captured as arguments or backed up.
     Macro replacement text and synthesized tokens never gain provenance. */
  int valid=persistent_tex_body_ready&&persistent_origin[0]&&persistent_origin_token==token&&
    (token/256==11||token/256==12||(token>=4224&&token<=4351)||(persistent_origin[3]<0&&token>=4095));
  /* Clearing an unmapped/reused token needs no new sparse chunk. In
     particular preamble tokens never allocate character provenance. */
  int *entry=persistent_navigation_entry(p,valid);if(!entry)return;
  entry[0]=0;entry[2]=-1;entry[3]=1;
  if(valid)memcpy(entry,persistent_origin,4*sizeof(int));
}
static int persistent_character_mapping;
int persistentEnableCharacters(int enabled) {persistent_character_mapping=enabled;return 0;}
/* Token registers may replay collected math bodies. These additional origins
   are math-only: never turn a macro definition into editable literal prose. */
void persistent_navigation_scanned_math(int p,int token) {
  if(!persistent_character_mapping||curinput.statefield!=0||!persistent_origin[0]||persistent_origin[3]>1)return;
  persistent_navigation_store_token(p,token);
  int *entry=persistent_navigation_entry(p,0);if(entry&&entry[0])entry[3]=-abs(entry[3]);
}
/* Math fields carry a negative byte length, separate from prose records. */
void persistent_navigation_clear(int p) {
  int *entry=persistent_navigation_entry(p,0);if(entry){entry[0]=0;entry[2]=-1;entry[3]=1;}
}
void persistent_navigation_control_token(void) {
  if(!persistent_character_mapping||!persistent_tex_body_ready||!persistent_origin[0]||curinput.statefield==0)return;
  int at=curinput.startfield+persistent_origin[2],end=curinput.locfield;
  if(at<curinput.startfield||at>=end||buffer[at]!='\\')return;
  while(end>at+1&&buffer[end-1]==' ')end--;
  if(end-at>16)return;
  persistent_origin[3]=-(end-at);persistent_origin_token=4095+curcs;
}
void persistent_navigation_math(int p) {
  persistent_navigation_clear(p);
  if(!persistent_character_mapping||!persistent_tex_body_ready||abs(curlist.modefield)!=207||!persistent_origin[0])return;
  int token=curcs?4095+curcs:curcmd*256+curchr;
  if(token!=persistent_origin_token||persistent_origin[2]<0||persistent_origin[3]==0)return;
  int *entry=persistent_navigation_entry(p,1);if(entry){memcpy(entry,persistent_origin,4*sizeof(int));entry[3]=-abs(entry[3]);}
}
static FILE *persistent_nav_output;
static int persistent_nav_file, persistent_nav_line, persistent_nav_page;
static double persistent_nav_x, persistent_nav_y, persistent_nav_right, persistent_nav_bottom;

void persistent_navigation_tag(int p) {
  if (p < memmin || p > memmax) return;
  int *entry=persistent_navigation_entry(p,0),level=inopen;
  if(entry){entry[0]=entry[1]=0;entry[2]=-1;entry[3]=1;}
  if(!persistent_tex_body_ready)return;
  while (level>0 && !fullsourcefilenamestack[level]) level--;
  if (!level) return;
  int name=fullsourcefilenamestack[level], start=strstart[name], length=strstart[name+1]-start;
  /* Distribution macros are not editable project source. */
  if (length>0 && strpool[start]=='/' &&
      !((length>6&&!memcmp(strpool+start,"/work/",6)) ||
        (length>19&&!memcmp(strpool+start,"/project-resources/",19)))) return;
  entry=persistent_navigation_entry(p,1);if(!entry)return;
  entry[2]=-1;entry[3]=1;
  entry[0]=name;
  entry[1]=level==inopen?line:linestack[level+1];
  /* UTF-8 input expands through LaTeX macros, sometimes into separate accent
     and base glyphs. Tag that exact input interval only while its expansion
     still owns the underlying file position; the viewer verifies Unicode. */
  if(abs(curlist.modefield)==104&&(persistent_utf8_frame_count||persistent_utf8[0])&&persistent_utf8_context())memcpy(entry,persistent_utf8_effective,4*sizeof(int));
}
void persistent_navigation_character(int p) {
  persistent_navigation_tag(p);
  int *entry=persistent_navigation_entry(p,0);
  /* Only literal characters read directly from an input line in horizontal
     mode. Expanded tokens, math, generated characters and ligatures do not
     acquire a guessed source column. Columns are zero-based input bytes. */
  instaterecord origin=curinput;
  /* new_graf backs up exactly the paragraph's first literal token. */
  if(curinput.statefield==0&&curinput.indexfield==3&&curinput.locfield==-268435455L&&inputptr>0)
    origin=inputstack[inputptr-1];
  if(entry&&entry[0]&&origin.statefield!=0&&abs(curlist.modefield)==104&&
     (curcmd==11||curcmd==12)&&origin.locfield>origin.startfield&&
     origin.locfield<=origin.limitfield+1&&buffer[origin.locfield-1]==curchr)
    {entry[2]=origin.locfield-origin.startfield-1;entry[3]=1;}
  else if(entry&&abs(curlist.modefield)==104&&(curcmd==11||curcmd==12)&&
          persistent_origin[0]&&persistent_origin[3]>0&&persistent_origin_token==curcmd*256+curchr)
    memcpy(entry,persistent_origin,4*sizeof(int));
}
void persistent_navigation_copy(int from,int to) {
  int *source=persistent_navigation_entry(from,0),*target=persistent_navigation_entry(to,source&&source[0]);
  if(target){target[0]=source?source[0]:0;target[1]=source?source[1]:0;target[2]=source?source[2]:-1;target[3]=source?source[3]:1;}
}
void persistent_navigation_ligature(int q,int p) {
  persistent_navigation_copy(q,p);
  int *entry=persistent_navigation_entry(p,0);if(!entry||entry[2]<0)return;
  int column=entry[2],length=0,node=q;
  while(node!=-268435455L&&length<16){
    int *part=persistent_navigation_entry(node,0);
    if(node<himemmin||!part||part[0]!=entry[0]||part[1]!=entry[1]||part[2]!=column+length||part[3]!=1){entry[2]=-1;return;}
    length++;node=zmem[node].hh.v.RH;
  }
  if(node!=-268435455L||length<1){entry[2]=-1;return;}
  entry[3]=length;
}
/* TeX reconstructs words while considering hyphenation, even when the final
   line does not break there. Snapshot origins before freeing those nodes. */
static int persistent_hyphen_origins[64][5];
void persistent_navigation_hyphen_store(int index,int node,int character) {
  if(index<0||index>63)return;
  int *entry=persistent_navigation_entry(node,0),*target=persistent_hyphen_origins[index];
  memset(target,0,5*sizeof(int));if(entry)memcpy(target,entry,4*sizeof(int));target[4]=character;
}
void persistent_navigation_hyphen_restore(int index,int node,int character) {
  int *entry=persistent_navigation_entry(node,1);if(!entry)return;
  entry[0]=0;entry[2]=-1;entry[3]=1;
  if(index>=0&&index<=63&&persistent_hyphen_origins[index][4]==character)
    memcpy(entry,persistent_hyphen_origins[index],4*sizeof(int));
}
void persistent_navigation_flush(void) {
  if (!persistent_nav_file || !persistent_nav_output) return;
  fputs("[\"",persistent_nav_output);
  for(int k=strstart[persistent_nav_file];k<strstart[persistent_nav_file+1];k++) {
    unsigned char c=strpool[k];
    if(c=='"'||c=='\\')fputc('\\',persistent_nav_output);
    if(c<32)fprintf(persistent_nav_output,"\\u%04x",c);else fputc(c,persistent_nav_output);
  }
  fprintf(persistent_nav_output,"\",%d,%d,%.3f,%.3f,%.3f,%.3f]\n",persistent_nav_line,persistent_nav_page,
          persistent_nav_x,persistent_nav_y,persistent_nav_right-persistent_nav_x,persistent_nav_bottom-persistent_nav_y);
  persistent_nav_file=0;
}
void persistent_navigation_glyph(int p,int font,int character) {
  if (!isshippingpage) return;
  int *entry=persistent_navigation_entry(p,0);if(!entry)return;
  int file=entry[0],source_line=entry[1];
  if (!file || source_line<1) return;
  if (!persistent_nav_output) persistent_nav_output=fopen("/work/.persistent-tex/navigation.jsonl","wb");
  if (!persistent_nav_output) return;
  int info=fontinfo[charbase[font]+effectivechar(true,font,character)].qqqq.b0;
  int hd=fontinfo[charbase[font]+effectivechar(true,font,character)].qqqq.b1;
  double factor=72.0/(72.27*65536.0), x=curh*factor;
  double height=fontinfo[heightbase[font]+hd/16].cint*factor;
  double depth=fontinfo[depthbase[font]+hd%16].cint*factor;
  double y=curv*factor-height, right=x+fontinfo[widthbase[font]+info].cint*factor, bottom=curv*factor+depth;
  if(persistent_character_mapping&&entry[2]>=0) {
    fputs(entry[3]<0?"{\"mathGlyph\":[\"":"{\"glyph\":[\"",persistent_nav_output);
    for(int k=strstart[file];k<strstart[file+1];k++) {
      unsigned char ch=strpool[k];if(ch=='"'||ch=='\\')fputc('\\',persistent_nav_output);
      if(ch<32)fprintf(persistent_nav_output,"\\u%04x",ch);else fputc(ch,persistent_nav_output);
    }
    fprintf(persistent_nav_output,"\",%d,%d,%d,%.3f,%.3f,%.3f,%.3f,%d,%d]}\n",
      source_line,entry[2],totalpages+1,x,y,right-x,bottom-y,character,abs(entry[3]));
  }
  if (file!=persistent_nav_file || source_line!=persistent_nav_line || totalpages+1!=persistent_nav_page ||
      y>persistent_nav_bottom+3 || bottom<persistent_nav_y-3 || x<persistent_nav_x-1) {
    persistent_navigation_flush();persistent_nav_file=file;persistent_nav_line=source_line;persistent_nav_page=totalpages+1;
    persistent_nav_x=x;persistent_nav_y=y;persistent_nav_right=right;persistent_nav_bottom=bottom;
  } else {
    if(x<persistent_nav_x)persistent_nav_x=x;if(y<persistent_nav_y)persistent_nav_y=y;
    if(right>persistent_nav_right)persistent_nav_right=right;if(bottom>persistent_nav_bottom)persistent_nav_bottom=bottom;
  }
}
void persistent_navigation_finish(void) {
  persistent_navigation_flush();if(persistent_nav_output)fclose(persistent_nav_output);persistent_nav_output=NULL;
}
