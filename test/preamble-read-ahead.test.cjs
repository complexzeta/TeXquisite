const {test}=require('node:test'),assert=require('node:assert/strict');
const {checkpointInputLine}=require('../dist/preamble-read-ahead');
test('Logical root positions distinguish unread line tails, CRLF, EOF, and byte offsets',()=>{
 for(const ending of ['\n','\r\n','']){const prefix='α preamble\n',line='\\begin{document}π text  ',source=Buffer.from(prefix+line+ending),position=source.length;assert.deepEqual(checkpointInputLine(source,position),{start:Buffer.byteLength(prefix),visibleLength:Buffer.byteLength(line.trimEnd()),readEnd:position});}
 const bytes=Buffer.from('first\n\nlast');assert.deepEqual(checkpointInputLine(bytes,7),{start:6,visibleLength:0,readEnd:7});
 for(const position of [-1,0,2,3.5,99,NaN])assert.equal(checkpointInputLine(bytes,position),undefined);
 assert.deepEqual(checkpointInputLine(Buffer.from('last'),4),{start:0,visibleLength:4,readEnd:4});
});
