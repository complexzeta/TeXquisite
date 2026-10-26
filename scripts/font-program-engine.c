/* Complete subset programs are reusable only for exact pre-parser inputs.
   Subset tags are registered afresh and patched in the unencrypted header. */
EM_JS(int,persistent_program_enabled,(void),{
 return typeof persistentFontProgramEnabled==='function'&&persistentFontProgramEnabled()?1:0;
});
static int persistent_program_pending;
EM_JS(int,persistent_program_lookup,(const char *file,const void *names,int names_length,const void *codes,int codes_length,const void *state,int state_length,const void *strings,int strings_length),{
 if(typeof persistentFontProgramGet!=='function')return 0;
 return persistentFontProgramGet(UTF8ToString(file),HEAPU8.subarray(names,names+names_length),HEAPU8.subarray(codes,codes+codes_length),HEAPU8.subarray(state,state+state_length),HEAPU8.subarray(strings,strings+strings_length));
});
EM_JS(void,persistent_program_read,(void *destination),{persistentFontProgramRead(HEAPU8,destination);});
EM_JS(void,persistent_program_store,(const void *bytes,int length),{
 if(typeof persistentFontProgramStore==='function')persistentFontProgramStore(HEAPU8.subarray(bytes,bytes+length));
});
typedef struct {integer lengths[3],tag_offset,glyphs,name_length,program_length;intparm dimensions[FONT_KEYS_NUM];} persistent_program_meta;
static int persistent_font_program_get(fd_entry *fd){
 persistent_program_pending=0;
 if(!persistent_encoding_fast||fb_offset()!=0||fd->subset_tag||!fd->gl_tree)return 0;
 if(!persistent_program_enabled())return 0;persistent_program_pending=1;
 struct avl_traverser t;char *glyph;size_t length=0;
 avl_t_init(&t,fd->gl_tree);for(glyph=avl_t_first(&t,fd->gl_tree);glyph;glyph=avl_t_next(&t))length+=strlen(glyph)+1;
 if(length>1048576)return 0;char *names=malloc(length?length:1),*p=names;if(!names)return 0;
 avl_t_init(&t,fd->gl_tree);for(glyph=avl_t_first(&t,fd->gl_tree);glyph;glyph=avl_t_next(&t)){size_t n=strlen(glyph)+1;memcpy(p,glyph,n);p+=n;}
 integer codes[256],count=0;if(fd->tx_tree){int *code;avl_t_init(&t,fd->tx_tree);for(code=avl_t_first(&t,fd->tx_tree);code;code=avl_t_next(&t)){if(count==256){free(names);return 0;}codes[count++]=*code;}}
 integer state[8+2*FONT_KEYS_NUM]={fd->all_glyphs,fd->write_ttf_glyph_names,fd->fm->slant,fd->fm->extend,fd->fm->type,fd->fm->fd_flags,fd->fm->pid,fd->fm->eid};
 for(int i=0;i<FONT_KEYS_NUM;i++){state[8+2*i]=fd->font_dim[i].val;state[9+2*i]=fd->font_dim[i].set;}
 const char *values[]={fd->fontname,fd->fm->tfm_name,fd->fm->sfd_name,fd->fm->ps_name,fd->fm->encname,fd->fm->ff_name};size_t strings_length=0;
 for(int i=0;i<6;i++)strings_length+=strlen(values[i]?values[i]:"")+1;
 char *strings=malloc(strings_length);if(!strings){free(names);return 0;}p=strings;for(int i=0;i<6;i++){const char *s=values[i]?values[i]:"";size_t n=strlen(s)+1;memcpy(p,s,n);p+=n;}
 int size=persistent_program_lookup(cur_file_name,names,length,codes,count*sizeof(integer),state,sizeof(state),strings,strings_length);free(names);free(strings);
 if(size<(int)sizeof(persistent_program_meta)||size>8388608)return 0;
 unsigned char *data=malloc(size);if(!data)return 0;persistent_program_read(data);persistent_program_meta meta;memcpy(&meta,data,sizeof(meta));p=(char *)data+sizeof(meta);
 xfree(fd->fontname);fd->fontname=xstrdup(p);p+=meta.name_length;
 fd->builtin_glyph_names=xtalloc(256,char *);for(int i=0;i<256;i++){fd->builtin_glyph_names[i]=strcmp(p,notdef)==0?notdef:xstrdup(p);p+=strlen(p)+1;}
 for(int i=0;i<meta.glyphs;i++){if(!avl_find(fd->gl_tree,p))avl_probe(fd->gl_tree,xstrdup(p));p+=strlen(p)+1;}
 make_subset_tag(fd);memcpy(fd->font_dim,meta.dimensions,sizeof(meta.dimensions));
 t1_length1=meta.lengths[0];t1_length2=meta.lengths[1];t1_length3=meta.lengths[2];
 persistent_fb_write((unsigned char *)p,meta.program_length);memcpy(fb_array+meta.tag_offset,fd->subset_tag,6);free(data);return 1;
}
static void persistent_font_program_save(fd_entry *fd){
 if(!persistent_program_pending)return;
 if(t1_synthetic||!fd->subset_tag||!fd->builtin_glyph_names||!fd->fontname||t1_fontname_offset<=0||t1_fontname_offset+6>t1_length1||memcmp(fb_array+t1_fontname_offset,fd->subset_tag,6))return;
 persistent_program_meta meta;memset(&meta,0,sizeof(meta));meta.lengths[0]=t1_length1;meta.lengths[1]=t1_length2;meta.lengths[2]=t1_length3;meta.tag_offset=t1_fontname_offset;meta.name_length=strlen(fd->fontname)+1;meta.program_length=fb_offset();memcpy(meta.dimensions,fd->font_dim,sizeof(meta.dimensions));
 size_t length=sizeof(meta)+meta.name_length+meta.program_length;for(int i=0;i<256;i++)length+=strlen(fd->builtin_glyph_names[i])+1;
 struct avl_traverser t;char *glyph;avl_t_init(&t,fd->gl_tree);for(glyph=avl_t_first(&t,fd->gl_tree);glyph;glyph=avl_t_next(&t)){meta.glyphs++;length+=strlen(glyph)+1;}
 if(length>8388608)return;unsigned char *data=malloc(length);if(!data)return;memcpy(data,&meta,sizeof(meta));char *p=(char *)data+sizeof(meta);memcpy(p,fd->fontname,meta.name_length);p+=meta.name_length;
 for(int i=0;i<256;i++){size_t n=strlen(fd->builtin_glyph_names[i])+1;memcpy(p,fd->builtin_glyph_names[i],n);p+=n;}
 avl_t_init(&t,fd->gl_tree);for(glyph=avl_t_first(&t,fd->gl_tree);glyph;glyph=avl_t_next(&t)){size_t n=strlen(glyph)+1;memcpy(p,glyph,n);p+=n;}
 memcpy(p,fb_array,meta.program_length);persistent_program_store(data,length);free(data);
}
