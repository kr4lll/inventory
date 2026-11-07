from datetime import datetime
from typing import Annotated, Literal, Optional

from pydantic import BaseModel, ConfigDict, StringConstraints, computed_field, field_validator, model_validator

ShortName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class NameIn(BaseModel):
    name: ShortName


class NameOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str


class ManufacturerNumberMixin(BaseModel):
    manufacturer_number: Optional[str] = None

    @field_validator("manufacturer_number", mode="before")
    @classmethod
    def clean_manufacturer_number(cls, v):
        if isinstance(v, str):
            v = v.strip() or None  # empty input is stored as NULL
        if v is not None and len(v) > 100:
            raise ValueError("Manufacturer Number is too long (max 100 characters).")
        return v


class TemplateFieldOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    label: str
    position: int


class SubcategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    category_id: int
    fields: list[TemplateFieldOut]


class SubcategoryCreate(BaseModel):
    name: ShortName
    category_id: int
    fields: list[ShortName] = []


class FieldEdit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: Optional[int] = None  # set: rename this field; not set: add a new field at the end
    label: ShortName


class SubcategoryUpdate(BaseModel):
    """PATCH body: rename the subcategory, rename fields, add fields. Nothing else can change."""
    model_config = ConfigDict(extra="forbid")
    name: Optional[ShortName] = None
    fields: list[FieldEdit] = []


class ItemCreate(ManufacturerNumberMixin):
    category_id: int
    subcategory_id: int
    field_values: dict[str, str] = {}
    location_id: int
    owner_id: int
    quantity: int = 1
    note: str = ""
    how_to_buy: str = ""

    @field_validator("quantity")
    @classmethod
    def check_quantity(cls, v):
        if not 0 <= v <= 1_000_000:
            raise ValueError("Quantity must be between 0 and 1,000,000.")
        return v


class ItemUpdate(ManufacturerNumberMixin):
    """PATCH body: only the fields sent are changed. Quantity is changed via movements, not here."""
    model_config = ConfigDict(extra="forbid")
    field_values: Optional[dict[str, str]] = None
    location_id: Optional[int] = None
    low_stock: Optional[bool] = None
    note: Optional[str] = None
    how_to_buy: Optional[str] = None

    @model_validator(mode="after")
    def no_nulls(self):
        for f in ("field_values", "location_id", "low_stock", "note", "how_to_buy"):
            if f in self.model_fields_set and getattr(self, f) is None:
                raise ValueError(f"{f} cannot be null")
        return self


class PersonOutstanding(BaseModel):
    person: str
    quantity: int


class ItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    manufacturer_number: Optional[str]
    category_id: int
    subcategory_id: int
    field_values: dict[str, str]
    location_id: Optional[int]
    owner_id: int
    category: NameOut
    subcategory: SubcategoryOut
    location: Optional[NameOut]
    owner: NameOut
    quantity: int
    low_stock: bool
    note: str
    how_to_buy: str
    image_path: Optional[str]
    created_at: datetime
    updated_at: datetime
    outstanding: Optional[list[PersonOutstanding]] = None  # per person; only filled on the single-item endpoints

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
    person_id: Optional[int] = None  # required for BORROW/RETURN

    @model_validator(mode="after")
    def check(self):
        if self.quantity > 1_000_000:
            raise ValueError("Quantity is too large.")
        if self.type == "ADJUST" and self.quantity < 0:
            raise ValueError("New quantity cannot be negative.")
        if self.type != "ADJUST" and self.quantity < 1:
            raise ValueError("Quantity must be at least 1.")
        if self.type != "ADJUST" and self.person_id is None:
            raise ValueError("Please choose a person.")
        return self


class MovementResult(BaseModel):
    item: ItemOut
    warning: Optional[str] = None


class MovementOut(BaseModel):
    id: int
    item_id: int
    item_name: str  # the item's current name and number, joined in
    item_manufacturer_number: Optional[str]
    person: Optional[str]  # NULL only for ADJUST
    type: str
    quantity: int
    created_at: datetime
    outstanding: int  # units of this item still borrowed


class OutstandingMovementOut(BaseModel):
    item_id: int
    item_name: str
    item_manufacturer_number: Optional[str]
    person: str
    outstanding: int


class MovementPage(BaseModel):
    items: list[MovementOut | OutstandingMovementOut]
    total: int
    page: int
    page_size: int


class HomeOut(BaseModel):
    total_items: int
    low_stock_count: int
    low_stock_items: list[ItemOut]
