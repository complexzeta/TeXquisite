/* Application-owned acceleration for pdfTeX stream compression. The Node host
   provides synchronous zlib; TeX-visible compression settings remain unchanged.
   The original C zlib path remains available when no host hook is installed. */
#ifdef WEBASSEMBLY_BUILD
#include <emscripten.h>
#include <limits.h>
EM_JS(int, persistent_native_zip_available, (void), {
    return typeof persistentCompress === 'function' ? 1 : 0;
});
EM_JS(int, persistent_native_zip, (const unsigned char *input, int length, int level, unsigned char *output, int capacity), {
    const bytes = persistentCompress(HEAPU8.subarray(input, input + length), level);
    if (bytes.length > capacity) throw new Error('Compressed PDF stream exceeds its buffer');
    HEAPU8.set(bytes, output);
    return bytes.length;
});
static unsigned char *persistent_zip_input;
static size_t persistent_zip_length, persistent_zip_capacity;
void persistent_native_zip_begin(void) {persistent_zip_length = 0;}
static void persistent_writezip(boolean finish, int level) {
    size_t needed = persistent_zip_length + (size_t) pdfptr;
    if (needed > INT_MAX) pdftex_fail("PDF compression stream exceeds the native buffer limit");
    if (needed > persistent_zip_capacity) {
        size_t capacity = persistent_zip_capacity ? persistent_zip_capacity : 32768;
        while (capacity < needed) capacity *= 2;
        unsigned char *next = realloc(persistent_zip_input, capacity);
        if (!next) pdftex_fail("Cannot allocate PDF compression input");
        persistent_zip_input = next; persistent_zip_capacity = capacity;
    }
    if (pdfptr) memcpy(persistent_zip_input + persistent_zip_length, pdfbuf, pdfptr);
    persistent_zip_length = needed;
    if (finish) {
        uLong capacity = compressBound(persistent_zip_length);
        if (capacity > INT_MAX) pdftex_fail("PDF compression output exceeds the native buffer limit");
        unsigned char *output = xmalloc(capacity);
        int length = persistent_native_zip(persistent_zip_input, persistent_zip_length, level, output, capacity);
        pdfgone += xfwrite(output, 1, length, pdffile);
        if (length) pdflastbyte = output[length - 1];
        pdfstreamlength = length; xfflush(pdffile); free(output);
        persistent_zip_length = 0;
    }
}
#endif
