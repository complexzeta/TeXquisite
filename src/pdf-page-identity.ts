import {PDFDocument,PDFName,PDFRef,PDFDict,PDFArray,PDFRawStream,PDFNumber,PDFBool,PDFNull,PDFString,PDFHexString} from 'pdf-lib';
// Exact rendering inputs for ordinary page-only PDFs. Reference numbers and
// sibling pages are excluded; every reachable resource and raw stream is kept.
// Catalog features that can affect rendering outside the page graph opt out.
export async function pdfPageIdentities(bytes:Uint8Array):Promise<(Uint8Array|undefined)[]>{
  try{
    const pdf=await PDFDocument.load(bytes,{updateMetadata:false});
    if(pdf.context.trailerInfo.Encrypt||pdf.catalog.keys().some(k=>!['Type','Pages','PageLabels','Names','Dests','Outlines','PageMode','PageLayout','OpenAction','ViewerPreferences','Metadata','Lang'].includes(k.decodeText())))return [];
    return pdf.getPages().map(page=>{
      try{
        const chunks:Uint8Array[]=[],seen=new Map<object,number>();let length=0,objects=0;
        const add=(b:Uint8Array)=>{length+=b.length;if(length>2*1024*1024)throw Error('Large page identity');chunks.push(b);};
        const text=(s:string)=>add(new TextEncoder().encode(s));
        const visit=(input:any,root=false)=>{
          if(++objects>20000)throw Error('Complex page identity');
          const value=input instanceof PDFRef?pdf.context.lookup(input):input;
          if(!value){
            // Bounded native page PDFs can retain unused resource references.
            // Keep the exact unresolved reference, never equate it with a
            // resolved object or a differently numbered missing resource.
            if(input instanceof PDFRef){text('missing-reference:'+input.toString()+';');return;}
            throw Error('Unresolved PDF object');
          }
          if(value instanceof PDFDict||value instanceof PDFArray||value instanceof PDFRawStream){const prior=seen.get(value);if(prior!==undefined){text('@'+prior+';');return;}seen.set(value,seen.size);}
          if(value instanceof PDFRawStream){text('stream{');visit(value.dict);text('bytes:'+value.contents.length+':');add(value.contents);text('}');}
          else if(value instanceof PDFDict){text('dict{');const entries=value.entries().filter(([k])=>!root||!['Parent','Resources','MediaBox','CropBox','Rotate'].includes(k.decodeText())).sort(([a],[b])=>a.toString()<b.toString()?-1:a.toString()>b.toString()?1:0);for(const [k,v]of entries){text(k.toString()+':');visit(v);}if(root)for(const name of ['Resources','MediaBox','CropBox','Rotate']){const inherited=page.node.getInheritableAttribute(PDFName.of(name));text('inherited/'+name+':');if(inherited)visit(inherited);else text('absent;');}text('}');}
          else if(value instanceof PDFArray){text('array[');for(let i=0;i<value.size();i++)visit(value.get(i));text(']');}
          else if(value instanceof PDFName||value instanceof PDFNumber||value instanceof PDFBool||value===PDFNull||value instanceof PDFString||value instanceof PDFHexString){const s=value.toString();text(s.length+':'+s+';');}
          else throw Error('Unsupported PDF identity object');
        };
        visit(page.node,true);const result=new Uint8Array(length);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result;
      }catch{return undefined;}
    });
  }catch{return [];}
}
