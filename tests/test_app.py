import os
os.environ["DATABASE_PATH"] = "/tmp/chowoncampus-test.db"
os.environ["SECRET_KEY"] = "test-secret"
try:
    os.remove(os.environ["DATABASE_PATH"])
except FileNotFoundError:
    pass

from app import app, db
from werkzeug.security import generate_password_hash
import pytest

@pytest.fixture()
def client():
    with db() as c:
        for table in ("offers", "order_items", "orders", "products", "businesses", "agents", "users"):
            c.execute(f"DELETE FROM {table}")
    app.config.update(TESTING=True)
    return app.test_client()

def seed_dispatch_case(delivery_type, pref=None, agent_gender="male"):
    with db() as c:
        biz_user = c.execute(
            "INSERT INTO users(name,email,phone,password,role,status) VALUES(?,?,?,?,?,?)",
            ("Vendor", "vendor@example.test", "08000000001", generate_password_hash("a-long-test-password"), "business", "approved")
        ).lastrowid
        student = c.execute(
            "INSERT INTO users(name,email,phone,password,role,status) VALUES(?,?,?,?,?,?)",
            ("Student", "student@example.test", "08000000002", generate_password_hash("a-long-test-password"), "student", "approved")
        ).lastrowid
        agent_id = c.execute(
            "INSERT INTO users(name,email,phone,password,role,status) VALUES(?,?,?,?,?,?)",
            ("Agent", "agent@example.test", "08000000003", generate_password_hash("a-long-test-password"), "agent", "approved")
        ).lastrowid
        business_id = c.execute(
            "INSERT INTO businesses(owner_id,name,kind,status,online) VALUES(?,?,?,?,1)",
            (biz_user, "Campus Bites", "restaurant", "approved")
        ).lastrowid
        c.execute("INSERT INTO agents(user_id,gender,available) VALUES(?,?,1)", (agent_id, agent_gender))
        order_id = c.execute(
            "INSERT INTO orders(student_id,business_id,delivery_type,hostel,room,agent_gender_pref,subtotal,delivery_fee) VALUES(?,?,?,?,?,?,?,?)",
            (student, business_id, delivery_type, "Hostel A" if delivery_type == "room" else None,
             "12" if delivery_type == "room" else None, pref, 2500, 400 if delivery_type == "room" else 300)
        ).lastrowid
    return biz_user, agent_id, order_id

def test_public_home_loads(client):
    response = client.get("/")
    assert response.status_code == 200
    assert b"ChowOnCampus" in response.data

def test_gate_order_dispatch_does_not_require_gender_match(client):
    biz_user, agent_id, order_id = seed_dispatch_case("gate", None, "male")
    with client.session_transaction() as sess:
        sess["uid"] = biz_user
    response = client.post("/business", data={"ready_order": str(order_id)})
    assert response.status_code == 302
    with db() as c:
        offer = c.execute("SELECT * FROM offers WHERE order_id=? AND agent_id=?", (order_id, agent_id)).fetchone()
        assert offer is not None

def test_room_dispatch_only_matches_selected_agent_gender(client):
    biz_user, agent_id, order_id = seed_dispatch_case("room", "female", "male")
    with client.session_transaction() as sess:
        sess["uid"] = biz_user
    client.post("/business", data={"ready_order": str(order_id)})
    with db() as c:
        offer = c.execute("SELECT * FROM offers WHERE order_id=?", (order_id,)).fetchone()
        order = c.execute("SELECT status FROM orders WHERE id=?", (order_id,)).fetchone()
        assert offer is None
        assert order["status"] == "queued"
