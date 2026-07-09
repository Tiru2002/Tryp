import os
from sqlalchemy import create_engine, Column, Integer, String, Float, ForeignKey, Date, DateTime, Boolean
from sqlalchemy.orm import declarative_base, sessionmaker, relationship
from sqlalchemy.sql import func
from datetime import date, datetime, timedelta

# SQLite setup
SQLALCHEMY_DATABASE_URL = "sqlite:///./nl2sql.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# --- MODELS ---
class Customer(Base):
    __tablename__ = "customers"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    industry = Column(String)
    region = Column(String)

class Product(Base):
    __tablename__ = "products"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    category = Column(String)
    price = Column(Float)

class Order(Base):
    __tablename__ = "orders"
    id = Column(Integer, primary_key=True, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"))
    order_date = Column(Date)
    total_amount = Column(Float)

class OrderItem(Base):
    __tablename__ = "order_items"
    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("orders.id"))
    product_id = Column(Integer, ForeignKey("products.id"))
    quantity = Column(Integer)
    price = Column(Float)

# --- USER & LOG MODELS ---
class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    hashed_password = Column(String)
    is_admin = Column(Boolean, default=False) # <-- NEW: Admin Flag

class QueryLog(Base):
    __tablename__ = "query_logs"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    question = Column(String, nullable=False)
    generated_sql = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

 #The Admin Audit Trail Table
class AdminActionLog(Base):
    __tablename__ = "admin_action_logs"
    id = Column(Integer, primary_key=True, index=True)
    admin_username = Column(String, index=True)
    action_type = Column(String)  
    details = Column(String)      
    created_at = Column(DateTime, default=datetime.utcnow)
    
# --- HELPER FUNCTIONS ---
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def seed_database():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    if db.query(Customer).first():
        db.close()
        return

    c1 = Customer(name="Acme Corp", industry="Tech", region="North America")
    c2 = Customer(name="Globex", industry="Manufacturing", region="Europe")
    c3 = Customer(name="Initech", industry="Software", region="North America")
    db.add_all([c1, c2, c3])
    db.commit()

    p1 = Product(name="Widget A", category="Hardware", price=25.0)
    p2 = Product(name="Widget B", category="Hardware", price=40.0)
    p3 = Product(name="Software License", category="Software", price=150.0)
    db.add_all([p1, p2, p3])
    db.commit()

    o1 = Order(customer_id=c1.id, order_date=date.today() - timedelta(days=5), total_amount=200.0)
    o2 = Order(customer_id=c2.id, order_date=date.today() - timedelta(days=2), total_amount=150.0)
    db.add_all([o1, o2])
    db.commit()

    oi1 = OrderItem(order_id=o1.id, product_id=p1.id, quantity=2, price=25.0)
    oi2 = OrderItem(order_id=o1.id, product_id=p3.id, quantity=1, price=150.0)
    oi3 = OrderItem(order_id=o2.id, product_id=p3.id, quantity=1, price=150.0)
    db.add_all([oi1, oi2, oi3])
    db.commit()
    db.close()