/* Preserve the existing eight-million-cell font capacity without reserving it
   all before the first document. Font references are indices, not pointers. */
#include <emscripten.h>
EM_JS(int,persistent_font_memory_initial,(void),{
 return typeof persistentFontMemoryInitial==='function'?persistentFontMemoryInitial():8000000;
});
int persistent_font_memory_reserve(integer required){
 if(required<0)return 0;
 if(required<=fontmemsize)return 1;
 if(required>8000000)return 0;
 integer next=fontmemsize<100000?100000:fontmemsize;
 while(next<required){if(next>4000000){next=8000000;break;}next*=2;}
 fontinfo=xreallocarray(fontinfo,fmemoryword,next);fontmemsize=next;return 1;
}
int persistentFontMemoryCapacity(void){return fontmemsize;}
int persistentFontMemoryUsed(void){return fmemptr;}
