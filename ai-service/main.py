from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import torch
import redis
import json
import logging
import os
import requests
from typing import Optional
from contextlib import asynccontextmanager
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

from services.flux_service import FluxService
from models.generation_request import GenerationRequest, GenerationResponse

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Global variables
flux_service: Optional[FluxService] = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global flux_service
    
    # Initialize services
    logger.info("Initializing AI services...")
    
    # Initialize Flux service (lazy loading)
    flux_service = FluxService()
    
    logger.info("AI services initialized successfully")
    
    yield
    
    # Cleanup
    logger.info("Shutting down AI services...")

app = FastAPI(
    title="Fluxer AI Service", 
    description=f"AI image generation service using {os.getenv('MODEL_NAME', 'AI model')}",
    version="1.0.0",
    lifespan=lifespan
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def root():
    model_name = os.getenv('MODEL_NAME', 'AI model')
    return {"message": f"Fluxer AI Service - {model_name}", "status": "running"}

@app.get("/health")
async def health_check():
    try:
        gpu_available = torch.cuda.is_available()
        gpu_count = torch.cuda.device_count() if gpu_available else 0
        
        model_name = os.getenv('MODEL_NAME', 'AI model')
        return {
            "status": "healthy",
            "gpu_available": gpu_available,
            "gpu_count": gpu_count,
            "model_loaded": flux_service is not None and flux_service.is_loaded,
            "model_name": model_name,
        }
    except Exception as e:
        return {
            "status": "error",
            "error": str(e)
        }

@app.get("/ping")
async def ping():
    return {"status": "ok"}

@app.post("/generate", response_model=GenerationResponse)
async def generate_image(
    request: GenerationRequest,
    background_tasks: BackgroundTasks
):
    if not flux_service:
        raise HTTPException(status_code=503, detail="Flux service not initialized")
    
    try:
        # Generate image directly without queue for now
        if not flux_service.is_loaded:
            await flux_service.initialize()
        
        # Create progress callback that sends updates to backend
        def progress_callback(progress: int, message: str):
            try:
                # Send progress to backend via HTTP
                backend_url = os.getenv('BACKEND_URL', 'http://localhost:3000')
                requests.post(f"{backend_url}/api/internal/progress", json={
                    "user_id": request.user_id,
                    "job_id": request.job_id,
                    "progress": progress,
                    "message": message
                }, timeout=1)
            except Exception as e:
                logger.warning(f"Failed to send progress update: {e}")
        
        result = await flux_service.generate_image(request.model_dump(), progress_callback)
        
        if result["status"] == "completed":
            return GenerationResponse(
                job_id=request.job_id,
                status="completed",
                message="Image generated successfully",
                image_url=f"data:image/png;base64,{result['image_data']}"
            )
        else:
            return GenerationResponse(
                job_id=request.job_id,
                status="failed", 
                message="Image generation failed",
                error=result.get("error")
            )
    except Exception as e:
        logger.error(f"Error generating image: {e}")
        raise HTTPException(status_code=500, detail="Failed to generate image")

# Job status is now handled by backend through SQS
# No need for job status endpoint in AI service

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        log_level="info",
        reload=False
    )