from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import torch
import redis
import json
import logging
import os
from typing import Optional
from contextlib import asynccontextmanager
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

from services.flux_service import FluxService
from services.queue_service import QueueService
from models.generation_request import GenerationRequest, GenerationResponse

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Global variables
flux_service: Optional[FluxService] = None
queue_service: Optional[QueueService] = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global flux_service, queue_service
    
    # Initialize services
    logger.info("Initializing AI services...")
    
    # Initialize Redis connection
    redis_client = redis.Redis(
        host=os.getenv('REDIS_HOST', 'localhost'),
        port=int(os.getenv('REDIS_PORT', '6379')),
        decode_responses=True
    )
    
    # Initialize Flux service
    flux_service = FluxService()
    await flux_service.initialize()
    
    # Initialize queue service
    queue_service = QueueService(redis_client, flux_service)
    await queue_service.start_worker()
    
    logger.info("AI services initialized successfully")
    
    yield
    
    # Cleanup
    logger.info("Shutting down AI services...")
    if queue_service:
        await queue_service.stop_worker()

app = FastAPI(
    title="Fluxer AI Service",
    description="AI image generation service using Flux.1-dev",
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
    return {"message": "Fluxer AI Service", "status": "running"}

@app.get("/health")
async def health_check():
    gpu_available = torch.cuda.is_available()
    gpu_count = torch.cuda.device_count() if gpu_available else 0
    
    return {
        "status": "healthy",
        "gpu_available": gpu_available,
        "gpu_count": gpu_count,
        "model_loaded": flux_service is not None and flux_service.is_loaded,
    }

@app.post("/generate", response_model=GenerationResponse)
async def generate_image(
    request: GenerationRequest,
    background_tasks: BackgroundTasks
):
    if not queue_service:
        raise HTTPException(status_code=503, detail="Queue service not initialized")
    
    try:
        job_id = await queue_service.add_job(request.dict())
        
        return GenerationResponse(
            job_id=job_id,
            status="queued",
            message="Image generation job queued successfully"
        )
    except Exception as e:
        logger.error(f"Error queuing generation job: {e}")
        raise HTTPException(status_code=500, detail="Failed to queue generation job")

@app.get("/job/{job_id}")
async def get_job_status(job_id: str):
    if not queue_service:
        raise HTTPException(status_code=503, detail="Queue service not initialized")
    
    try:
        status = await queue_service.get_job_status(job_id)
        if not status:
            raise HTTPException(status_code=404, detail="Job not found")
        
        return status
    except Exception as e:
        logger.error(f"Error getting job status: {e}")
        raise HTTPException(status_code=500, detail="Failed to get job status")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        log_level="info",
        reload=True
    )