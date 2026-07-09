from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import text, inspect
from database import get_db, seed_database, QueryLog, User, AdminActionLog, engine
from llm import generate_sql, generate_corrected_sql, generate_data_summary
from auth import get_password_hash, verify_password, create_access_token, get_current_user

seed_database()

app = FastAPI(title="NL-to-SQL API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- GLOBAL SETTINGS STATE ---
GLOBAL_SETTINGS = {
    "row_limit": 500
}

class SettingsUpdate(BaseModel):
    row_limit: int

class UserCreate(BaseModel):
    username: str
    password: str

class QueryRequest(BaseModel):
    question: str

@app.post("/register")
def register_user(user: UserCreate, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.username == user.username).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Username already registered")
    
    hashed_password = get_password_hash(user.password)
    is_admin = True if user.username.lower() == 'admin' else False
    
    new_user = User(username=user.username, hashed_password=hashed_password, is_admin=is_admin)
    db.add(new_user)
    db.commit()
    return {"message": "User created successfully"}

@app.post("/token")
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == form_data.username).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token = create_access_token(data={"sub": user.username})
    return {"access_token": access_token, "token_type": "bearer", "is_admin": user.is_admin}

def validate_and_execute(db: Session, sql: str, is_admin: bool):
    clean_sql = sql.strip()
    upper_sql = clean_sql.upper()
    
    danger_words = ["DROP TABLE", "DROP DATABASE", "ALTER TABLE", "TRUNCATE"]
    if any(word in upper_sql for word in danger_words):
        raise ValueError("Destructive database structure changes are forbidden.")

    if is_admin:
        allowed_actions = ("SELECT", "INSERT", "UPDATE", "DELETE")
        if not upper_sql.startswith(allowed_actions):
            raise ValueError("Admin queries must start with SELECT, INSERT, UPDATE, or DELETE.")
    else:
        if not upper_sql.startswith("SELECT"):
            raise ValueError("Standard users are only allowed to run SELECT queries.")
    
    resultProxy = db.execute(text(clean_sql))
    
    if upper_sql.startswith(("INSERT", "UPDATE", "DELETE")):
        db.commit()
        return clean_sql, [{"Message": f"Success. Rows affected: {resultProxy.rowcount}"}]
        
    columns = resultProxy.keys()
    results = [dict(zip(columns, row)) for row in resultProxy.fetchall()]
    return clean_sql, results

@app.post("/query")
def run_nl_query(request: QueryRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    question = request.question
    
    recent_logs = db.query(QueryLog).filter(QueryLog.user_id == current_user.id).order_by(QueryLog.created_at.desc()).limit(2).all()
    chat_history = list(reversed(recent_logs))
    
    current_limit = GLOBAL_SETTINGS["row_limit"]
    
    try:
        generated_sql = generate_sql(question, chat_history, row_limit=current_limit)
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))
    
    final_sql = ""
    results = []
    retries = 0

    try:
        final_sql, results = validate_and_execute(db, generated_sql, current_user.is_admin)
    except Exception as initial_error:
        try:
            corrected_sql = generate_corrected_sql(question, generated_sql, str(initial_error), chat_history, row_limit=current_limit)
            final_sql, results = validate_and_execute(db, corrected_sql, current_user.is_admin)
            retries = 1
        except Exception as final_error:
            raise HTTPException(status_code=500, detail=f"Query failed. AI generated invalid SQL. Error: {str(final_error)}")
            
    try:
        log_entry = QueryLog(question=question, generated_sql=final_sql, user_id=current_user.id)
        db.add(log_entry)
        db.commit()
    except Exception:
        db.rollback()

    summary = ""
    if results and len(results) > 0 and len(results) <= 15:
        try:
            summary = generate_data_summary(question, results)
        except Exception as e:
            pass
        
    return {"sql": final_sql, "results": results, "retries": retries, "summary": summary}

@app.get("/history")
def get_query_history(db: Session = Depends(get_db), limit: int = 10, current_user: User = Depends(get_current_user)):
    return db.query(QueryLog).filter(QueryLog.user_id == current_user.id).order_by(QueryLog.created_at.desc()).limit(limit).all()

@app.get("/schema")
def get_db_schema(current_user: User = Depends(get_current_user)):
    inspector = inspect(engine)
    schema_data = {}
    for table_name in inspector.get_table_names():
        if table_name in ["query_logs", "users", "admin_action_logs"]: continue
        schema_data[table_name] = [{"name": c['name'], "type": str(c['type'])} for c in inspector.get_columns(table_name)]
    return schema_data

@app.get("/admin/logs")
def get_all_global_logs(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Not authorized")
    logs = db.query(QueryLog, User.username).join(User, QueryLog.user_id == User.id).order_by(QueryLog.created_at.desc()).limit(50).all()
    return [{"id": log.id, "username": username, "question": log.question, "sql": log.generated_sql, "date": log.created_at} for log, username in logs]

@app.get("/admin/settings")
def get_settings(current_user: User = Depends(get_current_user)):
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Not authorized")
    return GLOBAL_SETTINGS

@app.post("/admin/settings")
def update_settings(settings: SettingsUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    old_limit = GLOBAL_SETTINGS["row_limit"]
    new_limit = settings.row_limit
    
    GLOBAL_SETTINGS["row_limit"] = new_limit
    
    try:
        log_entry = AdminActionLog(
            admin_username=current_user.username,
            action_type="SETTINGS_CHANGED",
            details=f"Changed global row limit from {old_limit} to {new_limit}"
        )
        db.add(log_entry)
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"Failed to log admin action: {e}")

    return {"message": "Settings updated successfully", "new_limit": new_limit}