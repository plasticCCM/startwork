import hashlib
import hmac
import os
import re
import secrets
import time
import uuid
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from threading import Lock
from urllib.parse import urlparse

from fastapi import FastAPI, Depends, HTTPException, Request, Response, UploadFile, File, Form, BackgroundTasks
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import select, or_, delete, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DBSession
from sqlalchemy.orm.exc import StaleDataError

from .db import ROOT, Session, init_db, User, AuthSession, Course, Membership, Assignment, Job, now
from .content import Curriculum, DraftCurriculum, split_source, generate_chunk, extract_file
from .settings import provider_settings

ACTIVE_JOB_STATUSES = ('pending', 'running', 'preparing', 'generating', 'validating', 'saving')

@asynccontextmanager
async def lifespan(app):
    init_db()
    yield

app = FastAPI(title='StartWork', lifespan=lifespan, docs_url=None, redoc_url=None)
app.mount('/static', StaticFiles(directory=ROOT/'app/static'), name='static')

@app.exception_handler(StaleDataError)
async def concurrent_edit(request, exc):
    return JSONResponse({'detail': 'Курс уже изменён другим наставником. Обновите страницу.'}, status_code=409)

@app.middleware('http')
async def headers_and_csrf(request: Request, call_next):
    if request.url.path.startswith('/api/') and request.method not in ('GET', 'HEAD', 'OPTIONS'):
        origin = request.headers.get('origin')
        if request.headers.get('x-startwork') != '1' or (origin and urlparse(origin).netloc != request.headers.get('host')):
            return JSONResponse({'detail': 'Запрос отклонён. Обновите страницу.'}, status_code=403)
    res = await call_next(request)
    res.headers['X-Content-Type-Options'] = 'nosniff'
    res.headers['Referrer-Policy'] = 'same-origin'
    res.headers['X-Frame-Options'] = 'DENY'
    res.headers['Content-Security-Policy'] = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
    if request.url.path.startswith('/api/'):
        res.headers['Cache-Control'] = 'no-store'
    return res

def db_session():
    with Session() as db:
        yield db

DB = Depends(db_session)

def auth(request: Request, db: DBSession = DB):
    token = request.cookies.get('sw_session', '')
    row = db.get(AuthSession, hashlib.sha256(token.encode()).hexdigest()) if token else None
    if not row or row.expires < time.time():
        raise HTTPException(401, 'Войдите в аккаунт')
    user = db.get(User, row.user_id)
    if not user:
        raise HTTPException(401, 'Войдите в аккаунт')
    return user

AUTH = Depends(auth)

def mentor(user):
    if user.role != 'mentor':
        raise HTTPException(403, 'Это действие доступно наставнику')

def owned(db, user, cid):
    mentor(user)
    course = db.get(Course, cid)
    member = db.scalar(select(Membership).where(Membership.course_id == cid, Membership.user_id == user.id, Membership.status == 'accepted'))
    if not course or (course.owner_id != user.id and not member):
        raise HTTPException(404, 'Курс не найден')
    return course

def user_info(user):
    return {'id': user.id, 'login': user.login, 'name': user.name, 'role': user.role, 'email': user.email}

def hash_password(password):
    salt = secrets.token_hex(16)
    digest = hashlib.scrypt(password.encode(), salt=salt.encode(), n=16384, r=8, p=1).hex()
    return salt + ':' + digest

def check_password(password, stored):
    salt, digest = stored.split(':', 1)
    guess = hashlib.scrypt(password.encode(), salt=salt.encode(), n=16384, r=8, p=1).hex()
    return hmac.compare_digest(guess, digest)

attempts = defaultdict(deque)
attempt_lock = Lock()

def throttle(request, action, limit=20):
    key = (request.client.host if request.client else 'local', action)
    with attempt_lock:
        if len(attempts) > 5000:
            stale = [k for k, v in attempts.items() if not v or v[-1] < time.time() - 900]
            for k in stale:
                del attempts[k]
        q = attempts[key]
        while q and q[0] < time.time() - 900:
            q.popleft()
        if len(q) >= limit:
            raise HTTPException(429, 'Слишком много попыток. Подождите 15 минут.')
        q.append(time.time())

