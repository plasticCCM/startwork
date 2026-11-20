import copy
import atexit
import os
import tempfile
from pathlib import Path

temp = tempfile.TemporaryDirectory()
os.environ['DATABASE_URL'] = 'sqlite:///' + (Path(temp.name)/'test.db').as_posix()
os.environ['DEEPSEEK_API_KEY'] = ''

import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.db import Base, engine
from app.content import split_source, extract_file, Curriculum

atexit.register(engine.dispose)

H = {'X-StartWork': '1'}
EX = [
    {'kind':'single','prompt':'Кто согласует доступ?','options':['Руководитель','Сотрудник'],'answers':[0],'left':[],'explanation':'Доступ согласует руководитель.'},
    {'kind':'multiple','prompt':'Какие данные нужны?','options':['Система','Причина','Пароль'],'answers':[0,1],'left':[],'explanation':'Нужны система и причина.'},
    {'kind':'matching','prompt':'Сопоставьте действия и роли','options':['Руководитель','Сотрудник'],'left':['Создаёт заявку','Согласует'],'answers':[1,0],'explanation':'Заявку создаёт сотрудник, согласует руководитель.'},
    {'kind':'order','prompt':'Восстановите порядок','options':['Получить доступ','Создать заявку','Дождаться согласования'],'answers':[1,2,0],'left':[],'explanation':'Сначала заявка, затем согласование и доступ.'},
]
CONTENT = {'lessons':[{'title':'Запрос доступа','summary':'Создайте заявку, укажите систему и причину. Дождитесь согласования руководителем.','source_quote':'','source_section':'','exercises':EX}]}

@pytest.fixture(autouse=True)
def clean():
    from app.main import attempts
    attempts.clear()
    Base.metadata.drop_all(engine); Base.metadata.create_all(engine)
    yield

def account(login, role='mentor'):
    c=TestClient(app, headers=H)
    res=c.post('/api/auth/register',json={'login':login,'password':'test1','role':role,'name':login})
    assert res.status_code==200,res.text
    return c

def course(client):
    r=client.post('/api/courses',json={'title':'Доступ','description':'Новый курс'})
    assert r.status_code==200
    return r.json()

def publish(client,c,content=None):
    r=client.put('/api/courses/'+str(c['id']),json={'title':'Доступ','description':'Курс','content':content or CONTENT,'version':c['version']})
    assert r.status_code==200,r.text
    r=client.post(f"/api/courses/{c['id']}/publish",json={'version':r.json()['version'],'reviewed':True})
    assert r.status_code==200,r.text
    return r.json()

def test_registration_login_logout():
    c=TestClient(app,headers=H)
    assert c.post('/api/auth/register',json={'login':'alex','password':'abc','role':'mentor'}).status_code==422
    a=account('alex');assert a.get('/api/me').json()['email']==''
    assert c.post('/api/auth/login',json={'login':'alex','password':'bad'}).status_code==401
    assert c.post('/api/auth/login',json={'login':'ALEX','password':'test1'}).status_code==200
    c.post('/api/auth/logout');assert c.get('/api/me').status_code==401

def test_profile_update_is_private_and_does_not_change_role():
    owner=account('owner');other=account('other','learner')
    assert TestClient(app,headers=H).put('/api/me',json={'name':'Новое имя'}).status_code==401
    r=owner.put('/api/me',json={'name':'Александр','email':'alex@example.org','role':'learner'})
    assert r.status_code==200 and r.json()['name']=='Александр'
    assert r.json()['role']=='mentor' and r.json()['login']=='owner'
    assert other.get('/api/me').json()['name']=='other'
    assert owner.put('/api/me',json={'name':' ','email':''}).status_code==422
    assert owner.put('/api/me',json={'name':'Александр','email':'not-an-email'}).status_code==422
    assert owner.put('/api/me',json={'name':'Александр','email':''}).json()['email']==''

def test_password_change_checks_old_password_and_revokes_other_sessions():
    owner=account('owner');other_session=TestClient(app,headers=H)
    assert other_session.post('/api/auth/login',json={'login':'owner','password':'test1'}).status_code==200
    assert owner.post('/api/me/password',json={'current_password':'bad','new_password':'newpass2'}).status_code==422
    assert owner.post('/api/me/password',json={'current_password':'test1','new_password':'nonumbers'}).status_code==422
    assert owner.post('/api/me/password',json={'current_password':'test1','new_password':'test1'}).status_code==422
    assert owner.post('/api/me/password',json={'current_password':'test1','new_password':'newpass2'}).status_code==200
    assert owner.get('/api/me').status_code==200
    assert other_session.get('/api/me').status_code==401
    assert other_session.post('/api/auth/login',json={'login':'owner','password':'test1'}).status_code==401
    assert other_session.post('/api/auth/login',json={'login':'owner','password':'newpass2'}).status_code==200

