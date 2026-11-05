import io
import secrets
from contextlib import asynccontextmanager
from typing import Literal, Optional

from fastapi import APIRouter, Depends, FastAPI, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from PIL import Image
from sqlalchemy import case, func, or_, select, text
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from models import (
    IMAGE_DIR, ROOT, Base, Category, Item, Location, Movement, Person, SessionLocal, Subcategory, TemplateField, engine,
)
from schemas import (
    HomeOut, ItemCreate, ItemOut, ItemPage, ItemUpdate, MovementIn, MovementOut,
    MovementPage, MovementResult, NameIn, NameOut, PersonOutstanding, SubcategoryCreate, SubcategoryOut,
    SubcategoryUpdate,
)

DEFAULT_CATEGORIES = ["Mechanical", "Electrical", "Electronics", "EE"]
DEFAULT_PEOPLE = ["Mecatron", "IES", "JPC", "Project House"]
MAX_IMAGE_BYTES = 5 * 1024 * 1024
IMAGE_EXT = {"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp"}
MAX_NAME_LENGTH = 500
NAME_LOCK = 727001  # Postgres advisory lock held by everything that generates or changes item names


@asynccontextmanager
async def lifespan(app: FastAPI):
    IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    try:
        with engine.begin() as conn:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
        Base.metadata.create_all(engine)
    except OperationalError as e:
        raise SystemExit(f"Cannot reach the database. Did you run 'docker compose up -d'?\n{e}")
    with SessionLocal() as db:
        if not db.scalar(select(func.count(Category.id))):
            db.add_all([Category(name=n) for n in DEFAULT_CATEGORIES])
        if not db.scalar(select(func.count(Person.id))):
            db.add_all([Person(name=n) for n in DEFAULT_PEOPLE])
        db.commit()
    yield


app = FastAPI(title="Lab Inventory", lifespan=lifespan)
api = APIRouter(prefix="/api/v1")


def get_db():
    with SessionLocal() as db:
        yield db


# ---------- helpers ----------

def commit(db: Session):
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Duplicate value: that name is already in use.")


def get_item(db: Session, item_id: int, lock: bool = False) -> Item:
    stmt = select(Item).where(Item.id == item_id)
    if lock:
        stmt = stmt.with_for_update()  # SELECT ... FOR UPDATE
    item = db.scalar(stmt)
    if item is None:
        raise HTTPException(404, "Item not found.")
    return item


# Borrowed minus returned, computed from the movement log.
DELTA = case((Movement.type == "BORROW", Movement.quantity), (Movement.type == "RETURN", -Movement.quantity), else_=0)


def outstanding(db: Session, item_id: int) -> list[PersonOutstanding]:
    rows = db.execute(
        select(Person.name, func.sum(DELTA))
        .select_from(Movement)
        .join(Person, Person.id == Movement.person_id)
        .where(Movement.item_id == item_id)
        .group_by(Person.id, Person.name)
        .having(func.sum(DELTA) > 0)
        .order_by(func.lower(Person.name))
    ).all()
    return [PersonOutstanding(person=name, quantity=n) for name, n in rows]


def person_outstanding(db: Session, item_id: int, person_id: int) -> int:
    stmt = select(func.coalesce(func.sum(DELTA), 0)).where(Movement.item_id == item_id, Movement.person_id == person_id)
    return max(db.scalar(stmt), 0)


def item_out(db: Session, item: Item) -> ItemOut:
    out = ItemOut.model_validate(item)
    out.outstanding = outstanding(db, item.id)
    return out


def check_refs(db: Session, category_id: Optional[int], location_id: Optional[int], owner_id: Optional[int] = None):
    if category_id is not None and db.get(Category, category_id) is None:
        raise HTTPException(422, "Unknown category.")
    if location_id is not None and db.get(Location, location_id) is None:
        raise HTTPException(422, "Unknown location.")
    if owner_id is not None and db.get(Person, owner_id) is None:
        raise HTTPException(422, "Unknown owner.")


