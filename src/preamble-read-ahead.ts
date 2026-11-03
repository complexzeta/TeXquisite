// Locate the physical line that TeX read, using its flushed logical file
// position. Native code independently checks the complete actual line buffer.
export function checkpointInputLine(bytes:Uint8Array,position:number){
  if(!Number.isSafeInteger(position)||position<=0||position>bytes.length||position<bytes.length&&bytes[position-1]!==10)return;
  let end=position;if(bytes[end-1]===10)end--;if(end>0&&bytes[end-1]===13)end--;
  let start=end;while(start>0&&bytes[start-1]!==10)start--;
  while(end>start&&bytes[end-1]===32)end--;
  return {start,visibleLength:end-start,readEnd:position};
}