def test_favicon():
    r=TestClient(app).get('/favicon.ico')
    assert r.status_code==200 and r.content[:4]==b'\x00\x00\x01\x00'

def test_course_isolation_invite_accept_and_revoke():
    owner=account('owner'); guest=account('guest');other=account('other');c=course(owner);cid=c['id']
    for route in ['', '/results','/members']:
        assert guest.get(f'/api/courses/{cid}'+route).status_code==404
    assert guest.get('/api/courses').json()==[]
    assert owner.post(f'/api/courses/{cid}/invite',json={'login':'guest'}).status_code==200
    inv=guest.get('/api/invitations').json()[0]
    assert guest.get(f'/api/courses/{cid}').status_code==404
    assert other.post('/api/invitations/'+str(inv['id']),json={'accept':True}).status_code==404
    guest.post('/api/invitations/'+str(inv['id']),json={'accept':True})
    assert guest.get(f'/api/courses/{cid}').status_code==200
    pub=publish(guest,c)
    assert guest.get(f'/api/courses/{cid}/results').status_code==200
    assert guest.delete(f"/api/courses/{cid}/members/{inv['id']}").status_code==403
    owner.delete(f"/api/courses/{cid}/members/{inv['id']}")
    assert guest.get(f'/api/courses/{cid}').status_code==404

def test_declined_invitation_gives_no_access():
    owner=account('owner');guest=account('guest');c=course(owner)
    owner.post(f"/api/courses/{c['id']}/invite",json={'login':'guest'})
    iid=guest.get('/api/invitations').json()[0]['id']
    guest.post('/api/invitations/'+str(iid),json={'accept':False})
    assert guest.get('/api/courses').json()==[]

def test_mentor_picker_and_batch_invitations():
    owner=account('owner');nikita=account('nikita');anna=account('anna');outsider=account('outsider');student=account('student','learner')
    nikita.put('/api/me',json={'name':'Никита Завьялов','email':'private@example.org'})
    c=course(owner);cid=c['id'];nid=nikita.get('/api/me').json()['id'];aid=anna.get('/api/me').json()['id']
    assert outsider.get(f'/api/courses/{cid}/mentors').status_code==404
    assert student.get(f'/api/courses/{cid}/mentors').status_code==403
    rows=owner.get(f'/api/courses/{cid}/mentors').json()['users']
    assert all(x['login']!='student' and 'email' not in x for x in rows)
    creator=next(x for x in rows if x['login']=='owner');assert creator['status']=='owner' and creator['assigned']
    assert owner.get(f'/api/courses/{cid}/mentors',params={'q':'НИКИТА'}).json()['users'][0]['id']==nid
    assert owner.post(f'/api/courses/{cid}/invite-batch',json={'user_ids':[nid,creator['id']]}).status_code==422
    assert nikita.get('/api/invitations').json()==[]
    r=owner.post(f'/api/courses/{cid}/invite-batch',json={'user_ids':[nid,aid]}).json()
    assert r=={'invited':2,'already_invited':0}
    assert nikita.get(f'/api/courses/{cid}').status_code==404
    assert nikita.post(f'/api/courses/{cid}/invite-batch',json={'user_ids':[aid]}).status_code==404
    assert owner.post(f'/api/courses/{cid}/invite-batch',json={'user_ids':[nid,aid]}).json()=={'invited':0,'already_invited':2}
    iid=nikita.get('/api/invitations').json()[0]['id'];nikita.post(f'/api/invitations/{iid}',json={'accept':True})
    anna_iid=anna.get('/api/invitations').json()[0]['id'];anna.post(f'/api/invitations/{anna_iid}',json={'accept':False})
    states={x['login']:x for x in owner.get(f'/api/courses/{cid}/mentors').json()['users']}
    assert states['nikita']['status']=='accepted' and states['nikita']['assigned']
    assert states['anna']['status']=='declined' and not states['anna']['assigned']
    assert owner.post(f'/api/courses/{cid}/invite-batch',json={'user_ids':[aid]}).json()['invited']==1
    assert len(anna.get('/api/invitations').json())==1
    target=outsider.get('/api/me').json()['id']
    assert nikita.post(f'/api/courses/{cid}/invite-batch',json={'user_ids':[target]}).json()['invited']==1

