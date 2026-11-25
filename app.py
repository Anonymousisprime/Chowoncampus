import os, sqlite3, secrets
from functools import wraps
from flask import Flask, request, redirect, url_for, session, render_template_string, flash
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", secrets.token_hex(32))
DB = os.environ.get("DATABASE_PATH", "chowoncampus.db")
GATE_FEE, ROOM_FEE = 300, 400

def db():
    c = sqlite3.connect(DB)
    c.row_factory = sqlite3.Row
    return c

def init_db():
    with db() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, phone TEXT NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'approved');
        CREATE TABLE IF NOT EXISTS businesses(id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', online INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY, business_id INTEGER NOT NULL, name TEXT NOT NULL, price INTEGER NOT NULL, available INTEGER NOT NULL DEFAULT 1);
        CREATE TABLE IF NOT EXISTS agents(user_id INTEGER PRIMARY KEY, gender TEXT NOT NULL, available INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL, business_id INTEGER NOT NULL, agent_id INTEGER, delivery_type TEXT NOT NULL, hostel TEXT, room TEXT, agent_gender_pref TEXT, subtotal INTEGER NOT NULL, delivery_fee INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'placed', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS order_items(id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL, product_id INTEGER NOT NULL, name TEXT NOT NULL, qty INTEGER NOT NULL, unit_price INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS offers(id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL, agent_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'offered', created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(order_id, agent_id));
        """)
init_db()

BASE = """
<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ChowOnCampus</title>
<style>
:root{--green:#116b45;--ink:#17251f;--muted:#6b7771;--bg:#f4f7f5}*{box-sizing:border-box}body{margin:0;background:var(--bg);font:15px/1.5 Inter,system-ui,Arial;color:var(--ink)}header{background:#fff;border-bottom:1px solid #e4ebe6;padding:16px max(20px,calc((100% - 1080px)/2));display:flex;justify-content:space-between;align-items:center;gap:12px;position:sticky;top:0}header b{color:var(--green);font-size:20px}.wrap{max-width:1080px;margin:32px auto;padding:0 18px}.hero{background:#e4f3eb;border-radius:22px;padding:36px;margin-bottom:22px}.hero h1{font-size:clamp(30px,5vw,48px);line-height:1.1;margin:8px 0}.muted{color:var(--muted)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px}.card{background:#fff;border:1px solid #e4ebe6;border-radius:16px;padding:20px;margin:12px 0}.btn,button{background:var(--green);color:#fff;border:0;border-radius:10px;padding:11px 16px;font-weight:650;cursor:pointer;text-decoration:none;display:inline-block}.btn.secondary{background:#e8f2ec;color:var(--green)}input,select{width:100%;padding:11px;border:1px solid #d5dfd9;border-radius:9px;margin:5px 0 14px;background:#fff}label{font-weight:600;font-size:13px}h2{margin-top:0}form.inline{display:inline}table{width:100%;border-collapse:collapse}td,th{text-align:left;border-bottom:1px solid #edf0ee;padding:10px}.notice{padding:12px 16px;background:#fff3d9;border-radius:10px;margin:10px 0}.tag{background:#e7f4ec;color:#126b45;border-radius:30px;padding:4px 10px;font-size:12px}footer{text-align:center;color:var(--muted);padding:32px}@media(max-width:600px){.hero{padding:24px}.wrap{margin:18px auto}header{padding:14px 18px}}
</style></head><body><header><b>🥗 ChowOnCampus</b><div>{% if user %}<span class="muted">{{user.name}}</span> · <a href="/logout">Log out</a>{% else %}<a href="/login">Sign in</a>{% endif %}</div></header><main class="wrap">
{% with messages=get_flashed_messages() %}{% for m in messages %}<div class="notice">{{m}}</div>{% endfor %}{% endwith %}
{{body|safe}}</main><footer>ChowOnCampus · Campus ordering and delivery · Redeemer’s University</footer></body></html>
"""

def page(body):
    return render_template_string(BASE, body=body, user=current())

def current():
    if not session.get("uid"): return None
    with db() as c: return c.execute("SELECT id,name,email,phone,role,status FROM users WHERE id=?",(session["uid"],)).fetchone()

def login_required(fn):
    @wraps(fn)
    def w(*a,**k):
        if not current(): return redirect(url_for("login"))
        return fn(*a,**k)
    return w

def role_required(*roles):
    def deco(fn):
        @wraps(fn)
        @login_required
        def w(*a,**k):
            u=current()
            if u["role"] not in roles: return page("<div class='card'><h2>Access denied</h2></div>"),403
            return fn(*a,**k)
        return w
    return deco

@app.get("/")
def home():
    u=current()
    if not u:
        body="""<section class='hero'><span class='tag'>RUN campus delivery</span><h1>Your campus. Your cravings. Delivered.</h1><p>Order from participating campus restaurants and shops. Choose gate or hostel-room delivery.</p><a class='btn' href='/register'>Create account</a> <a class='btn secondary' href='/login'>Sign in</a></section><div class='grid'><div class='card'><h2>🛍️ Browse</h2><p>Discover approved campus businesses and available items.</p></div><div class='card'><h2>🛵 Delivery</h2><p>₦300 to the gate or ₦400 to your hostel room.</p></div><div class='card'><h2>🔒 Clear order tracking</h2><p>Follow your order from confirmation to handover.</p></div></div>"""
        return page(body)
    if u["role"]=="admin": return redirect("/admin")
    if u["role"]=="business": return redirect("/business")
    if u["role"]=="agent": return redirect("/agent")
    with db() as c:
        businesses=c.execute("SELECT * FROM businesses WHERE status='approved' AND online=1").fetchall()
        products=c.execute("SELECT p.*,b.name business_name FROM products p JOIN businesses b ON b.id=p.business_id WHERE p.available=1 AND b.status='approved' AND b.online=1").fetchall()
        orders=c.execute("SELECT * FROM orders WHERE student_id=? ORDER BY id DESC",(u["id"],)).fetchall()
    body="<div class='hero'><h1>Welcome, "+u["name"]+"</h1><p>Choose a business and place your order.</p></div><div class='card'><h2>Available items</h2>"
    if not products: body+="<p class='muted'>No businesses or products are available yet. Check back soon.</p>"
    for p in products:
        body+=f"<form method='post' action='/order' class='card'><input type='hidden' name='product_id' value='{p['id']}'><b>{p['name']}</b><p class='muted'>{p['business_name']} · ₦{p['price']:,}</p><label>Quantity</label><input name='qty' type='number' min='1' max='20' value='1'><label>Delivery</label><select name='delivery_type' onchange=\"document.getElementById('room-{p['id']}').hidden=this.value!=='room'\"><option value='gate'>Gate · ₦300</option><option value='room'>Room · ₦400</option></select><div id='room-{p['id']}' hidden><label>Hostel</label><input name='hostel' placeholder='Hostel'><label>Room number</label><input name='room' placeholder='Room number'><label>Preferred agent</label><select name='gender_pref'><option value='male'>Male</option><option value='female'>Female</option></select></div><button>Place order</button></form>"
    body+="</div><div class='card'><h2>Your orders</h2>"
    if not orders: body+="<p class='muted'>No orders yet.</p>"
    for o in orders: body+=f"<p>Order #{o['id']} · {o['delivery_type'].title()} · ₦{o['subtotal']+o['delivery_fee']:,} · <span class='tag'>{o['status']}</span></p>"
    body+="</div>"
    return page(body)

@app.route("/register",methods=["GET","POST"])
def register():
    if request.method=="POST":
        name=request.form.get("name","").strip(); email=request.form.get("email","").strip().lower(); phone=request.form.get("phone","").strip(); pw=request.form.get("password",""); role=request.form.get("role","student"); gender=request.form.get("gender","")
        if role not in ("student","business","agent") or len(pw)<10 or not name or not email or not phone:
            flash("Complete every field. Password must be at least 10 characters."); return redirect("/register")
        status="approved" if role=="student" else "pending"
        try:
            with db() as c:
                cur=c.execute("INSERT INTO users(name,email,phone,password,role,status) VALUES(?,?,?,?,?,?)",(name,email,phone,generate_password_hash(pw),role,status))
                uid=cur.lastrowid
                if role=="agent":
                    if gender not in ("male","female"): raise ValueError("Select your gender for agent eligibility.")
                    c.execute("INSERT INTO agents(user_id,gender) VALUES(?,?)",(uid,gender))
                if role=="business":
                    bname=request.form.get("business_name","").strip(); kind=request.form.get("kind","restaurant")
                    if not bname: raise ValueError("Business name is required.")
                    c.execute("INSERT INTO businesses(owner_id,name,kind) VALUES(?,?,?)",(uid,bname,kind))
            if role=="student": session["uid"]=uid; return redirect("/")
            flash("Application received. Admin approval is required before you can operate."); return redirect("/login")
        except (sqlite3.IntegrityError,ValueError) as e:
            flash(str(e) or "That email is already registered."); return redirect("/register")
    body="""<div class='card'><h2>Create your account</h2><form method='post'><label>Full name</label><input name='name' required><label>Email</label><input name='email' type='email' required><label>Phone</label><input name='phone' required><label>Password (10+ characters)</label><input name='password' type='password' minlength='10' required><label>Account type</label><select name='role' id='role' onchange=\"document.getElementById('agent').hidden=this.value!=='agent';document.getElementById('business').hidden=this.value!=='business'\"><option value='student'>Student</option><option value='agent'>Delivery agent</option><option value='business'>Restaurant / Shop</option></select><div id='agent' hidden><label>Agent gender (for room-delivery matching)</label><select name='gender'><option value='male'>Male</option><option value='female'>Female</option></select></div><div id='business' hidden><label>Business name</label><input name='business_name'><label>Business type</label><select name='kind'><option value='restaurant'>Restaurant</option><option value='shop'>Shop</option></select></div><button>Create account</button></form></div>"""
    return page(body)

@app.route("/login",methods=["GET","POST"])
def login():
    if request.method=="POST":
        with db() as c: u=c.execute("SELECT * FROM users WHERE email=?",(request.form.get("email","").lower(),)).fetchone()
        if not u or not check_password_hash(u["password"],request.form.get("password","")): flash("Email or password is incorrect."); return redirect("/login")
        if u["status"]!="approved" and u["role"]!="admin": flash("Your account is awaiting admin approval."); return redirect("/login")
        session["uid"]=u["id"]; return redirect("/")
    return page("<div class='card'><h2>Sign in</h2><form method='post'><label>Email</label><input name='email' type='email' required><label>Password</label><input name='password' type='password' required><button>Sign in</button></form><p><a href='/register'>Create an account</a></p></div>")

@app.get("/logout")
def logout(): session.clear(); return redirect("/")

@app.post("/order")
@role_required("student")
def order():
    u=current(); pid=request.form.get("product_id",type=int); qty=request.form.get("qty",1,type=int); dtype=request.form.get("delivery_type","gate")
    if qty<1 or qty>20 or dtype not in ("gate","room"): flash("Invalid order details."); return redirect("/")
    with db() as c:
        p=c.execute("SELECT p.*,b.status bstatus,b.online FROM products p JOIN businesses b ON b.id=p.business_id WHERE p.id=? AND p.available=1",(pid,)).fetchone()
        if not p or p["bstatus"]!="approved" or not p["online"]: flash("This item is no longer available."); return redirect("/")
        hostel=request.form.get("hostel","").strip() if dtype=="room" else None
        room=request.form.get("room","").strip() if dtype=="room" else None
        pref=request.form.get("gender_pref") if dtype=="room" else None
        if dtype=="room" and (not hostel or not room or pref not in ("male","female")): flash("Room delivery requires hostel, room and agent preference."); return redirect("/")
        fee=ROOM_FEE if dtype=="room" else GATE_FEE
        cur=c.execute("INSERT INTO orders(student_id,business_id,delivery_type,hostel,room,agent_gender_pref,subtotal,delivery_fee) VALUES(?,?,?,?,?,?,?,?)",(u["id"],p["business_id"],dtype,hostel,room,pref,p["price"]*qty,fee))
        oid=cur.lastrowid
        c.execute("INSERT INTO order_items(order_id,product_id,name,qty,unit_price) VALUES(?,?,?,?,?)",(oid,pid,p["name"],qty,p["price"]))
    flash(f"Order #{oid} placed. Total ₦{p['price']*qty+fee:,}. Payment is not collected by this prototype.")
    return redirect("/")

@app.route("/business",methods=["GET","POST"])
@role_required("business")
def business():
    u=current()
    with db() as c:
        b=c.execute("SELECT * FROM businesses WHERE owner_id=?",(u["id"],)).fetchone()
        if not b or b["status"]!="approved": return page("<div class='card'><h2>Application pending</h2><p>Admin approval is required before you can manage your business.</p></div>")
        if request.method=="POST":
            if "toggle" in request.form: c.execute("UPDATE businesses SET online=? WHERE id=?",(0 if b["online"] else 1,b["id"]))
            else:
                name=request.form.get("name","").strip(); price=request.form.get("price",type=int)
                if name and price and 0<price<100000000: c.execute("INSERT INTO products(business_id,name,price) VALUES(?,?,?)",(b["id"],name,price))
            return redirect("/business")
        items=c.execute("SELECT * FROM products WHERE business_id=?",(b["id"],)).fetchall()
    body=f"<div class='card'><h2>{b['name']}</h2><p>Status: <span class='tag'>{'Online' if b['online'] else 'Offline'}</span></p><form method='post'><button name='toggle' value='1'>Go {'offline' if b['online'] else 'online'}</button></form></div><div class='card'><h2>Add product</h2><form method='post'><label>Item name</label><input name='name' required><label>Price (₦)</label><input name='price' type='number' min='1' required><button>Add item</button></form></div><div class='card'><h2>Your products</h2>"
    for p in items: body+=f"<p>{p['name']} · ₦{p['price']:,} · {'Available' if p['available'] else 'Unavailable'}</p>"
    body+="</div>"
    return page(body)

@app.route("/agent",methods=["GET","POST"])
@role_required("agent")
def agent():
    u=current()
    with db() as c:
        a=c.execute("SELECT * FROM agents WHERE user_id=?",(u["id"],)).fetchone()
        if not a or u["status"]!="approved": return page("<div class='card'><h2>Agent application pending</h2><p>Admin approval is required.</p></div>")
        if request.method=="POST": c.execute("UPDATE agents SET available=? WHERE user_id=?",(1 if request.form.get("available")=="1" else 0,u["id"])); return redirect("/agent")
        offers=c.execute("SELECT o.*,b.name business_name FROM offers f JOIN orders o ON o.id=f.order_id JOIN businesses b ON b.id=o.business_id WHERE f.agent_id=? AND f.status='offered' ORDER BY o.id DESC",(u["id"],)).fetchall()
        jobs=c.execute("SELECT o.*,b.name business_name FROM orders o JOIN businesses b ON b.id=o.business_id WHERE o.agent_id=? ORDER BY o.id DESC",(u["id"],)).fetchall()
    body=f"<div class='card'><h2>Agent dashboard</h2><p>Availability: {'Available' if a['available'] else 'Offline'}</p><form method='post'><button name='available' value='{0 if a['available'] else 1}'>Go {'offline' if a['available'] else 'available'}</button></form></div><div class='card'><h2>Delivery offers</h2>"
    if not offers: body+="<p class='muted'>No offers yet.</p>"
    for o in offers: body+=f"<p>Order #{o['id']} · {o['business_name']} · {o['delivery_type']} · ₦{o['subtotal']+o['delivery_fee']:,}<form class='inline' method='post' action='/agent/accept/{o['id']}'><button>Accept</button></form></p>"
    body+="</div><div class='card'><h2>My deliveries</h2>"
    for o in jobs: body+=f"<p>Order #{o['id']} · {o['status']} · {o['delivery_type']}</p>"
    body+="</div>"
    return page(body)

@app.post("/agent/accept/<int:oid>")
@role_required("agent")
def accept(oid):
    u=current()
    with db() as c:
        c.execute("BEGIN IMMEDIATE")
        a=c.execute("SELECT * FROM agents WHERE user_id=? AND available=1",(u["id"],)).fetchone()
        o=c.execute("SELECT * FROM orders WHERE id=? AND agent_id IS NULL AND status IN ('ready','offering','queued')",(oid,)).fetchone()
        if not a or not o or (o["delivery_type"]=="room" and o["agent_gender_pref"]!=a["gender"]):
            c.rollback(); flash("This offer is no longer available or you are not eligible."); return redirect("/agent")
        c.execute("UPDATE orders SET agent_id=?,status='assigned' WHERE id=? AND agent_id IS NULL",(u["id"],oid))
        c.execute("UPDATE offers SET status='accepted' WHERE order_id=? AND agent_id=?",(oid,u["id"]))
        c.commit()
    flash(f"You accepted order #{oid}."); return redirect("/agent")

@app.get("/admin")
@role_required("admin")
def admin():
    with db() as c:
        pending=c.execute("SELECT * FROM users WHERE status='pending'").fetchall()
        bs=c.execute("SELECT * FROM businesses WHERE status='pending'").fetchall()
        orders=c.execute("SELECT * FROM orders ORDER BY id DESC LIMIT 100").fetchall()
    body="<div class='hero'><h1>Admin operations</h1><p>Approve applications and monitor orders.</p></div><div class='card'><h2>Pending users</h2>"
    for x in pending: body+=f"<p>{x['name']} · {x['role']} · <a href='/admin/approve-user/{x['id']}'>Approve</a></p>"
    body+="</div><div class='card'><h2>Pending businesses</h2>"
    for x in bs: body+=f"<p>{x['name']} · <a href='/admin/approve-business/{x['id']}'>Approve</a></p>"
    body+="</div><div class='card'><h2>Orders</h2>"
    for o in orders: body+=f"<p>#{o['id']} · {o['delivery_type']} · ₦{o['subtotal']+o['delivery_fee']:,} · {o['status']}</p>"
    body+="</div>"
    return page(body)

@app.get("/admin/approve-user/<int:uid>")
@role_required("admin")
def approve_user(uid):
    with db() as c: c.execute("UPDATE users SET status='approved' WHERE id=? AND role IN ('agent','business')",(uid,))
    return redirect("/admin")

@app.get("/admin/approve-business/<int:bid>")
@role_required("admin")
def approve_business(bid):
    with db() as c: c.execute("UPDATE businesses SET status='approved' WHERE id=?",(bid,))
    return redirect("/admin")

@app.get("/setup-admin")
def setup_admin():
    token=os.environ.get("ADMIN_BOOTSTRAP_TOKEN")
    if not token: return page("<div class='card'><h2>Admin setup disabled</h2><p>Set ADMIN_BOOTSTRAP_TOKEN in the hosting environment first.</p></div>")
    if request.args.get("token")!=token: return page("<div class='card'><h2>Admin setup</h2><p>Open this route with your configured bootstrap token.</p></div>"),403
    if request.args.get("confirm")=="yes":
        with db() as c:
            if c.execute("SELECT 1 FROM users WHERE role='admin'").fetchone(): return page("<div class='card'>An admin already exists.</div>")
            c.execute("INSERT INTO users(name,email,phone,password,role,status) VALUES(?,?,?,?,?,?)",("ChowOnCampus Admin",os.environ["ADMIN_EMAIL"],"admin",generate_password_hash(os.environ["ADMIN_PASSWORD"]),"admin","approved"))
        return page("<div class='card'><h2>Admin created</h2><p>Sign in with the credentials configured in hosting environment.</p></div>")
    return page("<div class='card'><h2>Confirm first admin setup</h2><a class='btn' href='/setup-admin?token="+token+"&confirm=yes'>Create first admin</a></div>")

if __name__=="__main__": app.run(host="0.0.0.0",port=int(os.environ.get("PORT",5000)))
