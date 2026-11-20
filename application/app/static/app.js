'use strict';
const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const esc = (v='') => String(v ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths={grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',book:'M4 3h12a3 3 0 0 1 3 3v15H7a3 3 0 0 1-3-3V3z M4 17a3 3 0 0 1 3-3h12 M8 7h7 M8 10h5',plus:'M12 5v14 M5 12h14',arrow:'M5 12h14 M14 7l5 5-5 5',back:'M19 12H5 M10 7l-5 5 5 5',users:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M17 4a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',mail:'M3 5h18v14H3z M3 5l9 8 9-8',logout:'M9 3H4v18h5 M12 12h9 M17 8l4 4-4 4',shield:'M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3z M8 12l3 3 5-6',check:'M5 12l4 4L19 6',clock:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 7v5l3 2',search:'M20 20l-5-5 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',spark:'M12 2l3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7',file:'M14 2H5v20h14V7l-5-5z M14 2v6h5 M8 12h8 M8 16h6',chart:'M4 3v18h17 M8 16v-5 M13 16V7 M18 16V4',bell:'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4',close:'M6 6l12 12 M18 6L6 18',chevron:'M9 5l7 7-7 7',down:'M6 9l6 6 6-6',up:'M6 15l6-6 6 6',trash:'M3 6h18 M9 6V3h6v3 M6 6v15h12V6 M10 10v7 M14 10v7',edit:'M16 3l5 5-12 12-6 1 1-6L16 3z',upload:'M12 16V3 M7 8l5-5 5 5 M3 16v5h18v-5',lock:'M5 10h14v11H5z M8 10V6a4 4 0 0 1 8 0v4',eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12 M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',info:'M12 8h.01 M12 11v6 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',play:'M8 4l12 8-12 8V4z',save:'M3 3h15l3 3v15H3V3z M7 3v6h10V3 M7 21v-8h10v8',award:'M8 14l-2 8 6-3 6 3-2-8 M19 9a7 7 0 1 1-14 0 7 7 0 0 1 14 0'};
const icon = n=>`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[n]||paths.book}"/></svg>`;
const brand=()=>`<a class="brand" href="#/" aria-label="StartWork — на главный экран"><span class="brand-mark">s<span>↗</span></span><span class="brand-text">StartWork<small>SPACE TO GROW</small></span></a>`;
const initials = u=>esc((u.name||u.login||'S').slice(0,2).toUpperCase());
const btn=(label,action,ico='plus',cls='primary')=>`<button class="btn ${cls}" data-action="${action}">${icon(ico)}${label}</button>`;
let user=null, config={}, currentCourse=null, currentAssignment=null, viewToken=0, authMode='login', authRole='mentor', courseFilter='all', emailVisible=false, editorDirty=false;
const kinds={single:'Один правильный ответ',multiple:'Несколько правильных ответов',matching:'Сопоставление',order:'Правильная последовательность'};

async function api(path, options={}){
  const opts={...options,credentials:'same-origin',headers:{'X-StartWork':'1',...options.headers}};
  if(options.body && !(options.body instanceof FormData)){opts.body=JSON.stringify(options.body);opts.headers['Content-Type']='application/json';}
  const res=await fetch('/api'+path,opts);
  let data;try{data=await res.json();}catch{throw new Error('Сервер вернул неожиданный ответ. Повторите позже.');}
  if(!res.ok){
    let detail=data.detail;
    if(Array.isArray(detail))detail=detail.map(validationMessage).join('; ');
    if(res.status===401 && user && !path.includes('/auth/')){user=null;renderAuth();}
    throw new Error(typeof detail==='string'?detail:'Не удалось выполнить действие');
  }
  return data;
}
function validationMessage(error){
 const labels={title:'Название',description:'Описание',lessons:'Темы курса',summary:'Учебный материал',exercises:'Задания',options:'Варианты ответа',answers:'Правильные ответы',prompt:'Текст задания',explanation:'Объяснение',left:'Пары для сопоставления',login:'Логин',password:'Пароль'};
 const key=[...(error.loc||[])].reverse().find(x=>typeof x==='string'&&labels[x]);
 const label=labels[key]||'Проверьте заполнение';
 if(error.type==='too_short'||error.type==='string_too_short')return label+': минимум '+(error.ctx?.min_length||1)+(error.type==='string_too_short'?' символов.':' элементов.');
 if(error.type==='too_long'||error.type==='string_too_long')return label+': превышен допустимый размер.';
 if(error.type==='missing')return label+': заполните это поле.';
 if(error.type==='value_error')return label+': '+error.msg.replace(/^Value error, /,'');
 return label+': проверьте значение и сохраните ещё раз.';
}
let jobClock=null;
const activeJob = j=>j && !['done','error'].includes(j.status);
function toast(message,error=false){const d=document.createElement('div');d.className='toast'+(error?' error':'');d.textContent=message;$('#toasts').append(d);setTimeout(()=>d.remove(),error?8000:4200);}
function notice(message,type=''){return `<div class="notice ${type}">${icon(type==='warning'?'info':'shield')}<span>${message}</span></div>`;}
function empty(title,text,action=''){return `<div class="empty fade-in"><div class="empty-symbol">${icon('book')}</div><h3>${title}</h3><p>${text}</p>${action}</div>`;}
function closeModal(){const previous=$('#modal-root')._previous;$('#modal-root').innerHTML='';previous?.focus();}
function modal(title,body){
  const root=$('#modal-root');root._previous=document.activeElement;
  root.innerHTML=`<div class="modal-overlay"><section role="dialog" aria-modal="true" aria-label="${esc(title)}" class="modal"><button class="icon-btn close" data-action="close-modal" aria-label="Закрыть">${icon('close')}</button><h2>${esc(title)}</h2>${body}</section></div>`;
  $('.modal-overlay').addEventListener('click',e=>{if(e.target===e.currentTarget)closeModal();});
  setTimeout(()=>$('.modal input,.modal button:not(.close)')?.focus(),30);
}
document.addEventListener('keydown',e=>{
 if(e.key==='Escape')closeModal();
 if(e.key==='Tab' && $('.modal')){const controls=$$('button:not(:disabled),input,select,textarea,a[href]', $('.modal')).filter(x=>x.offsetParent!==null);const first=controls[0],last=controls.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}
});
window.addEventListener('beforeunload',e=>{if(editorDirty){e.preventDefault();e.returnValue='';}});

function renderAuth(error=''){
  viewToken++;document.title='StartWork — вход';
  const register=authMode==='register';
  const markup=`<div class="auth-page"><section class="auth-story">${brand()}<h1>Первый день.<br>Новые знания.<br><em>Уверенный старт.</em></h1><p>Соберите опыт вашей команды в курсы,<br>которые помогут новичкам освоиться.</p><div class="auth-mini"><span class="pill">Пространство обучения</span><p>От внутренних материалов —<br>к понятному пути адаптации.</p><div class="row">${icon('file')}<span>Материал</span>${icon('arrow')}<span>Курс</span>${icon('arrow')}${icon('award')}</div></div><div class="auth-footer">${icon('shield')} Ваши курсы. Ваша команда. Ваше пространство.</div></section><section class="auth-form-side"><div class="auth-form-wrap fade-in"><div class="mobile-brand">${brand()}</div><h2>${register?'Начнём знакомство':'С возвращением'}</h2><p class="muted">${register?'Создайте аккаунт и выберите свою роль.':'Войдите, чтобы продолжить свой путь.'}</p><div class="auth-tabs"><button data-action="auth-login" class="${!register?'active':''}">Войти</button><button data-action="auth-register" class="${register?'active':''}">Создать аккаунт</button></div><form id="auth-form">${register?`<div class="role-picker"><button type="button" data-action="role-mentor" class="${authRole==='mentor'?'selected':''}">${icon('users')}Я наставник</button><button type="button" data-action="role-learner" class="${authRole==='learner'?'selected':''}">${icon('book')}Я учусь</button></div><label class="field"><span>Как вас зовут <small style="display:inline">· необязательно</small></span><input name="name" autocomplete="name" maxlength="100" placeholder="Александр"></label>`:''}<label class="field"><span>Логин</span><input name="login" required minlength="3" maxlength="40" autocomplete="username" placeholder="Ваш логин" autocapitalize="none" spellcheck="false"></label><label class="field"><span>Пароль</span><input name="password" type="password" required maxlength="128" autocomplete="${register?'new-password':'current-password'}" placeholder="${register?'Хотя бы одна цифра':'Ваш пароль'}">${register?'<small>Без подтверждений и писем. Добавьте хотя бы одну цифру.</small>':''}</label>${register?`<button type="button" class="auth-email" data-action="show-email">${emailVisible?'Почта необязательна':'＋ Добавить почту · необязательно'}</button>${emailVisible?'<label class="field"><span>Почта</span><input type="email" name="email" autocomplete="email" placeholder="name@company.ru"></label>':''}`:''}<div id="auth-error">${error?`<div class="form-error">${esc(error)}</div>`:''}</div><button type="submit" class="btn primary wide">${register?'Создать аккаунт':'Войти в пространство'}${icon('arrow')}</button></form><p class="auth-note">${register?'Роль определяет ваш кабинет. Наставник создаёт курсы,<br>обучающийся проходит назначенное обучение.':'Логин и пароль — всё, что нужно для входа.'}</p></div></section></div>`;
  const existing=$('.auth-form-wrap');
  if(existing && $('.auth-page')){
    const values=Object.fromEntries(new FormData($('#auth-form')));
    const height=existing.getBoundingClientRect().height;
    const focused=document.activeElement?.dataset.action;
    const fragment=document.createElement('template');fragment.innerHTML=markup;
    const next=fragment.content.querySelector('.auth-form-wrap');
    // Keep the scene, card and tab buttons mounted; only form content changes.
    const tabs=$('.auth-tabs');
    const nextTabs=next.querySelector('.auth-tabs');
    $$('button',tabs).forEach(b=>b.classList.toggle('active',b.dataset.action===(register?'auth-register':'auth-login')));
    nextTabs.replaceWith(tabs);
    existing._resizeAnimation?.cancel();
    existing.replaceChildren(...next.childNodes);
    for(const [key,value] of Object.entries(values)){
      const input=$('[name="'+key+'"]',existing);if(input)input.value=value;
    }
    if(focused)$('[data-action="'+focused+'"]',existing)?.focus({preventScroll:true});
    const targetHeight=existing.getBoundingClientRect().height;
    if(!matchMedia('(prefers-reduced-motion: reduce)').matches){
      existing.style.overflow='hidden';
      const animation=existing.animate([{height:height+'px'},{height:targetHeight+'px'}],{duration:420,easing:'cubic-bezier(.22,1,.36,1)'});
      existing._resizeAnimation=animation;
      animation.finished.then(()=>{if(existing._resizeAnimation===animation){existing.style.overflow='';existing._resizeAnimation=null;}}).catch(()=>{});
      for(const el of [$('#auth-form'),$('h2',existing),$('.auth-note',existing)]){
        el?.animate([{opacity:0,transform:'translateY(7px)'},{opacity:1,transform:'translateY(0)'}],{duration:280,delay:70,easing:'ease-out',fill:'backwards'});
      }
    }
    window.dispatchEvent(new Event('auth-mode-changed'));
  }else $('#app').innerHTML=markup;
  $('#auth-form').onsubmit=async e=>{
    e.preventDefault();const b=$('button[type=submit]',e.target);b.disabled=true;
    const data=Object.fromEntries(new FormData(e.target));if(register)data.role=authRole;
    try{user=await api('/auth/'+(register?'register':'login'),{method:'POST',body:data});location.hash='#/';await bootUser();}
    catch(err){$('#auth-error').innerHTML=`<div class="form-error">${esc(err.message)}</div>`;b.disabled=false;}
  };
}

function shell(active='home'){
  const mentor=user.role==='mentor';
  $('#app').innerHTML=`<aside class="sidebar">${brand()}<a class="workspace" href="#/" aria-label="Открыть личное пространство"><span class="workspace-icon">${icon('users')}</span><div>Личное пространство<p>${mentor?'Кабинет наставника':'Моё обучение'}</p></div></a><div class="nav-label">РАБОЧЕЕ ПРОСТРАНСТВО</div><nav><a href="#/" aria-label="Обзор" class="nav-link ${active==='home'?'active':''}">${icon('grid')}<span>Обзор</span></a><a href="#/courses" aria-label="Курсы" class="nav-link ${active==='courses'?'active':''}">${icon('book')}<span>${mentor?'Мои курсы':'Моё обучение'}</span></a>${mentor?`<a href="#/invitations" aria-label="Приглашения" class="nav-link ${active==='invitations'?'active':''}">${icon('mail')}<span>Приглашения</span><span class="count hide" id="inbox-count"></span></a>`:''}<a href="#/profile" aria-label="Настройки профиля" class="nav-link ${active==='profile'?'active':''}">${icon('edit')}<span>Настройки профиля</span></a></nav><div class="sidebar-bottom"><div class="privacy-note">${icon('shield')}<p>${mentor?'Курсы доступны только вам<br>и приглашённым наставникам.':'Здесь только ваши курсы<br>и ваши результаты.'}</p></div><div class="profile"><a href="#/profile" class="profile-link" aria-label="Открыть настройки профиля"><div class="avatar">${initials(user)}</div><div class="profile-info"><div class="profile-name">${esc(user.name)}</div><div class="profile-role">${mentor?'Наставник':'Обучающийся'}</div></div></a><button class="icon-btn" aria-label="Выйти из аккаунта" title="Выйти" data-action="logout">${icon('logout')}</button></div></div></aside><main class="main"><header class="topbar"><div class="breadcrumb"><a class="breadcrumb-root" href="#/">Пространство</a>${icon('chevron')}<span id="breadcrumb-title">Обзор</span></div><div class="topbar-right"><span class="muted">Учимся. Растём. Вместе.</span>${mentor?`<a href="#/invitations" class="icon-btn" aria-label="Приглашения">${icon('bell')}</a>`:''}<a class="avatar profile-avatar" href="#/profile" aria-label="Настройки профиля" title="Настройки профиля">${initials(user)}</a><button class="icon-btn mobile-logout" data-action="logout" aria-label="Выйти из аккаунта">${icon('logout')}</button></div></header><div class="content" id="content"></div></main>`;
  if(mentor)api('/invitations').then(data=>{const c=$('#inbox-count');if(c && data.length){c.textContent=data.length;c.classList.remove('hide');}}).catch(()=>{});
}
async function bootUser(){
  if(user.role==='mentor'){try{config=await api('/config');}catch(e){toast(e.message,true);}}
  await route();
}
async function route(){
  if(!user)return renderAuth();
  const token=++viewToken;clearInterval(jobClock);jobClock=null;currentCourse=null;currentAssignment=null;
  const path=location.hash.replace(/^#\/?/,'').split('/');
  shell(path[0]==='profile'?'profile':path[0]==='invitations'?'invitations':path[0]?'courses':'home');
  $('#content').innerHTML='<div class="course-grid"><div class="skeleton"></div><div class="skeleton"></div></div>';
  try{
    if(path[0]==='profile')await profilePage(token);
    else if(path[0]==='course' && user.role==='mentor')await coursePage(Number(path[1]),path[2]||'content',token);
    else if(path[0]==='learn')await readerPage(Number(path[1]),Number(path[2]||0),token);
    else if(path[0]==='invitations' && user.role==='mentor')await inboxPage(token);
    else await dashboard(path[0]==='courses',token);
  }catch(e){if(token===viewToken && user)$('#content').innerHTML=empty('Не удалось открыть страницу',esc(e.message),'<a href="#/" class="btn">Вернуться к обзору</a>');}
}
async function profilePage(token){
 const account=await api('/me');if(token!==viewToken)return;user=account;
 $('#breadcrumb-title').textContent='Настройки профиля';
 $('#content').innerHTML=`<div class="page-top fade-in"><div><div class="eyebrow">Ваше пространство</div><h1>Настройки профиля</h1><p>Как к вам обращаться и как защитить ваш аккаунт.</p></div></div><section class="panel profile-overview"><div class="avatar profile-large-avatar">${initials(user)}</div><div class="grow"><h2>${esc(user.name)}</h2><p class="muted">@${esc(user.login)}</p></div><span class="pill">${user.role==='mentor'?'Наставник':'Обучающийся'}</span></section><div class="profile-settings-grid"><section class="panel"><div class="settings-heading">${icon('users')}<div><h2>Личные данные</h2><p>Имя видно другим участникам ваших курсов.</p></div></div><form id="profile-details"><label class="field"><span>Ваше имя</span><input name="name" required maxlength="100" autocomplete="name" value="${esc(user.name)}"></label><label class="field"><span>Логин</span><input readonly class="readonly-input" value="${esc(user.login)}" aria-label="Ваш логин"><small>Используется для входа, приглашений и назначений. Не меняется.</small></label><label class="field"><span>Почта · необязательно</span><input name="email" type="email" autocomplete="email" maxlength="254" value="${esc(user.email)}" placeholder="name@company.ru"><small>Подтверждение почты не требуется.</small></label><div id="profile-error" class="inline-error" role="alert"></div><button type="submit" class="btn primary">${icon('save')}Сохранить изменения</button></form></section><section class="panel"><div class="settings-heading">${icon('lock')}<div><h2>Безопасность</h2><p>Для смены пароля понадобится текущий пароль.</p></div></div><form id="password-form"><label class="field"><span>Текущий пароль</span><input name="current_password" type="password" required maxlength="128" autocomplete="current-password"></label><label class="field"><span>Новый пароль</span><input name="new_password" type="password" required maxlength="128" autocomplete="new-password"><small>Хотя бы одна цифра; должен отличаться от текущего.</small></label><label class="field"><span>Повторите новый пароль</span><input name="confirm_password" type="password" required maxlength="128" autocomplete="new-password"></label><div id="password-error" class="inline-error" role="alert"></div><button type="submit" class="btn">${icon('lock')}Изменить пароль</button></form><p class="settings-security-note">После смены пароля остальные сеансы будут завершены. В этом браузере вы останетесь в аккаунте.</p></section></div>`;
 $('#profile-details').onsubmit=async e=>{
   e.preventDefault();const b=$('button[type=submit]',e.target);b.disabled=true;$('#profile-error').textContent='';
   try{user=await api('/me',{method:'PUT',body:Object.fromEntries(new FormData(e.target))});toast('Профиль обновлён');await route();}
   catch(err){if($('#profile-error'))$('#profile-error').textContent=err.message;b.disabled=false;}
 };
 $('#password-form').onsubmit=async e=>{
   e.preventDefault();const data=Object.fromEntries(new FormData(e.target)),error=$('#password-error');error.textContent='';
   if(data.new_password!==data.confirm_password){error.textContent='Новые пароли не совпадают';return;}
   if(!/[0-9]/.test(data.new_password)){error.textContent='Добавьте в новый пароль хотя бы одну цифру';return;}
   const b=$('button[type=submit]',e.target);b.disabled=true;
   try{await api('/me/password',{method:'POST',body:{current_password:data.current_password,new_password:data.new_password}});e.target.reset();toast('Пароль изменён. Остальные сеансы завершены.');}
   catch(err){if($('#password-error'))$('#password-error').textContent=err.message;}
   finally{b.disabled=false;}
 };
}

function art(){return `<div class="hero-art" aria-hidden="true"><div class="art-sheet back"></div><div class="art-sheet">${icon('file')}</div><div class="art-star">✦</div><div class="art-dot"></div></div>`;}
function stats(items){return `<div class="stat-grid stagger">${items.map(([n,title,ico])=>`<div class="stat"><span class="stat-icon">${icon(ico)}</span><div><strong>${n}</strong><p>${title}</p></div></div>`).join('')}</div>`;}
function courseCard(c,learner=false){
  const done=learner&&c.progress===100;
  const state=learner?(done?'Завершён':c.progress>0?'В процессе':'Назначен'):(c.published?'Опубликован':'Черновик');
  const href=learner?`#/learn/${c.id}/${c.completed_lessons.length===c.lesson_count?0:c.completed_lessons.length}`:`#/course/${c.id}`;
  return `<a href="${href}" class="course-card" data-title="${esc(c.title.toLowerCase())}" data-state="${learner?(done?'done':'progress'):(c.published?'published':'draft')}"><div class="course-cover"><div class="cover-decoration"></div><span class="cover-symbol">${icon(learner?'book':'file')}</span><span class="pill ${done?'green':c.published?'blue':''}">${state}</span></div><div class="course-body"><h3>${esc(c.title)}</h3><p class="description">${esc(c.description||'Знания, которые помогают увереннее справляться с работой.')}</p><div class="course-meta"><span>${icon('book')}${c.lesson_count} ${plural(c.lesson_count,'тема','темы','тем')}</span><span>${icon(learner?'chart':'users')}${learner?c.progress+'% пройдено':c.owner_id===user.id?'Ваш курс':'Совместный курс'}</span></div>${learner?`<div class="progress"><i style="width:${c.progress}%"></i></div>`:''}<div class="course-footer"><span>${learner?'Ваш путь обучения':c.published?'Версия '+c.revision:'Готовим к публикации'}</span><span class="text-link">${learner?(done?'Повторить':'Продолжить'):'Открыть курс'}${icon('arrow')}</span></div></div></a>`;
}
function plural(n,one,two,many){return n%10===1&&n%100!==11?one:n%10>=2&&n%10<=4&&(n%100<12||n%100>14)?two:many;}
async function dashboard(onlyCourses,token){
  const mentor=user.role==='mentor', courses=await api(mentor?'/courses':'/assignments');
  if(token!==viewToken)return;
  $('#breadcrumb-title').textContent=onlyCourses?(mentor?'Мои курсы':'Моё обучение'):'Обзор';
  const published=courses.filter(c=>c.published).length, completed=courses.filter(c=>c.progress===100).length;
  $('#content').innerHTML=`<div class="page-top fade-in"><div><div class="eyebrow">${mentor?'Всё для уверенного старта':'Ваш следующий шаг'}</div><h1>${onlyCourses?(mentor?'Мои курсы':'Моё обучение'):`Привет, ${esc(user.name.split(' ')[0])} <span style="color:#c8acf0">✦</span>`}</h1><p>${mentor?'Помогайте команде расти — один курс за другим.':'Осваивайте новое в своём темпе. Ваш прогресс сохраняется.'}</p></div>${mentor?btn('Создать курс','new-course'):''}</div>${!onlyCourses?`<section class="hero fade-in"><div class="hero-text"><div class="hero-tag">${icon('spark')} ${mentor?'ОПЫТ КОМАНДЫ → НОВЫЕ ВОЗМОЖНОСТИ':'ОТ ПЕРВОГО ШАГА — К УВЕРЕННОСТИ'}</div><h2>${mentor?'Знания, с которых всё начинается':'Большой путь начинается с малого'}</h2><p>${mentor?'Загрузите материалы компании. Соберите понятный курс, проверьте содержание и пригласите команду учиться.':'Ваш наставник подготовил материалы и задания. Изучайте темы, проверяйте себя и двигайтесь вперёд.'}</p>${mentor?btn('Начать с нового курса','new-course','plus',''):courses.length?`<a class="btn" href="#/learn/${courses.find(c=>c.progress<100)?.id||courses[0].id}/0">${icon('play')}Перейти к обучению</a>`:''}</div>${art()}</section>${mentor?stats([[courses.length,'Всего курсов','book'],[published,'Опубликовано','check'],[courses.length-published,'В подготовке','edit']]):stats([[courses.length,'Назначено курсов','book'],[courses.length-completed,'В процессе','clock'],[completed,'Завершено','award']])}`:''}<div class="section-head"><h2>${onlyCourses?'Библиотека курсов':mentor?'Ваши курсы':'Мой путь обучения'}</h2><span class="muted">${courses.length} ${plural(courses.length,'курс','курса','курсов')}</span></div><div class="toolbar"><div class="chips">${(mentor?[['all','Все курсы'],['published','Опубликованные'],['draft','Черновики']]:[['all','Все курсы'],['progress','В процессе'],['done','Завершённые']]).map(([id,label])=>`<button data-filter="${id}" class="chip ${courseFilter===id?'active':''}">${label}</button>`).join('')}</div><div class="searchbox">${icon('search')}<input id="course-search" aria-label="Поиск курса" placeholder="Найти курс..."></div></div>${courses.length?`<div class="course-grid stagger" id="course-list">${courses.map(c=>courseCard(c,!mentor)).join('')}</div><div id="filter-empty" class="hide">${empty('Ничего не нашлось','Попробуйте другое название или фильтр.')}</div>`:empty(mentor?'Здесь начнётся первый курс':'Всё готово к новым знаниям',mentor?'Начните с инструкции, документа или описания процесса. Курс останется приватным, пока вы не пригласите участников.':'Попросите наставника назначить вам курс по вашему логину: '+esc(user.login),mentor?btn('Создать первый курс','new-course'):'')}<div class="footer-note">${icon('shield')}${mentor?'Ваши материалы доступны только участникам курса.':'Результаты обучения видите вы и наставники назначенного курса.'}</div>`;
  $('#course-search').oninput=filterCourses;
  $$('[data-filter]').forEach(b=>b.onclick=()=>{courseFilter=b.dataset.filter;$$('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));filterCourses();});
  if(!$$('[data-filter]').some(x=>x.dataset.filter===courseFilter))courseFilter='all';
  filterCourses();
}
function filterCourses(){let count=0;const query=($('#course-search')?.value||'').toLowerCase();$$('.course-card').forEach(c=>{const visible=c.dataset.title.includes(query)&&(courseFilter==='all'||c.dataset.state===courseFilter);c.classList.toggle('hide',!visible);count+=visible;});$('#filter-empty')?.classList.toggle('hide',count>0);}
function newCourse(){modal('Новое начало',`<p>Дайте курсу название. Материалы и задания добавим на следующем шаге.</p><form id="new-course-form"><label class="field"><span>Название курса</span><input name="title" required minlength="2" maxlength="180" placeholder="Например, первые шаги в команде"></label><label class="field"><span>О чём этот курс</span><textarea name="description" maxlength="3000" placeholder="Чему научится новый сотрудник?"></textarea></label><div id="modal-error"></div><button class="btn primary wide" type="submit">Создать приватный курс ${icon('arrow')}</button></form>`);$('#new-course-form').onsubmit=async e=>{e.preventDefault();const b=$('button[type=submit]',e.target);b.disabled=true;try{const c=await api('/courses',{method:'POST',body:Object.fromEntries(new FormData(e.target))});closeModal();location.hash=`#/course/${c.id}/source`;}catch(err){$('#modal-error').innerHTML=`<p class="inline-error">${esc(err.message)}</p>`;b.disabled=false;}};}

async function inboxPage(token){
 const invites=await api('/invitations');if(token!==viewToken)return;$('#breadcrumb-title').textContent='Приглашения';
 $('#content').innerHTML=`<div class="page-top"><div><div class="eyebrow">Вместе — больше</div><h1>Приглашения</h1><p>Примите приглашение, чтобы стать полноправным наставником курса.</p></div></div>${notice('После принятия вы сможете редактировать курс, назначать обучение и просматривать результаты. До принятия доступ закрыт.')}<div class="stagger">${invites.length?invites.map(i=>`<div class="inbox-card"><div class="empty-symbol" style="margin:0">${icon('mail')}</div><div class="grow"><span class="pill">Совместная работа</span><h3 style="margin-top:8px">${esc(i.course_title)}</h3><p>${esc(i.from)} приглашает вас в команду наставников.</p></div><div class="row"><button class="btn subtle" data-invite="${i.id}" data-accept="false">Отклонить</button><button class="btn primary" data-invite="${i.id}" data-accept="true">${icon('check')}Принять</button></div></div>`).join(''):empty('Пока без приглашений','Когда другой наставник пригласит вас в курс, запрос появится здесь. Ваш логин: '+esc(user.login))}</div>`;
 $$('[data-invite]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await api('/invitations/'+b.dataset.invite,{method:'POST',body:{accept:b.dataset.accept==='true'}});toast(b.dataset.accept==='true'?'Курс появился в вашей библиотеке':'Приглашение отклонено');route();}catch(e){toast(e.message,true);b.disabled=false;}});
}

async function coursePage(cid,tab,token){
  const [c,freshConfig]=await Promise.all([api('/courses/'+cid),api('/config')]);if(token!==viewToken)return;config=freshConfig;currentCourse=c;
  if(!['source','content','team','results'].includes(tab))tab='content';
  $('#breadcrumb-title').textContent='Курс';
  $('#content').innerHTML=`<a href="#/courses" class="top-back">${icon('back')}К библиотеке курсов</a><div class="page-top fade-in"><div><div class="publish-badge"><span class="pill ${c.published?'green':''}">${c.published?'Опубликован · версия '+c.revision:'Приватный черновик'}</span><span class="tiny muted">${c.owner_id===user.id?'Вы создатель':'Совместный курс'}</span></div><h1>${esc(c.title)}</h1><p>${esc(c.description||'Соберите знания, которые помогут команде расти.')}</p></div><div class="course-header-actions">${c.published?btn('Назначить обучение','assign','users'):''}${c.owner_id===user.id?btn('Удалить курс','delete-course','trash','danger subtle'):''}</div></div><div class="tabs">${[['source','file','Материалы'],['content','edit','Содержание'],['team','users','Наставники'],['results','chart','Результаты']].map(([id,i,t])=>`<a href="#/course/${cid}/${id}" class="tab ${tab===id?'active':''}">${icon(i)}${t}</a>`).join('')}</div><div id="course-tab" class="fade-in"></div>`;
  if(c.active_job){showJob(c.active_job);pollJob(cid,c.active_job.id,token);}
  if(tab==='source')sourceTab(c);else if(tab==='content')contentTab(c);else if(tab==='team')await teamTab(c,token);else await resultsTab(c,token);
  if(c.active_job)setGenerationBusy(true);
}
function sourceTab(c){
  $('#course-tab').innerHTML=`<section class="panel"><h2>Из чего соберём курс?</h2><p class="muted tiny" style="margin-top:8px">Загрузите документы, опишите процесс своими словами или добавьте и то и другое.</p><div class="spacer"></div><form id="source-form"><label class="file-drop">${icon('upload')}<strong>Выберите материалы курса</strong><span>Перетащите сюда PDF, Word, TXT или MD · до 6 файлов, вместе до 10 МБ</span><span class="file-select-control">${icon('plus')}Выбрать файлы</span><input class="file-input" type="file" name="files" multiple accept=".pdf,.docx,.txt,.md" aria-label="Выбрать файлы курса"><span id="selected-files" class="selected-files" role="status">Файлы пока не выбраны</span></label><label class="field"><span>Или добавьте материал текстом</span><textarea name="text" rows="7" maxlength="120000" placeholder="Опишите процесс, правила, последовательность действий — всё, что важно знать сотруднику."></textarea><small>До 120 000 символов на курс. Все части материала будут отправлены на обработку.</small></label>${notice('При подготовке курса текст передаётся ChatAnywhere для обработки выбранной моделью. Используйте только разрешённые материалы без лишних персональных данных.')}<p class="hint">${c.source?'Новый материал заменит исходник и сбросит черновик. Опубликованная версия и начатое обучение сохранятся.':'Сначала сохраним материал, затем подготовим черновик.'}</p><div class="spacer"></div><button class="btn primary" type="submit" ${c.active_job?'disabled':''}>${icon('save')}Сохранить материалы</button></form></section>${c.source?`<section class="panel"><div class="row between"><h3>Сохранённый исходник</h3><span class="tiny muted">${c.source.length.toLocaleString('ru')} символов</span></div><div class="source-info">${c.sources.map(n=>`<span class="pill">${esc(n)}</span>`).join('')}</div><div class="spacer"></div><div class="source-preview">${esc(c.source)}</div><div class="spacer"></div><div class="row wrap">${btn('Подготовить курс с ИИ','generate','spark')}<a class="btn subtle" href="#/course/${c.id}/content">${icon('edit')}Создать вручную</a></div><p class="tiny muted ai-model-label">Модель: ${esc(config.model)} · ${esc(config.provider||'ChatAnywhere')}</p>${!config.ai_ready?'<div id="ai-setup-notice">'+notice('Добавьте ключ ChatAnywhere в DEEPSEEK_API_KEY в серверном .env. После сохранения файла подготовку можно запустить сразу. До этого доступен ручной редактор.','warning')+'</div>':''}</section>`:''}`;
  const picker=$('#source-form input[type=file]'),drop=$('.file-drop');
  function describeFiles(){
    const files=[...picker.files];
    $('#selected-files').textContent=files.length?files.map(f=>f.name+' · '+(f.size<1024*1024?Math.ceil(f.size/1024)+' КБ':(f.size/1024/1024).toFixed(1)+' МБ')).join('  /  '):'Файлы пока не выбраны';
    drop.classList.toggle('has-files',files.length>0);
  }
  picker.addEventListener('change',describeFiles);
  drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('is-dragging');});
  drop.addEventListener('dragleave',e=>{if(!drop.contains(e.relatedTarget))drop.classList.remove('is-dragging');});
  drop.addEventListener('drop',e=>{
    e.preventDefault();drop.classList.remove('is-dragging');
    if(!e.dataTransfer.files.length)return;
    if(e.dataTransfer.files.length>6||[...e.dataTransfer.files].reduce((n,f)=>n+f.size,0)>10000000){toast('Не больше 6 файлов, вместе до 10 МБ',true);return;}
    picker.files=e.dataTransfer.files;describeFiles();
  });
  $('#source-form').onsubmit=async e=>{
    e.preventDefault();const b=$('button[type=submit]',e.target);const fd=new FormData(e.target);fd.set('version',c.version);
    // Empty file controls are not meaningful uploads.
    const files=fd.getAll('files').filter(f=>f instanceof File&&f.size>0);fd.delete('files');files.forEach(f=>fd.append('files',f));
    if(c.source && !confirm('Заменить исходник и очистить текущий черновик? Опубликованный курс сохранится.'))return;
    b.disabled=true;
    try{await api('/courses/'+c.id+'/source',{method:'POST',body:fd});toast('Материалы сохранены');await route();}catch(err){toast(err.message,true);b.disabled=false;}
  };
}
function newExercise(){return {kind:'single',prompt:'Какое действие будет правильным?',options:['Первый вариант','Второй вариант'],answers:[0],left:[],explanation:'Объясните, почему этот ответ верный.'};}
function newLesson(){return {title:'Новая тема',summary:'Добавьте понятное объяснение темы и ключевые правила.',source_quote:'',source_section:'',exercises:[newExercise()]};}
let draft=null;
function contentTab(c){
  draft=structuredClone(c.content?.lessons?.length?c.content:{lessons:[]});editorDirty=false;
  $('#course-tab').innerHTML=`${!c.source?notice('Можно собрать курс вручную. Для подготовки с ИИ сначала добавьте исходник во вкладке «Материалы».'):''}${c.published?notice('Вы редактируете черновик. Опубликованная версия не изменится до новой публикации. Уже назначенное обучение останется на своей версии.'):''}<section class="panel editor-header"><h3>Основное о курсе</h3><div class="field-grid"><label class="field"><span>Название</span><input id="edit-title" maxlength="180" value="${esc(c.title)}"></label><label class="field"><span>Краткое описание</span><input id="edit-description" maxlength="3000" value="${esc(c.description)}"></label></div></section><div class="row between" style="margin-bottom:18px"><h2>Темы и задания</h2>${c.source?btn('Подготовить с ИИ','generate','spark','small'):''}</div><div id="lessons-editor"></div><div class="row wrap lesson-add-actions">${btn('Добавить тему','add-lesson','plus','')}${!draft.lessons.length?'<span class="tiny muted">или подготовьте черновик по материалам с ИИ</span>':''}</div><div class="action-bar sticky-save"><div><h3 style="font-size:13px">Сначала проверка, потом публикация</h3><p id="save-state">Изменения нужно сохранить перед публикацией.</p></div><div class="row wrap">${btn('Сохранить','save-course','save','')}${btn('Проверить и опубликовать','publish','check','primary')}</div></div>`;
  $('#edit-title').oninput=$('#edit-description').oninput=()=>{editorDirty=true;};
  renderLessons();
}
function renderLessons(openLast=false){
  const opened=new Set($$('#lessons-editor details[open]').map(x=>Number(x.dataset.lesson)));
  $('#lessons-editor').innerHTML=draft.lessons.length?draft.lessons.map((l,li)=>`<details class="lesson-box" data-lesson="${li}" ${opened.has(li)||(!opened.size&&li===0)||openLast&&li===draft.lessons.length-1?'open':''}><summary><span class="lesson-number">${String(li+1).padStart(2,'0')}</span><span>${esc(l.title)}</span><span class="tiny muted">${l.exercises.length} заданий</span>${icon('down')}</summary><div class="lesson-inside"><div class="row between" style="margin:12px 0"><span class="tiny muted">Содержание темы</span><button class="icon-btn" data-remove-lesson="${li}" aria-label="Удалить тему">${icon('trash')}</button></div><label class="field"><span>Название темы</span><input data-l="${li}" data-key="title" value="${esc(l.title)}" maxlength="180"></label><label class="field"><span>Учебный материал</span><textarea data-l="${li}" data-key="summary" rows="7" maxlength="15000">${esc(l.summary)}</textarea></label><label class="field"><span>Раздел исходника</span><input data-l="${li}" data-key="source_section" value="${esc(l.source_section)}" maxlength="180"></label><label class="field"><span>Цитата из исходника для сверки</span><textarea data-l="${li}" data-key="source_quote" rows="2" maxlength="3000">${esc(l.source_quote)}</textarea><small>Наличие цитаты помогает сверить материал, но не гарантирует полноту и правильность темы.</small></label><h3 style="margin:23px 0 17px">Проверяем понимание</h3>${l.exercises.map((e,ei)=>exerciseEditor(e,li,ei)).join('')}<button class="btn small" data-add-exercise="${li}">${icon('plus')}Добавить задание</button></div></details>`).join(''):empty('Курс начинается с первой темы','Добавьте объяснение и задание или подготовьте черновик по вашим материалам.');
  $$('[data-l][data-key]').forEach(el=>el.oninput=()=>{draft.lessons[+el.dataset.l][el.dataset.key]=el.value;editorDirty=true;});
  $$('[data-remove-lesson]').forEach(b=>b.onclick=()=>{if(confirm('Удалить тему и задания?')){draft.lessons.splice(+b.dataset.removeLesson,1);editorDirty=true;renderLessons();}});
  $$('[data-add-exercise]').forEach(b=>b.onclick=()=>{const l=draft.lessons[+b.dataset.addExercise];if(l.exercises.length>=12)return toast('В теме не больше 12 заданий',true);l.exercises.push(newExercise());editorDirty=true;renderLessons();});
  $$('[data-delete-exercise]').forEach(b=>b.onclick=()=>{const [li,ei]=b.dataset.deleteExercise.split('-').map(Number);draft.lessons[li].exercises.splice(ei,1);editorDirty=true;renderLessons();});
  $$('[data-ex]').forEach(el=>{
    const [li,ei]=el.dataset.ex.split('-').map(Number), e=draft.lessons[li].exercises[ei];
    const update=()=>{
      editorDirty=true;const k=el.dataset.key;
      if(k==='kind'){e.kind=el.value;e.answers=e.kind==='order'||e.kind==='matching'?e.options.map((_,i)=>i):[0];e.left=e.kind==='matching'?e.options.map((_,i)=>'Элемент '+(i+1)):[];renderLessons();}
      else if(k==='options'||k==='left'){
        e[k]=el.value.split('\n').map(x=>x.trim()).filter(Boolean);
        if(k==='options'){
          e.answers=e.kind==='order'||e.kind==='matching'?e.options.map((_,i)=>i):[0];
          if(e.kind==='matching'){
            e.left=e.options.map((_,i)=>e.left[i]||'Элемент '+(i+1));
            const leftField=$('[data-ex="'+li+'-'+ei+'"][data-key="left"]');if(leftField)leftField.value=e.left.join('\n');
          }
        }
        const zone=$('[data-correct-zone="'+li+'-'+ei+'"]');
        zone.innerHTML=correctEditor(e,li+'-'+ei);wireCorrectAnswers();
      }
      else e[k]=el.value;
    };
    el[kUsesChange(el.dataset.key)?'onchange':'oninput']=update;
  });
  wireCorrectAnswers();
}
function wireCorrectAnswers(){
  $$('[data-correct]').forEach(el=>el.onchange=()=>{
    const [li,ei,oi]=el.dataset.correct.split('-').map(Number), e=draft.lessons[li].exercises[ei];editorDirty=true;
    if(e.kind==='single')e.answers=[oi];else e.answers=el.checked?[...new Set([...e.answers,oi])]:e.answers.filter(x=>x!==oi);
  });
  $$('[data-correct-map]').forEach(el=>el.onchange=()=>{const [li,ei,oi]=el.dataset.correctMap.split('-').map(Number);draft.lessons[li].exercises[ei].answers[oi]=+el.value;editorDirty=true;});
}
function kUsesChange(k){return ['kind','options','left'].includes(k);}
function exerciseEditor(e,li,ei){
 const ex=li+'-'+ei;

 return `<div class="exercise-editor"><div class="exercise-head"><strong>Задание ${ei+1}</strong><button class="icon-btn" data-delete-exercise="${ex}" aria-label="Удалить задание">${icon('trash')}</button></div><label class="field"><span>Тип задания</span><select data-ex="${ex}" data-key="kind">${Object.entries(kinds).map(([v,t])=>`<option value="${v}" ${e.kind===v?'selected':''}>${t}</option>`).join('')}</select></label><label class="field"><span>Вопрос или инструкция</span><input data-ex="${ex}" data-key="prompt" maxlength="2000" value="${esc(e.prompt)}"></label>${e.kind==='matching'?`<label class="field"><span>Левая группа — по одному элементу в строке</span><textarea data-ex="${ex}" data-key="left" rows="3">${esc(e.left.join('\n'))}</textarea></label>`:''}<label class="field"><span>${e.kind==='matching'?'Правая группа':e.kind==='order'?'Действия в произвольном порядке':'Варианты ответа'} — по одному в строке</span><textarea data-ex="${ex}" data-key="options" rows="3">${esc(e.options.join('\n'))}</textarea><small>От 2 до 12 неповторяющихся вариантов. После изменения проверьте правильные ответы заново.</small></label><p class="edit-note">${e.kind==='order'?'Выберите правильный порядок':e.kind==='matching'?'Укажите правильные пары':'Отметьте правильные ответы'}</p><div data-correct-zone="${ex}">${correctEditor(e,ex)}</div><label class="field" style="margin-top:18px"><span>Объяснение после проверки</span><textarea data-ex="${ex}" data-key="explanation" rows="2" maxlength="3000">${esc(e.explanation)}</textarea></label></div>`;
}
function correctEditor(e,ex){
 let correct='';
 if(e.kind==='single'||e.kind==='multiple')correct=e.options.map((o,oi)=>`<label class="answer-select"><input type="${e.kind==='single'?'radio':'checkbox'}" name="correct-${ex}" data-correct="${ex}-${oi}" ${e.answers.includes(oi)?'checked':''}><span>${esc(o)}</span></label>`).join('');
 else correct=e.options.map((_,oi)=>`<div class="sequence-row"><span>${e.kind==='matching'?esc(e.left[oi]||'Элемент '+(oi+1)):'Шаг '+(oi+1)}</span><select aria-label="Правильный вариант ${oi+1}" data-correct-map="${ex}-${oi}">${e.options.map((o,index)=>`<option value="${index}" ${e.answers[oi]===index?'selected':''}>${esc(o)}</option>`).join('')}</select></div>`).join('');
 return correct;
}

async function saveCourse(showToast=true){
 if(!currentCourse)return false;
 const title=$('#edit-title').value.trim(),description=$('#edit-description').value;
 if(title.length<2){toast('Добавьте название курса',true);return false;}
 try{
  const result=await api('/courses/'+currentCourse.id,{method:'PUT',body:{title,description,content:draft,version:currentCourse.version}});
  currentCourse={...currentCourse,...result,content:structuredClone(draft)};editorDirty=false;
  $('#save-state').textContent='Изменения сохранены. Можно перейти к проверке.';
  if(showToast)toast('Черновик сохранён');return true;
 }catch(e){toast(e.message,true);return false;}
}
async function publishModal(){
 if(!await saveCourse(false))return;
 modal('Готово к обучению?',`<p>Публикация откроет возможность назначать курс. Убедитесь, что материал соответствует исходнику.</p><div class="help-box">${icon('shield')} Проверьте полноту тем, факты и правильные ответы во всех заданиях. ИИ помогает с черновиком, решение принимаете вы.</div><form id="publish-form"><label class="check-label"><input type="checkbox" required name="reviewed"><span>Я сверил содержание с материалами и проверил задания.</span></label><div id="modal-error"></div><button type="submit" class="btn primary wide">${icon('check')}Опубликовать курс</button></form>`);
 $('#publish-form').onsubmit=async e=>{e.preventDefault();const b=$('button[type=submit]',e.target);b.disabled=true;try{await api('/courses/'+currentCourse.id+'/publish',{method:'POST',body:{reviewed:true,version:currentCourse.version}});closeModal();toast('Курс опубликован. Пригласите обучающихся.');route();}catch(err){$('#modal-error').innerHTML=`<p class="inline-error">${esc(err.message)}</p>`;b.disabled=false;}};
}
function deleteCourseModal(){
 const course=currentCourse;
 if(!course||course.owner_id!==user.id)return;
 if(activeJob(course.active_job)){toast('Дождитесь завершения подготовки перед удалением курса.',true);return;}
 modal('Удалить курс?',`<p>Удалится курс «${esc(course.title)}» — вместе с материалами, опубликованной версией, приглашениями, назначениями и результатами обучения. Восстановить его в приложении нельзя.</p><form id="delete-course-form"><label class="field"><span>Для подтверждения введите название курса</span><input name="confirmation" required maxlength="180" autocomplete="off" spellcheck="false" placeholder="${esc(course.title)}"></label><div id="delete-error" class="inline-error" role="alert"></div><div class="delete-course-actions"><button type="button" class="btn" data-action="close-modal">Отмена</button><button type="submit" class="btn danger" disabled>${icon('trash')}Удалить безвозвратно</button></div></form>`);
 const form=$('#delete-course-form'),input=$('[name=confirmation]',form),button=$('button[type=submit]',form);
 input.oninput=()=>{button.disabled=input.value.trim()!==course.title.trim();};
 form.onsubmit=async e=>{
  e.preventDefault();if(button.disabled)return;button.disabled=true;$('#delete-error').textContent='';
  try{
   await api('/courses/'+course.id,{method:'DELETE',body:{version:course.version,confirmation:input.value}});
   editorDirty=false;clearInterval(jobClock);jobClock=null;closeModal();toast('Курс удалён');location.hash='#/courses';
  }catch(err){if(form.isConnected){$('#delete-error').textContent=err.message;button.disabled=input.value.trim()!==course.title.trim();}}
 };
}

function setGenerationBusy(busy){
 $$('#course-tab input,#course-tab textarea,#course-tab select,#course-tab button').forEach(el=>{el.disabled=busy;});
}
function updateJobClock(){
 const container=$('#job-status'),j=container?._job;
 if(!j)return;
 const elapsed=Math.max(0,Math.floor((Date.now()-Date.parse(j.created))/1000));
 const time=Number.isFinite(elapsed)?(elapsed<60?elapsed+' сек.':Math.floor(elapsed/60)+' мин. '+elapsed%60+' сек.'):'несколько секунд';
 const timer=$('#job-elapsed');if(timer)timer.textContent='Прошло '+time;
 const hint=$('#job-wait-hint');
 if(hint && activeJob(j))hint.textContent=elapsed>=60?'Модель продолжает работать. Точное время ответа заранее неизвестно; можно перейти в другой раздел и вернуться к курсу.':elapsed>=20?'Модель ещё готовит материал. Это нормально: задания и объяснения требуют времени.':'Как только модель ответит, проверим задания и сохраним черновик. Публикация остаётся за вами.';
}
function showJob(j){
 let container=$('#job-status');if(!container){container=document.createElement('div');container.id='job-status';$('.tabs').after(container);}
 container._job=j;
 const busy=activeJob(j),failed=j.status==='error';
 const index=({pending:0,running:0,preparing:0,generating:1,validating:2,saving:3,done:4})[j.status]??1;
 const stages=['Материал принят','Темы и задания','Проверка курса','Сохранение черновика'];
 const heading=failed?'Подготовка остановилась':j.status==='done'?'Черновик готов к проверке':j.status==='validating'?'Проверяем готовый курс':j.status==='saving'?'Сохраняем черновик':index===0?'Принимаем материал':'Готовим ваш курс';
 container.innerHTML=`<section class="generation-panel ${failed?'generation-error':''}" aria-label="Подготовка курса"><div class="generation-header"><span class="generation-symbol">${busy?'<i class="spinner"></i>':icon(failed?'info':'check')}</span><div class="grow"><div class="eyebrow">${busy?'СОБИРАЕМ ВАШ КУРС':failed?'НУЖНО ВАШЕ ВНИМАНИЕ':'МОЖНО ОТКРЫВАТЬ РЕДАКТОР'}</div><h2>${heading}</h2></div><span id="job-elapsed" class="generation-time"></span></div><p class="generation-message" role="status">${esc(j.message)}</p><ol class="generation-stages">${stages.map((label,i)=>`<li class="${index>i?'is-done':index===i&&!failed?'is-current':''}" ${index===i?'aria-current="step"':''}><span>${index>i?icon('check'):String(i+1).padStart(2,'0')}</span><strong>${label}</strong></li>`).join('')}</ol><div class="generation-count"><span>Обработано и проверено частей: <strong>${j.done} из ${j.total}</strong></span><span>${j.status==='done'?'Готово':j.done===0?'Ожидаем первый ответ':'Прогресс по исходному материалу'}</span></div><progress class="generation-progress" value="${j.done}" max="${j.total}" aria-label="Обработанные части материала"></progress>${busy?'<p id="job-wait-hint" class="generation-hint"></p>':failed?'<p class="generation-hint">Материалы сохранены. Можно повторить подготовку или продолжить в ручном редакторе.</p>':''}</section>`;
 setGenerationBusy(busy);updateJobClock();
 if(busy&&!jobClock)jobClock=setInterval(updateJobClock,1000);
 if(!busy){clearInterval(jobClock);jobClock=null;}
}
async function pollJob(cid,jid,token){
 while(token===viewToken && user){
   await new Promise(r=>setTimeout(r,1200));if(token!==viewToken)return;
   try{
     const j=await api('/courses/'+cid+'/jobs/'+jid);if(token!==viewToken)return;showJob(j);
     if(j.status==='done'){
       editorDirty=false;toast('Черновик готов. Проверьте темы и задания.');
       const destination=`#/course/${cid}/content`;
       if(location.hash!==destination)location.hash=destination;else await route();
       return;
     }
     if(j.status==='error'){currentCourse.active_job=null;return;}
   }catch(e){toast(e.message,true);clearInterval(jobClock);jobClock=null;setGenerationBusy(false);return;}
 }
}
async function generateCourse(){
 if(editorDirty && !confirm('Есть несохранённые изменения. Подготовка заменит черновик. Продолжить?'))return;
 if(currentCourse.content?.lessons?.length && !confirm('Новый результат заменит текущий черновик. Опубликованная версия сохранится. Продолжить?'))return;
 try{
   config=await api('/config');
   if(config.ai_ready)$('#ai-setup-notice')?.remove();
   const j=await api('/courses/'+currentCourse.id+'/generate',{method:'POST',body:{version:currentCourse.version}});
   editorDirty=false;currentCourse.active_job=j;showJob(j);
   $('#job-status').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
   pollJob(currentCourse.id,j.id,viewToken);
 }catch(e){toast(e.message,true);}
}

function targetModal(mode){return assignmentModal(mode);}

function assignmentModal(mode='assign'){
 const inviting=mode==='invite';
 const description=inviting?'Выберите наставников или найдите по имени и логину. Каждый получит приглашение и сможет войти в курс после принятия.':'Выберите обучающихся из списка или найдите по имени и логину. Можно назначить курс нескольким людям сразу.';
 const loading=inviting?'Ищем наставников…':'Ищем обучающихся…';
 const noPeople=inviting?'На сайте пока нет других наставников. Пользователь должен зарегистрироваться с ролью «Я наставник».':'На сайте пока нет обучающихся. Пользователь должен зарегистрироваться с ролью «Я учусь».';
 const cid=currentCourse.id,selected=new Map();let people=[],offset=0,total=0,hasMore=false,sequence=0,timer=null;
 modal(inviting?'Пригласить наставников':'Назначить обучение',`<p>${description}</p><form id="target-form" class="assignment-picker"><label class="field"><span>${inviting?'Поиск наставников':'Поиск обучающихся'}</span><div class="people-search">${icon('search')}<input id="assign-search" name="login" type="search" autocomplete="off" maxlength="100" placeholder="Имя или логин" aria-label="Поиск по имени или логину"></div></label><div id="selected-people" class="selected-people"></div><div class="people-list-heading"><span id="people-count">Загружаем список…</span><button type="button" id="clear-selected" class="text-button hide">Снять выбор</button></div><div id="assign-list" class="people-list" aria-label="${inviting?'Наставники':'Обучающиеся'}" aria-busy="true"></div><button type="button" id="more-people" class="btn subtle small hide">Показать ещё</button><div id="modal-error" class="inline-error" role="alert"></div><div class="assign-footer"><span id="selected-count">Никто не выбран</span><button class="btn primary" type="submit" disabled>${icon(inviting?'mail':'users')}${inviting?'Отправить приглашения':'Назначить курс'}</button></div></form>`);
 $('.modal').classList.add('assignment-modal');
 const form=$('#target-form'),input=$('#assign-search'),submit=$('button[type=submit]',form);
 function selectionChanged(){
  $('#selected-count').textContent=selected.size?'Выбрано: '+selected.size:'Никто не выбран';
  submit.disabled=!selected.size;
  $('#clear-selected').classList.toggle('hide',!selected.size);
  $('#selected-people').innerHTML=[...selected.values()].map(u=>`<button type="button" class="selected-person" data-unselect-user="${u.id}" aria-label="Убрать ${esc(u.name)}">${esc(u.name)}${icon('close')}</button>`).join('');
  $$('[data-unselect-user]',form).forEach(b=>b.onclick=()=>{selected.delete(Number(b.dataset.unselectUser));renderPeople();});
 }
 function renderPeople(){
  $('#people-count').textContent='Найдено: '+total;
  $('#assign-list').setAttribute('aria-busy','false');
  $('#assign-list').innerHTML=people.length?people.map(u=>`<label class="person-choice ${u.assigned?'already-assigned':''}"><input type="checkbox" data-select-user="${u.id}" ${selected.has(u.id)||u.assigned?'checked':''} ${u.assigned?'disabled':''}><span class="avatar">${initials(u)}</span><span class="person-identity"><strong>${esc(u.name)}</strong><small>@${esc(u.login)}</small></span>${u.assigned?'<span class="pill '+(inviting&&u.status==='pending'?'':'green')+'">'+(inviting?({owner:'Создатель',accepted:'Уже участвует',pending:'Приглашён'})[u.status]:'Уже назначен')+'</span>':inviting&&u.status==='declined'?'<span class="pill amber">Можно снова</span>':''}</label>`).join(''):'<p class="people-empty">'+(input.value.trim()?'Никого не нашли. Проверьте имя или логин.':noPeople)+'</p>';
  $('#more-people').classList.toggle('hide',!hasMore);
  $$('[data-select-user]',form).forEach(check=>check.onchange=()=>{
    const id=Number(check.dataset.selectUser),person=people.find(u=>u.id===id);
    if(check.checked){if(selected.size>=50){check.checked=false;toast('За один раз можно выбрать до 50 человек',true);return;}selected.set(id,person);}else selected.delete(id);
    selectionChanged();
  });
  selectionChanged();
 }
 async function search(reset=true){
  if(!form.isConnected)return;
  const request=++sequence;const start=reset?0:offset;
  $('#assign-list').setAttribute('aria-busy','true');$('#more-people').disabled=true;
  if(reset)$('#assign-list').innerHTML='<div class="people-loading"><i class="spinner"></i>'+loading+'</div>';
  try{
   const result=await api('/courses/'+cid+'/'+(inviting?'mentors':'learners')+'?q='+encodeURIComponent(input.value.trim())+'&offset='+start);
   if(request!==sequence||!form.isConnected)return;
   people=reset?result.users:[...people,...result.users];offset=people.length;total=result.total;hasMore=result.has_more;renderPeople();
  }catch(err){if(request===sequence&&form.isConnected){$('#assign-list').innerHTML='<p class="people-empty">'+esc(err.message)+'</p>';$('#assign-list').setAttribute('aria-busy','false');}}
  finally{if(form.isConnected)$('#more-people').disabled=false;}
 }
 input.oninput=()=>{sequence++;clearTimeout(timer);people=[];offset=0;$('#more-people').classList.add('hide');$('#people-count').textContent='Ищем…';$('#assign-list').innerHTML='<div class="people-loading"><i class="spinner"></i>'+loading+'</div>';timer=setTimeout(()=>search(true),220);};
 $('#more-people').onclick=()=>search(false);
 $('#clear-selected').onclick=()=>{selected.clear();renderPeople();};
 form.onsubmit=async e=>{
  e.preventDefault();clearTimeout(timer);if(!selected.size)return;
  submit.disabled=true;$('#modal-error').textContent='';
  try{
   const result=await api('/courses/'+cid+'/'+(inviting?'invite-batch':'assign-batch'),{method:'POST',body:{user_ids:[...selected.keys()]}});
   closeModal();toast(inviting?(result.invited?'Приглашения отправлены: '+result.invited:'Наставники уже приглашены или участвуют в курсе'):(result.assigned?'Курс назначен: '+result.assigned+' '+plural(result.assigned,'человек','человека','человек'):'Курс уже назначен выбранным обучающимся'));await route();
  }catch(err){if(form.isConnected){$('#modal-error').textContent=err.message;submit.disabled=false;}}
 };
 search();
}

async function teamTab(c,token){
 const members=await api('/courses/'+c.id+'/members');if(token!==viewToken)return;
 $('#course-tab').innerHTML=`<section class="panel"><div class="row between"><div><h2>Команда наставников</h2><p class="tiny muted" style="margin-top:7px">Курс закрыт для остальных пользователей.</p></div>${btn('Пригласить','invite','plus')}</div><div class="spacer"></div>${members.map(m=>`<div class="member-row"><span class="avatar">${initials(m)}</span><div class="grow"><h4>${esc(m.name)}</h4><p>@${esc(m.login)}</p></div><span class="pill ${m.status==='owner'||m.status==='accepted'?'green':''}">${({owner:'Создатель',accepted:'Наставник',pending:'Ожидаем принятия',declined:'Отклонено'})[m.status]}</span>${c.owner_id===user.id&&m.membership_id?`<button class="icon-btn" data-remove-member="${m.membership_id}" aria-label="Удалить доступ ${esc(m.login)}">${icon('close')}</button>`:''}</div>`).join('')}</section>${notice('Приглашённый наставник получает доступ только после принятия. Он видит содержание и результаты, может редактировать курс и назначать обучение.')}`;
 $$('[data-remove-member]').forEach(b=>b.onclick=async()=>{if(!confirm('Отозвать приглашение или доступ к курсу?'))return;try{await api(`/courses/${c.id}/members/${b.dataset.removeMember}`,{method:'DELETE'});toast('Доступ отозван');route();}catch(e){toast(e.message,true);}});
}
async function resultsTab(c,token){
 const rows=await api('/courses/'+c.id+'/results');if(token!==viewToken)return;
 $('#course-tab').innerHTML=`${stats([[rows.length,'Назначено сотрудникам','users'],[rows.filter(r=>r.progress===100).length,'Завершили курс','award'],[rows.reduce((s,r)=>s+r.attempt_count,0),'Попыток выполнения','chart']])}<div class="section-head"><h2>Результаты обучения</h2>${c.published?btn('Назначить курс','assign','plus','small'):''}</div>${rows.length?`<div class="panel table-wrap"><table class="result-table"><thead><tr><th>Сотрудник</th><th>Прогресс</th><th>Последний результат</th><th>Попытки</th><th>Версия</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.user.name)}<small>@${esc(r.user.login)}</small></td><td>${r.progress}%<div class="progress"><i style="width:${r.progress}%"></i></div></td><td class="table-score">${r.attempts.length?r.attempts.at(-1).score+'%':'Пока нет'}${r.attempts.length?`<small>Тема ${r.attempts.at(-1).lesson+1}</small>`:''}</td><td>${r.attempt_count}</td><td>${r.revision}</td></tr>`).join('')}</tbody></table></div>`:empty('Здесь появится прогресс команды',c.published?'Назначьте курс обучающемуся по его логину. После начала обучения результаты появятся здесь.':'Сначала подготовьте и опубликуйте курс, затем назначьте обучение.',c.published?btn('Назначить обучение','assign','users'):'')}<p class="tiny muted" style="margin-top:18px">Сотрудник завершает тему, когда правильно выполнены все задания. Новая версия курса не меняет уже назначенное обучение.</p>`;
}

let quizOrders={};
async function readerPage(aid,li,token){
 const a=await api('/assignments/'+aid);if(token!==viewToken)return;currentAssignment=a;
 const firstIncomplete=a.lessons.findIndex((_,i)=>!a.completed_lessons.includes(i));
 if(li<0||li>=a.lessons.length||li>0&&!a.completed_lessons.includes(li-1))li=Math.max(0,firstIncomplete);
 const l=a.lessons[li];quizOrders={};$('#breadcrumb-title').textContent='Обучение';
 $('#content').innerHTML=`<a href="#/courses" class="top-back">${icon('back')}К моим курсам</a><div class="page-top"><div><div class="eyebrow">Ваш путь обучения</div><h1>${esc(a.title)}</h1><p>${a.completed_lessons.length} из ${a.lessons.length} тем завершено · ${a.progress}%</p></div><span class="pill ${a.progress===100?'green':''}">${a.progress===100?'Курс завершён':'В вашем темпе'}</span></div><div class="reader-layout"><aside class="lesson-nav"><div class="lesson-nav-title">ТЕМЫ КУРСА</div>${a.lessons.map((lesson,i)=>{const done=a.completed_lessons.includes(i),locked=i>0&&!a.completed_lessons.includes(i-1);return `<div class="lesson-nav-item ${i===li?'active':''} ${locked?'locked':''}">${icon(done?'check':locked?'lock':'book')}${locked?`<span>${esc(lesson.title)}</span>`:`<a href="#/learn/${aid}/${i}">${esc(lesson.title)}</a>`}</div>`;}).join('')}</aside><section class="lesson-section"><div class="panel"><div class="question-count">ТЕМА ${li+1} / ${a.lessons.length}</div><h2 class="lesson-title">${esc(l.title)}</h2><div class="reader-content">${esc(l.summary)}</div></div><div class="section-head"><h2>Проверим понимание</h2><span class="tiny muted">${l.exercises.length} ${plural(l.exercises.length,'задание','задания','заданий')}</span></div><form id="quiz-form">${l.exercises.map((e,i)=>renderQuestion(e,i)).join('')}<div id="quiz-summary"></div><button class="btn primary" type="submit">${icon('check')}Проверить ответы</button></form><div id="quiz-next"></div></section></div>`;
 wireOrders();
 $('#quiz-form').onsubmit=async e=>{
  e.preventDefault();const submit=$('button[type=submit]',e.target);submit.disabled=true;
  const answers=l.exercises.map((ex,i)=>{
   if(ex.kind==='order')return quizOrders[i];
   if(ex.kind==='matching')return $$(`[data-match="${i}"]`).map(s=>s.value===''?-1:Number(s.value));
   return $$(`input[name="q${i}"]:checked`).map(input=>Number(input.value));
  });
  if(answers.some(x=>!x.length||x.includes(-1))){toast('Сначала выполните все задания',true);submit.disabled=false;return;}
  try{
   const result=await api('/assignments/'+aid+'/submit',{method:'POST',body:{lesson:li,answers}});
   result.details.forEach((d,i)=>{$('#feedback-'+i).innerHTML=`<div class="feedback ${d.correct?'good':''}"><strong>${d.correct?'Верно':'Попробуйте ещё раз'}</strong>${esc(d.explanation)}</div>`;});
   $('#quiz-summary').innerHTML=`<p class="edit-note">Результат: ${result.score}%. ${result.passed?'Тема завершена.':'Для завершения темы выполните все задания правильно.'}</p>`;
   if(result.passed){
    currentAssignment.completed_lessons=result.completed_lessons;
    $('#quiz-next').innerHTML=li+1<a.lessons.length?`<div class="action-bar"><p>Вы отлично справились. Двигаемся дальше?</p><a class="btn primary" href="#/learn/${aid}/${li+1}">Следующая тема${icon('arrow')}</a></div>`:`<div class="complete">${icon('award')}<h2>Отличный старт!</h2><p>Вы завершили курс. Наставник уже видит ваш результат.</p><div class="spacer"></div><a class="btn primary" href="#/courses">К моему обучению ${icon('arrow')}</a></div>`;
    $('#quiz-next').scrollIntoView({behavior:'smooth',block:'nearest'});
   }
  }catch(err){toast(err.message,true);}finally{submit.disabled=false;}
 };
}
function shuffledIndices(n){const arr=Array.from({length:n},(_,i)=>i);for(let i=n-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];}return arr;}
function renderQuestion(e,i){
 let body='';
 if(e.kind==='single'||e.kind==='multiple')body=e.options.map((o,oi)=>`<label class="answer-select"><input type="${e.kind==='single'?'radio':'checkbox'}" name="q${i}" value="${oi}" ${e.kind==='single'?'required':''}><span>${esc(o)}</span></label>`).join('');
 else if(e.kind==='matching')body=e.left.map((o,oi)=>`<div class="match-row"><span>${esc(o)}</span><select required data-match="${i}" aria-label="Соответствие для ${esc(o)}"><option value="">Выберите соответствие</option>${shuffledIndices(e.options.length).map(idx=>`<option value="${idx}">${esc(e.options[idx])}</option>`).join('')}</select></div>`).join('');
 else{quizOrders[i]=shuffledIndices(e.options.length);body=`<p class="hint">Расставьте действия по порядку с помощью стрелок.</p><div id="order-${i}">${renderOrder(e,i)}</div>`;}
 return `<section class="quiz-question"><div class="quiz-type">${esc(kinds[e.kind])}</div><h3>${i+1}. ${esc(e.prompt)}</h3><fieldset aria-label="Задание ${i+1}">${body}</fieldset><div id="feedback-${i}"></div></section>`;
}
function renderOrder(e,i){return quizOrders[i].map((oi,pos)=>`<div class="order-item"><span class="order-index">${pos+1}</span><span class="grow">${esc(e.options[oi])}</span><button type="button" class="icon-btn" data-order="${i}:${pos}:-1" aria-label="Переместить выше" ${pos===0?'disabled':''}>${icon('up')}</button><button type="button" class="icon-btn" data-order="${i}:${pos}:1" aria-label="Переместить ниже" ${pos===e.options.length-1?'disabled':''}>${icon('down')}</button></div>`).join('');}
function wireOrders(){ $$('[data-order]').forEach(b=>b.onclick=()=>{const [i,pos,delta]=b.dataset.order.split(':').map(Number);const arr=quizOrders[i];[arr[pos],arr[pos+delta]]=[arr[pos+delta],arr[pos]];const li=Number(location.hash.split('/')[3]||0);const e=currentAssignment.lessons[li].exercises[i];$('#order-'+i).innerHTML=renderOrder(e,i);wireOrders();});}

document.addEventListener('click',async e=>{
 const link=e.target.closest('a[href^="#/"]');
 if(link&&editorDirty && !confirm('Уйти без сохранения изменений?')){e.preventDefault();return;}
 if(link)editorDirty=false;
 const target=e.target.closest('[data-action]');if(!target)return;
 const action=target.dataset.action;
 if(action==='close-modal')return closeModal();
 if(action==='auth-login'||action==='auth-register'){const next=action==='auth-login'?'login':'register';if(next===authMode)return;authMode=next;return renderAuth();}
 if(action==='role-mentor'||action==='role-learner'){
   authRole=action==='role-mentor'?'mentor':'learner';$$('.role-picker button').forEach(b=>b.classList.toggle('selected',b===target));return;
 }
 if(action==='show-email'){const data=new FormData($('#auth-form'));emailVisible=true;renderAuth();for(const [k,v] of data){const f=$(`[name="${k}"]`);if(f)f.value=v;}return;}
 if(action==='logout'){
   if(editorDirty&&!confirm('Выйти без сохранения изменений?'))return;
   try{await api('/auth/logout',{method:'POST'});editorDirty=false;user=null;renderAuth();}catch(err){toast(err.message,true);}return;
 }
 if(action==='new-course')return newCourse();
 if(action==='delete-course')return deleteCourseModal();
 if(action==='assign'||action==='invite')return targetModal(action);
 if(action==='add-lesson'){if(draft.lessons.length>=100)return toast('В курсе не больше 100 тем',true);draft.lessons.push(newLesson());editorDirty=true;renderLessons(true);return;}
 if(action==='generate'){target.disabled=true;try{await generateCourse();}finally{target.disabled=!!activeJob(currentCourse?.active_job);}return;}
 if(action==='save-course'){target.disabled=true;try{await saveCourse();}finally{target.disabled=false;}return;}
 if(action==='publish'){target.disabled=true;try{await publishModal();}finally{target.disabled=false;}return;}
});
window.addEventListener('hashchange',()=>{editorDirty=false;route();});
(async()=>{try{user=await api('/me');await bootUser();}catch{renderAuth();}})();
