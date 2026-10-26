/* Exact stock-math guard. TeX validates canonical definitions once, then keeps
   reference aliases alive. Comparing command/meaning identities is sufficient:
   an ordinary redefinition cannot recycle a token list still held by an alias.
   All state is in the snapshotted Wasm heap. No numerical evaluator changes. */
EM_JS(void,persistent_math_trace,(int stage,int a,int b),{if(typeof persistentMathGuardTrace==='function')persistentMathGuardTrace(stage,a,b);});
EM_JS(void,persistent_math_trace_name,(const char *bytes,int length,int a,int b),{if(typeof persistentMathGuardTrace==='function')persistentMathGuardTrace(UTF8ToString(bytes,length),a,b);});
EM_JS(int,persistent_math_lookup,(const char *expression,int mode,char *output),{
  if(typeof persistentMathLookup!=='function')return 0;
  try{
    const value=persistentMathLookup(UTF8ToString(expression),mode);
    if(typeof value!=='string'||value.length>32||! /^-?(?:[0-9]+(?:[.][0-9]*)?|[.][0-9]+)$/.test(value))return 0;
    stringToUTF8(value,output,34);return value.length;
  }catch{return 0;}
});
EM_JS(int,persistent_math_plan,(const char *expression,int mode,char *output),{
  if(typeof persistentMathPlan!=='function')return 0;
  try{const plan=persistentMathPlan(UTF8ToString(expression),mode);if(typeof plan!=='string'||plan.length>512)return 0;stringToUTF8(plan,output,514);return plan.length;}catch{return 0;}
});
typedef struct {halfword actual,reference,value;quarterword command;} persistent_math_pair;
static persistent_math_pair persistent_math_pairs[2048];
static int persistent_math_count;
static halfword persistent_math_check_cs,persistent_math_capture_cs;
static halfword persistent_math_ok_cs,persistent_math_one_cs,persistent_math_zero_cs;
static halfword persistent_math_expression_cs;
static halfword persistent_math_native_value_cs,persistent_math_empty_cs,persistent_math_mode_cs;
static halfword persistent_math_plan_cs,persistent_math_multiply_cs,persistent_math_divide_cs,persistent_math_sin_cs,persistent_math_cos_cs,persistent_math_pgf_result_cs;
static halfword persistent_math_add_cs,persistent_math_subtract_cs,persistent_math_neg_cs,persistent_math_let_cs,persistent_math_slots[16];
static halfword persistent_math_sub_sin_cs,persistent_math_sub_cos_cs;
static halfword persistent_math_globaldefs_index;
int persistentMathGuardVersion(void){return 5;}
int persistentMathGuardCount(void){return persistent_math_count;}
void persistent_math_reset(void){persistent_math_count=0;persistent_math_check_cs=persistent_math_capture_cs=0;}
static halfword persistent_math_find(const char *name){
  size_t length=strlen(name);unsigned char saved[96];if(length>=sizeof(saved))return 0;
  memcpy(saved,buffer,length);memcpy(buffer,name,length);
  halfword cs=idlookup(0,length);memcpy(buffer,saved,length);return cs;
}
static int persistent_math_named(halfword cs,const char *name){
  if(cs<514||cs>hashtop)return 0;strnumber s=hash[cs].v.RH;
  return s>0&&s<strptr&&strstart[s+1]-strstart[s]==strlen(name)&&!memcmp(strpool+strstart[s],name,strlen(name));
}
static void persistent_math_result(int safe){
  halfword value=safe?persistent_math_one_cs:persistent_math_zero_cs;
  if(!persistent_math_ok_cs||!value)return;
  quarterword command=zeqtb[value].hh.b0;halfword meaning=zeqtb[value].hh.v.RH;
  if(zeqtb[persistent_math_ok_cs].hh.b0==command&&zeqtb[persistent_math_ok_cs].hh.v.RH==meaning)return;
  if(command>=113)incr(zmem[meaning].hh.v.LH);
  eqdefine(persistent_math_ok_cs,command,meaning);
}
/* Install an ordinary local macro, using TeX's reference-counted token list
   representation. It is only a return value; never executable source. */
