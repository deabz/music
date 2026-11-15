const {chromium}=require('playwright');
const {createHealthServer}=require('../src/health-server');
const {healthPage}=require('../src/health-page');
const {dashboardPage}=require('../src/dashboard-page');
const fs=require('node:fs/promises');
const assert=require('node:assert/strict');
(async()=>{
const out='data/website-fixes';await fs.mkdir(out,{recursive:true});
const server=createHealthServer({page:healthPage,dashboardPage,getStatus:()=>({ready:true,serverCount:3})});await new Promise(r=>server.listen(3001,r));
const browser=await chromium.launch();const results=[];const errors=[];const diagnostics=[];
for(const width of [1920,375]){
const ctx=await browser.newContext({viewport:{width,height:width===375?812:1080}});const page=await ctx.newPage();let online=true;
await page.addInitScript(()=>{window.cls=0;new PerformanceObserver(list=>{for(const e of list.getEntries())if(!e.hadRecentInput)window.cls+=e.value}).observe({type:'layout-shift',buffered:true})});
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'){if(/503 \(Service Unavailable\)|404 \(Not Found\)/.test(m.text()))diagnostics.push(m.text());else errors.push(m.text())}});
await page.route('**/healthz',r=>r.fulfill({status:online?200:503,json:{status:online?'online':'offline',serverCount:online?3:0,version:'1.0.0',uptimeSeconds:120,pingMs:online?24:null,track:{title:'A long song title for checking smooth playback animation',artist:'Nyx test',status:'playing',positionSeconds:30,durationSeconds:180}}}));
await page.goto('http://localhost:3001');await page.waitForTimeout(1800);
for(const state of ['online','offline']){
if(state==='offline'){online=false;await page.locator('#refresh').click();await page.waitForTimeout(600)}
await page.evaluate(()=>window.scrollTo({top:0,behavior:"instant"}));await page.waitForTimeout(300);
await page.screenshot({path:`${out}/${width}-${state}.png`});
await page.screenshot({path:`${out}/${width}-${state}-full.png`,fullPage:true});
const metrics=await page.evaluate(()=>{const h=document.querySelector('h1').getBoundingClientRect(),p=document.querySelector('.player').getBoundingClientRect();return {cls:window.cls,overflow:document.documentElement.scrollWidth>innerWidth,gap:p.left>=h.right?p.left-h.right:p.top-h.bottom,status:document.body.dataset.connection,count:document.querySelector('#server-count').textContent,color:getComputedStyle(document.querySelector('.live-label')).color,dot:getComputedStyle(document.querySelector('.live-label'),'::before').animationName,eq:[...document.querySelectorAll('.equalizer i')].map(e=>getComputedStyle(e).animationName),background:getComputedStyle(document.querySelector('.hero-atmosphere')).position}});
assert.ok(metrics.gap>=40);assert.equal(metrics.overflow,false);assert.equal(metrics.status,state);assert.equal(metrics.count,'3');assert.equal(metrics.background,'fixed');assert.ok(metrics.cls<.01);
if(state==='offline'){assert.equal(metrics.dot,'none');assert.ok(metrics.eq.every(a=>a==='none'));assert.notEqual(metrics.color,'rgb(113, 224, 176)')}
results.push({width,state,...metrics});
}
await page.reload();await page.waitForTimeout(500);assert.equal(await page.locator('#server-count').textContent(),'3');
online=true;await page.locator('#refresh').click();await page.waitForTimeout(600);assert.equal(await page.locator('body').getAttribute('data-connection'),'online');
for(const w of [375,520,768,800,801,1024,1280,1440,1920]){await page.setViewportSize({width:w,height:1080});await page.waitForTimeout(80);assert.ok(await page.evaluate(()=>{const h=document.querySelector('h1').getBoundingClientRect(),p=document.querySelector('.player').getBoundingClientRect();return (p.left>=h.right?p.left-h.right:p.top-h.bottom)>=40 && document.documentElement.scrollWidth===innerWidth}),'gap at '+w)}
await page.evaluate(()=>window.scrollTo({top:document.documentElement.scrollHeight,behavior:'instant'}));await page.waitForTimeout(400);assert.ok(Number(await page.locator('html').evaluate(e=>e.style.getPropertyValue('--scroll')))>.99);await page.screenshot({path:`${out}/${width}-footer.png`});
for(const path of ['/status','/dashboard','/not-a-page']) {
  await page.setViewportSize({width,height:width===375?812:1080});
  for(const state of ['online','offline']) {
    online=state==='online';
    const response=await page.goto('http://localhost:3001'+path);
    assert.equal(response.status(),path==='/not-a-page'?404:200);
    await page.waitForTimeout(1700);
    assert.equal(await page.locator('body').count(),1);
    assert.equal(await page.locator('main').count(),1);
    assert.equal(await page.locator('.hero-atmosphere').count(),1);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    const before=await page.locator('.aurora-one').evaluate(e=>getComputedStyle(e).transform);
    await page.waitForTimeout(150);
    assert.notEqual(before,await page.locator('.aurora-one').evaluate(e=>getComputedStyle(e).transform));
    if(path==='/status') {assert.equal(await page.locator('body').getAttribute('data-connection'),state);assert.notEqual(await page.locator('#version').textContent(),'—');}
    await page.screenshot({path:`${out}/${width}-${path.slice(1)}-${state}.png`});
  }
}
await ctx.close();
}
assert.deepEqual(errors,[]);await fs.writeFile(out+'/report.json',JSON.stringify({results,errors,expectedHttp503Diagnostics:diagnostics},null,2));console.log(JSON.stringify({results,errors,expectedHttp503Diagnostics:diagnostics.length},null,2));await browser.close();await new Promise(r=>server.close(r));
})().catch(e=>{console.error(e);process.exit(1)});
