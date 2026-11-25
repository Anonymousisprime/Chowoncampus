import secrets
from decimal import Decimal

import reflex as rx
from sqlmodel import select

from .database import get_session
from .models import Business, Order, OrderItem, Product, User
from .security import hash_password, verify_password


class AppState(rx.State):
    _user_id: int | None = None

    full_name: str = ""
    phone: str = ""
    password: str = ""
    hostel: str = ""
    room: str = ""
    gender: str = ""
    delivery_type: str = "gate"
    selected_business: str = ""
    selected_product: str = ""
    quantity: str = "1"
    status_message: str = ""
    signed_in_name: str = ""
    business_options: list[str] = []
    product_options: list[str] = []
    catalogue: list[dict] = []
    cart: list[dict] = []

    @rx.var
    def is_signed_in(self) -> bool:
        return self._user_id is not None

    @rx.var
    def delivery_fee(self) -> int:
        return 400 if self.delivery_type == "room" else 300

    @rx.var
    def cart_total(self) -> int:
        return sum(int(item["line_total"]) for item in self.cart)

    @rx.var
    def grand_total(self) -> int:
        return self.cart_total + self.delivery_fee

    def set_business(self, value: str):
        self.selected_business = value
        self.selected_product = ""
        self.product_options = [
            self.product_label(p) for p in self.catalogue
            if p["business_name"] == value
        ]

    def set_product(self, value: str):
        self.selected_product = value

    def product_label(self, product: dict) -> str:
        return f'{product["name"]} — ₦{product["price"]}'

    def register(self):
        name = self.full_name.strip()
        phone = self.phone.strip()
        if not name or not phone or len(self.password) < 8:
            self.status_message = "Enter your name, phone number and a password of at least 8 characters."
            return
        try:
            with get_session() as session:
                existing = session.exec(select(User).where(User.phone == phone)).first()
                if existing:
                    self.status_message = "An account already exists for this phone number. Please sign in."
                    return
                user = User(full_name=name, phone=phone, password_hash=hash_password(self.password), role="student")
                session.add(user)
                session.commit()
                session.refresh(user)
                self._user_id = user.id
                self.signed_in_name = user.full_name
            self.password = ""
            self.status_message = "Account created. You can now browse the menu."
            self.load_catalogue()
        except Exception:
            self.status_message = "We couldn't create your account. Please try again or contact support."

    def sign_in(self):
        try:
            with get_session() as session:
                user = session.exec(
                    select(User).where(User.phone == self.phone.strip(), User.role == "student")
                ).first()
                if not user or not user.is_active or not verify_password(self.password, user.password_hash):
                    self.status_message = "The phone number or password is incorrect."
                    return
                self._user_id = user.id
                self.signed_in_name = user.full_name
            self.password = ""
            self.status_message = "You're signed in."
            self.load_catalogue()
        except Exception:
            self.status_message = "Sign-in is temporarily unavailable. Please try again."

    def sign_out(self):
        self._user_id = None
        self.signed_in_name = ""
        self.cart = []
        self.status_message = "You have signed out."

    def load_catalogue(self):
        try:
            with get_session() as session:
                businesses = session.exec(
                    select(Business).where(Business.is_active == True).order_by(Business.name)  # noqa: E712
                ).all()
                rows = session.exec(
                    select(Product, Business)
                    .join(Business, Product.business_id == Business.id)
                    .where(Product.is_available == True, Business.is_active == True)  # noqa: E712
                    .order_by(Business.name, Product.name)
                ).all()
                self.catalogue = [
                    {
                        "id": p.id,
                        "name": p.name,
                        "business_id": p.business_id,
                        "business_name": b.name,
                        "category": p.category,
                        "description": p.description,
                        "price": int(p.price),
                    }
                    for p, b in rows
                ]
                self.business_options = sorted({p["business_name"] for p in self.catalogue})
                if self.selected_business not in self.business_options:
                    self.selected_business = self.business_options[0] if self.business_options else ""
                self.product_options = [
                    self.product_label(p) for p in self.catalogue
                    if p["business_name"] == self.selected_business
                ]
        except Exception:
            self.status_message = "The menu is temporarily unavailable. Please try again later."

    def add_to_cart(self):
        if not self.selected_product:
            self.status_message = "Choose an available item first."
            return
        try:
            qty = int(self.quantity)
            if qty < 1 or qty > 20:
                raise ValueError
        except ValueError:
            self.status_message = "Enter a quantity from 1 to 20."
            return
        product = next(
            (p for p in self.catalogue
             if p["business_name"] == self.selected_business
             and self.product_label(p) == self.selected_product),
            None,
        )
        if not product:
            self.status_message = "That item is no longer available. Refresh the menu."
            return
        if self.cart and any(item["business_id"] != product["business_id"] for item in self.cart):
            self.status_message = "Please place separate orders for different businesses."
            return
        self.cart.append(
            {
                "product_id": product["id"],
                "name": product["name"],
                "business_id": product["business_id"],
                "business_name": product["business_name"],
                "quantity": qty,
                "unit_price": product["price"],
                "line_total": product["price"] * qty,
            }
        )
        self.status_message = f'Added {qty} × {product["name"]} to your order.'

    def clear_cart(self):
        self.cart = []
        self.status_message = "Your order list has been cleared."

    def submit_order(self):
        if self._user_id is None or not self.cart:
            self.status_message = "Sign in and add at least one item before submitting."
            return
        if not self.hostel.strip():
            self.status_message = "Enter your hostel or delivery location."
            return
        if self.delivery_type == "room" and (not self.room.strip() or self.gender not in ["male", "female"]):
            self.status_message = "For room delivery, enter your room and select a delivery-agent gender preference."
            return
        business_id = self.cart[0]["business_id"]
        try:
            with get_session() as session:
                fresh_products = []
                for item in self.cart:
                    product = session.get(Product, item["product_id"])
                    if not product or not product.is_available or product.business_id != business_id:
                        self.status_message = f'{item["name"]} is no longer available. Please refresh your menu.'
                        return
                    fresh_products.append((product, item["quantity"]))
                items_total = sum((p.price * qty for p, qty in fresh_products), Decimal("0.00"))
                delivery_fee = Decimal("400.00") if self.delivery_type == "room" else Decimal("300.00")
                order = Order(
                    order_code=f"COC-{secrets.token_hex(4).upper()}",
                    student_id=self._user_id,
                    business_id=business_id,
                    delivery_type=self.delivery_type,
                    hostel=self.hostel.strip(),
                    room=self.room.strip() if self.delivery_type == "room" else None,
                    delivery_gender_preference=self.gender if self.delivery_type == "room" else None,
                    delivery_fee=delivery_fee,
                    items_total=items_total,
                    grand_total=items_total + delivery_fee,
                )
                session.add(order)
                session.commit()
                session.refresh(order)
                for product, qty in fresh_products:
                    session.add(
                        OrderItem(
                            order_id=order.id,
                            product_id=product.id,
                            product_name=product.name,
                            quantity=qty,
                            unit_price=product.price,
                            line_total=product.price * qty,
                        )
                    )
                session.commit()
                code = order.order_code
            self.cart = []
            self.status_message = f"Order {code} submitted. Payment and agent assignment instructions will follow after review."
        except Exception:
            self.status_message = "We couldn't submit your order. Please try again. No payment has been taken."

    def refresh_menu(self):
        self.load_catalogue()
        self.status_message = "Menu refreshed."