static void persistent_math_clear(halfword cs){
    if(!cs)return;
    halfword meaning=zeqtb[persistent_math_empty_cs].hh.v.RH;
    if(zeqtb[persistent_math_empty_cs].hh.b0<113)return;
    incr(zmem[meaning].hh.v.LH);eqdefine(cs,113,meaning);
}
static void persistent_math_program(halfword cs,const halfword *tokens,int length){
  halfword head=getavail(),tail=head;
  zmem[head].hh.v.LH=0;
  halfword p=getavail();zmem[p].hh.v.LH=3584;zmem[tail].hh.v.RH=p;tail=p;
  for(int i=0;i<length;i++){
    p=getavail();zmem[p].hh.v.LH=tokens[i];zmem[tail].hh.v.RH=p;tail=p;
  }
  zmem[tail].hh.v.RH=-268435455L;eqdefine(cs,113,head);
}
static void persistent_math_value(const char *number,int length){
  if(!length){persistent_math_clear(persistent_math_native_value_cs);return;}
  halfword tokens[32];for(int i=0;i<length;i++)tokens[i]=3072+(unsigned char)number[i];
  persistent_math_program(persistent_math_native_value_cs,tokens,length);
}
static int persistent_math_decimal(const char *s){
  int length=strlen(s),dots=0,digits=0;if(length<1||length>18)return 0;
  if(length>1&&s[0]=='0'&&s[1]!='.')return 0;
  for(int i=0;i<length;i++)if(s[i]>='0'&&s[i]<='9')digits++;else if(s[i]=='.'&&i>0&&i<length-1)dots++;else return 0;
  return digits&&dots<=1&&atof(s)<=10000;
}
static int persistent_math_argument(halfword *tokens,int n,const char *number){
  tokens[n++]=379;
  if(number)for(int i=0;number[i];i++)tokens[n++]=3072+(unsigned char)number[i];
  else tokens[n++]=4095+persistent_math_pgf_result_cs;
  tokens[n++]=637;return n;
}
typedef struct {const char *literal;halfword cs;} persistent_math_operand;
/* Replayed literals are exact guarded trig results, never evaluator output
   computed by the host. Unlike source literals they may be signed. */
