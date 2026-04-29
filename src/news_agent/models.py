from datetime import datetime
from enum import Enum as PyEnum

from sqlalchemy import (
    JSON,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class ActionType(PyEnum):
    like = "like"
    favorite = "favorite"
    not_interested = "not_interested"
    viewed = "viewed"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    actions: Mapped[list["ArticleAction"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    preferences: Mapped["UserPreference"] = relationship(
        back_populates="user", uselist=False, cascade="all, delete-orphan"
    )


class Article(Base):
    __tablename__ = "articles"

    id: Mapped[int] = mapped_column(primary_key=True)
    url: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    title_zh: Mapped[str] = mapped_column(Text, default="")
    title_en: Mapped[str] = mapped_column(Text, default="")
    summary_zh: Mapped[str] = mapped_column(Text, default="")
    summary_en: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    actions: Mapped[list["ArticleAction"]] = relationship(
        back_populates="article", cascade="all, delete-orphan"
    )

    __table_args__ = (Index("ix_articles_url", "url"),)


class ArticleAction(Base):
    __tablename__ = "article_actions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    article_id: Mapped[int] = mapped_column(ForeignKey("articles.id", ondelete="CASCADE"), nullable=False)
    action: Mapped[ActionType] = mapped_column(Enum(ActionType), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    user: Mapped["User"] = relationship(back_populates="actions")
    article: Mapped["Article"] = relationship(back_populates="actions")

    __table_args__ = (
        UniqueConstraint("user_id", "article_id", "action", name="uq_user_article_action"),
        Index("ix_article_actions_user_action", "user_id", "action"),
    )


class UserPreference(Base):
    __tablename__ = "user_preferences"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)
    news_source_preferences: Mapped[dict] = mapped_column(JSON, default=list)
    content_preferences: Mapped[dict] = mapped_column(JSON, default=list)

    user: Mapped["User"] = relationship(back_populates="preferences")
