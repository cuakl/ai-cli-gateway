/**
 * Inline script injected as the first child of `<head>`. Buffers window errors
 * until the overlay drains `window.__AI_DEVTOOLS_EARLY__`. Keep under 1 KB.
 */
export const EARLY_ERROR_SCRIPT = `(function(){var g=window.__AI_DEVTOOLS_EARLY__={errors:[]};var M=50;function a(e){if(g.errors.length<M)g.errors.push(e)}function r(v){var x=v.error||v.reason;a({message:String(x&&x.message||v.message||x||''),stack:x&&x.stack?String(x.stack):undefined,filename:v.filename,lineno:v.lineno,colno:v.colno,timestamp:Date.now()})}addEventListener('error',function(v){var t=v.target;if(t&&t!==window&&t.tagName){a({tag:t.tagName,src:t.src||t.href||'',timestamp:Date.now()});return}r(v)},true);addEventListener('unhandledrejection',r,true)})();`;
