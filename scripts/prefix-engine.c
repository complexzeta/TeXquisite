/* Optional intra-line checkpoint. The normal paragraph checkpoint remains the
   fallback. No prefix may be reused unless the host verifies all consumed bytes. */
#include <emscripten.h>
EM_JS(int,persistent_prefix_matches,(int start,int end,const unsigned char *data),{
 return typeof persistentPrefixMatches==='function'&&persistentPrefixMatches(start,end,HEAPU8.subarray(data,data+end-start))?1:0;
});
static int persistent_prefix_wanted,persistent_prefix_stop,persistent_prefix_ready;
static int persistent_prefix_lower,persistent_prefix_upper,persistent_prefix_offset,persistent_prefix_previous;
static int persistent_prefix_line_start,persistent_prefix_endchar,persistent_prefix_external;
void persistent_prefix_input(int index){
 if(index==1&&inputfile[1]){
  persistent_prefix_line_start=(int)ftell(inputfile[1]);persistent_prefix_endchar=zeqtb[29325].cint;
  /* This is an optional probe for a checkpoint before the edit cursor. Once
     that line has passed, no later checkpoint can help. In particular do not
     expand an entire remaining TikZ plot merely to report no usable prefix.
     The host discards this probe and restores the immutable region state. */
  if(persistent_prefix_wanted&&persistent_prefix_line_start>persistent_prefix_upper)uexit(109);
 }
 else if(persistent_prefix_wanted)persistent_prefix_external=1;
}
int persistentPrefixConfigure(int lower,int upper){
 persistent_prefix_lower=lower;persistent_prefix_upper=upper;persistent_prefix_external=0;persistent_prefix_previous=-1;
 persistent_prefix_wanted=1;persistent_prefix_stop=persistent_prefix_ready=0;return 0;
}
int persistent_prefix_active(void){return persistent_prefix_wanted;}
int persistent_prefix_check(void){
 if(persistent_prefix_external||!persistent_region_enabled||persistent_region_count||inopen!=1||curinput.indexfield!=1||curinput.namefield<=19||curinput.statefield==0||curlist.modefield!=104||outputactive||scannerstatus||zeqtb[29305].cint>0)return 0;
 int offset=persistent_prefix_line_start+curinput.locfield-curinput.startfield;
 if(offset>persistent_prefix_upper||curinput.locfield>curinput.limitfield)return 0;
 if(offset>persistent_prefix_previous)persistent_prefix_previous=offset;
 if(offset<persistent_prefix_lower)return 0;
 if(!persistent_prefix_matches(persistent_prefix_line_start,offset,buffer+curinput.startfield))return 0;
 persistent_prefix_offset=offset;persistent_prefix_wanted=0;persistent_prefix_stop=persistent_prefix_ready=1;return 1;
}
int persistent_prefix_take(void){if(!persistent_prefix_stop)return -1;persistent_prefix_stop=0;return persistent_prefix_offset;}
int persistentPrefixPrevious(void){return persistent_prefix_previous;}
int persistentPrefixReload(void){
 if(!persistent_prefix_ready||inopen!=1||curinput.indexfield!=1||curinput.statefield==0||curlist.modefield!=104)return 107;
 int location=curinput.locfield;
 if(fseek(inputfile[1],persistent_prefix_line_start,SEEK_SET))return 107;
 first=curinput.startfield;
 if(!inputln(inputfile[1],false)||last<location)return 107;
 // Endlinechar belongs to the original line read, even if the consumed prefix
 // subsequently changed the primitive. The actual loader supplies raw bytes
 // and trims trailing spaces; a trimmed consumed prefix refuses this shortcut.
 curinput.limitfield=last;
 if(persistent_prefix_endchar<0||persistent_prefix_endchar>255)curinput.limitfield--;
 else buffer[curinput.limitfield]=persistent_prefix_endchar;
 first=curinput.limitfield+1;curinput.locfield=location;return 0;
}
