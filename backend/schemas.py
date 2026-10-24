from datetime import datetime
from typing import Annotated, Literal, Optional

from pydantic import BaseModel, ConfigDict, StringConstraints, computed_field, field_validator, model_validator

ItemName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
ShortName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class NameIn(BaseModel):
    name: ShortName


class NameOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str


class SkuMixin(BaseModel):
    sku: Optional[str] = None

    @field_validator("sku", mode="before")
    @classmethod
    def clean_sku(cls, v):
        if isinstance(v, str):
            v = v.strip() or None  # empty input is stored as NULL
        if v is not None and len(v) > 100:
            raise ValueError("SKU is too long (max 100 characters).")
        return v


class ItemCreate(SkuMixin):
    name: ItemName
    category_id: Optional[int] = None
    location_id: Optional[int] = None
    description: str = ""
    quantity: int = 1
    low_stock: bool = False
    note: str = ""
    how_to_buy: str = ""

    @field_validator("quantity")
    @classmethod
    def check_quantity(cls, v):
        if not 0 <= v <= 1_000_000:
            raise ValueError("Quantity must be between 0 and 1,000,000.")
        return v


class ItemUpdate(SkuMixin):
    """PATCH body: only the fields sent are changed. Quantity is changed via movements, not here."""
    model_config = ConfigDict(extra="forbid")
    name: Optional[ItemName] = None
    category_id: Optional[int] = None
    location_id: Optional[int] = None
    description: Optional[str] = None
    low_stock: Optional[bool] = None
    note: Optional[str] = None
    how_to_buy: Optional[str] = None

    @model_validator(mode="after")
    def no_nulls(self):
        for f in ("name", "description", "low_stock", "note", "how_to_buy"):
            if f in self.model_fields_set and getattr(self, f) is None:
                raise ValueError(f"{f} cannot be null")
        return self


class ItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    sku: Optional[str]
    category_id: Optional[int]
    location_id: Optional[int]
    category: Optional[NameOut]
    location: Optional[NameOut]
    description: str
    quantity: int
    low_stock: bool
    note: str
    how_to_buy: str
    image_path: Optional[str]
    created_at: datetime
    updated_at: datetime
    outstanding: Optional[int] = None  # borrowed minus returned; only filled on the single-item endpoints

    @computed_field
    @property
    def image_url(self) -> Optional[str]:
        if not self.image_path:
            return None
        return "/api/v1/images/" + self.image_path.rsplit("/", 1)[-1]


class ItemPage(BaseModel):
    items: list[ItemOut]
    total: int
    page: int
    page_size: int


class MovementIn(BaseModel):
    type: Literal["BORROW", "RETURN", "ADJUST"]
    quantity: int  # BORROW/RETURN: how many. ADJUST: the new actual quantity.

    @model_validator(mode="after")
    def check(self):
        if self.quantity > 1_000_000:
            raise ValueError("Quantity is too large.")
        if self.type == "ADJUST" and self.quantity < 0:
            raise ValueError("New quantity cannot be negative.")
        if self.type != "ADJUST" and self.quantity < 1:
            raise ValueError("Quantity must be at least 1.")
        return self


class MovementResult(BaseModel):
    item: ItemOut
    warning: Optional[str] = None


class MovementOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    item_id: Optional[int]
    item_name: str
    item_sku: Optional[str]
    type: str
    quantity: int
    created_at: datetime
    outstanding: Optional[int] = None  # units of this item still borrowed (0 if item deleted)


class MovementPage(BaseModel):
    items: list[MovementOut]
    total: int
    page: int
    page_size: int


class HomeOut(BaseModel):
    total_items: int
    low_stock_count: int
    low_stock_items: list[ItemOut]
