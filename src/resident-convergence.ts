// Convergence concerns changing inputs, not whether every reference exists.
// A partial lecture can legitimately keep unresolved labels in a stable PDF.
export function residentConvergence(stable:boolean,log:string,files:Iterable<[string,Uint8Array]>):'ready'|'retry'|'external'{
 if(/Please .*run Biber|No file .*\.(?:bbl|ind|gls|acr|nls)/i.test(log))return 'external';
 if(!stable||/No pages of output/i.test(log))return 'retry';
 const missingCitation=/undefined citations|Citation[^\r\n]*(?:\r?\n[^\r\n]*)?undefined/i.test(log);
 if(missingCitation&&[...files].some(([name,bytes])=>/\.bcf$/i.test(name)||/\.aux$/i.test(name)&&/\\bibdata\s*\{/.test(new TextDecoder().decode(bytes))))return 'external';
 return 'ready';
}