class Registration(BaseModel):
    login: str = Field(min_length=3, max_length=40)
    password: str = Field(min_length=1, max_length=128)
    name: str = Field(default='', max_length=100)
    email: str = Field(default='', max_length=254)
    role: str

class Login(BaseModel):
    login: str = Field(max_length=50)
    password: str = Field(max_length=128)

def begin_session(db, user, response):
    token = secrets.token_urlsafe(40)
    db.add(AuthSession(token=hashlib.sha256(token.encode()).hexdigest(), user_id=user.id, expires=int(time.time()) + 7*86400))
    db.commit()
    response.set_cookie('sw_session', token, httponly=True, secure=os.getenv('COOKIE_SECURE', 'false').lower() == 'true', samesite='lax', max_age=7*86400)

@app.post('/api/auth/register')
def register(data: Registration, request: Request, response: Response, db: DBSession = DB):
    throttle(request, 'register', 30)
    login = data.login.strip().lower()
    if not re.fullmatch(r'[a-zа-яё0-9_.-]{3,40}', login, re.I):
        raise HTTPException(422, 'Логин: 3–40 букв, цифр, точек, дефисов или подчёркиваний')
    if not re.search(r'[0-9]', data.password):
        raise HTTPException(422, 'Добавьте в пароль хотя бы одну цифру')
    if data.role not in ('mentor', 'learner'):
        raise HTTPException(422, 'Выберите роль')
    if data.email and not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', data.email):
        raise HTTPException(422, 'Проверьте почту или оставьте поле пустым')
    user = User(login=login, name=data.name.strip() or login, email=data.email, role=data.role, password=hash_password(data.password))
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, 'Этот логин уже занят') from None
    begin_session(db, user, response)
    return user_info(user)

@app.post('/api/auth/login')
def login(data: Login, request: Request, response: Response, db: DBSession = DB):
    throttle(request, 'login', 40)
    user = db.scalar(select(User).where(User.login == data.login.strip().lower()))
    if not user or not check_password(data.password, user.password):
        raise HTTPException(401, 'Неверный логин или пароль')
    begin_session(db, user, response)
    return user_info(user)

@app.post('/api/auth/logout')
def logout(request: Request, response: Response, db: DBSession = DB):
    token = request.cookies.get('sw_session', '')
    db.execute(delete(AuthSession).where(AuthSession.token == hashlib.sha256(token.encode()).hexdigest()))
    db.commit()
    response.delete_cookie('sw_session')
    return {'ok': True}

@app.get('/api/me')
def me(user: User = AUTH):
    return user_info(user)

class ProfileUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    email: str = Field(default='', max_length=254)

@app.put('/api/me')
def update_profile(data: ProfileUpdate, db: DBSession = DB, user: User = AUTH):
    if not data.name.strip():
        raise HTTPException(422, 'Введите имя')
    email = data.email.strip()
    if email and not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email):
        raise HTTPException(422, 'Проверьте почту или оставьте поле пустым')
    user.name = data.name.strip()
    user.email = email
    db.commit()
    return user_info(user)

class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=1, max_length=128)

@app.post('/api/me/password')
def change_password(data: PasswordChange, request: Request, db: DBSession = DB, user: User = AUTH):
    throttle(request, 'password-change', 15)
    if not check_password(data.current_password, user.password):
        raise HTTPException(422, 'Текущий пароль неверный')
    if not re.search(r'[0-9]', data.new_password):
        raise HTTPException(422, 'В новом пароле нужна хотя бы одна цифра')
    if data.current_password == data.new_password:
        raise HTTPException(422, 'Новый пароль должен отличаться от текущего')
    user.password = hash_password(data.new_password)
    current_token = hashlib.sha256(request.cookies.get('sw_session', '').encode()).hexdigest()
    db.execute(delete(AuthSession).where(AuthSession.user_id == user.id, AuthSession.token != current_token))
    db.commit()
    return {'ok': True}

@app.get('/api/config')
def config(user: User = AUTH):
    mentor(user)
    settings = provider_settings()
    return {'ai_ready': bool(settings['DEEPSEEK_API_KEY'].strip()), 'model': settings['DEEPSEEK_MODEL'], 'provider': settings['provider']}

