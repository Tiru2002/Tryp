import requests
import re
import json
from sqlalchemy import inspect
from database import engine

OLLAMA_URL = "http://localhost:11434/api/generate"
MODEL_NAME = "qwen2.5-coder:7b" 

def get_database_schema():
    inspector = inspect(engine)
    schema_text = ""
    for table_name in inspector.get_table_names():
        if table_name in ["query_logs", "users", "admin_action_logs"]:
            continue
            
        columns = []
        for column in inspector.get_columns(table_name):
            columns.append(f"{column['name']} ({column['type']})")
        schema_text += f"Table '{table_name}': {', '.join(columns)}\n"
    return schema_text

def _call_ollama(prompt: str) -> str:
    payload = {
        "model": MODEL_NAME,
        "prompt": prompt,
        "stream": False
    }
    try:
        response = requests.post(OLLAMA_URL, json=payload)
        response.raise_for_status()
        data = response.json()
        
        text_response = data.get("response", "").strip()
        text_response = re.sub(r'^```(sql)?\s*', '', text_response, flags=re.IGNORECASE)
        text_response = re.sub(r'\s*```$', '', text_response)
        
        return text_response.strip()
    except requests.exceptions.RequestException as e:
        raise Exception(f"Error communicating with Ollama: {str(e)}. Is Ollama running?")

def _translate_to_english(question: str) -> str:
    translation_prompt = f"""
    You are an expert technical translator. Translate the following text into plain English. 
    If the text is already in English, return it exactly as is.
    Do not answer the question, do not add conversational filler, and do not explain yourself.
    Output ONLY the English translation.
    
    Text: {question}
    """
    return _call_ollama(translation_prompt)

def format_history(chat_history: list) -> str:
    if not chat_history:
        return ""
    history_text = "RECENT CONVERSATION HISTORY (For context on follow-up questions):\n"
    for log in chat_history:
        history_text += f"Previous Question: {log.question}\nPrevious SQL: {log.generated_sql}\n\n"
    return history_text

def generate_sql(question: str, chat_history: list = None, row_limit: int = 500) -> str:
    english_question = _translate_to_english(question)
    schema = get_database_schema()
    history_context = format_history(chat_history)
    
    prompt = f"""You are an expert MySQL data analyst.
Write a valid MySQL SELECT query to answer the user's CURRENT QUESTION.
Use ONLY the tables and columns provided in the schema below.
If the CURRENT QUESTION is a follow-up, use the RECENT CONVERSATION HISTORY to understand the context and modify the previous SQL accordingly.
Return ONLY the raw SQL query. Do not include markdown formatting, backticks, or explanations.

SCHEMA:
{schema}

{history_context}
CURRENT QUESTION (Translated): {english_question}
SQL QUERY:"""
    
    sql = _call_ollama(prompt)
    
    if sql.upper().startswith("SELECT") and not re.search(r'\bLIMIT\b', sql, re.IGNORECASE):
        sql = sql.rstrip(';') + f" LIMIT {row_limit};"
        
    return sql

def generate_corrected_sql(question: str, failed_sql: str, error_message: str, chat_history: list = None, row_limit: int = 500) -> str:
    english_question = _translate_to_english(question)
    schema = get_database_schema()
    history_context = format_history(chat_history)
    
    prompt = f"""You are an expert MySQL data analyst.
Your previous MySQL query failed with an execution error. 
Fix the query based on the error message provided.
Use ONLY the tables and columns provided in the schema below.
Return ONLY the corrected raw SQL query. Do not include markdown formatting or explanations.

SCHEMA:
{schema}

{history_context}
CURRENT QUESTION: {english_question}
FAILED QUERY: {failed_sql}
ERROR MESSAGE: {error_message}
CORRECTED SQL QUERY:"""
    
    sql = _call_ollama(prompt)
    
    if sql.upper().startswith("SELECT") and not re.search(r'\bLIMIT\b', sql, re.IGNORECASE):
        sql = sql.rstrip(';') + f" LIMIT {row_limit};"
        
    return sql

def generate_data_summary(question: str, data: list) -> str:
    safe_data = data[:10] 
    prompt = f"""
    The user asked: "{question}"
    The database returned this JSON data: {json.dumps(safe_data)}
    
    Write a single, punchy sentence summarizing the most important insight from this data. 
    Do not explain how you got it, just state the fact.
    """
    try:
        return _call_ollama(prompt)
    except Exception as e:
        return "Could not generate summary."