def lock_names(db: Session):
    db.execute(select(func.pg_advisory_xact_lock(NAME_LOCK)))  # released when the transaction ends


def check_name_length(name: str):
    if len(name) > MAX_NAME_LENGTH:
        raise HTTPException(422, f"The item name would be too long (max {MAX_NAME_LENGTH} characters).")


def name_prefix(sub: Subcategory, values: dict[str, str]) -> str:
    parts = [sub.name] + [values.get(str(f.id), "") for f in sub.fields]
    return ".".join(p for p in parts if p)


# Call with lock_names held, so two saves can never pick the same number.
def next_name(db: Session, prefix: str) -> str:
    start = prefix + "."
    names = db.scalars(select(Item.name).where(Item.name.startswith(start, autoescape=True))).all()
    numbers = [int(n[len(start):]) for n in names if n[len(start):].isdecimal()]
    name = f"{start}{max(numbers, default=0) + 1}"
    check_name_length(name)
    return name


def merge_values(sub: Subcategory, new: dict[str, str], current: dict[str, str]) -> dict[str, str]:
    if set(new) - {str(f.id) for f in sub.fields}:
        raise HTTPException(422, "Unknown template field.")
    return {**current, **{k: v.strip() for k, v in new.items()}}


def check_labels(labels: list[str]):
    lowered = [label.lower() for label in labels]
    if len(set(lowered)) != len(lowered):
        raise HTTPException(409, "Two fields have the same label.")


def check_subcategory_name(db: Session, name: str, exclude_id: Optional[int] = None):
    stmt = select(Subcategory).where(func.lower(Subcategory.name) == name.lower())
    if exclude_id is not None:
        stmt = stmt.where(Subcategory.id != exclude_id)
    if db.scalar(stmt):
        raise HTTPException(409, f"Subcategory '{name}' already exists.")


def like(q: str) -> str:
    return "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def remove_file(image_path: Optional[str]):
    if image_path:
        (ROOT / image_path).unlink(missing_ok=True)


def create_named(db: Session, model, name: str, label: str):
    if db.scalar(select(model).where(func.lower(model.name) == name.lower())):
        raise HTTPException(409, f"{label} '{name}' already exists.")
    row = model(name=name)
    db.add(row)
    commit(db)
    db.refresh(row)
    return row


# ---------- health / home ----------

