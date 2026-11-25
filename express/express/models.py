from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlmodel import Field, SQLModel


class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    full_name: str
    phone: str = Field(index=True, unique=True)
    password_hash: str
    role: str = Field(default="student", index=True)
    gender: Optional[str] = None
    is_active: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Business(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    category: str = "restaurant"
    phone: Optional[str] = None
    is_active: bool = True


class Product(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    business_id: int = Field(foreign_key="business.id", index=True)
    name: str
    category: str = "Meals"
    description: str = ""
    price: Decimal = Field(decimal_places=2, max_digits=12)
    is_available: bool = True


class Order(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    order_code: str = Field(index=True, unique=True)
    student_id: int = Field(foreign_key="user.id", index=True)
    business_id: int = Field(foreign_key="business.id")
    delivery_type: str
    hostel: str
    room: Optional[str] = None
    delivery_gender_preference: Optional[str] = None
    delivery_fee: Decimal = Field(decimal_places=2, max_digits=10)
    items_total: Decimal = Field(decimal_places=2, max_digits=12)
    grand_total: Decimal = Field(decimal_places=2, max_digits=12)
    status: str = Field(default="pending", index=True)
    payment_status: str = Field(default="unverified")
    created_at: datetime = Field(default_factory=datetime.utcnow)


class OrderItem(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    order_id: int = Field(foreign_key="order.id", index=True)
    product_id: int = Field(foreign_key="product.id")
    product_name: str
    quantity: int
    unit_price: Decimal = Field(decimal_places=2, max_digits=12)
    line_total: Decimal = Field(decimal_places=2, max_digits=12)


class AgentProfile(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", unique=True)
    gender: str
    is_available: bool = False
    account_name: Optional[str] = None
    account_number: Optional[str] = None
    bank_name: Optional[str] = None
