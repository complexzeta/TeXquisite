// Playwright waitForFunction treats a returned Promise as truthy. Await IPC
// predicates outside its polling callback so false results really keep waiting.
module.exports=async function waitForAsync(page,predicate,arg,options={}){
 const timeout=options.timeout??30000,polling=typeof options.polling==='number'?options.polling:20,deadline=Date.now()+timeout;
 do{if(await page.evaluate(predicate,arg))return;const remaining=deadline-Date.now();if(remaining<=0)break;await page.waitForTimeout(Math.min(polling,remaining));}while(Date.now()<=deadline);
 throw Error('Asynchronous condition did not become true within '+timeout+' ms');
};
