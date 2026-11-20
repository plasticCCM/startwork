const {chromium}=require(process.env.STARTWORK_NODE_MODULES+'/playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const base=process.env.STARTWORK_TEST_URL||'http://127.0.0.1:8001';
const headers={'X-StartWork':'1'};
const content={lessons:[{title:'Работа с доступами',summary:'Чтобы получить доступ, создайте заявку в сервис-деске. Укажите систему и причину доступа. Заявку согласует руководитель. Никогда не указывайте пароль в заявке. После согласования дождитесь уведомления о выдаче доступа.',source_section:'Инструкция, раздел 1',source_quote:'Заявку согласует руководитель.',exercises:[
{kind:'single',prompt:'Кто согласует заявку?',options:['Руководитель','Новый сотрудник'],answers:[0],left:[],explanation:'Заявку согласует руководитель.'},
{kind:'multiple',prompt:'Что указывают в заявке?',options:['Систему','Причину доступа','Пароль'],answers:[0,1],left:[],explanation:'Нужны система и причина, пароль указывать нельзя.'},
{kind:'matching',prompt:'Сопоставьте действие и роль',options:['Руководитель','Сотрудник'],left:['Создаёт заявку','Согласует заявку'],answers:[1,0],explanation:'Сотрудник создаёт заявку, руководитель согласует.'},
{kind:'order',prompt:'Расставьте действия по порядку',options:['Получить доступ','Создать заявку','Дождаться согласования'],answers:[1,2,0],left:[],explanation:'Сначала заявка, потом согласование, затем доступ.'}
]}]};
async function api(ctx,path,method='GET',data){const r=await ctx.request.fetch(base+'/api'+path,{method,headers,...(data?{data}:{})});const result=await r.json();assert(r.ok(),JSON.stringify(result));return result;}
(async()=>{
 const browser=await chromium.launch({executablePath:process.env['ProgramFiles(x86)']+'/Microsoft/Edge/Application/msedge.exe',headless:true});
 fs.mkdirSync('test-results',{recursive:true});const errors=[];
 try{
 const ctx=await browser.newContext({viewport:{width:1440,height:1050},reducedMotion:'reduce'}),page=await ctx.newPage();
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base);await page.getByRole('heading',{name:'С возвращением'}).waitFor();
 await page.screenshot({path:'test-results/auth.png',fullPage:true});
 await page.getByRole('button',{name:'Создать аккаунт',exact:true}).click();
 const suffix=Date.now().toString().slice(-8),owner='mentor_'+suffix,guest='colleague_'+suffix,learner='learner_'+suffix;
 await page.locator('[name=name]').fill('Александр');await page.locator('[name=login]').fill(owner);await page.locator('[name=password]').fill('localtest1');
 await page.locator('button[type=submit]').click();await page.getByRole('heading',{name:/Привет, Александр/}).waitFor();
 await page.getByRole('button',{name:'Создать курс',exact:true}).click();
 await page.locator('#new-course-form [name=title]').fill('Первые шаги в команде');
 await page.locator('#new-course-form [name=description]').fill('Всё, что поможет освоиться: рабочие процессы, доступы и правила команды.');
 await page.getByRole('button',{name:'Создать приватный курс'}).click();
 await page.getByRole('heading',{name:'Из чего соберём курс?'}).waitFor();
 const cid=+page.url().split('/course/')[1].split('/')[0];
 await page.locator('#source-form textarea').fill('Создайте заявку в сервис-деске. Укажите систему и причину доступа. Заявку согласует руководитель. Пароль не указывайте.');
 await page.getByRole('button',{name:'Сохранить материалы'}).click();await page.getByRole('heading',{name:'Сохранённый исходник'}).waitFor();
 await page.getByRole('link',{name:'Содержание',exact:true}).click();await page.getByRole('button',{name:'Добавить тему'}).waitFor();
 await page.getByRole('button',{name:'Добавить тему'}).click();
 await page.locator('[data-l="0"][data-key=title]').fill('Первая тема');
 await page.getByRole('button',{name:'Сохранить',exact:true}).click();await page.getByText('Изменения сохранены. Можно перейти к проверке.').waitFor();
 let c=await api(ctx,'/courses/'+cid);
 await api(ctx,'/courses/'+cid,'PUT',{title:'Первые шаги в команде',description:'Всё, что поможет освоиться: рабочие процессы, доступы и правила команды.',version:c.version,content});
 await page.reload();await page.getByRole('button',{name:'Проверить и опубликовать'}).click();
 await page.locator('#publish-form input').check();await page.getByRole('button',{name:'Опубликовать курс',exact:true}).click();await page.getByText('Опубликован · версия 1').waitFor();
 const guestCtx=await browser.newContext(),learnerCtx=await browser.newContext();
 await api(guestCtx,'/auth/register','POST',{login:guest,password:'localtest1',name:'Никита',role:'mentor'});
 await api(learnerCtx,'/auth/register','POST',{login:learner,password:'localtest1',name:'Анна',role:'learner'});
 await page.getByRole('link',{name:'Наставники',exact:true}).click();await page.getByRole('button',{name:'Пригласить',exact:true}).click();
 await page.locator('#assign-search').fill(guest);await page.locator('.person-choice').filter({hasText:'@'+guest}).getByRole('checkbox').check();await page.getByRole('button',{name:'Отправить приглашения',exact:true}).click();await page.getByText('Ожидаем принятия').waitFor();
 const gp=await guestCtx.newPage();await gp.goto(base+'/#/invitations');await gp.getByRole('button',{name:'Принять',exact:true}).click();await gp.getByRole('heading',{name:'Пока без приглашений'}).waitFor();
 assert.equal((await api(guestCtx,'/courses')).length,1);
 await page.getByRole('button',{name:'Назначить обучение',exact:true}).click();await page.locator('#assign-search').fill(learner);await page.locator('.person-choice').filter({hasText:'@'+learner}).getByRole('checkbox').check();await page.getByRole('button',{name:'Назначить курс',exact:true}).click();
 for(const title of ['Правила работы с информацией','Рабочие инструменты'])await api(ctx,'/courses','POST',{title,description:'Учебный пример для проверки интерфейса StartWork.'});
 await page.goto(base);await page.getByRole('heading',{name:/Привет, Александр/}).waitFor();await page.locator('.course-card').first().waitFor();
 await page.screenshot({path:'test-results/dashboard.png',fullPage:true});
 await page.locator('#course-search').fill('zzzz');assert(await page.locator('#filter-empty').isVisible());await page.locator('#course-search').fill('');
 const lp=await learnerCtx.newPage();await lp.setViewportSize({width:1440,height:1050});await lp.goto(base);await lp.locator('.course-card').first().waitFor();
 await lp.locator('.course-card').first().click();await lp.getByRole('heading',{name:'Проверим понимание'}).waitFor();
 await lp.locator('input[name=q0][value="0"]').check();await lp.locator('input[name=q1][value="0"]').check();await lp.locator('input[name=q1][value="1"]').check();
 await lp.locator('[data-match="2"]').nth(0).selectOption('1');await lp.locator('[data-match="2"]').nth(1).selectOption('0');
 for(let target=0;target<3;target++){
  const text=['Создать заявку','Дождаться согласования','Получить доступ'][target];
  for(let guard=0;guard<3;guard++){
    const texts=await lp.locator('#order-3 .order-item .grow').allTextContents();const pos=texts.indexOf(text);if(pos===target)break;
    await lp.locator('#order-3 .order-item').nth(pos).getByRole('button',{name:'Переместить выше'}).click();
  }
 }
 await lp.getByRole('button',{name:'Проверить ответы'}).click();await lp.getByRole('heading',{name:'Отличный старт!'}).waitFor();
 assert.equal((await api(learnerCtx,'/assignments'))[0].progress,100);
 await lp.screenshot({path:'test-results/learning.png',fullPage:true});
 await page.goto(base+'/#/course/'+cid+'/results');await page.getByRole('heading',{name:'Результаты обучения'}).waitFor();await page.getByText('@'+learner).waitFor();await page.screenshot({path:'test-results/results.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.goto(base);await page.locator('.course-card').first().waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'test-results/mobile.png',fullPage:true});
 await gp.goto(base+'/#/course/'+cid+'/content');await gp.getByRole('link',{name:'Содержание',exact:true}).waitFor();assert.equal(await gp.getByRole('button',{name:'Удалить курс',exact:true}).count(),0);
 await page.setViewportSize({width:1440,height:1050});await page.goto(base+'/#/course/'+cid+'/content');await page.getByRole('button',{name:'Удалить курс',exact:true}).click();
 const deletion=page.locator('#delete-course-form'),confirmDelete=deletion.getByRole('button',{name:'Удалить безвозвратно'});
 assert(await confirmDelete.isDisabled());await deletion.locator('input').fill('Неверное название');assert(await confirmDelete.isDisabled());
 await deletion.getByRole('button',{name:'Отмена',exact:true}).click();assert.equal((await api(ctx,'/courses/'+cid)).id,cid);
 await page.getByRole('button',{name:'Удалить курс',exact:true}).click();await deletion.locator('input').fill('Первые шаги в команде');assert(await confirmDelete.isEnabled());await page.screenshot({path:'test-results/delete-confirmation.png',fullPage:true});
 await confirmDelete.click();await page.waitForURL('**/#/courses');assert.equal((await api(ctx,'/courses')).some(c=>c.id===cid),false);
 assert.deepEqual(errors,[]);console.log('PASS: registration, course lifecycle, sharing, learning, responsive layout, owner-only deletion and confirmation.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
