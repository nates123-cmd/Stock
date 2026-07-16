import { chromium } from 'playwright';
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join } from 'node:path';
const ROOT = process.cwd() + '/dist';
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.png':'image/png','.ico':'image/x-icon' };
const srv = http.createServer((req,res)=>{ let p=decodeURIComponent(req.url.split('?')[0]); if(p.startsWith('/Stock'))p=p.slice(6); let f=join(ROOT,p); if(!existsSync(f)||p==='/'||p==='')f=join(ROOT,'index.html'); try{const b=readFileSync(f);res.writeHead(200,{'content-type':MIME[extname(f)]||'application/octet-stream'});res.end(b);}catch{res.writeHead(404);res.end('nf');} });
await new Promise(r=>srv.listen(4601,r));
const b=await chromium.launch(); const pg=await b.newPage();
const errs=[]; pg.on('pageerror',e=>errs.push(String(e)));
// Go through the wizard
await pg.goto('http://localhost:4601/Stock/build-list',{waitUntil:'networkidle',timeout:30000});
await pg.waitForTimeout(1800);
await pg.getByText(/Start/).first().click().catch(()=>{});
await pg.waitForTimeout(1200);
// Click Next through recipe steps + combine until "Add to shopping list"
for (let i=0;i<6;i++){
  const addBtn = await pg.getByText(/Add to shopping list/i).count();
  if (addBtn>0){ await pg.getByText(/Add to shopping list/i).first().click(); break; }
  const next = await pg.getByText(/^Next$|→ Next|Next$/).count();
  await pg.getByText(/Next/).first().click().catch(()=>{});
  await pg.waitForTimeout(900);
}
await pg.waitForTimeout(2000);
console.log('URL:', pg.url());
const body=(await pg.innerText('body')).replace(/\n+/g,' | ');
console.log('LANDED:', body.slice(0,500));
const hasDone = /\bDone\b/.test(body);
const hasTabs = /RECIPES|PLAN|COOK/.test(body);
console.log('hasDone(bad):', hasDone, ' hasBottomTabs(good):', hasTabs);
await pg.screenshot({path:process.env.CLAUDE_JOB_DIR+'/tmp/wizard-landed.png', fullPage:true});
console.log('ERRORS:', errs.filter(e=>!/favicon|sqlite|wasm/i.test(e)).slice(0,4).join(' || ')||'none');
await b.close(); srv.close();