def test_learning_all_types_and_answer_secrecy():
    owner=account('owner');learner=account('student','learner');stranger=account('stranger','learner');c=course(owner)
    assert owner.post(f"/api/courses/{c['id']}/assign",json={'login':'student'}).status_code==422
    publish(owner,c)
    assert owner.post(f"/api/courses/{c['id']}/assign",json={'login':'student'}).status_code==200
    a=learner.get('/api/assignments').json()[0];aid=a['id']
    assert learner.get(f"/api/courses/{c['id']}").status_code==403
    assert stranger.get(f'/api/assignments/{aid}').status_code==404
    payload=learner.get(f'/api/assignments/{aid}').json()
    for e in payload['lessons'][0]['exercises']:
        assert 'answers' not in e and 'explanation' not in e
    wrong=learner.post(f'/api/assignments/{aid}/submit',json={'lesson':0,'answers':[[1],[0],[1,0],[1,2,0]]})
    assert wrong.status_code==200 and wrong.json()['passed']==False
    assert learner.get('/api/assignments').json()[0]['progress']==0
    right=learner.post(f'/api/assignments/{aid}/submit',json={'lesson':0,'answers':[[0],[1,0],[1,0],[1,2,0]]})
    assert right.json()['score']==100
    assert learner.get('/api/assignments').json()[0]['progress']==100
    results=owner.get(f"/api/courses/{c['id']}/results").json()[0]
    assert results['attempt_count']==2 and results['progress']==100

def test_learner_search_and_batch_assignment():
    owner=account('owner');student=account('anna','learner');other=account('second','learner');outsider=account('outsider')
    student.put('/api/me',json={'name':'Анна Кожинова','email':'private@example.org'})
    c=course(owner);cid=c['id']
    assert student.get(f'/api/courses/{cid}/learners').status_code==403
    assert outsider.get(f'/api/courses/{cid}/learners').status_code==404
    found=owner.get(f'/api/courses/{cid}/learners',params={'q':'анна'}).json()
    assert found['total']==1 and found['users'][0]['login']=='anna'
    assert set(found['users'][0])=={'id','name','login','assigned'}
    assert owner.get(f'/api/courses/{cid}/learners',params={'q':'ANNA'}).json()['total']==1
    assert owner.get(f'/api/courses/{cid}/learners',params={'q':'%'}).json()['total']==0
    ids=[student.get('/api/me').json()['id'],other.get('/api/me').json()['id']]
    assert owner.post(f'/api/courses/{cid}/assign-batch',json={'user_ids':ids}).status_code==422
    publish(owner,c)
    assert outsider.post(f'/api/courses/{cid}/assign-batch',json={'user_ids':ids}).status_code==404
    result=owner.post(f'/api/courses/{cid}/assign-batch',json={'user_ids':ids+ids}).json()
    assert result=={'assigned':2,'already_assigned':0}
    assert len(student.get('/api/assignments').json())==1
    assert len(other.get('/api/assignments').json())==1
    assert all(x['assigned'] for x in owner.get(f'/api/courses/{cid}/learners').json()['users'])
    assert owner.post(f'/api/courses/{cid}/assign-batch',json={'user_ids':ids}).json()=={'assigned':0,'already_assigned':2}

def test_batch_rejects_invalid_target_atomically():
    owner=account('owner');student=account('student','learner');c=course(owner);publish(owner,c)
    sid=student.get('/api/me').json()['id'];mid=owner.get('/api/me').json()['id']
    assert owner.post(f"/api/courses/{c['id']}/assign-batch",json={'user_ids':[sid,mid]}).status_code==422
    assert student.get('/api/assignments').json()==[]
    assert owner.post(f"/api/courses/{c['id']}/assign-batch",json={'user_ids':[]}).status_code==422

def test_sequential_learning_and_version_snapshot():
    owner=account('owner');learner=account('student','learner');c=course(owner)
    content=copy.deepcopy(CONTENT);content['lessons'].append(copy.deepcopy(content['lessons'][0]))
    pub=publish(owner,c,content)
    owner.post(f"/api/courses/{c['id']}/assign",json={'login':'student'})
    aid=learner.get('/api/assignments').json()[0]['id']
    assert learner.post(f'/api/assignments/{aid}/submit',json={'lesson':1,'answers':[[0],[0,1],[1,0],[1,2,0]]}).status_code==422
    publish(owner,pub,CONTENT)
    a=learner.get(f'/api/assignments/{aid}').json()
    assert a['revision']==1 and len(a['lessons'])==2