def account_panel() -> rx.Component:
    return rx.card(
        rx.vstack(
            rx.heading("Student account", size="5"),
            rx.input(placeholder="Full name (for new account)", value=AppState.full_name, on_change=AppState.set_full_name),
            rx.input(placeholder="Phone number", value=AppState.phone, on_change=AppState.set_phone),
            rx.input(placeholder="Password (minimum 8 characters)", type="password", value=AppState.password, on_change=AppState.set_password),
            rx.hstack(
                rx.button("Create account", on_click=AppState.register),
                rx.button("Sign in", variant="outline", on_click=AppState.sign_in),
                width="100%",
                wrap="wrap",
            ),
            rx.text(AppState.status_message, color="blue"),
            spacing="3",
            width="100%",
        ),
        width="100%",
    )


def catalogue_panel() -> rx.Component:
    return rx.card(
        rx.vstack(
            rx.hstack(
                rx.heading("Campus menu", size="5"),
                rx.spacer(),
                rx.button("Refresh", on_click=AppState.refresh_menu, variant="outline", size="2"),
                width="100%",
            ),
            rx.text("Choose a participating business and an available item. Prices are set by each business."),
            rx.select(AppState.business_options, placeholder="Choose a business", value=AppState.selected_business, on_change=AppState.set_business),
            rx.select(AppState.product_options, placeholder="Choose an available item", value=AppState.selected_product, on_change=AppState.set_product),
            rx.input(placeholder="Quantity", value=AppState.quantity, on_change=AppState.set_quantity),
            rx.button("Add item", on_click=AppState.add_to_cart, width="100%"),
            rx.text("Only verified available items appear in the menu."),
            spacing="3",
            width="100%",
        ),
        width="100%",
    )