def course_info(c):
    return {'id': c.id, 'title': c.title, 'description': c.description, 'owner_id': c.owner_id,
            'revision': c.revision, 'version': c.version, 'lesson_count': len(c.content.get('lessons', [])),
            'published': bool(c.published), 'created': c.created}

@app.get('/api/courses')
def courses(db: DBSession = DB, user: User = AUTH):
    mentor(user)
    invited = select(Membership.course_id).where(Membership.user_id == user.id, Membership.status == 'accepted')
    cs = db.scalars(select(Course).where(or_(Course.owner_id == user.id, Course.id.in_(invited))).order_by(Course.id.desc())).all()
    return [course_info(c) for c in cs]

class CreateCourse(BaseModel):
    title: str = Field(min_length=2, max_length=180)
    description: str = Field(default='', max_length=3000)

@app.post('/api/courses')
def create_course(data: CreateCourse, db: DBSession = DB, user: User = AUTH):
    mentor(user)
    if len(data.title.strip()) < 2:
        raise HTTPException(422, 'Введите название курса')
    c = Course(owner_id=user.id, title=data.title.strip(), description=data.description)
    db.add(c); db.commit()
    return course_info(c)

@app.get('/api/courses/{cid}')
def get_course(cid: int, db: DBSession = DB, user: User = AUTH):
    c = owned(db, user, cid)
    return {**course_info(c), 'source': c.source, 'sources': c.sources, 'content': c.content,
            'active_job': job_info(db.scalar(select(Job).where(Job.course_id == cid, Job.status.in_(ACTIVE_JOB_STATUSES)).order_by(Job.created.desc())))}

def lock_course(db, cid):
    # PostgreSQL row lock; SQLite serialises writes at transaction level.
    return db.scalar(select(Course).where(Course.id == cid).with_for_update())

def expect_version(c, version):
    if c.version != version:
        raise HTTPException(409, 'Курс изменён другим наставником. Обновите страницу перед сохранением.')

def no_active_job(db, cid):
    if db.scalar(select(Job).where(Job.course_id == cid, Job.status.in_(ACTIVE_JOB_STATUSES))):
        raise HTTPException(409, 'Дождитесь завершения подготовки курса')

class SaveCourse(CreateCourse):
    content: DraftCurriculum
    version: int

@app.put('/api/courses/{cid}')
def save_course(cid: int, data: SaveCourse, db: DBSession = DB, user: User = AUTH):
    owned(db, user, cid)
    c = lock_course(db, cid); expect_version(c, data.version); no_active_job(db, cid)
    if len(data.title.strip()) < 2:
        raise HTTPException(422, 'Введите название курса')
    c.title = data.title.strip(); c.description = data.description
    c.content = data.content.model_dump(); c.version += 1
    db.commit()
    return course_info(c)

@app.post('/api/courses/{cid}/source')
async def source(cid: int, text: str = Form(''), version: int = Form(...), files: list[UploadFile] = File(default=[]), db: DBSession = DB, user: User = AUTH):
    owned(db, user, cid)
    no_active_job(db, cid)
    if len(files) > 6 or len(text) > 120000:
        raise HTTPException(422, 'Не больше 6 файлов и 120 000 символов материала на курс')
    parts, names, total = [], [], 0
    if text.strip():
        parts.append('[Текст наставника]\n' + text.strip()); names.append('Текст наставника')
    for f in files:
        raw = await f.read(10_000_001)
        total += len(raw)
        if total > 10_000_000:
            raise HTTPException(422, 'Общий размер файлов — до 10 МБ')
        try:
            parsed = extract_file(f.filename or '', raw)
        except ValueError as e:
            raise HTTPException(422, str(e)) from None
        name = (f.filename or 'Документ').replace('\\', '/').rsplit('/', 1)[-1][:200]
        parts.append('[' + name + ']\n' + parsed); names.append(name)
    full = '\n\n'.join(parts)
    if len(full) < 40 or len(full) > 120000:
        raise HTTPException(422, 'Добавьте от 40 до 120 000 символов. Длинный материал разделите на курсы.')
    c = lock_course(db, cid); expect_version(c, version); no_active_job(db, cid)
    c.source = full; c.sources = names; c.content = {}; c.version += 1
    db.commit()
    return {'version': c.version, 'characters': len(full), 'sources': names, 'parts': len(split_source(full))}