def test_validation_and_stale_version():
    a=account('owner');c=course(a)
    assert a.post(f"/api/courses/{c['id']}/publish",json={'version':0,'reviewed':False}).status_code==422
    bad=copy.deepcopy(CONTENT);bad['lessons'][0]['exercises'][0]['answers']=[999]
    assert a.put(f"/api/courses/{c['id']}",json={'title':'Test','content':bad,'version':0}).status_code==422
    publish(a,c)
    assert a.put(f"/api/courses/{c['id']}",json={'title':'Test','content':CONTENT,'version':0}).status_code==409

def test_only_creator_can_delete_and_confirmation_is_required():
    owner=account('owner');guest=account('guest');stranger=account('stranger');student=account('student','learner')
    c=course(owner);cid=c['id']
    owner.post(f'/api/courses/{cid}/invite',json={'login':'guest'})
    iid=guest.get('/api/invitations').json()[0]['id'];guest.post(f'/api/invitations/{iid}',json={'accept':True})
    payload={'version':0,'confirmation':c['title']}
    assert TestClient(app,headers=H).request('DELETE',f'/api/courses/{cid}',json=payload).status_code==401
    assert stranger.request('DELETE',f'/api/courses/{cid}',json=payload).status_code==404
    assert student.request('DELETE',f'/api/courses/{cid}',json=payload).status_code==403
    assert guest.request('DELETE',f'/api/courses/{cid}',json=payload).status_code==403
    assert owner.request('DELETE',f'/api/courses/{cid}',json={'version':0,'confirmation':'не то название'}).status_code==422
    assert owner.request('DELETE',f'/api/courses/{cid}',json={'version':999,'confirmation':c['title']}).status_code==409
    assert owner.get(f'/api/courses/{cid}').status_code==200

def test_deletion_cascades_without_deleting_accounts():
    from app.db import Session,Job,Membership,Assignment,User
    from sqlalchemy import select,func
    owner=account('owner');guest=account('guest');student=account('student','learner')
    c=course(owner);published=publish(owner,c);cid=c['id']
    owner.post(f'/api/courses/{cid}/invite',json={'login':'guest'})
    owner.post(f'/api/courses/{cid}/assign',json={'login':'student'})
    with Session.begin() as db:db.add(Job(id='active-delete-test',course_id=cid,status='generating'))
    payload={'version':published['version'],'confirmation':published['title']}
    assert owner.request('DELETE',f'/api/courses/{cid}',json=payload).status_code==409
    with Session.begin() as db:db.get(Job,'active-delete-test').status='done'
    assert owner.request('DELETE',f'/api/courses/{cid}',json=payload).status_code==200
    assert owner.get(f'/api/courses/{cid}').status_code==404
    assert student.get('/api/assignments').json()==[] and guest.get('/api/invitations').json()==[]
    with Session() as db:
        for model in [Job,Membership,Assignment]:
            assert db.scalar(select(func.count()).select_from(model).where(model.course_id==cid))==0
        assert db.scalar(select(func.count()).select_from(User))==3

def test_concurrent_updates_are_not_silently_overwritten():
    from app.db import Session, Course
    from sqlalchemy.orm.exc import StaleDataError
    owner=account('owner'); c=course(owner)
    with Session() as one, Session() as two:
        first=one.get(Course,c['id']);second=two.get(Course,c['id'])
        first.title='Изменение первого наставника';first.version+=1;one.commit()
        second.title='Изменение второго наставника';second.version+=1
        with pytest.raises(StaleDataError):two.commit()

def test_sources_and_missing_key():
    a=account('owner');c=course(a)
    assert a.post(f"/api/courses/{c['id']}/source",data={'text':'x','version':0}).status_code==422
    r=a.post(f"/api/courses/{c['id']}/source",data={'text':'Первый шаг — создать заявку. Второй шаг — дождаться согласования.','version':0})
    assert r.status_code==200,r.text
    assert a.post(f"/api/courses/{c['id']}/generate",json={'version':1}).status_code==422
    assert a.get(f"/api/courses/{c['id']}").json()['content']=={}

