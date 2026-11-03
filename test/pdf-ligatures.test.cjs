const {test}=require('node:test'),assert=require('node:assert/strict'),{ligaturePathCode}=require('../dist/pdf-ligatures');
const f={code:102,object:7,box:[10,15,20,27]},i={code:105,object:7,box:[10,15,20,27]};
test('Shared or empty continuation boxes identify a decomposed fi cluster',()=>{assert.equal(ligaturePathCode([f,i]),0xfb01);assert.equal(ligaturePathCode([f,{...i,box:[15,15,20,27]}]),0xfb01);assert.equal(ligaturePathCode([f,{...f},i]),0xfb03);});
test('Ordinary adjacent letters, other objects, malformed boxes and unrelated sequences remain unproved',()=>{for(const glyphs of [[f,{...i,box:[15,18,20,27]}],[f,{...i,object:8}],[f,{...i,box:[NaN,15,20,27]}],[{...f,box:[0,0,0,0]},i],[f,{...i,code:120}],[f]])assert.equal(ligaturePathCode(glyphs),undefined);});