class Version(BaseModel):
    version: int

class DeleteCourse(Version):
    confirmation: str = Field(min_length=1, max_length=180)

@app.delete('/api/courses/{cid}')
def delete_course(cid: int, data: DeleteCourse, db: DBSession = DB, user: User = AUTH):
    owned(db, user, cid)
    c = lock_course(db, cid)
    if c.owner_id != user.id:
        raise HTTPException(403, 'Удалить курс может только его создатель')
    expect_version(c, data.version)
    no_active_job(db, cid)
    if data.confirmation.strip() != c.title.strip():
        raise HTTPException(422, 'Для подтверждения введите точное название курса')
    db.delete(c)
    db.commit()
    return {'ok': True}

def job_info(j):
    return None if not j else {'id': j.id, 'status': j.status, 'done': j.done, 'total': j.total, 'message': j.message, 'created': j.created}

def update_job(jid, status, message):
    with Session.begin() as db:
        j = db.get(Job, jid)
        j.status = status
        j.message = message

def run_generation(jid):
    try:
        with Session() as db:
            j = db.get(Job, jid); c = db.get(Course, j.course_id)
            chunks = split_source(c.source)
            j.status = 'preparing'; j.total = len(chunks)
            j.message = f'Исходник принят: {len(c.source)} символов. Подготовлено частей: {len(chunks)}.'
            db.commit()
        lessons = []
        for i, chunk in enumerate(chunks):
            update_job(jid, 'generating', f'Модель изучает материал и готовит темы и задания. Часть {i+1} из {len(chunks)}.')
            def response_received(message):
                update_job(jid, 'generating', f'Часть {i+1} из {len(chunks)}: {message}')
            generated = generate_chunk(chunk, on_stage=response_received)
            for lesson in generated['lessons']:
                lesson['source_section'] = f'Часть {i+1} · ' + lesson.get('source_section', '')[:150]
                lessons.append(lesson)
            with Session.begin() as db:
                j = db.get(Job, jid)
                j.done = i+1; j.message = f'Обработано частей: {i+1} из {len(chunks)}'
        update_job(jid, 'validating', 'Все части обработаны. Проверяем структуру курса и корректность заданий.')
        curriculum = Curriculum.model_validate({'lessons': lessons}).model_dump()
        update_job(jid, 'saving', 'Проверка завершена. Сохраняем темы и задания в ваш черновик.')
        with Session.begin() as db:
            j = db.get(Job, jid); c = db.get(Course, j.course_id)
            c.content = curriculum; c.version += 1
            j.status = 'done'; j.message = 'Черновик готов. Проверьте полноту тем и правильные ответы.'
    except Exception as e:
        with Session.begin() as db:
            j = db.get(Job, jid)
            if j:
                j.status = 'error'
                # Never expose provider responses, request headers or tracebacks.
                j.message = str(e)[:350] if type(e) is ValueError else 'Не удалось подготовить курс. Повторите попытку или создайте его вручную.'

@app.post('/api/courses/{cid}/generate')
def generate(cid: int, data: Version, tasks: BackgroundTasks, db: DBSession = DB, user: User = AUTH):
    owned(db, user, cid)
    c = lock_course(db, cid); expect_version(c, data.version); no_active_job(db, cid)
    if not c.source:
        raise HTTPException(422, 'Сначала добавьте исходный материал')
    if not provider_settings()['DEEPSEEK_API_KEY'].strip():
        raise HTTPException(422, 'Добавьте ключ ChatAnywhere в DEEPSEEK_API_KEY в серверном .env. Курс можно подготовить вручную.')
    j = Job(id=str(uuid.uuid4()), course_id=cid, total=len(split_source(c.source)))
    db.add(j); db.commit(); tasks.add_task(run_generation, j.id)
    return job_info(j)

@app.get('/api/courses/{cid}/jobs/{jid}')
def job(cid: int, jid: str, db: DBSession = DB, user: User = AUTH):
    owned(db, user, cid)
    j = db.get(Job, jid)
    if not j or j.course_id != cid:
        raise HTTPException(404, 'Подготовка не найдена')
    return job_info(j)

class Publish(Version):
    reviewed: bool

