import { spawn } from "node:child_process"; import http from "node:http"; import { writeFileSync } from "node:fs";
const SHELL="/Users/daniel/Library/Caches/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const PORT=8138,DBG=9348;
const server=spawn("python3",["-m","http.server",String(PORT)],{cwd:process.cwd(),stdio:"ignore"});await new Promise(r=>setTimeout(r,700));
const chrome=spawn(SHELL,["--headless",`--remote-debugging-port=${DBG}`,"--disable-gpu","--no-sandbox","--hide-scrollbars","--user-data-dir=/tmp/tl-h2","about:blank"],{stdio:"ignore"});await new Promise(r=>setTimeout(r,1200));
const getJSON=(p)=>new Promise((res,rej)=>{http.get({host:"127.0.0.1",port:DBG,path:p},r=>{let d="";r.on("data",c=>d+=c);r.on("end",()=>res(JSON.parse(d)));}).on("error",rej);});
const page=(await getJSON("/json")).find(t=>t.type==="page");const ws=new WebSocket(page.webSocketDebuggerUrl);
let id=0;const pending=new Map();ws.addEventListener("message",e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}});
await new Promise(r=>ws.addEventListener("open",r));
const send=(method,params={})=>new Promise(res=>{const i=++id;pending.set(i,res);ws.send(JSON.stringify({id:i,method,params}));});
const ev=async(x)=>{const r=await send("Runtime.evaluate",{expression:x,returnByValue:true,awaitPromise:true});return r.result?.result?.value;};
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
await send("Page.enable");await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride",{width:520,height:380,deviceScaleFactor:2,mobile:false});
await send("Page.navigate",{url:`http://localhost:${PORT}/index.html`});await wait(300);await ev("localStorage.clear()");
await send("Page.navigate",{url:`http://localhost:${PORT}/index.html`});await wait(1100);
await ev("document.querySelector('.phase-tab[data-phase=matrix]').click()");await wait(150);
await ev("document.getElementById('resortBtn').click()");await wait(300);
const gy = await ev("document.querySelector('#matrixGrid .grid-col-header').getBoundingClientRect().top + window.scrollY");
for (const NUDGE of [10,14,18]) {
  await ev(`document.querySelectorAll('#matrixGrid .col-label').forEach(l=>{l.style.transform='translateX(${NUDGE}px) rotate(-52deg)';});`);
  await ev(`(function(){document.querySelectorAll('.__g').forEach(e=>e.remove());const cells=[...document.querySelectorAll('#matrixGrid .grid-row')[0].querySelectorAll('.cell')];for(const k of [0,1,2,3,4,5,6]){const c=cells[k];if(!c)continue;const r=c.getBoundingClientRect();const g=document.createElement('div');g.className='__g';g.style.cssText='position:fixed;top:0;height:230px;width:1px;background:rgba(220,0,0,.6);z-index:9999;left:'+(r.left+r.width/2)+'px';document.body.appendChild(g);}})()`);
  await ev(`window.scrollTo(0, ${gy} - 14)`); await wait(120);
  let r=await send("Page.captureScreenshot",{format:"png"});
  writeFileSync(`/tmp/n_${NUDGE}.png`,Buffer.from(r.result.data,"base64"));
}
ws.close();chrome.kill();server.kill();process.exit(0);
