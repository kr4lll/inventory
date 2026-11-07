import os
from datetime import datetime
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from sqlalchemy import (
    Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint,
    create_engine, func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.engine import URL
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker

ROOT = Path(__file__).resolve().parent.parent  # project root (where .env and data/ live)
IMAGE_DIR = ROOT / "data" / "images"

load_dotenv(ROOT / ".env")
if not os.getenv("POSTGRES_PASSWORD"):
    raise SystemExit("POSTGRES_PASSWORD is not set. Copy .env.example to .env in the project root first.")

engine = create_engine(
    URL.create(
        "postgresql+psycopg",
        username=os.getenv("POSTGRES_USER", "inventory"),
        password=os.environ["POSTGRES_PASSWORD"],
        host="127.0.0.1",
        port=int(os.getenv("POSTGRES_PORT", "5432")),
        database=os.getenv("POSTGRES_DB", "inventory"),
    ),
    pool_pre_ping=True,
)
SessionLocal = sessionmaker(engine)


class Base(DeclarativeBase):
    pass


class Category(Base):
    __tablename__ = "categories"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)


class Location(Base):
    __tablename__ = "locations"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)


class Person(Base):
    __tablename__ = "people"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)


class TemplateField(Base):
    __tablename__ = "template_fields"
    id: Mapped[int] = mapped_column(primary_key=True)
    subcategory_id: Mapped[int] = mapped_column(ForeignKey("subcategories.id"), index=True)
    label: Mapped[str] = mapped_column(String(100))
    position: Mapped[int] = mapped_column(Integer)  # order of creation

    # Deferred so two labels can swap names in one save.
    __table_args__ = (
        UniqueConstraint("subcategory_id", "label", name="uq_template_fields_label", deferrable=True, initially="DEFERRED"),
    )


class Subcategory(Base):
    __tablename__ = "subcategories"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id"), index=True)

    fields: Mapped[list[TemplateField]] = relationship(lazy="selectin", order_by=TemplateField.position)


class Item(Base):
    __tablename__ = "items"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(500), unique=True)  # generated: prefix + "." + number
    manufacturer_number: Mapped[Optional[str]] = mapped_column(String(100), index=True)  # optional, not unique
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id"))
    subcategory_id: Mapped[int] = mapped_column(ForeignKey("subcategories.id"), index=True)
    field_values: Mapped[dict] = mapped_column(JSONB, default=dict)  # {field_id: string}; a missing key means empty
    location_id: Mapped[Optional[int]] = mapped_column(ForeignKey("locations.id"))
    owner_id: Mapped[int] = mapped_column(ForeignKey("people.id"), index=True)
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    low_stock: Mapped[bool] = mapped_column(Boolean, default=False)
    note: Mapped[str] = mapped_column(Text, default="")
    how_to_buy: Mapped[str] = mapped_column(Text, default="")
    image_path: Mapped[Optional[str]] = mapped_column(Text)  # relative to project root, e.g. data/images/ab12.jpg
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    category: Mapped[Category] = relationship(lazy="selectin")
    subcategory: Mapped[Subcategory] = relationship(lazy="selectin")
    location: Mapped[Optional[Location]] = relationship(lazy="selectin")
    owner: Mapped[Person] = relationship(lazy="selectin")

    __table_args__ = (
        CheckConstraint("quantity >= 0", name="ck_items_quantity_nonneg"),
        Index("ix_items_name_trgm", "name", postgresql_using="gin", postgresql_ops={"name": "gin_trgm_ops"}),
    )


class Movement(Base):
    __tablename__ = "movements"
    id: Mapped[int] = mapped_column(primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id", ondelete="RESTRICT"), index=True)
    person_id: Mapped[Optional[int]] = mapped_column(ForeignKey("people.id"), index=True)  # NULL only for ADJUST
    type: Mapped[str] = mapped_column(String(10))  # BORROW / RETURN / ADJUST
    quantity: Mapped[int] = mapped_column(Integer)  # BORROW/RETURN: the number; ADJUST: signed difference
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        CheckConstraint("type IN ('BORROW','RETURN','ADJUST')", name="ck_movements_type"),
        CheckConstraint("type = 'ADJUST' OR person_id IS NOT NULL", name="ck_movements_person"),
    )
