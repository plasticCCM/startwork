import os
from datetime import datetime, timezone
from pathlib import Path
from dotenv import load_dotenv
from sqlalchemy import create_engine, event, String, Text, Integer, ForeignKey, UniqueConstraint, JSON
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

ROOT = Path(__file__).resolve().parents[1]
PROVIDER_ENV_KEYS = ('DEEPSEEK_API_KEY', 'DEEPSEEK_URL', 'DEEPSEEK_BASE_URL', 'DEEPSEEK_MODEL')
PROVIDER_ENV_OVERRIDES = {key for key in PROVIDER_ENV_KEYS if key in os.environ}
load_dotenv(ROOT / '.env')
(ROOT / 'data').mkdir(exist_ok=True)
URL = os.getenv('DATABASE_URL') or 'sqlite:///' + (ROOT / 'data/startwork.db').as_posix()
engine = create_engine(URL, connect_args={'check_same_thread': False} if URL.startswith('sqlite') else {}, pool_pre_ping=True)
if URL.startswith('sqlite'):
    @event.listens_for(engine, 'connect')
    def sqlite_settings(connection, _):
        connection.execute('PRAGMA foreign_keys=ON')
        connection.execute('PRAGMA busy_timeout=10000')
        connection.create_function('lower', 1, lambda value: value.casefold() if value else '', deterministic=True)
Session = sessionmaker(engine, expire_on_commit=False)

def now():
    return datetime.now(timezone.utc).isoformat()

class Base(DeclarativeBase):
    pass

class User(Base):
    __tablename__ = 'users'
    id: Mapped[int] = mapped_column(primary_key=True)
    login: Mapped[str] = mapped_column(String(50), unique=True)
    name: Mapped[str] = mapped_column(String(100))
    email: Mapped[str] = mapped_column(String(254), default='')
    password: Mapped[str] = mapped_column(Text)
    role: Mapped[str] = mapped_column(String(20))
    created: Mapped[str] = mapped_column(String(40), default=now)

class AuthSession(Base):
    __tablename__ = 'sessions'
    token: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'))
    expires: Mapped[int] = mapped_column(Integer)

class Course(Base):
    __tablename__ = 'courses'
    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey('users.id'))
    title: Mapped[str] = mapped_column(String(180))
    description: Mapped[str] = mapped_column(Text, default='')
    source: Mapped[str] = mapped_column(Text, default='')
    sources: Mapped[list] = mapped_column(JSON, default=list)
    content: Mapped[dict] = mapped_column(JSON, default=dict)
    published: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    version: Mapped[int] = mapped_column(Integer, default=0)
    __mapper_args__ = {'version_id_col': version, 'version_id_generator': False}
    created: Mapped[str] = mapped_column(String(40), default=now)

class Membership(Base):
    __tablename__ = 'memberships'
    __table_args__ = (UniqueConstraint('course_id', 'user_id'),)
    id: Mapped[int] = mapped_column(primary_key=True)
    course_id: Mapped[int] = mapped_column(ForeignKey('courses.id', ondelete='CASCADE'))
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'))
    invited_by: Mapped[int] = mapped_column(ForeignKey('users.id'))
    status: Mapped[str] = mapped_column(String(20), default='pending')

class Assignment(Base):
    __tablename__ = 'assignments'
    __table_args__ = (UniqueConstraint('course_id', 'user_id'),)
    id: Mapped[int] = mapped_column(primary_key=True)
    course_id: Mapped[int] = mapped_column(ForeignKey('courses.id', ondelete='CASCADE'))
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id'))
    snapshot: Mapped[dict] = mapped_column(JSON)
    revision: Mapped[int] = mapped_column(Integer)
    completed_lessons: Mapped[list] = mapped_column(JSON, default=list)
    attempts: Mapped[list] = mapped_column(JSON, default=list)
    assigned: Mapped[str] = mapped_column(String(40), default=now)

class Job(Base):
    __tablename__ = 'jobs'
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    course_id: Mapped[int] = mapped_column(ForeignKey('courses.id', ondelete='CASCADE'))
    status: Mapped[str] = mapped_column(String(20), default='pending')
    done: Mapped[int] = mapped_column(Integer, default=0)
    total: Mapped[int] = mapped_column(Integer, default=1)
    message: Mapped[str] = mapped_column(Text, default='Готовим материал')
    created: Mapped[str] = mapped_column(String(40), default=now)

def init_db():
    Base.metadata.create_all(engine)
    # A restarted process cannot resume its old in-process generation tasks.
    with Session.begin() as db:
        from sqlalchemy import select
        for j in db.scalars(select(Job).where(Job.status.in_(['pending', 'running', 'preparing', 'generating', 'validating', 'saving']))):
            j.status = 'error'
            j.message = 'Подготовка прервалась после перезапуска сервера. Запустите её заново.'