@app.post('/api/courses/{cid}/publish')
def publish(cid: int, data: Publish, db: DBSession = DB, user: User = AUTH):
    owned(db, user, cid)
    c = lock_course(db, cid); expect_version(c, data.version); no_active_job(db, cid)
    if not data.reviewed:
        raise HTTPException(422, 'Подтвердите сверку с исходником')
    try:
        content = Curriculum.model_validate(c.content).model_dump()
    except ValueError:
        raise HTTPException(422, 'В курсе нужны темы, объяснения и корректные задания') from None
    c.revision += 1; c.version += 1
    c.published = {'title': c.title, 'description': c.description, 'lessons': content['lessons']}
    db.commit()
    return course_info(c)

class Target(BaseModel):
    login: str = Field(min_length=3, max_length=40)

class BatchInvitation(BaseModel):
    user_ids: list[int] = Field(min_length=1, max_length=50)

@app.get('/api/courses/{cid}/mentors')
def find_mentors(cid: int, q: str = '', offset: int = 0, db: DBSession = DB, user: User = AUTH):
    c = owned(db, user, cid)
    if len(q) > 100 or offset < 0:
        raise HTTPException(422, 'Проверьте поисковый запрос')
    query = select(User).where(User.role == 'mentor')
    term = q.strip().lower()
    if term:
        query = query.where(or_(User.login.icontains(term, autoescape=True), User.name.icontains(term, autoescape=True)))
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    users = db.scalars(query.order_by(func.lower(User.name), User.id).offset(offset).limit(20)).all()
    membership = {m.user_id: m.status for m in db.scalars(select(Membership).where(Membership.course_id == cid))}
    people = []
    for u in users:
        status = 'owner' if u.id == c.owner_id else membership.get(u.id, 'available')
        people.append({'id': u.id, 'name': u.name, 'login': u.login, 'status': status,
                       'assigned': status in ('owner', 'accepted', 'pending')})
    return {'users': people, 'total': total, 'has_more': offset + len(users) < total}

@app.post('/api/courses/{cid}/invite-batch')
def invite_batch(cid: int, data: BatchInvitation, db: DBSession = DB, user: User = AUTH):
    owned(db, user, cid)
    c = lock_course(db, cid)
    ids = set(data.user_ids)
    targets = db.scalars(select(User).where(User.id.in_(ids), User.role == 'mentor', User.id != c.owner_id)).all()
    if len(targets) != len(ids):
        raise HTTPException(422, 'Выберите зарегистрированных наставников, кроме создателя курса.')
    memberships = {m.user_id: m for m in db.scalars(select(Membership).where(Membership.course_id == cid, Membership.user_id.in_(ids)))}
    count = 0
    for target in targets:
        old = memberships.get(target.id)
        if old and old.status in ('accepted', 'pending'):
            continue
        if old:
            old.status = 'pending'
            old.invited_by = user.id
        else:
            db.add(Membership(course_id=cid, user_id=target.id, invited_by=user.id))
        count += 1
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, 'Список приглашений изменился. Обновите его и повторите выбор.') from None
    return {'invited': count, 'already_invited': len(ids) - count}

@app.get('/api/courses/{cid}/members')
def members(cid: int, db: DBSession = DB, user: User = AUTH):
    c = owned(db, user, cid)
    owner = db.get(User, c.owner_id)
    result = [{**user_info(owner), 'status': 'owner', 'membership_id': None}]
    for m, u in db.execute(select(Membership, User).join(User, Membership.user_id == User.id).where(Membership.course_id == cid)):
        result.append({**user_info(u), 'status': m.status, 'membership_id': m.id})
    return result

@app.post('/api/courses/{cid}/invite')
def invite(cid: int, data: Target, db: DBSession = DB, user: User = AUTH):
    c = owned(db, user, cid)
    target = db.scalar(select(User).where(User.login == data.login.strip().lower(), User.role == 'mentor'))
    if not target or target.id == c.owner_id:
        raise HTTPException(422, 'Наставник с таким логином не найден или уже является владельцем')
    old = db.scalar(select(Membership).where(Membership.course_id == cid, Membership.user_id == target.id))
    if old and old.status in ('pending', 'accepted'):
        raise HTTPException(409, 'Наставник уже приглашён или участвует в курсе')
    if old:
        old.status = 'pending'; old.invited_by = user.id
    else:
        db.add(Membership(course_id=cid, user_id=target.id, invited_by=user.id))
    try:
        db.commit()
    except IntegrityError:
        db.rollback(); raise HTTPException(409, 'Наставник уже приглашён') from None
    return {'ok': True}