def test_empty_draft_saves_but_cannot_publish():
    owner=account('owner'); c=course(owner)
    r=owner.put(f"/api/courses/{c['id']}",json={'title':'Пока только название','content':{'lessons':[]},'version':0})
    assert r.status_code==200,r.text
    assert owner.get(f"/api/courses/{c['id']}").json()['content']=={'lessons':[]}
    assert owner.post(f"/api/courses/{c['id']}/publish",json={'version':r.json()['version'],'reviewed':True}).status_code==422
    incomplete={'lessons':[{'title':'Тема без заданий','summary':'','exercises':[]}]}
    r=owner.put(f"/api/courses/{c['id']}",json={'title':'Незавершённый курс','content':incomplete,'version':r.json()['version']})
    assert r.status_code==200
    assert owner.post(f"/api/courses/{c['id']}/publish",json={'version':r.json()['version'],'reviewed':True}).status_code==422

def test_config_refreshes_env_without_key_exposure(monkeypatch,tmp_path):
    import app.settings as settings
    monkeypatch.setattr(settings,'ROOT',tmp_path)
    monkeypatch.setattr(settings,'PROVIDER_ENV_OVERRIDES',set())
    owner=account('owner')
    (tmp_path/'.env').write_text('DEEPSEEK_API_KEY=\n',encoding='utf8')
    assert owner.get('/api/config').json()['ai_ready']==False
    (tmp_path/'.env').write_text('DEEPSEEK_API_KEY=not-a-real-key\nDEEPSEEK_MODEL=deepseek-flash\n',encoding='utf8')
    r=owner.get('/api/config')
    assert r.json()['ai_ready']==True
    assert 'not-a-real-key' not in r.text

def test_generation_reports_real_phases(monkeypatch):
    import app.main as main
    from app.db import Session,Job
    monkeypatch.setenv('DEEPSEEK_API_KEY','unit-test-not-real')
    observed=[];original=main.update_job
    def track(jid,status,message):
        observed.append(status)
        original(jid,status,message)
    def fake_generate(text,on_stage=None):
        with Session() as db:
            job=db.scalar(select(Job))
            assert job.status=='generating' and job.done==0
        if on_stage:on_stage('Ответ получен. Проверяем задания.')
        return CONTENT
    from sqlalchemy import select
    monkeypatch.setattr(main,'update_job',track)
    monkeypatch.setattr(main,'generate_chunk',fake_generate)
    owner=account('owner');c=course(owner)
    owner.post(f"/api/courses/{c['id']}/source",data={'text':'Учебный материал: создайте заявку и дождитесь согласования ответственного руководителя.','version':0})
    r=owner.post(f"/api/courses/{c['id']}/generate",json={'version':1})
    assert r.status_code==200
    j=owner.get(f"/api/courses/{c['id']}/jobs/{r.json()['id']}").json()
    assert j['created'] and j['done']==j['total']==1 and j['status']=='done'
    assert observed==['generating','generating','validating','saving']

def test_csrf_and_login_required():
    assert TestClient(app).post('/api/auth/logout').status_code==403
    assert TestClient(app).get('/api/courses').status_code==401
    assert TestClient(app,headers={**H,'Origin':'https://evil.test'}).post('/api/auth/logout').status_code==403

def test_extraction_and_chunk_coverage():
    text=('Раздел материала.\n'*2000)
    assert ''.join(split_source(text))==text
    assert extract_file('note.txt',text.encode())==text.strip()
    with pytest.raises(ValueError): extract_file('old.doc',b'not a docx')
    import io
    from docx import Document
    d=Document();d.add_paragraph('Первый абзац инструкции.');t=d.add_table(rows=1,cols=1);t.cell(0,0).text='Таблица процесса.';d.add_paragraph('Завершение инструкции.')
    b=io.BytesIO();d.save(b);result=extract_file('test.docx',b.getvalue())
    assert result.index('Первый')<result.index('Таблица')<result.index('Завершение')

def test_generation_job_and_unauthorised_poll(monkeypatch):
    import app.main as main
    monkeypatch.setenv('DEEPSEEK_API_KEY','unit-test-not-real')
    monkeypatch.setattr(main,'generate_chunk',lambda text, on_stage=None:CONTENT)
    a=account('owner');other=account('other');c=course(a)
    a.post(f"/api/courses/{c['id']}/source",data={'text':'Разрешённый материал для подготовки курса. Все важные правила здесь.','version':0})
    j=a.post(f"/api/courses/{c['id']}/generate",json={'version':1}).json()
    assert a.get(f"/api/courses/{c['id']}/jobs/{j['id']}").json()['status']=='done'
    assert other.get(f"/api/courses/{c['id']}/jobs/{j['id']}").status_code==404
    assert a.get(f"/api/courses/{c['id']}").json()['content']['lessons']

