/* Shared motion layer. No data requests, no changes to course or account state. */
(()=>{
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const fine=matchMedia('(hover: hover) and (pointer: fine)');
  const app=document.getElementById('app');
  let lastTab='login', scanFrame=0, pointerFrame=0, pendingPointer=null;
  const seen=new WeakSet(), observed=new WeakSet();
  const svg=(path)=>`<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
  const aura=document.createElement('div'),dot=document.createElement('div');
  aura.className='cursor-aura';dot.className='cursor-dot';aura.ariaHidden=dot.ariaHidden='true';document.body.append(aura,dot);

  const observer=new IntersectionObserver(entries=>{
    entries.forEach(({target,isIntersecting})=>{
      if(!isIntersecting)return;
      observer.unobserve(target);
      if(reduced.matches)return;
      const siblings=[...target.parentElement.children].filter(e=>e.matches('.stat,.course-card,.inbox-card'));
      const delay=Math.max(0,siblings.indexOf(target))*65;
      target.animate([{opacity:0,transform:'translateY(22px) scale(.985)',filter:'blur(4px)'},{opacity:1,transform:'translateY(0) scale(1)',filter:'blur(0px)'}],{duration:650,delay,easing:'cubic-bezier(.16,1,.3,1)',fill:'backwards'});
    });
  },{threshold:.08});

  function scan(){
    scanFrame=0;
    document.querySelectorAll('.page-top,.hero,.stat,.course-card,.panel,.lesson-box,.inbox-card,.empty,.auth-form-wrap,.auth-story h1,.auth-story>p,.auth-mini,.quiz-question').forEach(el=>{
      if(!observed.has(el)){observed.add(el);observer.observe(el);}
    });
    const story=document.querySelector('.auth-story');
    if(story&&!seen.has(story)){
      seen.add(story);
      const scene=document.createElement('div');scene.className='constellation';scene.ariaHidden='true';
      scene.innerHTML=`<div class="orbit-ring"></div><div class="orbit-ring second"></div><div class="orbit-ring third"></div><div class="orbit-core">${svg('M12 2l3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7')}</div><div class="orbit-track"><span class="orbit-node">${svg('M14 2H5v20h14V7l-5-5z M14 2v6h5 M8 12h8 M8 16h6')}</span></div><div class="orbit-track reverse"><span class="orbit-node">${svg('M8 14l-2 8 6-3 6 3-2-8 M19 9a7 7 0 1 1-14 0 7 7 0 0 1 14 0')}</span></div>`;
      story.append(scene);
    }
    const tabs=document.querySelector('.auth-tabs');
    if(tabs&&!seen.has(tabs)){
      seen.add(tabs);const indicator=document.createElement('span');indicator.className='auth-tab-glider';indicator.ariaHidden='true';tabs.prepend(indicator);
      const active=tabs.querySelector('button.active'),buttons=[...tabs.querySelectorAll('button')],previous=buttons.find(b=>b.dataset.action.includes(lastTab))||active;
      const end=active.offsetLeft,start=previous.offsetLeft;
      indicator.style.width=active.offsetWidth+'px';indicator.style.transform=`translateX(${end}px)`;
      if(!reduced.matches)indicator.animate([{transform:`translateX(${start}px)`},{transform:`translateX(${end}px)`}],{duration:450,easing:'cubic-bezier(.2,1.25,.4,1)'});
      lastTab=active.dataset.action.replace('auth-','');
    }
    document.querySelectorAll('.modal').forEach(el=>{
      if(seen.has(el))return;seen.add(el);
      if(!reduced.matches)el.animate([{opacity:0,transform:'translateY(26px) scale(.93)',filter:'blur(5px)'},{opacity:1,transform:'translateY(0) scale(1)',filter:'blur(0px)'}],{duration:460,easing:'cubic-bezier(.2,1.15,.35,1)'});
    });
  }
  function queueScan(){if(!scanFrame)scanFrame=requestAnimationFrame(scan);}
  new MutationObserver(queueScan).observe(app,{childList:true,subtree:true});
  new MutationObserver(queueScan).observe(document.getElementById('modal-root'),{childList:true,subtree:true});
  scan();
  addEventListener('auth-mode-changed',()=>{
    const tabs=document.querySelector('.auth-tabs'),active=tabs?.querySelector('button.active'),glider=tabs?.querySelector('.auth-tab-glider');
    if(!active||!glider)return;
    const previous=getComputedStyle(glider).transform;
    glider.getAnimations().forEach(a=>a.cancel());
    glider.style.width=active.offsetWidth+'px';
    const destination=`translateX(${active.offsetLeft}px)`;
    glider.style.transform=destination;
    if(!reduced.matches)glider.animate([{transform:previous},{transform:destination}],{duration:420,easing:'cubic-bezier(.22,1,.36,1)'});
    lastTab=active.dataset.action.replace('auth-','');
  });
  addEventListener('resize',()=>{
    const tabs=document.querySelector('.auth-tabs'),active=tabs?.querySelector('button.active'),glider=tabs?.querySelector('.auth-tab-glider');
    if(active&&glider){glider.style.width=active.offsetWidth+'px';glider.style.transform=`translateX(${active.offsetLeft}px)`;}
  },{passive:true});

  function paintPointer(){
    pointerFrame=0;const e=pendingPointer;if(!e||!fine.matches||reduced.matches)return;
    const {x,y,target}=e;
    dot.style.transform=`translate3d(${x}px,${y}px,0)`;
    aura.style.transform=`translate3d(${x}px,${y}px,0)`;
    dot.style.opacity='1';aura.style.opacity='1';
    dot.classList.toggle('on-control',!!target.closest('button,a,input,textarea,select,summary'));
    const surfaces=new Set();
    for(const selector of ['.btn','.course-card','.stat','.hero','.auth-mini','.auth-form-wrap']){
      const el=target.closest(selector);if(el)surfaces.add(el);
    }
    surfaces.forEach(el=>{
      const r=el.getBoundingClientRect(),px=x-r.left,py=y-r.top;
      el.style.setProperty('--mx',px+'px');el.style.setProperty('--my',py+'px');
      if(el.classList.contains('btn')&&!el.disabled){
        el.style.translate=`${((px/r.width)-.5)*7}px ${((py/r.height)-.5)*5}px`;
      }
      if(el.classList.contains('course-card')){
        el.style.setProperty('--ry',((px/r.width)-.5)*5+'deg');
        el.style.setProperty('--rx',-((py/r.height)-.5)*4+'deg');
      }
    });
    for(const selector of ['.auth-story','.auth-form-side','.hero']){
      const el=target.closest(selector);if(!el)continue;
      const r=el.getBoundingClientRect(),px=x-r.left,py=y-r.top;
      el.style.setProperty('--sx',px+'px');el.style.setProperty('--sy',py+'px');
      el.style.setProperty('--parallax-x',((px/r.width)-.5)*7+'px');
      el.style.setProperty('--parallax-y',((py/r.height)-.5)*6+'px');
    }
  }
  document.addEventListener('pointermove',e=>{pendingPointer={x:e.clientX,y:e.clientY,target:e.target};if(!pointerFrame)pointerFrame=requestAnimationFrame(paintPointer);},{passive:true});
  document.addEventListener('pointerout',e=>{
    const button=e.target.closest('.btn');
    if(button&&!button.contains(e.relatedTarget))button.style.translate='0px 0px';
    const card=e.target.closest('.course-card');
    if(card&&!card.contains(e.relatedTarget)){card.style.setProperty('--rx','0deg');card.style.setProperty('--ry','0deg');}
    if(!e.relatedTarget){dot.style.opacity='0';aura.style.opacity='0';}
  },{passive:true});
  document.addEventListener('pointerdown',e=>{
    if(reduced.matches)return;
    const b=e.target.closest('.btn,.icon-btn,.chip,.role-picker button');
    if(!b||b.disabled)return;
    if(b.matches('.btn')){
      const r=b.getBoundingClientRect(),size=Math.max(r.width,r.height)*2.5;
      const ripple=document.createElement('span');ripple.className='ripple';ripple.ariaHidden='true';
      ripple.style.width=ripple.style.height=size+'px';ripple.style.left=(e.clientX-r.left-size/2)+'px';ripple.style.top=(e.clientY-r.top-size/2)+'px';
      b.append(ripple);setTimeout(()=>ripple.remove(),800);
    }
    b.animate([{scale:'1'},{scale:'.96'},{scale:'1'}],{duration:360,easing:'cubic-bezier(.2,1.5,.4,1)'});
  },{passive:true});
  reduced.addEventListener('change',()=>{if(reduced.matches){dot.style.opacity=aura.style.opacity='0';document.getAnimations().forEach(a=>{if(a.effect?.target?.closest?.('#app,#modal-root'))a.cancel();});}});
})();