@app.get('/api/invitations')
def invitations(db: DBSession = DB, user: User = AUTH):
    mentor(user)
    return [{'id': m.id, 'course_title': c.title, 'from': u.name, 'created': c.created} for m,c,u in db.execute(
        select(Membership, Course, User).join(Course, Membership.course_id == Course.id).join(User, Membership.invited_by == User.id)
        .where(Membership.user_id == user.id, Membership.status == 'pending'))]

class Decision(BaseModel):
    accept: bool

@app.post('/api/invitations/{mid}')
def decide(mid: int, data: Decision, db: DBSession = DB, user: User = AUTH):
    mentor(user)
    m = db.get(Membership, mid)
    if not m or m.user_id != user.id or m.status != 'pending':
        raise HTTPException(404, 'Приглашение не найдено')
    m.status = 'accepted' if data.accept else 'declined'; db.commit()
    return {'ok': True}

@app.delete('/api/courses/{cid}/members/{mid}')
def remove_member(cid: int, mid: int, db: DBSession = DB, user: User = AUTH):
    c = owned(db, user, cid)
    if c.owner_id != user.id:
        raise HTTPException(403, 'Удалить участника может создатель курса')
    m = db.get(Membership, mid)
    if not m or m.course_id != cid:
        raise HTTPException(404, 'Участник не найден')
    db.delete(m); db.commit()
    return {'ok': True}

@app.post('/api/courses/{cid}/assign')
def assign(cid: int, data: Target, db: DBSession = DB, user: User = AUTH):
    c = owned(db, user, cid)
    if not c.published:
        raise HTTPException(422, 'Сначала проверьте и опубликуйте курс')
    target = db.scalar(select(User).where(User.login == data.login.strip().lower(), User.role == 'learner'))
    if not target:
        raise HTTPException(422, 'Обучающийся с таким логином не найден')
    if db.scalar(select(Assignment).where(Assignment.course_id == cid, Assignment.user_id == target.id)):
        raise HTTPException(409, 'Курс уже назначен. Новая публикация не меняет начатое обучение.')
    a = Assignment(course_id=cid, user_id=target.id, snapshot=c.published, revision=c.revision)
    db.add(a)
    try:
        db.commit()
    except IntegrityError:
        db.rollback(); raise HTTPException(409, 'Курс уже назначен') from None
    return {'ok': True}

@app.get('/api/courses/{cid}/learners')
def find_learners(cid: int, q: str = '', offset: int = 0, db: DBSession = DB, user: User = AUTH):
    owned(db, user, cid)
    if len(q) > 100 or offset < 0:
        raise HTTPException(422, 'Проверьте поисковый запрос')
    query = select(User).where(User.role == 'learner')
    term = q.strip().lower()
    if term:
        query = query.where(or_(User.login.icontains(term, autoescape=True), User.name.icontains(term, autoescape=True)))
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    users = db.scalars(query.order_by(func.lower(User.name), User.id).offset(offset).limit(20)).all()
    assigned_ids = set(db.scalars(select(Assignment.user_id).where(Assignment.course_id == cid)))
    return {'users': [{'id': u.id, 'name': u.name, 'login': u.login, 'assigned': u.id in assigned_ids} for u in users],
            'total': total, 'has_more': offset + len(users) < total}

class BatchAssignment(BaseModel):
    user_ids: list[int] = Field(min_length=1, max_length=50)

@app.post('/api/courses/{cid}/assign-batch')
def assign_batch(cid: int, data: BatchAssignment, db: DBSession = DB, user: User = AUTH):
    owned(db, user, cid)
    c = lock_course(db, cid)
    if not c.published:
        raise HTTPException(422, 'Сначала проверьте и опубликуйте курс')
    ids = set(data.user_ids)
    targets = db.scalars(select(User).where(User.id.in_(ids), User.role == 'learner')).all()
    if len(targets) != len(ids):
        raise HTTPException(422, 'Один из выбранных обучающихся не найден. Обновите список.')
    existing = set(db.scalars(select(Assignment.user_id).where(Assignment.course_id == cid, Assignment.user_id.in_(ids))))
    for u in targets:
        if u.id not in existing:
            db.add(Assignment(course_id=cid, user_id=u.id, snapshot=c.published, revision=c.revision))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, 'Назначения изменились другим наставником. Обновите список и повторите.') from None
    return {'assigned': len(ids - existing), 'already_assigned': len(existing)}

