/* Select an actual TeX input frame. Empty name preserves root-file behavior. */
static char persistent_input_name[2048];
static int persistent_input_checkpoints,persistent_input_last_offset;
int persistentSelectInput(const char *name,int checkpoints) {
  size_t length=strlen(name);if(length>=sizeof(persistent_input_name))return 108;
  memcpy(persistent_input_name,name,length+1);persistent_input_checkpoints=checkpoints;persistent_input_last_offset=0;
  if(checkpoints)persistent_tex_body_offset=0;
  return 0;
}
int persistent_input_index(void) {
  if(!persistent_input_name[0])return 1;
  for(int level=inopen;level>0;level--){
    int name=fullsourcefilenamestack[level];if(name<=0||name>=strptr)continue;
    int start=strstart[name],length=strstart[name+1]-start;
    const unsigned char *p=strpool+start;
    if(length>=6&&!memcmp(p,"/work/",6)){p+=6;length-=6;}
    while(length>=2&&p[0]=='.'&&p[1]=='/'){p+=2;length-=2;}
    if((int)strlen(persistent_input_name)==length&&!memcmp(p,persistent_input_name,length)){persistent_input_last_offset=(int)ftell(inputfile[level]);return level;}
  }
  return 0;
}
int persistent_checkpoint_input(void){return persistent_input_checkpoints?persistent_input_index():1;}

int persistentSelectedOffset(void){int index=persistent_input_index();return index>0?(int)ftell(inputfile[index]):persistent_input_last_offset;}
