const motionCss = String.raw`
html { scroll-behavior:smooth; scroll-padding-top:100px; scrollbar-color:#8b5cf6 #0a0a0f; }
::selection { background:#8b5cf677; color:white; }
::-webkit-scrollbar { width:9px; } ::-webkit-scrollbar-track { background:#0a0a0f; } ::-webkit-scrollbar-thumb { background:#7150aa; border-radius:9px; }
body { isolation:isolate; }
.scroll-progress { position:fixed; inset:0 0 auto; height:3px; z-index:100; pointer-events:none; }
.scroll-progress i { display:block; height:100%; background:linear-gradient(90deg,#7240e2,#b49aff,#e3d3ff); box-shadow:0 0 12px #8b5cf6; transform:scaleX(var(--scroll,0)); transform-origin:left; }
/* The full-width backplate belongs to the header stacking context, above every card. */
header.shell { position:sticky; top:0; z-index:50; isolation:isolate; }
header.shell::before { content:""; position:absolute; top:0; bottom:0; left:50%; width:100vw; transform:translateX(-50%); z-index:-1; pointer-events:none; background:#0a0a0f9e; border-bottom:1px solid transparent; backdrop-filter:blur(18px); -webkit-backdrop-filter:blur(18px); transition:background .25s,border-color .25s; }
header.shell.scrolled::before { background:#0a0a0ff2; border-color:#b49aff30; }
header.nav { border-bottom-color:transparent; transition:transform .25s ease; }
header.nav.scrolled { border-bottom-color:transparent; }
header.nav > * { transition:transform .25s; }

header.nav.scrolled .logo { transform:scale(.9); }
nav a { position:relative; } nav a::after { content:""; position:absolute; bottom:-6px; left:0; width:100%; height:1px; background:#b49aff; transform:scaleX(0); transform-origin:left; transition:transform .2s; } nav a:hover::after { transform:scaleX(1); }
.hero { position:relative; grid-template-columns:minmax(0,1.02fr) minmax(0,.98fr); }
.hero-copy { min-width:0; max-width:100%; container-type:inline-size; }
.hero h1 { max-width:100%; font-size:clamp(2rem,11.6cqi,3.6rem); }
.hero > * { min-width:0; }
.hero-atmosphere { position:fixed; z-index:-1; pointer-events:none; inset:0; overflow:hidden; }
.aurora { position:absolute; width:620px; height:620px; border-radius:50%; filter:blur(40px); opacity:.75; will-change:transform; }
.aurora-one { left:-260px; top:-180px; background:radial-gradient(circle,#7c3aed40,transparent 65%); animation:drift-one 19s ease-in-out infinite alternate; }
.aurora-two { right:-170px; top:-40px; background:radial-gradient(circle,#a16cff35,transparent 65%); animation:drift-two 25s ease-in-out infinite alternate; }
.aurora-three { left:32%; top:100px; width:350px; height:350px; background:radial-gradient(circle,#4338ca30,transparent 65%); animation:drift-one 23s -9s ease-in-out infinite alternate-reverse; }
@keyframes drift-one { to { transform:translate3d(160px,80px,0) scale(1.15); } }
@keyframes drift-two { to { transform:translate3d(-130px,90px,0) scale(.85); } }
.hero-grid { position:absolute; inset:-50px; opacity:.33; background-image:linear-gradient(#b49aff13 1px,transparent 1px),linear-gradient(90deg,#b49aff13 1px,transparent 1px); background-size:52px 52px; mask-image:radial-gradient(ellipse,#0008,transparent 70%); animation:grid-drift 28s linear infinite; }
@keyframes grid-drift { to { transform:translate3d(52px,52px,0); } }
h1 .hero-line { display:block; color:inherit; background:none; white-space:nowrap; }
h1 .hero-word { display:inline-block; color:inherit; background:none; padding:0 .05em .14em 0; margin:0 -.05em -.14em 0; }
h1 .accent .hero-word { color:transparent; background:linear-gradient(100deg,#a78bfa,#f0ddff 45%,#8b5cf6 70%,#a78bfa); background-size:220% 100%; background-clip:text; -webkit-background-clip:text; }
.js .hero-word { animation:word-arrive .65s cubic-bezier(.2,.8,.2,1) both; animation-delay:calc(var(--word)*130ms + 70ms); }
.js .accent .hero-word { animation:word-arrive .65s cubic-bezier(.2,.8,.2,1) both,shimmer 8s linear infinite; animation-delay:calc(var(--word)*130ms + 70ms),0s; }
@keyframes word-arrive { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }
@keyframes shimmer { to { background-position:220% center; } }
.button,button,.command { position:relative; overflow:hidden; cursor:pointer; transition:transform .2s,box-shadow .2s,border-color .2s,background .2s; }
.button:hover { transform:translateY(-4px); box-shadow:0 10px 32px #8b5cf633; border-color:#b49aff80; }
.button:active,button:active { transform:scale(.96); }
.button::after { content:""; position:absolute; inset:-50%; background:linear-gradient(110deg,transparent 35%,#ffffff45 50%,transparent 65%); transform:translateX(-110%); pointer-events:none; }
.button:hover::after { animation:shine .7s ease-out; }
@keyframes shine { to { transform:translateX(110%); } }
.feature,.player,.panel,.commands { --rx:0deg; --ry:0deg; position:relative; transition:transform .25s; }
.feature::after,.panel::after { content:""; position:absolute; inset:-1px; border-radius:inherit; padding:1px; pointer-events:none; opacity:0; background:radial-gradient(230px circle at var(--mx,50%) var(--my,50%),#d2b8ffcc,transparent 75%); mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0); mask-composite:exclude; -webkit-mask-composite:xor; transition:opacity .25s; }
.feature:hover::after,.panel:hover::after { opacity:1; }
.feature::before { content:""; position:absolute; inset:0; border-radius:inherit; pointer-events:none; background:radial-gradient(280px circle at var(--mx,50%) var(--my,50%),#b49aff12,transparent 70%); opacity:0; transition:opacity .2s; }
.feature:hover::before { opacity:1; }
.feature-icon { transition:transform .35s; }
.feature:hover .feature-icon { transform:translateY(-3px) rotate(-10deg) scale(1.15); }
.feature:nth-child(2):hover .feature-icon { transform:translate(4px,-4px) rotate(8deg); }
@media(hover:hover) and (prefers-reduced-motion:no-preference) { .js .feature.visible:hover,.player:hover,.panel:hover { transform:perspective(900px) rotateX(var(--rx)) rotateY(var(--ry)) translateY(-5px); } }
.server-count::before { content:""; display:inline-block; width:7px; height:7px; border-radius:50%; margin-right:8px; background:#71e0b0; box-shadow:0 0 12px #71e0b070; animation:pulse 2s ease-in-out infinite; }
.status-dot.online,body[data-connection="online"] .live-label::before { animation:pulse 2s ease-in-out infinite; }
.live-label,.server-count,.server-count strong,.server-count::before,.status-dot { transition:color .4s,background-color .4s,box-shadow .4s; }
body:not([data-connection="online"]) .live-label { color:#eac56d; }
body:not([data-connection="online"]) .server-count { color:#9895a7; }
body:not([data-connection="online"]) .server-count strong { color:#b8b1c1; }
body:not([data-connection="online"]) .server-count::before { background:#b17b83; box-shadow:none; animation:none; }
.status-pill { min-width:174px; justify-content:center; }
.server-count strong { display:inline-block; min-width:3ch; font-variant-numeric:tabular-nums; }
.cover-placeholder { background:linear-gradient(110deg,transparent 20%,#c0aaff09 48%,transparent 76%); background-size:250% 100%; animation:placeholder-shimmer 7s ease-in-out infinite alternate; }
@keyframes placeholder-shimmer { to { background-position:100% 0; } }
.status-dot.offline { animation:pulse 1.8s ease-in-out infinite; background:#f07888; color:#f07888; }
@keyframes pulse { 50% { opacity:.4; transform:scale(.75); } }
.player { --art-color:139 92 246; --art-x:0px; --art-y:0px; }
.player::before { top:55px; right:0; width:100%; height:70%; background:radial-gradient(ellipse,rgb(var(--art-color)/.28),transparent 68%); filter:blur(22px); opacity:.7; }
.player.playing::before { animation:art-pulse 4.5s ease-in-out infinite; }
@keyframes art-pulse { 50% { opacity:.3; transform:scale(1.12); } }
.cover-wrap { overflow:hidden; transform:perspective(900px) rotateX(var(--art-rx,0deg)) rotateY(var(--art-ry,0deg)); transition:transform .25s; }
.cover { position:absolute; inset:0; transition:opacity .65s ease; transform:translate3d(var(--art-x),var(--art-y),0) scale(1.045); }
.cover-previous { z-index:1; opacity:0; pointer-events:none; }
.cover-placeholder { z-index:0; }
.track-copy { flex:1; min-width:0; overflow:hidden; }
.title-window { overflow:hidden; width:100%; }
.title-window.is-overflowing { mask-image:linear-gradient(90deg,#000 0%,#000 86%,transparent 100%); }
.track-title { display:block; width:max-content; max-width:none; overflow:visible; text-overflow:clip; white-space:nowrap; }
.track-title.marquee { animation:marquee var(--marquee-seconds,14s) linear infinite alternate; }
.title-window:hover .track-title.marquee { animation-play-state:paused; }
@keyframes marquee { 0%,12% { transform:translateX(0); } 88%,100% { transform:translateX(var(--overflow,0px)); } }
.track-copy.track-enter { animation:title-enter .55s ease both; }
@keyframes title-enter { from { transform:translateY(12px); opacity:0; } to { transform:translateY(0); opacity:1; } }
.equalizer { align-items:center; }
.equalizer i { height:24px; transform-origin:center; animation:equalize .58s ease-in-out infinite alternate; }
.equalizer i:nth-child(2) { height:24px; animation-duration:.43s; animation-delay:-.21s; }
.equalizer i:nth-child(3) { height:24px; animation-duration:.77s; animation-delay:-.38s; }
.equalizer i:nth-child(4) { height:24px; animation-duration:.51s; animation-delay:-.17s; }
@keyframes equalize { from { transform:scaleY(.2); opacity:.5; } to { transform:scaleY(1); opacity:1; } }
.equalizer.paused i { animation:none; transform:scaleY(.14); opacity:.45; }
.seek { position:relative; overflow:visible; }
.seek-bar { width:100%; transform:scaleX(var(--progress,0)); transform-origin:left; transition:transform 1s linear; box-shadow:0 0 9px #b49aff55; }
.seek::after { content:""; position:absolute; left:0; top:-2px; width:8px; height:8px; margin-left:-4px; border-radius:50%; background:#ede2ff; box-shadow:0 0 12px #b49aff; transform:translateX(var(--progress-px,0px)); transition:transform 1s linear; }
.commands { grid-template-columns:minmax(180px,.7fr) minmax(0,1.3fr); gap:40px; }
.command-groups { min-width:0; display:grid; gap:0; }
.command-group { padding:18px 0; border-bottom:1px solid #ffffff0e; }
.command-group:first-child { padding-top:0; } .command-group:last-child { padding-bottom:0; border:0; }
.command-group h4 { display:flex; flex-wrap:wrap; justify-content:space-between; gap:8px; margin:0 0 13px; color:#e5dcef; font-size:.78rem; font-weight:650; }
.command-group h4 span { color:#777183; font-size:.68rem; font-weight:450; }
.command-list { gap:8px; }
.command:hover { transform:translateY(-3px) scale(1.05); border-color:#b49aff70; background:#8b5cf620; box-shadow:0 4px 16px #8b5cf622; }
.js .reveal { opacity:0; transform:translateY(18px); }
.js .reveal.visible { opacity:1; transform:translateY(0); transition:opacity .65s var(--delay,0ms),transform .65s cubic-bezier(.2,.8,.2,1) var(--delay,0ms); }
.js .command.reveal.visible:hover { transform:translateY(-3px) scale(1.05); transition-delay:0ms; }
.toast { position:fixed; bottom:24px; left:50%; display:flex; align-items:center; gap:10px; transform:translate(-50%,15px); padding:13px 20px; background:#20182ff5; border:1px solid #8b5cf677; border-radius:14px; z-index:100; opacity:0; pointer-events:none; transition:transform .2s,opacity .2s; box-shadow:0 12px 40px #0007; }
.toast.show { opacity:1; transform:translate(-50%,0); }
.toast-check { display:grid; place-items:center; width:22px; height:22px; border-radius:50%; color:#b9f1d8; background:#71e0b022; }
.toast.show .toast-check { animation:check-pop .4s cubic-bezier(.2,1.8,.4,1); }
@keyframes check-pop { from { opacity:0; transform:scale(.2) rotate(-45deg); } to { opacity:1; transform:scale(1) rotate(0); } }
#controls:not([hidden]),.queue-item { animation:enter .4s ease both; }
@keyframes enter { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
.queue-item.leaving { opacity:0; transform:translateX(20px); transition:opacity .2s,transform .2s; }
.shake { animation:shake .35s; } @keyframes shake { 25%,75% { transform:translateX(-6px); } 50% { transform:translateX(6px); } }
.loading::before { content:""; position:absolute; inset:0; z-index:2; pointer-events:none; border-radius:inherit; background:linear-gradient(100deg,#18132088,#8b5cf633,#18132088); animation:pulse .8s infinite; }
.ripple { position:absolute; border-radius:50%; width:40px; height:40px; margin:-20px; background:#ffffff3d; pointer-events:none; animation:ripple .6s ease-out forwards; } @keyframes ripple { to { transform:scale(8); opacity:0; } }
[hidden] { display:none !important; }
@media(max-width:800px) { .hero { grid-template-columns:minmax(0,1fr); gap:42px; } }
@media(max-width:520px) {
  .nav { gap:12px; height:78px; }
  .wordmark { flex-shrink:0; }
  .nav-right { flex-wrap:wrap; justify-content:flex-end; gap:9px 13px; }
  .nav-right a { display:inline; font-size:.72rem; }
  .nav-right a[href="#commands"] { display:none; }
  .nav-right .status-pill { font-size:.61rem; padding:6px 9px; gap:6px; }
  .server-count { max-width:100%; }
  .commands { grid-template-columns:1fr; gap:26px; }
  .hero { gap:42px; }
  .nav-right .status-pill { min-width:145px; }
  .hero-atmosphere .aurora { width:400px; height:500px; }
  .command { font-size:.74rem; }
  .player-bottom { font-size:.66rem; }
}
/* Reference motion: dea star-drift/reveals/copy-pop; psy page transitions. */
.hero-atmosphere::after { content:""; position:absolute; inset:-130px; opacity:.25; background-image:radial-gradient(circle,#b49aff75 1px,transparent 1.8px),radial-gradient(circle,#8273cc55 1px,transparent 1.8px); background-size:79px 79px,127px 127px; background-position:11px 17px,41px 69px; animation:star-drift 50s linear infinite; }
@keyframes star-drift { to { transform:translate3d(79px,79px,0); } }
.command.copied { animation:copy-pop .3s ease; }
@keyframes copy-pop { 50% { transform:scale(1.06); } }
.queue-item { animation-duration:.35s; animation-delay:calc(min(var(--queue-index,0),8)*45ms); }
body.tab-hidden *,body.tab-hidden *::before,body.tab-hidden *::after { animation-play-state:paused !important; }
@view-transition { navigation:auto; }
@media(prefers-reduced-motion:no-preference) {
  header.shell { view-transition-name:site-nav; }
  .footer { view-transition-name:site-footer; }
  .hero-atmosphere { view-transition-name:site-bg; }
  main { view-transition-name:page-content; }
  ::view-transition-group(site-nav),::view-transition-group(site-footer),::view-transition-group(site-bg),
  ::view-transition-old(site-nav),::view-transition-new(site-nav),::view-transition-old(site-footer),::view-transition-new(site-footer),::view-transition-old(site-bg),::view-transition-new(site-bg) { animation:none; }
  ::view-transition-old(page-content) { animation:page-out 200ms ease-out both; }
  ::view-transition-new(page-content) { animation:page-in 200ms ease-out both; }
  .no-view-transitions main { animation:page-fade-in 160ms ease-out both; }
}
@keyframes page-in { from { opacity:0; transform:translateY(10px); } }
@keyframes page-out { to { opacity:0; transform:translateY(-8px); } }
@keyframes page-fade-in { from { opacity:0; } to { opacity:1; } }
@media(prefers-reduced-motion:reduce) { @view-transition { navigation:none; } ::view-transition-group(*),::view-transition-old(*),::view-transition-new(*) { animation:none !important; } }
@media(prefers-reduced-motion:reduce) {
  html { scroll-behavior:auto; }
  *,*::before,*::after { animation:none !important; transition:none !important; }
  .js .reveal,.js .hero-word { opacity:1; transform:none; filter:none; }
  .aurora { will-change:auto; }
  .title-window.is-overflowing { overflow:auto; mask-image:none; scrollbar-width:thin; }
}
`;
const motionJs = String.raw`(() => {
  const root=document.documentElement;
  // Install the safety net before enabling any hidden reveal styles.
  setTimeout(() => document.querySelectorAll('.reveal').forEach(el=>el.classList.add('visible')),1500);
  root.classList.add('js');
  root.classList.toggle('no-view-transitions',!('startViewTransition' in document));
  if(!document.querySelector('.hero-atmosphere')) {
    const atmosphere=document.createElement('div'); atmosphere.className='hero-atmosphere'; atmosphere.setAttribute('aria-hidden','true');
    ['one','two','three'].forEach(name=> { const blob=document.createElement('i'); blob.className='aurora aurora-'+name; atmosphere.append(blob); });
    document.body.prepend(atmosphere);
  }
  if(!document.querySelector('.scroll-progress')) {
    const progress=document.createElement('div'); progress.className='scroll-progress'; progress.setAttribute('aria-hidden','true'); progress.append(document.createElement('i')); document.body.prepend(progress);
  }
  const updateVisibility=()=>document.body.classList.toggle('tab-hidden',document.hidden);
  document.addEventListener('visibilitychange',updateVisibility); updateVisibility();

  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const countFrames=new WeakMap();
  window.nyxCancelCount=el=> { cancelAnimationFrame(countFrames.get(el)); countFrames.delete(el); };
  window.nyxCountUp=(el,value)=> {
    window.nyxCancelCount(el);
    const previous=Number(el.textContent);
    if(reduced || !Number.isFinite(previous) || previous===value) { el.textContent=value; return; }
    const began=performance.now();
    const tick=time=> {
      const fraction=Math.min(1,(time-began)/650);
      el.textContent=Math.round(previous+(value-previous)*(1-Math.pow(1-fraction,3)));
      if(fraction<1) countFrames.set(el,requestAnimationFrame(tick));
    };
    countFrames.set(el,requestAnimationFrame(tick));
  };
  if('IntersectionObserver' in window && !reduced) {
    const observer=new IntersectionObserver(entries=>entries.forEach(entry=> { if(entry.isIntersecting) { entry.target.classList.add('visible'); observer.unobserve(entry.target); } }),{threshold:.12});
    document.querySelectorAll('.hero-copy > :not(h1),.section-heading,.feature,.command,main > h1,main > .intro,.auth').forEach((el,i)=> {
      el.classList.add('reveal');
      const siblings=Array.from(el.parentElement.children);
      el.style.setProperty('--delay',(siblings.indexOf(el)%8)*65+'ms'); observer.observe(el);
    });
  }
  const header=document.querySelector('header');
  let scrollFrame;
  function onScroll() {
    if(scrollFrame) return;
    scrollFrame=requestAnimationFrame(()=> {
      header?.classList.toggle('scrolled',scrollY>10);
      const distance=document.documentElement.scrollHeight-innerHeight;
      root.style.setProperty('--scroll',distance>0 ? Math.max(0,Math.min(1,scrollY/distance)) : 0);
      scrollFrame=null;
    });
  }
  addEventListener('scroll',onScroll,{passive:true}); addEventListener('resize',onScroll); onScroll();
  if(!reduced && matchMedia('(hover:hover)').matches) document.querySelectorAll('.feature,.panel,.player').forEach(card=> {
    let frame;
    card.addEventListener('pointermove',e=> { cancelAnimationFrame(frame); frame=requestAnimationFrame(()=> {
      const r=card.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;
      card.style.setProperty('--mx',x+'px'); card.style.setProperty('--my',y+'px');
      card.style.setProperty('--rx',((.5-y/r.height)*5)+'deg'); card.style.setProperty('--ry',((x/r.width-.5)*5)+'deg');
      if(card.classList.contains('player')) { card.style.setProperty('--art-x',((x/r.width-.5)*8)+'px'); card.style.setProperty('--art-y',((y/r.height-.5)*8)+'px'); card.style.setProperty('--art-rx',((.5-y/r.height)*3)+'deg'); card.style.setProperty('--art-ry',((x/r.width-.5)*3)+'deg'); }
    }); });
    card.addEventListener('pointerleave',()=> { cancelAnimationFrame(frame); ['--rx','--ry','--art-rx','--art-ry'].forEach(name=>card.style.setProperty(name,'0deg')); ['--art-x','--art-y'].forEach(name=>card.style.setProperty(name,'0px')); });
  });
  const toast=document.createElement('div'); toast.className='toast'; toast.setAttribute('role','status');
  const check=document.createElement('span'); check.className='toast-check'; check.textContent='✓'; check.setAttribute('aria-hidden','true');
  const message=document.createElement('span'); toast.append(check,message); document.body.append(toast); let toastTimer;
  document.addEventListener('click',async e=> {
    const chip=e.target.closest('button.command');
    if(chip) {
      try { await navigator.clipboard.writeText(chip.dataset.command); message.textContent='Copied! '+chip.dataset.command; } catch { message.textContent='Copy: '+chip.dataset.command; }
      chip.classList.remove('copied'); requestAnimationFrame(()=>chip.classList.add('copied'));
      setTimeout(()=>chip.classList.remove('copied'),350);
      toast.classList.remove('show'); requestAnimationFrame(()=>toast.classList.add('show'));
      clearTimeout(toastTimer); toastTimer=setTimeout(()=>toast.classList.remove('show'),2000);
    }
    const button=e.target.closest('button,.button');
    if(button && !reduced) { const r=button.getBoundingClientRect(); const ripple=document.createElement('span'); ripple.className='ripple'; ripple.style.left=(e.clientX-r.left)+'px'; ripple.style.top=(e.clientY-r.top)+'px'; button.append(ripple); setTimeout(()=>ripple.remove(),650); }
  });
  const title=document.querySelector('.track-title'),titleWindow=title?.parentElement;
  function measureTitle() {
    if(!title) return;
    const overflow=Math.max(0,title.scrollWidth-titleWindow.clientWidth);
    titleWindow.classList.toggle('is-overflowing',overflow>2);
    title.classList.toggle('marquee',overflow>2);
    title.style.setProperty('--overflow',-(overflow+12)+'px');
    title.style.setProperty('--marquee-seconds',Math.max(9,(overflow+12)/24)+'s');
  }
  if(title) { new MutationObserver(()=>requestAnimationFrame(measureTitle)).observe(title,{childList:true,characterData:true,subtree:true}); new ResizeObserver(measureTitle).observe(titleWindow); measureTitle(); }
  window.nyxTrackChanged=()=> {
    measureTitle();
    const copy=title?.closest('.track-copy');
    if(copy && !reduced) { copy.classList.remove('track-enter'); requestAnimationFrame(()=>copy.classList.add('track-enter')); }
  };
  const seek=document.querySelector('.seek');
  window.nyxProgress=value=> { if(seek) seek.style.setProperty('--progress-px',(seek.clientWidth*value)+'px'); };
  if(seek) new ResizeObserver(()=>window.nyxProgress(Number(document.getElementById('seek-bar').style.getPropertyValue('--progress'))||0)).observe(seek);
  const cover=document.getElementById('cover'),previous=document.getElementById('cover-previous'),player=document.getElementById('now-playing');
  let fadeTimer;
  function tintArtwork() {
    if(!cover?.naturalWidth || !player) return;
    // Reuse loaded artwork. Cross-origin canvases may be tainted; keep the purple fallback then.
    try {
      const canvas=document.createElement('canvas'); canvas.width=canvas.height=8;
      const ctx=canvas.getContext('2d',{willReadFrequently:true}); ctx.drawImage(cover,0,0,8,8);
      const pixels=ctx.getImageData(0,0,8,8).data;
      let r=0,g=0,b=0,weight=0;
      for(let i=0;i<pixels.length;i+=4) { const max=Math.max(pixels[i],pixels[i+1],pixels[i+2]),min=Math.min(pixels[i],pixels[i+1],pixels[i+2]); const w=(max-min+10)/265; r+=pixels[i]*w; g+=pixels[i+1]*w; b+=pixels[i+2]*w; weight+=w; }
      player.style.setProperty('--art-color',[r,g,b].map(v=>Math.round(v/weight)).join(' '));
    } catch { player.style.setProperty('--art-color','139 92 246'); }
  }
  if(cover) {
    cover.addEventListener('load',()=> { cover.style.opacity='1'; tintArtwork(); if(previous) { previous.style.opacity='0'; clearTimeout(fadeTimer); fadeTimer=setTimeout(()=>{ previous.hidden=true; previous.removeAttribute('src'); },700); } });
    if(cover.complete) tintArtwork();
  }
  window.nyxUpdateArtwork=url=> {
    if(!cover || cover.getAttribute('src')===url) return;
    if(previous && cover.naturalWidth && !reduced) { clearTimeout(fadeTimer); previous.src=cover.src; previous.hidden=false; previous.style.opacity='1'; }
    cover.style.opacity=reduced?'1':'0'; cover.src=url; cover.hidden=false;
  };
})();`;
module.exports = { motionCss, motionJs };
