#!/usr/bin/env python3

import uvicorn
from fastapi import FastAPI

app = FastAPI()

@app.get("/ping")
def ping():
    return {"status": "ok"}

@app.get("/health")  
def health():
    return {"status": "healthy"}

if __name__ == "__main__":
    print("Starting server on http://127.0.0.1:8000")
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")