def assignment_info(a):
    count = len(a.snapshot['lessons'])
    return {'id': a.id, 'title': a.snapshot['title'], 'description': a.snapshot['description'], 'revision': a.revision,
            'lesson_count': count, 'completed_lessons': a.completed_lessons,
            'progress': round(len(a.completed_lessons)/count*100), 'attempt_count': len(a.attempts), 'assigned': a.assigned}

@app.get('/api/assignments')
def assignments(db: DBSession = DB, user: User = AUTH):
    return [assignment_info(a) for a in db.scalars(select(Assignment).where(Assignment.user_id == user.id).order_by(Assignment.id.desc()))]

def my_assignment(db, user, aid):
    a = db.get(Assignment, aid)
    if not a or a.user_id != user.id:
        raise HTTPException(404, 'Обучение не найдено')
    return a

@app.get('/api/assignments/{aid}')
def assignment(aid: int, db: DBSession = DB, user: User = AUTH):
    a = my_assignment(db, user, aid)
    lessons = []
    for l in a.snapshot['lessons']:
        lessons.append({'title': l['title'], 'summary': l['summary'], 'exercises': [
            {k: v for k,v in e.items() if k not in ('answers', 'explanation')} for e in l['exercises']]})
    return {**assignment_info(a), 'lessons': lessons}

class Submission(BaseModel):
    lesson: int = Field(ge=0)
    answers: list[list[int]] = Field(max_length=12)

@app.post('/api/assignments/{aid}/submit')
def submit(aid: int, data: Submission, db: DBSession = DB, user: User = AUTH):
    a = my_assignment(db, user, aid)
    if data.lesson >= len(a.snapshot['lessons']):
        raise HTTPException(422, 'Тема не найдена')
    if data.lesson > 0 and data.lesson-1 not in a.completed_lessons:
        raise HTTPException(422, 'Сначала завершите предыдущую тему')
    exercises = a.snapshot['lessons'][data.lesson]['exercises']
    if len(exercises) != len(data.answers):
        raise HTTPException(422, 'Выполните все задания')
    if len(a.attempts) >= 500:
        raise HTTPException(422, 'Лимит попыток достигнут. Обратитесь к наставнику.')
    details = []
    for e, answer in zip(exercises, data.answers):
        if any(i < 0 or i >= len(e['options']) for i in answer) or len(set(answer)) != len(answer):
            raise HTTPException(422, 'Проверьте выбранные варианты')
        correct = (set(answer) == set(e['answers'])) if e['kind'] in ('single','multiple') else (answer == e['answers'])
        details.append({'correct': correct, 'explanation': e['explanation'], 'answers': e['answers']})
    score = round(sum(d['correct'] for d in details)/len(details)*100)
    passed = score == 100
    if passed:
        a.completed_lessons = sorted(set(a.completed_lessons + [data.lesson]))
    a.attempts = a.attempts + [{'lesson': data.lesson, 'score': score, 'answers': data.answers, 'at': now()}]
    db.commit()
    return {'score': score, 'passed': passed, 'details': details, 'completed_lessons': a.completed_lessons}

@app.get('/api/courses/{cid}/results')
def results(cid: int, db: DBSession = DB, user: User = AUTH):
    owned(db, user, cid)
    return [{**assignment_info(a), 'user': {'name': u.name, 'login': u.login}, 'attempts': a.attempts}
            for a,u in db.execute(select(Assignment, User).join(User, Assignment.user_id == User.id).where(Assignment.course_id == cid))]

@app.get('/')
def index():
    return FileResponse(ROOT/'app/static/index.html', headers={'Cache-Control': 'no-cache'})

@app.get('/favicon.ico', include_in_schema=False)
def favicon():
    return FileResponse(ROOT/'app/static/favicon.ico', media_type='image/x-icon')
