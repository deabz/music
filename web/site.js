(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const root = document.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const safety = setTimeout(() => document.querySelectorAll('.reveal').forEach(el => el.classList.add('visible')), 1500);
  root.classList.add('js');
  root.classList.toggle('no-view-transitions', !('startViewTransition' in document));
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const format = seconds => { const n = Math.max(0, Math.floor(Number(seconds) || 0)); return Math.floor(n/60)+':'+String(n%60).padStart(2,'0'); };
  const duration = seconds => {const n=Math.max(0,Math.floor(seconds));return (n>=86400?Math.floor(n/86400)+'d ':'')+Math.floor(n%86400/3600)+'h '+Math.floor(n%3600/60)+'m '+n%60+'s';};
  const tasks = new Set();
  const visible = el => !document.hidden && (!el || el.getBoundingClientRect().bottom > 0 && el.getBoundingClientRect().top < innerHeight);
  let clock;
  const addTask = (el, fn, ms) => {const task={el,fn,ms,last:performance.now()};tasks.add(task);return ()=>tasks.delete(task);};
  function runClock() {clearInterval(clock);if(document.hidden)return;tasks.forEach(task=>task.last=performance.now());let previous=performance.now();clock=setInterval(()=>{const now=performance.now();const dt=Math.min(500,now-previous);previous=now;for(const task of tasks){if(!visible(task.el)){task.last=now;continue;}if(now-task.last>=task.ms){const elapsed=Math.min(500,now-task.last);task.last=now;task.fn(elapsed);}}},100);}
  function visibility() {document.body.classList.toggle('tab-hidden',document.hidden);runClock();}
  document.addEventListener('visibilitychange',visibility);visibility();
  const observer = 'IntersectionObserver' in window ? new IntersectionObserver(entries=>entries.forEach(entry=>{entry.target.classList.toggle('motion-paused',!entry.isIntersecting);}),{rootMargin:'40px'}) : null;
  let revealObserver;
  if ('IntersectionObserver' in window) revealObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('visible');revealObserver.unobserve(entry.target);}}),{threshold:.1});
  function reveal(scope=document) {scope.querySelectorAll('.reveal').forEach((el,i)=>{el.style.setProperty('--delay',(i%3)*70+'ms');if(reduced.matches||!revealObserver)el.classList.add('visible');else revealObserver.observe(el);});}
  reveal();
  document.querySelectorAll('.live-player,.command-marquee,.demo-art,.chat-demo,.gradient,.lost-mark').forEach(el=>observer?.observe(el));
  const hero = document.querySelector('.hero') || document.querySelector('.page-heading') || $('main');
  if(hero && 'IntersectionObserver' in window)new IntersectionObserver(entries=>document.body.classList.toggle('no-particles',!entries[0].isIntersecting)).observe(hero);
  const themeButton = document.querySelector('.theme-toggle');
  function syncTheme() {const dark=root.dataset.theme==='dark';themeButton?.setAttribute('aria-label','Switch to '+(dark?'light':'dark')+' theme');themeButton?.setAttribute('aria-pressed',String(dark));document.querySelector('meta[name="theme-color"]')?.setAttribute('content',dark?'#101016':'#faf7f2');}
  syncTheme();
  themeButton?.addEventListener('click',()=>{root.dataset.theme=root.dataset.theme==='dark'?'light':'dark';root.style.colorScheme=root.dataset.theme;try{localStorage.setItem('nyx-theme',root.dataset.theme);}catch{}syncTheme();});
  matchMedia('(prefers-color-scheme:dark)').addEventListener('change',e=>{let saved;try{saved=localStorage.getItem('nyx-theme');}catch{}if(!saved){root.dataset.theme=e.matches?'dark':'light';root.style.colorScheme=root.dataset.theme;syncTheme();}});
  const menuButton=document.querySelector('.menu-toggle'),menu=$('main-nav');
  function closeMenu(){menu?.classList.remove('open');menuButton?.setAttribute('aria-expanded','false');menuButton?.setAttribute('aria-label','Open navigation');}
  menuButton?.addEventListener('click',()=>{const open=menu.classList.toggle('open');menuButton.setAttribute('aria-expanded',String(open));menuButton.setAttribute('aria-label',open?'Close navigation':'Open navigation');});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&menu?.classList.contains('open')){closeMenu();menuButton.focus();}});
  document.addEventListener('click',e=>{if(!e.target.closest('.site-nav'))closeMenu();});
  menu?.addEventListener('click',e=>{if(e.target.closest('a'))closeMenu();});
  const prefetched=new Set();
  function prefetch(e){if(navigator.connection?.saveData)return;const link=e.target.closest?.('a[href]');if(!link)return;const url=new URL(link.href,location.href);if(url.origin!==location.origin||!['/','/commands','/changelog','/status'].includes(url.pathname)||url.pathname===location.pathname||prefetched.has(url.pathname))return;prefetched.add(url.pathname);const hint=document.createElement('link');hint.rel='prefetch';hint.href=url.pathname;document.head.append(hint);}
  document.addEventListener('pointerover',prefetch);document.addEventListener('focusin',prefetch);document.addEventListener('touchstart',prefetch,{passive:true});
  let scrollFrame;
  function scroll(){if(scrollFrame)return;scrollFrame=requestAnimationFrame(()=>{const distance=root.scrollHeight-innerHeight;root.style.setProperty('--scroll',distance>0?Math.max(0,Math.min(1,scrollY/distance)):0);document.querySelector('.site-nav')?.classList.toggle('scrolled',scrollY>15);scrollFrame=null;});}
  addEventListener('scroll',scroll,{passive:true});addEventListener('resize',scroll);scroll();
  if(!reduced.matches&&matchMedia('(hover:hover)').matches){document.querySelectorAll('.feature,.demo-player,.button.primary').forEach(el=>{let frame;el.addEventListener('pointermove',e=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{const r=el.getBoundingClientRect();el.style.setProperty('--mx',((e.clientX-r.left)/r.width*100)+'%');el.style.setProperty('--my',((e.clientY-r.top)/r.height*100)+'%');if(el.classList.contains('primary'))el.style.transform=`translate(${(e.clientX-r.left-r.width/2)*.035}px,${(e.clientY-r.top-r.height/2)*.05-2}px)`;else el.style.transform=`perspective(1000px) rotateX(${(.5-(e.clientY-r.top)/r.height)*2}deg) rotateY(${((e.clientX-r.left)/r.width-.5)*2}deg) translateY(-3px)`;});});el.addEventListener('pointerleave',()=>{cancelAnimationFrame(frame);el.style.transform='';});});}
  const countFrames=new WeakMap();
  function count(el,value){if(!el)return;cancelAnimationFrame(countFrames.get(el));const rawStart=Number(el.textContent);const start=Number.isFinite(rawStart)?rawStart:0;if(reduced.matches||start===value||!visible(el)){el.textContent=value;return;}const began=performance.now();const step=now=>{if(document.body.dataset.connection!=='online'||document.hidden){el.textContent=value;return;}const t=Math.min(1,(now-began)/650);el.textContent=Math.round(start+(value-start)*(1-(1-t)**3));if(t<1)countFrames.set(el,requestAnimationFrame(step));};countFrames.set(el,requestAnimationFrame(step));}
  const toast=document.querySelector('.toast');let toastUntil=0;
  function notify(message){toast.textContent=message;toast.classList.add('show');toastUntil=performance.now()+2000;}
  addTask(null,()=>{if(toastUntil&&performance.now()>toastUntil){toast.classList.remove('show');toastUntil=0;}},100);
  document.addEventListener('click',async e=>{const button=e.target.closest('[data-copy]');if(!button)return;try{await navigator.clipboard.writeText(button.dataset.copy);notify('Copied! '+button.dataset.copy);button.classList.remove('copied');requestAnimationFrame(()=>button.classList.add('copied'));}catch{notify('Select and copy: '+button.dataset.copy);}});
  // Live artwork is validated independently of source playback URLs, on server and client.
  const cover=$('live-cover'), backdrop=$('live-backdrop');
  let currentArtwork='';
  function clearArtwork() {
    cover?.closest('.live-art').classList.remove('is-loaded');
    if(cover) {cover.hidden=true;cover.removeAttribute('src');}
    if(backdrop) {backdrop.hidden=true;backdrop.removeAttribute('src');}
  }
  function artworkLoaded() {
    if(!cover || !currentArtwork || cover.getAttribute('src')!==currentArtwork || !cover.naturalWidth)return;
    cover.closest('.live-art').classList.add('is-loaded');
    if(backdrop) {backdrop.src=currentArtwork;backdrop.hidden=false;}
  }
  cover?.addEventListener('load',artworkLoaded);
  cover?.addEventListener('error',clearArtwork);
  backdrop?.addEventListener('error',()=>{backdrop.hidden=true;backdrop.removeAttribute('src');});
  function updateArtwork(track) {
    if(!cover)return;
    const url=nyxSafeCoverUrl(track?.thumbnail);
    cover.alt=track?'Cover art for '+track.title:'';
    if(url===currentArtwork&&(cover.hasAttribute('src')||!url))return;
    currentArtwork=url;clearArtwork();
    if(url) {cover.src=url;cover.hidden=false;}
  }
  // The per-load variant is random, with a different choice on refresh when storage is available.
  let coverVariant=(crypto.getRandomValues(new Uint32Array(1))[0])%20;
  try {const previous=sessionStorage.getItem('nyx-demo-cover-variant');if(previous!==null&&Number(previous)===coverVariant)coverVariant=(coverVariant+1)%20;sessionStorage.setItem('nyx-demo-cover-variant',String(coverVariant));}catch{}
  const generatedCovers=new Map();
  function generatedCover(title) {
    const key=String(title).trim().toLowerCase();
    if(!generatedCovers.has(key))generatedCovers.set(key,nyxDemoCover(key,coverVariant));
    return generatedCovers.get(key);
  }
  let coverFade;
  function demoArtwork(title) {
    const art=$('demo-art');if(!art)return;
    const image=art.querySelector('.demo-cover'),previous=art.querySelector('.demo-cover-previous');
    const source=generatedCover(title);
    if(image.getAttribute('src')===source)return;
    coverFade?.cancel();previous.hidden=true;
    if(image.getAttribute('src')&&!reduced.matches) {
      previous.src=image.src;previous.hidden=false;
      coverFade=previous.animate([{opacity:1},{opacity:0}],{duration:320,easing:'ease-out',fill:'forwards'});
      coverFade.onfinish=()=>{previous.hidden=true;previous.removeAttribute('src');};
    }
    image.src=source;
  }
  // Public rendering uses only the sanitized now-playing payload, never the health track object.
  let latest=null,received=0,busy=false,lastCount=null,healthController;
  try{const saved=sessionStorage.getItem('nyx-server-count');if(saved!==null&&Number.isInteger(Number(saved))&&Number(saved)>=0)lastCount=Number(saved);}catch{}
  if(lastCount!==null)document.querySelectorAll('[data-server-count],#server-count').forEach(el=>el.textContent=lastCount);
  function measureTitle() {
    const title=$('track-title');
    if(!title)return;
    title.classList.remove('marquee');
    title.parentElement.classList.remove('is-overflowing');
    title.title=title.textContent;
    title.setAttribute('aria-label',title.textContent);
  }
  addEventListener('resize',measureTitle);reduced.addEventListener('change',()=>{measureTitle();reveal();if(reduced.matches){coverFade?.cancel();const previous=document.querySelector('.demo-cover-previous');if(previous)previous.hidden=true;}});
  function progress(){if(!latest)return;const online=latest.online;const elapsed=latest.track?Math.max(0,latest.track.position+(online&&latest.track.state==='playing'?(Date.now()-received)/1000*latest.track.rate:0)):0;const length=latest.track?.length||0;const value=length?Math.min(1,elapsed/length):0;if($('seek-bar')){$('seek-bar').style.setProperty('--progress',value);$('elapsed').textContent=format(length?Math.min(elapsed,length):elapsed);$('duration').textContent=length?format(length):'—';document.querySelector('.live-player .seek')?.setAttribute('aria-valuenow',String(Math.round(value*100)));}if($('uptime'))$('uptime').textContent=latest.uptime===null?'—':duration(latest.uptime+(Date.now()-received)/1000);}
  function showHealth(data,online,error=false){const track=online&&data.track?{title:String(data.track.title||'Unknown track'),artist:String(data.track.artist||''),thumbnail:nyxSafeCoverUrl(data.track.thumbnail),position:Number(data.track.positionSeconds)||0,length:Number(data.track.durationSeconds)||0,state:data.track.status,rate:Number(data.track.playbackRate)||1}:null;latest={online,track,uptime:Number.isFinite(data.uptimeSeconds)?data.uptimeSeconds:null};received=Date.now();document.body.dataset.connection=error?'error':online?'online':'offline';document.querySelectorAll('[data-status-text]').forEach(el=>el.textContent=error?'Status unavailable':online?'Online · All systems go':'Offline · Reconnecting');document.querySelectorAll('[data-strip-title]').forEach(el=>el.textContent=error?'Taking a moment to reconnect.':online?'Ready for your next session.':'We’ll be right back.');if(online&&Number.isInteger(data.serverCount)){lastCount=data.serverCount;try{sessionStorage.setItem('nyx-server-count',String(lastCount));}catch{}}document.querySelectorAll('[data-server-count],#server-count').forEach(el=>{if(online)count(el,lastCount??0);else{cancelAnimationFrame(countFrames.get(el));el.textContent=lastCount??'—';}});const player=$('now-playing');if(player){updateArtwork(track);const state=error?'error':!online?'offline':!track?'idle':track.state==='playing'?'playing':track.state==='paused'?'paused':'buffering';player.dataset.state=state;$('track-status').textContent={error:'Status unavailable',offline:'Reconnecting',idle:'Ready when you are',playing:'Now playing',paused:'Paused',buffering:'Finding the rhythm'}[state];const title=track?.title||(online?'Your next favourite':'The music will be back');if($('track-title').textContent!==title){$('track-title').textContent=title;if(!reduced.matches&&visible(player))document.querySelector('.live-art')?.animate([{opacity:.5},{opacity:1}],{duration:600,easing:'ease-out'});}$('track-artist').textContent=track?track.artist:(error?'We couldn’t reach the status service':online?'Nothing playing right now':'Nyx is reconnecting to Discord');$('updated').textContent=error?'Retrying shortly':'Live status';measureTitle();}if($('bot-state')){$('bot-state').textContent=error?'Unavailable':online?'Online':'Reconnecting';$('ping').textContent=online&&Number.isFinite(data.pingMs)?data.pingMs+' ms':'—';$('version').textContent=data.version||'—';$('restart').textContent=Number.isFinite(data.uptimeSeconds)?new Date(Date.now()-data.uptimeSeconds*1000).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'—';$('status-updated').textContent=(error?'Retry available':'Updated '+new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}))+' · auto-refreshes every 15s';$('status-error').hidden=!error;}progress();}
  async function health(){if(busy||document.hidden)return;busy=true;healthController=new AbortController();const timeout=setTimeout(()=>healthController.abort(),6000);$('status-refresh')?.setAttribute('disabled','');try{const [response,playback]=await Promise.all([fetch('/healthz',{cache:'no-store',headers:{Accept:'application/json'},signal:healthController.signal}),fetch('/api/now-playing',{cache:'no-store',headers:{Accept:'application/json'},signal:healthController.signal})]);if((!response.ok&&response.status!==503)||!playback.ok)throw Error();const data=await response.json();const publicPlayback=await playback.json();data.track=publicPlayback.status==='online'?publicPlayback.track:null;showHealth(data,response.ok&&data.status==='online');}catch{showHealth({},false,true);}finally{clearTimeout(timeout);busy=false;$('status-refresh')?.removeAttribute('disabled');}}
  if(document.querySelector('.live-player')||$('bot-state')){health();addTask($('main'),health,15000);addTask($('now-playing')||$('main'),progress,1000);if($('uptime'))addTask(document.querySelector('.status-grid'),progress,1000);$('status-refresh')?.addEventListener('click',health);$('status-retry')?.addEventListener('click',health);}
  // Fictional, silent player demo. No requests and no live bot state.
  if($('demo-play')){const tracks=[{title:'Peach Hour',artist:'The Paper Satellites',length:168},{title:'Soft Signal',artist:'Velvet Circuit',length:194},{title:'After the Rain',artist:'Sunday Rooms',length:182}];let selected=0,position=0,playing=false,last=performance.now();const art=$('demo-art');function render(){const t=tracks[selected];$('demo-title').textContent=t.title;$('demo-artist').textContent=t.artist+' · Demo track';$('demo-elapsed').textContent=format(position);$('demo-duration').textContent=format(t.length);$('demo-progress').style.setProperty('--progress',position/t.length);document.querySelector('.demo-seek').setAttribute('aria-valuenow',String(Math.round(position/t.length*100)));$('demo-play').textContent=playing?'Ⅱ':'▶';$('demo-play').setAttribute('aria-pressed',String(playing));$('demo-play').setAttribute('aria-label',playing?'Pause demo':'Play demo');art.dataset.track=selected;demoArtwork(t.title);$('demo-queue').querySelectorAll('button').forEach((b,i)=>b.setAttribute('aria-pressed',String(i===selected)));}function choose(i){selected=i;position=0;last=performance.now();render();}tracks.forEach((t,i)=>{const button=document.createElement('button');button.type='button';button.innerHTML='<img class="queue-cover" alt="" width="40" height="40" decoding="async" src="'+generatedCover(t.title)+'"><span>'+String(i+1).padStart(2,'0')+' &nbsp; '+escape(t.title)+'</span><small>'+format(t.length)+'</small>';button.addEventListener('click',()=>choose(i));$('demo-queue').append(button);});$('demo-play').addEventListener('click',()=>{playing=!playing;last=performance.now();render();});$('demo-skip').addEventListener('click',()=>choose((selected+1)%tracks.length));$('demo-volume').addEventListener('input',e=>$('demo-volume-value').textContent=e.target.value+'%');$('demo-reset').addEventListener('click',()=>{playing=false;selected=position=0;$('demo-volume').value=65;$('demo-volume-value').textContent='65%';render();});addTask(document.querySelector('.demo-player'),()=>{const now=performance.now();if(playing&&visible(document.querySelector('.demo-player'))){position+=Math.min(.35,(now-last)/1000);if(position>=tracks[selected].length){if(reduced.matches){playing=false;position=tracks[selected].length;}else choose((selected+1)%tracks.length);}render();}last=now;},100);render();}
  if ($('chat-form')) {
    const demo=document.querySelector('.chat-demo');
    const log=$('chat-messages'), typing=$('chat-typing'), input=$('chat-input'), send=$('chat-send');
    const transcript=$('chat-transcript');
    const command='/play a little late-night jazz';
    let phase='waiting', elapsed=0, charIndex=0, pending='', inView=false;
    let conversation=[], autoEnabled=true;
    function syncSend() { send.hidden=!input.value.trim(); }
    function stopSequence() {
      phase='idle'; elapsed=0; charIndex=0; pending='';
      typing.hidden=true; send.classList.remove('is-pressed');
    }
    function announce() { transcript.textContent='Demo transcript: '+conversation.join(' '); }
    function userMessage(text) {
      const row=document.createElement('div'); row.className='chat-message chat-user';
      row.innerHTML='<div><strong>You</strong><p>'+escape(text)+'</p></div>';
      log.append(row); conversation.push('You: '+text+'.'); announce();
      log.scrollTop=log.scrollHeight;
    }
    function reply(text) {
      const row=document.createElement('div'); row.className='chat-message chat-bot';
      row.innerHTML='<span class="logo" aria-hidden="true">✳</span><div class="chat-reply"><strong>Now playing: '+escape(text)+' (demo)</strong><p class="chat-artist">Sunday Rooms · Demo artist</p><div class="seek" aria-label="Demo track progress"><i style="--progress:.25"></i></div><div class="chat-times"><small>0:42 / 2:48</small><small>Requested by You</small></div></div>';
      const thumbnail=document.createElement('img');thumbnail.className='chat-cover';thumbnail.alt='';thumbnail.width=72;thumbnail.height=72;thumbnail.decoding='async';thumbnail.src=generatedCover(text);row.querySelector('.chat-reply').append(thumbnail);
      log.append(row); conversation.push('Nyx: Now playing '+text+' (demo), by Sunday Rooms, duration 2 minutes 48 seconds. Requested by You.');
      announce(); log.scrollTop=log.scrollHeight;
    }
    function post(text) {
      stopSequence(); autoEnabled=false;
      input.value=''; syncSend();
      userMessage(text);
      pending=text.replace(/^\/play\s*/i,'').trim()||'A good little tune';
      if(reduced.matches) { reply(pending); stopSequence(); }
      else { phase='before-typing'; elapsed=0; }
    }
    function reset() {
      stopSequence(); conversation=[]; log.replaceChildren(); input.value=''; syncSend();
      autoEnabled=true; announce();
      if(reduced.matches) { userMessage(command); reply('a little late-night jazz'); phase='idle'; autoEnabled=false; }
      else { phase='waiting'; elapsed=0; }
    }
    const chatObserver='IntersectionObserver' in window ? new IntersectionObserver(entries=>{
      inView=entries[0].isIntersecting&&entries[0].intersectionRatio>=.18;
    },{threshold:[0,.18]}) : null;
    if(chatObserver)chatObserver.observe(demo);else inView=true;
    input.addEventListener('input',()=>{ stopSequence(); autoEnabled=false; syncSend(); });
    input.addEventListener('keydown',event=>{
      if(event.key==='Enter'&&input.value.trim()) {event.preventDefault();post(input.value.trim());}
    });
    $('chat-form').addEventListener('submit',event=>{
      event.preventDefault();const text=input.value.trim();if(text)post(text);
    });
    $('chat-reset').addEventListener('click',reset);
    reduced.addEventListener('change',reset);
    // One cancellable state machine uses the shared visible-tab clock. No loose timeouts.
    addTask(demo,dt=>{
      if(!inView||reduced.matches)return;
      elapsed+=dt;
      if(phase==='waiting'&&autoEnabled&&elapsed>=350) {phase='composing';elapsed=0;}
      if(phase==='composing') {
        while(elapsed>=45&&charIndex<command.length) {charIndex++;elapsed-=45;}
        input.value=command.slice(0,charIndex);syncSend();
        if(charIndex===command.length) {phase='holding';elapsed=0;}
      } else if(phase==='holding'&&elapsed>=450) {
        send.classList.add('is-pressed');phase='pressing';elapsed=0;
      } else if(phase==='pressing'&&elapsed>=130) {
        post(input.value);
      } else if(phase==='before-typing'&&elapsed>=150) {
        typing.hidden=!!input.value.trim();phase='typing';elapsed=0;
      } else if(phase==='typing'&&elapsed>=900) {
        typing.hidden=true;reply(pending);stopSequence();
      }
    },50);
    addEventListener('pagehide',()=>{stopSequence();chatObserver?.disconnect();});
    addEventListener('pageshow',event=>{if(event.persisted){chatObserver?.observe(demo);reset();}});
    reset();
  }
  function filters(container,values,active,onChange){container.replaceChildren();values.forEach(([value,label])=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.setAttribute('aria-pressed',String(value===active));b.addEventListener('click',()=>{container.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));onChange(value);});container.append(b);});}
  if($('command-list')){let commands=[],category=new URLSearchParams(location.search).get('category')||'all';$('command-search').value=new URLSearchParams(location.search).get('q')||'';function render(){const q=$('command-search').value.toLowerCase();const matches=commands.filter(c=>(category==='all'||category===c.category)&&(c.name+' '+c.description).toLowerCase().includes(q));$('command-results').textContent=matches.length+' of '+commands.length+' commands';$('command-list').classList.remove('skeleton-grid');$('command-list').innerHTML=matches.length?matches.map(c=>`<details class="card command-card reveal"><summary><strong>/${escape(c.name)}</strong><p>${escape(c.description)}</p></summary><div class="command-detail"><dl><dt>Usage</dt><dd><code>${escape(c.usage)}</code></dd><dt>Example</dt><dd><code>${escape(c.example)}</code></dd></dl><button type="button" data-copy="${escape('/'+c.name)}" aria-label="Copy /${escape(c.name)}">Copy command ↗</button></div></details>`).join(''):'<p class="empty-state">No commands match. Try a different search or category.</p>';reveal($('command-list'));}async function load(){$('command-error').hidden=true;try{const r=await fetch('/api/commands',{cache:'no-store'});if(!r.ok)throw Error();commands=await r.json();$('command-count').textContent=commands.length;filters($('command-filters'),[['all','All commands'],...new Map(commands.map(c=>[c.category,c.categoryLabel])).entries()],category,value=>{category=value;render();});render();}catch{$('command-error').hidden=false;$('command-list').replaceChildren();$('command-results').textContent='Command guide unavailable';}}$('command-search').addEventListener('input',render);$('command-retry').addEventListener('click',load);load();}
  if($('timeline')){let entries=[],kind='all',expanded=new Set();function ago(date){const h=Math.max(0,Math.floor((Date.now()-Date.parse(date))/3600000));return h<1?'less than an hour ago':h<24?h+' hours ago':Math.floor(h/24)+' days ago';}function render(){const q=$('change-search').value.toLowerCase();const matches=entries.filter(e=>(kind==='all'||e.changes.some(c=>c.type===kind))&&(e.title+' '+e.changes.map(c=>c.text).join(' ')).toLowerCase().includes(q));$('change-results').textContent=matches.length+' updates';$('timeline').innerHTML=matches.length?matches.map(e=>`<details class="card reveal" data-entry="${escape(e.id)}" ${expanded.has(e.id)?'open':''}><summary><span class="entry-date"><time datetime="${escape(e.date)}">${escape(new Date(e.date).toLocaleDateString([], {month:'long',day:'numeric',year:'numeric'}))}</time> · ${ago(e.date)}</span><h2>${escape(e.title)}</h2><span class="entry-tags">${[...new Set(e.changes.map(c=>c.type))].map(t=>`<span class="tag" data-kind="${escape(t)}">${escape(t)}</span>`).join('')}</span></summary><div class="entry-body">${e.changes.map(c=>`<div class="change-row"><span class="tag" data-kind="${escape(c.type)}">${escape(c.type)}</span><span>${escape(c.text)}</span></div>`).join('')}</div></details>`).join(''):'<p class="empty-state">No updates match this search.</p>';reveal($('timeline'));$('timeline').querySelectorAll('details').forEach(d=>d.addEventListener('toggle',()=>{if(d.open)expanded.add(d.dataset.entry);else expanded.delete(d.dataset.entry);}));}async function load(){$('change-error').hidden=true;try{const r=await fetch('/changelog.json',{cache:'no-store'});if(!r.ok)throw Error();entries=(await r.json()).sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));filters($('change-filters'),['all','Added','Improved','Fixed','Removed'].map(v=>[v,v==='all'?'All updates':v]),kind,v=>{kind=v;render();});render();}catch{$('timeline').replaceChildren();$('change-results').textContent='Updates unavailable';$('change-error').hidden=false;}}$('change-search').addEventListener('input',render);$('expand-all').addEventListener('click',()=>{$('timeline').querySelectorAll('details').forEach(d=>{expanded.add(d.dataset.entry);d.open=true;});});$('collapse-all').addEventListener('click',()=>{expanded.clear();$('timeline').querySelectorAll('details').forEach(d=>d.open=false);});$('change-retry').addEventListener('click',load);load();addTask($('timeline'),()=>{$('timeline').querySelectorAll('time').forEach(t=>t.parentElement.lastChild.textContent=' · '+ago(t.dateTime));},60000);}
  addEventListener('pagehide',()=>{clearInterval(clock);clearTimeout(safety);coverFade?.cancel();healthController?.abort();observer?.disconnect();revealObserver?.disconnect();});
  addEventListener('pageshow',e=>{if(e.persisted){visibility();reveal();}});
})();
