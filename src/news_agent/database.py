import os
import secrets
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

import bcrypt
from jose import JWTError, jwt
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker

from news_agent.models import ActionType, Article, ArticleAction, Base, User, UserPreference

ROOT_DIR = Path(__file__).resolve().parents[1]
DB_PATH = ROOT_DIR / "data" / "newsagent.db"
JWT_SECRET = os.getenv("JWT_SECRET", secrets.token_urlsafe(32))
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_HOURS = int(os.getenv("JWT_EXPIRE_HOURS", "168"))
engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(bind=engine)


def get_session() -> Session:
    return SessionLocal()


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def create_token(user_id: int, username: str) -> str:
    expire = datetime.utcnow() + timedelta(hours=JWT_EXPIRE_HOURS)
    payload = {"sub": str(user_id), "username": username, "exp": expire}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except JWTError:
        return None


def get_current_user(token: str) -> Optional[User]:
    payload = decode_token(token)
    if payload is None:
        return None
    with get_session() as db:
        user = db.get(User, int(payload["sub"]))
        if user is None:
            return None
        return user


def get_user_by_username(username: str) -> Optional[User]:
    with get_session() as db:
        stmt = select(User).where(User.username == username)
        return db.scalars(stmt).first()


def create_user(username: str, password: str) -> tuple[int, str]:
    with get_session() as db:
        user = User(username=username, password_hash=hash_password(password))
        db.add(user)
        db.flush()
        pref = UserPreference(
            user_id=user.id,
            news_source_preferences=[],
            content_preferences=[],
        )
        db.add(pref)
        db.commit()
        return user.id, user.username


def get_or_create_article(db: Session, url: str, title_zh: str = "", title_en: str = "",
                          summary_zh: str = "", summary_en: str = "") -> Article:
    article = db.scalars(select(Article).where(Article.url == url)).first()
    if article is None:
        article = Article(
            url=url, title_zh=title_zh, title_en=title_en,
            summary_zh=summary_zh, summary_en=summary_en,
        )
        db.add(article)
        db.commit()
        db.refresh(article)
    else:
        if title_zh and not article.title_zh:
            article.title_zh = title_zh
        if summary_zh and not article.summary_zh:
            article.summary_zh = summary_zh
        db.commit()
    return article


def set_article_action(db: Session, user_id: int, url: str, action: ActionType,
                       title_zh: str = "", title_en: str = "",
                       summary_zh: str = "", summary_en: str = "") -> ArticleAction:
    article = get_or_create_article(db, url, title_zh, title_en, summary_zh, summary_en)
    existing = db.scalars(
        select(ArticleAction)
        .where(ArticleAction.user_id == user_id)
        .where(ArticleAction.article_id == article.id)
        .where(ArticleAction.action == action)
    ).first()

    if existing:
        db.delete(existing)
        db.commit()
        return existing

    record = ArticleAction(user_id=user_id, article_id=article.id, action=action)
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def get_user_actions(db: Session, user_id: int, action: ActionType, limit: int = 50, offset: int = 0) -> list[ArticleAction]:
    stmt = (
        select(ArticleAction)
        .where(ArticleAction.user_id == user_id)
        .where(ArticleAction.action == action)
        .order_by(ArticleAction.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    return list(db.scalars(stmt).all())


def count_user_actions(db: Session, user_id: int, action: ActionType) -> int:
    stmt = (
        select(func.count())
        .where(ArticleAction.user_id == user_id)
        .where(ArticleAction.action == action)
    )
    return db.scalar(stmt) or 0


def get_user_article_actions(db: Session, user_id: int, url: str) -> dict[str, bool]:
    """Return a dict of action -> True for all actions the user has performed on the given article URL."""
    stmt = (
        select(ArticleAction.action)
        .join(Article, ArticleAction.article_id == Article.id)
        .where(ArticleAction.user_id == user_id)
        .where(Article.url == url)
    )
    rows = db.scalars(stmt).all()
    return {row.value: True for row in rows}
