/* Reuse only the encrypted Type 1 body after the ordinary ASCII/encoding pass.
   The host owns exact keys and payloads outside the restorable TeX heap. */
#include <emscripten.h>
EM_JS(int,persistent_font_optimization_enabled,(void),{
 return typeof persistentFontOptimizationEnabled==='function'&&persistentFontOptimizationEnabled()?1:0;
});
/* Fast recognition of the canonical decimal encoding row. All other syntax,
   including octal, hex, unusual whitespace and long names, uses sscanf. */
static int persistent_encoding_pair(const char *p,int *index,char *name){
 if(strncmp(p,"dup ",4)!=0)return 0;p+=4;while(*p==' ')p++;
 if(*p<'0'||*p>'9'||(*p=='0'&&p[1]>='0'&&p[1]<='9'))return 0;
 int value=0;while(*p>='0'&&*p<='9'){value=value*10+*p++-'0';if(value>255)return 0;}
 if(*p!=' ')return 0;while(*p==' ')p++;if(*p!='/')return 0;
 const char *start=p;int length=0;
 while(*p&&*p!=' '&&*p!='\t'&&*p!='\r'&&*p!='\n'&&*p!='\v'&&*p!='\f'){if(++length>255)return 0;p++;}
 if(strncmp(p," put",4)!=0)return 0;
 memcpy(name,start,length);name[length]=0;*index=value;return 1;
}
EM_JS(int,persistent_font_body_lookup,(const char *file,const void *prefix,int prefix_length,const void *glyphs,int glyph_length,const void *state,int state_length),{
 if(typeof persistentFontBodyGet!=='function')return 0;
 return persistentFontBodyGet(UTF8ToString(file),HEAPU8.subarray(prefix,prefix+prefix_length),HEAPU8.subarray(glyphs,glyphs+glyph_length),HEAPU8.subarray(state,state+state_length));
});
EM_JS(void,persistent_font_body_read,(void *destination),{
 persistentFontBodyRead(HEAPU8,destination);
});
EM_JS(void,persistent_font_body_store,(const void *meta,int meta_length,const void *body,int body_length),{
 if(typeof persistentFontBodyStore==='function')persistentFontBodyStore(HEAPU8.subarray(meta,meta+meta_length),HEAPU8.subarray(body,body+body_length));
});
EM_JS(void,persistent_font_phase,(int phase),{
 if(typeof persistentFontPhase==='function')persistentFontPhase(phase);
});
EM_JS(int,persistent_encoding_lookup,(const char *file,const void *line,int line_length,const void *state,int state_length),{
 if(typeof persistentFontEncodingGet!=='function')return 0;
 return persistentFontEncodingGet(UTF8ToString(file),HEAPU8.subarray(line,line+line_length),HEAPU8.subarray(state,state+state_length));
});
EM_JS(void,persistent_encoding_read,(void *destination),{persistentFontEncodingRead(HEAPU8,destination);});
EM_JS(void,persistent_encoding_store,(const void *bytes,int length),{
 if(typeof persistentFontEncodingStore==='function')persistentFontEncodingStore(HEAPU8.subarray(bytes,bytes+length));
});
typedef struct {integer position,block,encoding,line_length,line_offset,buf_length,buf_offset;} persistent_encoding_meta;
static char **persistent_builtin_encoding(void){
 if(!persistent_encoding_fast||t1_in_eexec||t1_eexec_encrypt||t1_cs)return t1_builtin_enc();
 integer state[]={ftell(t1_file),t1_block_length,t1_pfa,t1_dr,t1_er,t1_scan,t1_synthetic,t1_lenIV};
 int size=persistent_encoding_lookup(cur_file_name,t1_line_array,t1_line_ptr-t1_line_array+1,state,sizeof(state));
 if(size>=(int)sizeof(persistent_encoding_meta)&&size<=1048576){
  unsigned char *data=malloc(size);if(!data)return t1_builtin_enc();persistent_encoding_read(data);
  persistent_encoding_meta meta;memcpy(&meta,data,sizeof(meta));
  if(fseek(t1_file,meta.position,SEEK_SET))pdftex_fail("cannot restore font encoding position");
  t1_line_ptr=t1_line_array;alloc_array(t1_line,meta.line_length,T1_BUF_SIZE);
  memcpy(t1_line_array,data+sizeof(meta),meta.line_length);t1_line_ptr=t1_line_array+meta.line_offset;
  t1_buf_ptr=t1_buf_array;alloc_array(t1_buf,meta.buf_length,T1_BUF_SIZE);
  memcpy(t1_buf_array,data+sizeof(meta)+meta.line_length,meta.buf_length);t1_buf_ptr=t1_buf_array+meta.buf_offset;
  char **names=xtalloc(256,char *),*p=(char *)data+sizeof(meta)+meta.line_length+meta.buf_length;
  for(int i=0;i<256;i++){names[i]=strcmp(p,notdef)==0?notdef:xstrdup(p);p+=strlen(p)+1;}
  t1_block_length=meta.block;t1_encoding=meta.encoding;t1_cslen=0;free(data);return names;
 }
 int prior_history=history;char **names=t1_builtin_enc();
 if(history==prior_history&&!t1_in_eexec&&!t1_eexec_encrypt&&!t1_cs&&!feof(t1_file)){
  persistent_encoding_meta meta={ftell(t1_file),t1_block_length,t1_encoding,t1_line_ptr-t1_line_array+1,t1_line_ptr-t1_line_array,strlen(t1_buf_array)+1,t1_buf_ptr-t1_buf_array};
  size_t length=sizeof(meta)+meta.line_length+meta.buf_length;for(int i=0;i<256;i++)length+=strlen(names[i])+1;
  if(length<=1048576){unsigned char *data=malloc(length);if(data){memcpy(data,&meta,sizeof(meta));memcpy(data+sizeof(meta),t1_line_array,meta.line_length);memcpy(data+sizeof(meta)+meta.line_length,t1_buf_array,meta.buf_length);char *p=(char *)data+sizeof(meta)+meta.line_length+meta.buf_length;for(int i=0;i<256;i++){size_t n=strlen(names[i])+1;memcpy(p,names[i],n);p+=n;}persistent_encoding_store(data,length);free(data);}}
 }
 return names;
}
typedef struct {integer lengths[3],synthetic;intparm dimensions[FONT_KEYS_NUM];} persistent_font_meta;
static int persistent_font_body_get(fd_entry *fd){
 struct avl_traverser t;char *glyph;size_t length=0;
 avl_t_init(&t,fd->gl_tree);
 for(glyph=avl_t_first(&t,fd->gl_tree);glyph;glyph=avl_t_next(&t))length+=strlen(glyph)+1;
 if(length>1048576)return 0;
 char *names=malloc(length?length:1),*next=names;if(!names)return 0;
 avl_t_init(&t,fd->gl_tree);
 for(glyph=avl_t_first(&t,fd->gl_tree);glyph;glyph=avl_t_next(&t)){size_t n=strlen(glyph)+1;memcpy(next,glyph,n);next+=n;}
 integer state[12+2*FONT_KEYS_NUM]={fd->all_glyphs,fd->fm->slant,fd->fm->extend,fd->fm->type,t1_er,t1_dr,t1_lenIV,t1_synthetic,t1_in_eexec,t1_block_length,t1_pfa,t1_scan};
 for(int i=0;i<FONT_KEYS_NUM;i++){state[12+2*i]=fd->font_dim[i].val;state[13+2*i]=fd->font_dim[i].set;}
 int size=persistent_font_body_lookup(cur_file_name,fb_array,fb_offset(),names,length,state,sizeof(state));free(names);
 if(size<=0)return 0;
 if(size<(int)sizeof(persistent_font_meta)||size>8388608)return 0;
 unsigned char *data=malloc(size);if(!data)return 0;
 persistent_font_body_read(data);persistent_font_meta meta;memcpy(&meta,data,sizeof(meta));
 t1_length1=meta.lengths[0];t1_length2=meta.lengths[1];t1_length3=meta.lengths[2];
 t1_synthetic=meta.synthetic;
 memcpy(fd->font_dim,meta.dimensions,sizeof(meta.dimensions));
 persistent_fb_write(data+sizeof(meta),size-sizeof(meta));free(data);return 1;
}
static void persistent_font_body_save(fd_entry *fd,int start){
 persistent_font_meta meta;memset(&meta,0,sizeof(meta));
 meta.lengths[0]=t1_length1;meta.lengths[1]=t1_length2;meta.lengths[2]=t1_length3;
 meta.synthetic=t1_synthetic;
 memcpy(meta.dimensions,fd->font_dim,sizeof(meta.dimensions));
 persistent_font_body_store(&meta,sizeof(meta),fb_array+start,fb_offset()-start);
}
