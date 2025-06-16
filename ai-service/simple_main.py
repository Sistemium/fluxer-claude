from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
import asyncio
import uuid
import logging
from typing import Optional

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Simple AI Service (Mock)",
    description="Mock AI service for testing without model loading",
    version="1.0.0"
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory job storage
jobs = {}

class GenerationRequest(BaseModel):
    user_id: str
    prompt: str
    width: int = 512
    height: int = 512
    guidance_scale: float = 7.5
    num_inference_steps: int = 50
    seed: Optional[int] = None

class GenerationResponse(BaseModel):
    job_id: str
    status: str
    message: str

class JobStatus(BaseModel):
    job_id: str
    status: str
    progress: int
    image_url: Optional[str] = None
    error: Optional[str] = None

@app.get("/")
async def root():
    return {"message": "Simple AI Service (Mock)", "status": "running"}

@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "gpu_available": False,
        "gpu_count": 0,
        "model_loaded": True,
    }

@app.post("/generate", response_model=GenerationResponse)
async def generate_image(
    request: GenerationRequest,
    background_tasks: BackgroundTasks
):
    job_id = str(uuid.uuid4())
    
    # Store job
    jobs[job_id] = {
        "status": "queued",
        "progress": 0,
        "request": request.dict(),
        "image_url": None,
        "error": None
    }
    
    # Start background processing
    background_tasks.add_task(process_image, job_id, request)
    
    logger.info(f"Job {job_id} queued for prompt: {request.prompt}")
    
    return GenerationResponse(
        job_id=job_id,
        status="queued",
        message="Image generation started"
    )

async def process_image(job_id: str, request: GenerationRequest):
    """Mock image processing"""
    try:
        # Update status to processing
        jobs[job_id]["status"] = "processing"
        jobs[job_id]["progress"] = 10
        
        logger.info(f"Processing job {job_id}")
        
        # Simulate processing time
        await asyncio.sleep(3)
        
        jobs[job_id]["progress"] = 50
        await asyncio.sleep(2)
        
        # Generate mock image URL
        seed = request.seed or 42
        image_url = f"https://picsum.photos/seed/{seed}/{request.width}/{request.height}"
        
        # Complete job
        jobs[job_id]["status"] = "completed"
        jobs[job_id]["progress"] = 100
        jobs[job_id]["image_url"] = image_url
        
        logger.info(f"Job {job_id} completed: {image_url}")
        
    except Exception as e:
        logger.error(f"Job {job_id} failed: {e}")
        jobs[job_id]["status"] = "failed"
        jobs[job_id]["error"] = str(e)

@app.get("/job/{job_id}", response_model=JobStatus)
async def get_job_status(job_id: str):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    
    job_data = jobs[job_id]
    
    return JobStatus(
        job_id=job_id,
        status=job_data["status"],
        progress=job_data["progress"],
        image_url=job_data.get("image_url"),
        error=job_data.get("error")
    )

if __name__ == "__main__":
    logger.info("Starting Simple AI Service...")
    uvicorn.run(
        "simple_main:app",
        host="0.0.0.0",
        port=8000,
        log_level="info",
        reload=False  # Disable reload to avoid issues
    )