def order_panel() -> rx.Component:
    return rx.card(
        rx.vstack(
            rx.heading("Delivery details", size="5"),
            rx.text("Signed in as ", AppState.signed_in_name),
            rx.select(["gate", "room"], value=AppState.delivery_type, on_change=AppState.set_delivery_type),
            rx.input(placeholder="Hostel / campus delivery location", value=AppState.hostel, on_change=AppState.set_hostel),
            rx.cond(
                AppState.delivery_type == "room",
                rx.vstack(
                    rx.input(placeholder="Room number", value=AppState.room, on_change=AppState.set_room),
                    rx.select(["male", "female"], placeholder="Preferred agent gender", value=AppState.gender, on_change=AppState.set_gender),
                    width="100%",
                ),
                rx.box(),
            ),
            rx.heading("Your order", size="4"),
            rx.foreach(
                AppState.cart,
                lambda item: rx.hstack(
                    rx.text(item["quantity"], " × ", item["name"]),
                    rx.spacer(),
                    rx.text("₦", item["line_total"]),
                    width="100%",
                ),
            ),
            rx.text("Items total: ₦", AppState.cart_total),
            rx.text("Delivery: ₦", AppState.delivery_fee),
            rx.heading("Total: ₦", AppState.grand_total, size="5"),
            rx.button("Submit order", on_click=AppState.submit_order, width="100%"),
            rx.button("Clear order", on_click=AppState.clear_cart, variant="soft", width="100%"),
            rx.text(AppState.status_message),
            spacing="3",
            width="100%",
        ),
        width="100%",
    )


def index() -> rx.Component:
    return rx.container(
        rx.vstack(
            rx.heading("ChowOnCampus Express", size="8"),
            rx.text("Order from participating campus restaurants and shops. Delivered anywhere on campus."),
            rx.cond(
                AppState.is_signed_in,
                rx.hstack(
                    rx.text("Welcome, ", AppState.signed_in_name),
                    rx.spacer(),
                    rx.button("Sign out", on_click=AppState.sign_out, variant="outline"),
                    width="100%",
                ),
                account_panel(),
            ),
            rx.cond(
                AppState.is_signed_in,
                rx.vstack(catalogue_panel(), order_panel(), width="100%"),
                rx.box(),
            ),
            rx.text("Gate delivery ₦300 • Room delivery ₦400 (includes ₦100 room surcharge)"),
            rx.text("No payment is collected by this app. Payment instructions follow only after order review."),
            spacing="4",
            width="100%",
            align="stretch",
        ),
        max_width="48rem",
        padding="1.25rem",
    )


app = rx.App()
app.add_page(index, route="/", title="ChowOnCampus Express")
