/* Optional kind-zero root-line reload. The host still verifies EVERY consumed
   source byte, project input, and dependency before restoring this snapshot. */
static int persistent_preamble_ready,persistent_preamble_frame;
static int persistent_preamble_start,persistent_preamble_location;
static int persistent_preamble_line,persistent_preamble_endchar;
static instaterecord *persistent_preamble_root(int *frame) {
  instaterecord *found=NULL;int count=0;
  if(curinput.statefield!=0&&curinput.indexfield==1&&curinput.namefield>19){found=&curinput;*frame=-1;count++;}
  for(int i=0;i<inputptr;i++)if(inputstack[i].statefield!=0&&inputstack[i].indexfield==1&&inputstack[i].namefield>19){found=&inputstack[i];*frame=i;count++;}
  return count==1?found:NULL;
}
int persistentPreambleMark(int line_start,int visible_length,int read_end) {
  persistent_preamble_ready=0;
  if(persistent_tex_checkpoint_kind!=0||inopen!=1||!inputfile[1]||outputactive||scannerstatus||line_start<0||visible_length<0||read_end<line_start+visible_length||ftell(inputfile[1])!=read_end)return -1;
  int frame=0;instaterecord *root=persistent_preamble_root(&frame);
  if(!root||root->startfield<0||root->locfield<root->startfield||root->locfield-root->startfield>visible_length||first!=root->limitfield+1)return -2;
  int length=root->limitfield-root->startfield;
  if(length!=visible_length&&length!=visible_length-1)return -3;
  /* Reject transformed ^^ input, ambiguous line origins and trimmed consumed
     bytes. Infer the end character from the line that was ACTUALLY read; a
     begin-document hook may since have changed the endlinechar primitive. */
  if(!persistent_prefix_matches(line_start,line_start+visible_length,buffer+root->startfield))return -4;
  persistent_preamble_frame=frame;persistent_preamble_line=line_start;
  persistent_preamble_start=root->startfield;persistent_preamble_location=root->locfield;
  persistent_preamble_endchar=length==visible_length?buffer[root->limitfield]:-1;
  persistent_preamble_ready=1;
  return line_start+root->locfield-root->startfield;
}
int persistentPreambleReload(void) {
  if(!persistent_preamble_ready||persistent_tex_checkpoint_kind!=0||inopen!=1||!inputfile[1]||outputactive||scannerstatus)return 107;
  int frame=0;instaterecord *root=persistent_preamble_root(&frame);
  if(!root||frame!=persistent_preamble_frame||root->startfield!=persistent_preamble_start||root->locfield!=persistent_preamble_location||first!=root->limitfield+1)return 107;
  if(fseek(inputfile[1],persistent_preamble_line,SEEK_SET))return 107;
  first=root->startfield;
  if(!inputln(inputfile[1],false)||last<persistent_preamble_location)return 107;
  root->limitfield=last;
  if(persistent_preamble_endchar<0)root->limitfield--;
  else buffer[root->limitfield]=persistent_preamble_endchar;
  root->locfield=persistent_preamble_location;first=root->limitfield+1;
  return 0;
}