@api.get("/health")
def health(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    return {"status": "ok"}


@api.get("/home", response_model=HomeOut)
def home(db: Session = Depends(get_db)):
    total = db.scalar(select(func.count()).select_from(Item))
    low_count = db.scalar(select(func.count()).select_from(Item).where(Item.low_stock))
    low_items = db.scalars(select(Item).where(Item.low_stock).order_by(Item.name, Item.id).limit(100)).all()
    return HomeOut(total_items=total, low_stock_count=low_count, low_stock_items=low_items)


# ---------- categories / locations / people ----------

@api.get("/categories", response_model=list[NameOut])
def list_categories(db: Session = Depends(get_db)):
    return db.scalars(select(Category).order_by(func.lower(Category.name))).all()


@api.post("/categories", response_model=NameOut, status_code=201)
def add_category(body: NameIn, db: Session = Depends(get_db)):
    return create_named(db, Category, body.name, "Category")


@api.get("/locations", response_model=list[NameOut])
def list_locations(db: Session = Depends(get_db)):
    return db.scalars(select(Location).order_by(func.lower(Location.name))).all()


@api.post("/locations", response_model=NameOut, status_code=201)
def add_location(body: NameIn, db: Session = Depends(get_db)):
    return create_named(db, Location, body.name, "Location")


@api.get("/people", response_model=list[NameOut])
def list_people(db: Session = Depends(get_db)):
    return db.scalars(select(Person).order_by(func.lower(Person.name))).all()


@api.post("/people", response_model=NameOut, status_code=201)
def add_person(body: NameIn, db: Session = Depends(get_db)):
    return create_named(db, Person, body.name, "Person")


# ---------- subcategories ----------

@api.get("/subcategories", response_model=list[SubcategoryOut])
def list_subcategories(category_id: Optional[int] = None, db: Session = Depends(get_db)):
    where = [] if category_id is None else [Subcategory.category_id == category_id]
    return db.scalars(select(Subcategory).where(*where).order_by(func.lower(Subcategory.name))).all()


@api.post("/subcategories", response_model=SubcategoryOut, status_code=201)
def add_subcategory(body: SubcategoryCreate, db: Session = Depends(get_db)):
    check_refs(db, body.category_id, None)
    check_subcategory_name(db, body.name)
    check_labels(body.fields)
    sub = Subcategory(
        name=body.name,
        category_id=body.category_id,
        fields=[TemplateField(label=label, position=i) for i, label in enumerate(body.fields)],
    )
    db.add(sub)
    commit(db)
    db.refresh(sub)
    return sub


@api.patch("/subcategories/{subcategory_id}", response_model=SubcategoryOut)
def update_subcategory(subcategory_id: int, body: SubcategoryUpdate, db: Session = Depends(get_db)):
    lock_names(db)
    sub = db.get(Subcategory, subcategory_id)
    if sub is None:
        raise HTTPException(404, "Subcategory not found.")

    if body.name is not None and body.name != sub.name:
        check_subcategory_name(db, body.name, exclude_id=sub.id)
        # Same prefix values and number, only the subcategory part of each name changes.
        items = db.scalars(select(Item).where(Item.subcategory_id == sub.id).with_for_update()).all()
        for item in items:
            item.name = body.name + item.name[len(sub.name):]
            check_name_length(item.name)
        sub.name = body.name

    by_id = {f.id: f for f in sub.fields}
    position = max((f.position for f in sub.fields), default=-1)
    for edit in body.fields:
        if edit.id is None:
            position += 1
            sub.fields.append(TemplateField(label=edit.label, position=position))
        elif edit.id in by_id:
            by_id[edit.id].label = edit.label
        else:
            raise HTTPException(422, "Unknown template field.")
    check_labels([f.label for f in sub.fields])

    commit(db)
    db.refresh(sub)
    return sub


# ---------- items ----------

@api.get("/items", response_model=ItemPage)
def list_items(
    q: Optional[str] = None,
    manufacturer_number: Optional[str] = None,  # exact match (trimmed, case-insensitive), used by barcode scans
    category_id: Optional[int] = None,
    location_id: Optional[int] = None,
    owner_id: Optional[int] = None,
    low_stock: Optional[bool] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
):
    where = []
    order = [func.lower(Item.name), Item.id]
    q = (q or "").strip()
    if q:
        p = like(q)
        where.append(or_(Item.name.ilike(p, escape="\\"), Item.manufacturer_number.ilike(p, escape="\\")))
        # An exact Manufacturer Number match always comes first.
        order.insert(0, case((func.lower(Item.manufacturer_number) == q.lower(), 0), else_=1))
    manufacturer_number = (manufacturer_number or "").strip()
    if manufacturer_number:
        where.append(func.lower(Item.manufacturer_number) == manufacturer_number.lower())
    if category_id is not None:
        where.append(Item.category_id == category_id)
    if location_id is not None:
        where.append(Item.location_id == location_id)
    if owner_id is not None:
        where.append(Item.owner_id == owner_id)
    if low_stock is not None:
        where.append(Item.low_stock == low_stock)

    total = db.scalar(select(func.count()).select_from(Item).where(*where))
    rows = db.scalars(
        select(Item).where(*where).order_by(*order).limit(page_size).offset((page - 1) * page_size)
    ).all()
    return ItemPage(items=rows, total=total, page=page, page_size=page_size)


@api.post("/items", response_model=ItemOut, status_code=201)
def create_item(body: ItemCreate, db: Session = Depends(get_db)):
    check_refs(db, body.category_id, body.location_id, body.owner_id)
    lock_names(db)
    sub = db.get(Subcategory, body.subcategory_id)
    if sub is None:
        raise HTTPException(422, "Unknown subcategory.")
    if sub.category_id != body.category_id:
        raise HTTPException(422, "That subcategory belongs to a different category.")
    values = merge_values(sub, body.field_values, {})
    missing = [f.label for f in sub.fields if not values.get(str(f.id))]
    if missing:
        raise HTTPException(422, "Please fill in: " + ", ".join(missing) + ".")
    data = body.model_dump(exclude={"field_values"})
    item = Item(**data, field_values=values, name=next_name(db, name_prefix(sub, values)))
    db.add(item)
    commit(db)
    db.refresh(item)
    return item_out(db, item)


@api.get("/items/{item_id}", response_model=ItemOut)
def read_item(item_id: int, db: Session = Depends(get_db)):
    return item_out(db, get_item(db, item_id))


@api.patch("/items/{item_id}", response_model=ItemOut)
def update_item(item_id: int, body: ItemUpdate, db: Session = Depends(get_db)):
    data = body.model_dump(exclude_unset=True)
    new_values = data.pop("field_values", None)
    if new_values is not None:
        lock_names(db)  # before the item lock, the same order as renaming a subcategory
    item = get_item(db, item_id, lock=True)
    check_refs(db, None, data.get("location_id"))
    for key, value in data.items():
        setattr(item, key, value)
    if new_values is not None:
        item.field_values = merge_values(item.subcategory, new_values, item.field_values)
        prefix = name_prefix(item.subcategory, item.field_values)
        if prefix != item.name.rsplit(".", 1)[0]:
            item.name = next_name(db, prefix)
    commit(db)
    db.refresh(item)
    return item_out(db, item)


@api.post("/items/{item_id}/low-stock", response_model=ItemOut)
def toggle_low_stock(item_id: int, db: Session = Depends(get_db)):
    item = get_item(db, item_id, lock=True)
    item.low_stock = not item.low_stock
    commit(db)
    db.refresh(item)
    return item_out(db, item)


@api.post("/items/{item_id}/movements", response_model=MovementResult)
def add_movement(item_id: int, body: MovementIn, db: Session = Depends(get_db)):
    item = get_item(db, item_id, lock=True)  # row stays locked until commit
    warning = None
    person = db.get(Person, body.person_id) if body.person_id is not None else None
    if body.type != "ADJUST" and person is None:
        raise HTTPException(422, "Unknown person.")
    if body.type == "BORROW":
        if body.quantity > item.quantity:
            raise HTTPException(409, f"Cannot borrow {body.quantity}: only {item.quantity} available.")
        item.quantity -= body.quantity
        delta = body.quantity
    elif body.type == "RETURN":
        out = person_outstanding(db, item.id, person.id)
        if body.quantity > out:
            warning = f"{person.name} returned {body.quantity}, but only {out} recorded as borrowed by them. The quantity was increased anyway."
        item.quantity += body.quantity
        delta = body.quantity
    else:  # ADJUST: body.quantity is the new actual count
        delta = body.quantity - item.quantity
        if delta == 0:
            return MovementResult(item=item_out(db, item))  # nothing changed, nothing to log
        item.quantity = body.quantity
    db.add(Movement(item_id=item.id, person_id=person.id if body.type != "ADJUST" else None, type=body.type, quantity=delta))
    commit(db)
    db.refresh(item)
    return MovementResult(item=item_out(db, item), warning=warning)


# ---------- images ----------

@api.post("/items/{item_id}/image", response_model=ItemOut)
def upload_image(item_id: int, file: UploadFile = File(...), db: Session = Depends(get_db)):
    item = get_item(db, item_id)
    data = file.file.read(MAX_IMAGE_BYTES + 1)
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(422, "Image is larger than 5 MB.")
    try:
        img = Image.open(io.BytesIO(data))
        fmt = img.format
        img.verify()
    except Exception:
        raise HTTPException(422, "That file is not a valid image.")
    if fmt not in IMAGE_EXT:
        raise HTTPException(422, "Only JPEG, PNG or WebP images are allowed.")

    name = secrets.token_hex(16) + IMAGE_EXT[fmt]
    (IMAGE_DIR / name).write_bytes(data)
    old_image = item.image_path
    item.image_path = f"data/images/{name}"
    try:
        commit(db)
    except Exception:
        (IMAGE_DIR / name).unlink(missing_ok=True)
        raise
    remove_file(old_image)
    db.refresh(item)
    return item_out(db, item)


@api.delete("/items/{item_id}/image", response_model=ItemOut)
def delete_image(item_id: int, db: Session = Depends(get_db)):
    item = get_item(db, item_id)
    old_image = item.image_path
    item.image_path = None
    commit(db)
    remove_file(old_image)
    db.refresh(item)
    return item_out(db, item)


@api.get("/images/{filename}")
def get_image(filename: str):
    path = (IMAGE_DIR / filename).resolve()
    if path.parent != IMAGE_DIR.resolve() or not path.is_file():
        raise HTTPException(404, "Image not found.")
    return FileResponse(path, headers={"Cache-Control": "public, max-age=31536000, immutable"})


# ---------- movements log ----------

@api.get("/movements", response_model=MovementPage)
def list_movements(
    q: Optional[str] = None,
    type: Optional[Literal["BORROW", "RETURN", "ADJUST"]] = None,
    person_id: Optional[int] = None,
    not_returned: bool = False,  # items where any person still has units out
    item_id: Optional[int] = None,  # used by the item page to show just one item's history
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
):
    # per-item outstanding units: each person's borrowed minus returned, adding up those still out
    per_person = (
        select(Movement.item_id.label("item_id"), func.sum(DELTA).label("units"))
        .where(Movement.person_id.is_not(None))
        .group_by(Movement.item_id, Movement.person_id)
        .having(func.sum(DELTA) > 0)
        .subquery()
    )
    out_sq = (
        select(per_person.c.item_id, func.sum(per_person.c.units).label("outstanding"))
        .group_by(per_person.c.item_id)
        .subquery()
    )
    join = out_sq.c.item_id == Movement.item_id

    where = []
    q = (q or "").strip()
    if q:
        p = like(q)
        where.append(or_(Item.name.ilike(p, escape="\\"), Item.manufacturer_number.ilike(p, escape="\\")))
    if type:
        where.append(Movement.type == type)
    if item_id is not None:
        where.append(Movement.item_id == item_id)
    if person_id is not None:
        where.append(Movement.person_id == person_id)
    if not_returned:
        where.append(out_sq.c.outstanding > 0)

    total = db.scalar(select(func.count()).select_from(Movement).join(Item, Item.id == Movement.item_id).outerjoin(out_sq, join).where(*where))
    rows = db.execute(
        select(Movement, Item.name, Item.manufacturer_number, Person.name, func.coalesce(out_sq.c.outstanding, 0))
        .select_from(Movement)
        .join(Item, Item.id == Movement.item_id)
        .outerjoin(Person, Person.id == Movement.person_id)
        .outerjoin(out_sq, join)
        .where(*where)
        .order_by(Movement.created_at.desc(), Movement.id.desc())
        .limit(page_size)
        .offset((page - 1) * page_size)
    ).all()

    items = [
        MovementOut(
            id=m.id, item_id=m.item_id, item_name=name, item_manufacturer_number=number, person=person,
            type=m.type, quantity=m.quantity, created_at=m.created_at, outstanding=int(out),
        )
        for m, name, number, person, out in rows
    ]
    return MovementPage(items=items, total=total, page=page, page_size=page_size)


app.include_router(api)