def test_model_quote_validation(monkeypatch):
    import app.content as content
    monkeypatch.setenv('DEEPSEEK_API_KEY','unit-test-not-real')
    class FakeResponse:
        status_code=200
        def json(self):
            import json
            v=copy.deepcopy(CONTENT);v['lessons'][0]['source_quote']='Выдуманная цитата'
            return {'choices':[{'finish_reason':'stop','message':{'content':json.dumps(v)}}]}
    class FakeClient:
        def __init__(self,**kw):pass
        def __enter__(self):return self
        def __exit__(self,*args):pass
        def post(self,*args,**kwargs):return FakeResponse()
    monkeypatch.setattr(content.httpx,'Client',FakeClient)
    with pytest.raises(ValueError,match='Цитата'):
        content.generate_chunk('Подлинная инструкция без такой цитаты.')

@pytest.mark.parametrize('model',['deepseek-chat','gpt-4o-mini','deepseek-v4.1-flash'])
def test_chatanywhere_url_and_compatible_request(monkeypatch,model):
    import json
    import app.content as content
    endpoint='https://api.chatanywhere.org/v1/chat/completions'
    monkeypatch.setattr(content,'provider_settings',lambda:{'DEEPSEEK_API_KEY':'test-key-only','DEEPSEEK_URL':endpoint,'DEEPSEEK_MODEL':model,'provider':'ChatAnywhere'})
    calls=[]
    class FakeResponse:
        status_code=200
        def json(self):
            result=copy.deepcopy(CONTENT);result['lessons'][0]['source_quote']='Создайте заявку.'
            return {'choices':[{'finish_reason':'stop','message':{'content':json.dumps(result)}}]}
    class FakeClient:
        def __init__(self,**kw):pass
        def __enter__(self):return self
        def __exit__(self,*args):pass
        def post(self,url,headers,json):
            calls.append((url,headers,json));return FakeResponse()
    monkeypatch.setattr(content.httpx,'Client',FakeClient)
    result=content.generate_chunk('Создайте заявку. Дождитесь согласования руководителя.')
    assert len(result['lessons'])==1
    url,headers,body=calls[0]
    assert url==endpoint and url.count('/chat/completions')==1
    assert body['model']==model and body['stream']==False
    assert body['max_tokens']==8192 and body['response_format']=={'type':'json_object'}
    assert 'thinking' not in body and 'reasoning_effort' not in body
    assert headers['Authorization']=='Bearer test-key-only'

@pytest.mark.parametrize('code,expected',[(401,'ключ'),(402,'квоты'),(403,'квота'),(404,'DEEPSEEK_URL'),(429,'квоту')])
def test_chatanywhere_error_handling(monkeypatch,code,expected):
    import app.content as content
    monkeypatch.setattr(content,'provider_settings',lambda:{'DEEPSEEK_API_KEY':'test-key-only','DEEPSEEK_URL':'https://api.chatanywhere.org/v1/chat/completions','DEEPSEEK_MODEL':'deepseek-chat','provider':'ChatAnywhere'})
    class FakeClient:
        def __init__(self,**kw):pass
        def __enter__(self):return self
        def __exit__(self,*args):pass
        def post(self,*args,**kw):
            return type('Reply',(),{'status_code':code})()
    monkeypatch.setattr(content.httpx,'Client',FakeClient)
    with pytest.raises(ValueError,match=expected):
        content.generate_chunk('Учебный материал для теста.')

def test_full_url_precedence_and_default_model(monkeypatch,tmp_path):
    import app.settings as settings
    monkeypatch.setattr(settings,'ROOT',tmp_path)
    monkeypatch.setattr(settings,'PROVIDER_ENV_OVERRIDES',set())
    monkeypatch.delenv('DEEPSEEK_URL',raising=False)
    monkeypatch.delenv('DEEPSEEK_MODEL',raising=False)
    (tmp_path/'.env').write_text('DEEPSEEK_URL=https://api.chatanywhere.org/v1/chat/completions\nDEEPSEEK_BASE_URL=https://legacy.invalid\n',encoding='utf8')
    s=settings.provider_settings()
    assert s['DEEPSEEK_URL']=='https://api.chatanywhere.org/v1/chat/completions'
    assert s['DEEPSEEK_MODEL']=='deepseek-v4.1-flash' and s['provider']=='ChatAnywhere'
