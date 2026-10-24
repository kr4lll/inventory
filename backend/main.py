import io
import secrets
from contextlib import asynccontextmanager
from typing import Literal, Optional

from fastapi import APIRouter, Depends, FastAPI, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from PIL import Image
from sqlalchemy import case, func, or_, select, text, update
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from models import IMAGE_DIR, ROOT, Base, Category, Item, Location, Movement, SessionLocal, engine
from schemas import (
    HomeOut, ItemCreate, ItemOut, ItemPage, ItemUpdate, MovementIn, MovementOut,
    MovementPage, MovementResult, NameIn, NameOut,
)

DEFAULT_CATEGORIES = ["Mechanical", "Electrical", "Electronics", "EE"]
MAX_IMAGE_BYTES = 5 * 1024 * 1024
IMAGE_EXT = {"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp"}


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
        raise HTTPException(409, "Duplicate value: that SKU or name is already in use.")


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


def outstanding(db: Session, item_id: int) -> int:
    return max(db.scalar(select(func.coalesce(func.sum(DELTA), 0)).where(Movement.item_id == item_id)), 0)


def item_out(db: Session, item: Item) -> ItemOut:
    out = ItemOut.model_validate(item)
    out.outstanding = outstanding(db, item.id)
    return out


def check_sku(db: Session, sku: Optional[str], exclude_id: Optional[int] = None):
    if sku is None:
        return
    stmt = select(Item).where(Item.sku == sku)
    if exclude_id is not None:
        stmt = stmt.where(Item.id != exclude_id)
    other = db.scalar(stmt)
    if other:
        raise HTTPException(409, f"SKU '{sku}' is already used by item '{other.name}' (#{other.id}).")


def check_refs(db: Session, category_id: Optional[int], location_id: Optional[int]):
    if category_id is not None and db.get(Category, category_id) is None:
        raise HTTPException(422, "Unknown category.")
    if location_id is not None and db.get(Location, location_id) is None:
        raise HTTPException(422, "Unknown location.")


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


# ---------- categories / locations ----------

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


# ---------- items ----------

@api.get("/items", response_model=ItemPage)
def list_items(
    q: Optional[str] = None,
    category_id: Optional[int] = None,
    location_id: Optional[int] = None,
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
        where.append(or_(Item.name.ilike(p, escape="\\"), Item.sku.ilike(p, escape="\\")))
        # An exact SKU match (a barcode scan) always comes first.
        order.insert(0, case((func.lower(Item.sku) == q.lower(), 0), else_=1))
    if category_id is not None:
        where.append(Item.category_id == category_id)
    if location_id is not None:
        where.append(Item.location_id == location_id)
    if low_stock is not None:
        where.append(Item.low_stock == low_stock)

    total = db.scalar(select(func.count()).select_from(Item).where(*where))
    rows = db.scalars(
        select(Item).where(*where).order_by(*order).limit(page_size).offset((page - 1) * page_size)
    ).all()
    return ItemPage(items=rows, total=total, page=page, page_size=page_size)


@api.post("/items", response_model=ItemOut, status_code=201)
def create_item(body: ItemCreate, db: Session = Depends(get_db)):
    check_sku(db, body.sku)
    check_refs(db, body.category_id, body.location_id)
    item = Item(**body.model_dump())
    db.add(item)
    commit(db)
    db.refresh(item)
    return item_out(db, item)


@api.get("/items/{item_id}", response_model=ItemOut)
def read_item(item_id: int, db: Session = Depends(get_db)):
    return item_out(db, get_item(db, item_id))


@api.patch("/items/{item_id}", response_model=ItemOut)
def update_item(item_id: int, body: ItemUpdate, db: Session = Depends(get_db)):
    item = get_item(db, item_id, lock=True)
    data = body.model_dump(exclude_unset=True)
    if "sku" in data:
        check_sku(db, data["sku"], exclude_id=item.id)
    check_refs(db, data.get("category_id"), data.get("location_id"))
    for key, value in data.items():
        setattr(item, key, value)
    if "name" in data or "sku" in data:
        # keep the movement log in sync while the item still exists
        db.execute(update(Movement).where(Movement.item_id == item.id).values(item_name=item.name, item_sku=item.sku))
    commit(db)
    db.refresh(item)
    return item_out(db, item)


@api.delete("/items/{item_id}", status_code=204)
def delete_item(item_id: int, db: Session = Depends(get_db)):
    item = get_item(db, item_id, lock=True)
    old_image = item.image_path
    db.delete(item)  # movements keep their name/SKU snapshot; the DB sets their item_id to NULL
    db.commit()
    remove_file(old_image)


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
    if body.type == "BORROW":
        if body.quantity > item.quantity:
            raise HTTPException(409, f"Cannot borrow {body.quantity}: only {item.quantity} available.")
        item.quantity -= body.quantity
        delta = body.quantity
    elif body.type == "RETURN":
        out = outstanding(db, item.id)
        if body.quantity > out:
            warning = f"You returned {body.quantity}, but only {out} were recorded as borrowed. The quantity was increased anyway."
        item.quantity += body.quantity
        delta = body.quantity
    else:  # ADJUST: body.quantity is the new actual count
        delta = body.quantity - item.quantity
        if delta == 0:
            return MovementResult(item=item_out(db, item))  # nothing changed, nothing to log
        item.quantity = body.quantity
    db.add(Movement(item_id=item.id, item_name=item.name, item_sku=item.sku, type=body.type, quantity=delta))
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
    not_returned: bool = False,
    item_id: Optional[int] = None,  # used by the item page to show just one item's history
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
):
    # per-item outstanding units: total borrowed minus total returned
    out_sq = (
        select(Movement.item_id.label("item_id"), func.sum(DELTA).label("outstanding"))
        .where(Movement.item_id.is_not(None))
        .group_by(Movement.item_id)
        .subquery()
    )
    join = out_sq.c.item_id == Movement.item_id

    where = []
    q = (q or "").strip()
    if q:
        p = like(q)
        where.append(or_(Movement.item_name.ilike(p, escape="\\"), Movement.item_sku.ilike(p, escape="\\")))
    if type:
        where.append(Movement.type == type)
    if item_id is not None:
        where.append(Movement.item_id == item_id)
    if not_returned:
        where.append(out_sq.c.outstanding > 0)

    total = db.scalar(select(func.count()).select_from(Movement).outerjoin(out_sq, join).where(*where))
    rows = db.execute(
        select(Movement, func.coalesce(out_sq.c.outstanding, 0))
        .outerjoin(out_sq, join)
        .where(*where)
        .order_by(Movement.created_at.desc(), Movement.id.desc())
        .limit(page_size)
        .offset((page - 1) * page_size)
    ).all()

    items = []
    for movement, out in rows:
        m = MovementOut.model_validate(movement)
        m.outstanding = max(int(out), 0)
        items.append(m)
    return MovementPage(items=items, total=total, page=page, page_size=page_size)


app.include_router(api)