static int persistent_math_replayed(const char *s){
  int length=strlen(s),dots=0,digits=0;if(length<1||length>32)return 0;
  for(int i=0;i<length;i++)if(s[i]>='0'&&s[i]<='9')digits++;else if(s[i]=='.')dots++;else if(s[i]=='-'&&i==0){}else return 0;
  return digits&&dots<=1&&fabs(atof(s))<=2;
}
static int persistent_math_record_key(const char *s){
  int length=strlen(s);if(length<2||length>256||length%2)return 0;
  for(int i=0;i<length;i++)if(!strchr("0123456789abcdefABCDEF",s[i]))return 0;
  return 1;
}
static int persistent_math_stack_argument(halfword *tokens,int n,persistent_math_operand value){
  tokens[n++]=379;
  if(value.literal)for(int i=0;value.literal[i];i++)tokens[n++]=3072+(unsigned char)value.literal[i];
  else tokens[n++]=4095+value.cs;
  tokens[n++]=637;return n;
}
static void persistent_math_stack_plan(char *plan){
  halfword tokens[2048];persistent_math_operand stack[16];int depth=0,n=0,ops=0,instructions=0;
  char *item=plan+2;
  while(item&&*item){
    char *next=strchr(item,';');if(next)*next++=0;
    if(++instructions>48)return;
    if(item[0]=='v'||item[0]=='r'){
      if(depth>=16||(item[0]=='v'?!persistent_math_decimal(item+1):!persistent_math_replayed(item+1)))return;
      stack[depth++]=(persistent_math_operand){item+1,0};
    }else{
      char op=item[0];int arity=(op=='s'||op=='c'||op=='n')?1:2;
      int recording=(op=='s'||op=='c')&&item[1];
      if(!op||!strchr("scn+-*/",op)||(recording?!persistent_math_record_key(item+1):item[1]!=0)||++ops>16||n+384>2048)return;
      if(depth<arity)return;
      halfword fn=op=='s'?(recording?persistent_math_sub_sin_cs:persistent_math_sin_cs):op=='c'?(recording?persistent_math_sub_cos_cs:persistent_math_cos_cs):op=='n'?persistent_math_neg_cs:op=='+'?persistent_math_add_cs:op=='-'?persistent_math_subtract_cs:op=='*'?persistent_math_multiply_cs:persistent_math_divide_cs;
      tokens[n++]=4095+fn;
      for(int i=depth-arity;i<depth;i++)n=persistent_math_stack_argument(tokens,n,stack[i]);
      if(recording)n=persistent_math_argument(tokens,n,item+1);
      depth-=arity;
      tokens[n++]=4095+persistent_math_let_cs;tokens[n++]=4095+persistent_math_slots[depth];tokens[n++]=4095+persistent_math_pgf_result_cs;
      stack[depth]=(persistent_math_operand){NULL,persistent_math_slots[depth]};depth++;
    }
    if(next&&!*next)return;item=next;
  }
  if(depth!=1)return;
  if(!ops){if(stack[0].literal&&persistent_math_replayed(stack[0].literal))persistent_math_value(stack[0].literal,strlen(stack[0].literal));return;}
  persistent_math_program(persistent_math_plan_cs,tokens,n);
}
static void persistent_math_make_plan(const char *expression,int mode){
  char plan[514];int length=persistent_math_plan(expression,mode,plan);
  if(length>2&&length<=512&&plan[0]=='P'&&plan[1]=='|'){persistent_math_stack_plan(plan);return;}
  if(length<8||length>80||(plan[0]!='S'&&plan[0]!='C')||(plan[1]!='*'&&plan[1]!='/')||plan[2]!='|')return;
  char *a=plan+3,*b=strchr(a,'|');if(!b)return;*b++=0;char *outer=strchr(b,'|');if(!outer)return;*outer++=0;
  if(!persistent_math_decimal(a)||!persistent_math_decimal(b)||!persistent_math_decimal(outer)||atof(a)*atof(b)>10000||plan[1]=='/'&&atof(outer)<0.00002)return;
  halfword tokens[128];int n=0;
  tokens[n++]=4095+persistent_math_multiply_cs;n=persistent_math_argument(tokens,n,a);n=persistent_math_argument(tokens,n,b);
  tokens[n++]=4095+(plan[0]=='S'?persistent_math_sin_cs:persistent_math_cos_cs);n=persistent_math_argument(tokens,n,NULL);
  tokens[n++]=4095+(plan[1]=='*'?persistent_math_multiply_cs:persistent_math_divide_cs);
  n=persistent_math_argument(tokens,n,plan[1]=='*'?outer:NULL);n=persistent_math_argument(tokens,n,plan[1]=='*'?NULL:outer);
  persistent_math_program(persistent_math_plan_cs,tokens,n);
}
void persistent_math_command(void){
  if(curcmd!=0||curcs<514)return;
  if(!persistent_math_capture_cs&&persistent_math_named(curcs,"TxqMathCapture")){
    persistent_math_capture_cs=curcs;persistent_math_check_cs=persistent_math_find("TxqMathCheck");
  }
  if(curcs==persistent_math_capture_cs){
    persistent_math_trace(1,curcs,persistent_math_check_cs);
    persistent_math_count=0;
    persistent_math_ok_cs=persistent_math_find("TxqMathOK");
    persistent_math_one_cs=persistent_math_find("TxqMathOne");
    persistent_math_zero_cs=persistent_math_find("TxqMathZero");
    persistent_math_expression_cs=persistent_math_find("pgfmath@expression");
    persistent_math_native_value_cs=persistent_math_find("TxqMathNativeValue");
    persistent_math_empty_cs=persistent_math_find("TxqMathEmpty");
    persistent_math_mode_cs=persistent_math_find("pgfmath@trig@format@choice");
    persistent_math_plan_cs=persistent_math_find("TxqMathNativePlan");
    persistent_math_multiply_cs=persistent_math_find("pgfmathmultiply@");persistent_math_divide_cs=persistent_math_find("pgfmathdivide@");
    persistent_math_sin_cs=persistent_math_find("pgfmathsin@");persistent_math_cos_cs=persistent_math_find("pgfmathcos@");persistent_math_pgf_result_cs=persistent_math_find("pgfmathresult");
    persistent_math_sub_sin_cs=persistent_math_find("TxqMathSubSin");persistent_math_sub_cos_cs=persistent_math_find("TxqMathSubCos");
    persistent_math_add_cs=persistent_math_find("pgfmathadd@");persistent_math_subtract_cs=persistent_math_find("pgfmathsubtract@");persistent_math_neg_cs=persistent_math_find("pgfmathneg@");persistent_math_let_cs=persistent_math_find("let");
    for(int i=0;i<16;i++){char name[32];sprintf(name,"TxqMathStack%c",'A'+i);persistent_math_slots[i]=persistent_math_find(name);}
    persistent_math_clear(persistent_math_plan_cs);
    persistent_math_value(NULL,0);
    persistent_math_globaldefs_index=zeqtb[persistent_math_find("globaldefs")].hh.v.RH;
    halfword list=persistent_math_find("TxqMathNativePairs");
    if(zeqtb[list].hh.b0<113){persistent_math_trace(2,list,zeqtb[list].hh.b0);return;}
    halfword p=zmem[zeqtb[list].hh.v.RH].hh.v.RH,actual=0;int tokens=0;
    if(p==-268435455L||zmem[p].hh.v.LH!=3584)return;
    p=zmem[p].hh.v.RH; /* end_match_token precedes an argument-free macro body */
    while(p!=-268435455L&&++tokens<=4096){
      halfword token=zmem[p].hh.v.LH;p=zmem[p].hh.v.RH;
      if(token==2592)continue;
      if(token<4095){persistent_math_trace(3,token,persistent_math_count);persistent_math_count=0;return;}
      halfword cs=token-4095;if(cs<514||cs>eqtbtop){persistent_math_count=0;return;}
      if(!actual){actual=cs;continue;}
      if(persistent_math_count>=2048||zeqtb[actual].hh.b0!=zeqtb[cs].hh.b0||zeqtb[actual].hh.v.RH!=zeqtb[cs].hh.v.RH){persistent_math_trace(4,actual,cs);strnumber sn=hash[actual].v.RH;persistent_math_trace_name((const char *)strpool+strstart[sn],strstart[sn+1]-strstart[sn],zeqtb[actual].hh.v.RH,zeqtb[cs].hh.v.RH);persistent_math_count=0;return;}
      persistent_math_pairs[persistent_math_count++]=(persistent_math_pair){actual,cs,zeqtb[cs].hh.v.RH,zeqtb[cs].hh.b0};actual=0;
    }
    if(actual||p!=-268435455L)persistent_math_count=0;
    persistent_math_trace(5,persistent_math_count,tokens);persistent_math_result(persistent_math_count>0);return;
  }
  if(curcs!=persistent_math_check_cs||!persistent_math_count)return;
  persistent_math_value(NULL,0);
  persistent_math_clear(persistent_math_plan_cs);
  if(zeqtb[persistent_math_globaldefs_index].cint!=0){persistent_math_result(0);return;}
  for(int i=0;i<persistent_math_count;i++){
    persistent_math_pair *pair=&persistent_math_pairs[i];
    if(zeqtb[pair->actual].hh.b0!=pair->command||zeqtb[pair->actual].hh.v.RH!=pair->value||
       zeqtb[pair->reference].hh.b0!=pair->command||zeqtb[pair->reference].hh.v.RH!=pair->value){persistent_math_result(0);return;}
  }
  /* A printed expression alone cannot establish purity: active characters can
     have the same spelling as ordinary operators. Verify actual token codes. */
  if(zeqtb[persistent_math_expression_cs].hh.b0<113){persistent_math_result(0);return;}
  char expression[130],number[34];
  halfword p=zmem[zeqtb[persistent_math_expression_cs].hh.v.RH].hh.v.RH;int length=0,depth=0;
  if(p==-268435455L||zmem[p].hh.v.LH!=3584){persistent_math_result(0);return;}
  p=zmem[p].hh.v.RH;
  while(p!=-268435455L){
    int token=zmem[p].hh.v.LH,command=token/256,c=token%256;
    if(++length>128||token>=4095){persistent_math_result(0);return;}
    if(command==1&&c=='{'){if(++depth>16){persistent_math_result(0);return;}}
    else if(command==2&&c=='}'){if(--depth<0){persistent_math_result(0);return;}}
    else if(command==10&&c==' '){}
    else if(command==11&&c&&strchr("sincos",c)){}
    else if(command==12&&c&&(c>='0'&&c<='9'||strchr("-+*/.,()",c))){}
    else{persistent_math_result(0);return;}
    expression[length-1]=(char)c;
    p=zmem[p].hh.v.RH;
  }
  if(!length||depth){persistent_math_result(0);return;}
  persistent_math_result(1);
  expression[length]=0;
  if(zeqtb[persistent_math_mode_cs].hh.b0<113)return;
  p=zmem[zeqtb[persistent_math_mode_cs].hh.v.RH].hh.v.RH;
  if(p==-268435455L||zmem[p].hh.v.LH!=3584)return;
  p=zmem[p].hh.v.RH;if(p==-268435455L)return;
  int mode=zmem[p].hh.v.LH-3120;
  if(mode<0||mode>1||zmem[p].hh.v.RH!=-268435455L)return;
  int n=persistent_math_lookup(expression,mode,number);
  if(n>0&&n<=32)persistent_math_value(number,n);
  else persistent_math_make_plan(expression,mode);
}
