from decimal import Decimal

from sqlmodel import Session, select

from .database import engine, initialize_database
from .models import Business, Product


def main() -> None:
    initialize_database()
    with Session(engine) as session:
        existing = session.exec(select(Business)).first()
        if existing:
            print("Database is ready. Existing businesses were left unchanged.")
            return
        business = Business(name="Sample Campus Restaurant", category="restaurant", is_active=True)
        session.add(business)
        session.commit()
        session.refresh(business)
        session.add_all(
            [
                Product(
                    business_id=business.id,
                    name="Jollof Rice",
                    category="Rice",
                    description="Demo item. Replace with a verified menu and price.",
                    price=Decimal("1500.00"),
                    is_available=False,
                ),
                Product(
                    business_id=business.id,
                    name="Fried Rice",
                    category="Rice",
                    description="Demo item. Replace with a verified menu and price.",
                    price=Decimal("1800.00"),
                    is_available=False,
                ),
            ]
        )
        session.commit()
    print("Database initialized. Demo products remain unavailable until verified.")


if __name__ == "__main__":
    main()
