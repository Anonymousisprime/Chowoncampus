import os
from contextlib import contextmanager

from sqlmodel import Session, SQLModel, create_engine

from . import models  # noqa: F401 - register table models

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./chowoncampus_express.db")
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, echo=False, connect_args=connect_args)


def initialize_database() -> None:
    SQLModel.metadata.create_all(engine)


@contextmanager
def get_session():
    with Session(engine) as session:
        yield session
