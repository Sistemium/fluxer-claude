from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import torch
import logging
import os
import requests
import time as import_time
import asyncio
from typing import Optional
from contextlib import asynccontextmanager
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

from services.flux_service import FluxService
from services.eventbridge_client import send_progress_update as eb_send_progress, send_completion_update as eb_send_completion, send_error_update as eb_send_error
from services.mqtt_client import send_progress_update, send_completion_update, send_error_update, cleanup_mqtt
from services.instance_monitor import get_instance_monitor
from models.generation_request import GenerationRequest, GenerationResponse

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Global variables
flux_service: Optional[FluxService] = None

async def send_service_event(event_type: str, data: dict):
    """Send AI service lifecycle events via EventBridge and MQTT"""
    try:
        # Send via EventBridge only (lifecycle events don't need MQTT progress format)
        await asyncio.get_event_loop().run_in_executor(
            None, 
            eb_send_progress, 
            "ai-service-lifecycle", 
            event_type, 
            data
        )
        
        # For MQTT, send as raw message if needed
        try:
            from services.mqtt_client import get_mqtt_client
            client = get_mqtt_client()
            if client:
                topic = f"fluxer/ai/lifecycle/{event_type}"
                payload = {
                    'event_type': event_type,
                    'data': data,
                    'timestamp': import_time.time()
                }
                client._publish_message(topic, payload)
        except Exception as mqtt_error:
            logger.debug(f"MQTT lifecycle event failed (non-critical): {mqtt_error}")
        
        logger.info(f"Sent {event_type} event: {data}")
    except Exception as e:
        logger.error(f"Failed to send {event_type} event: {e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    global flux_service
    
    # Initialize services
    logger.info("Initializing AI services...")
    
    try:
        # Start instance monitoring
        instance_monitor = get_instance_monitor()
        await instance_monitor.start_monitoring()
        
        # Send startup event
        instance_id = os.getenv('EC2_INSTANCE_ID', 'unknown')
        await send_service_event("ai_service_starting", {
            "instance_id": instance_id,
            "model_name": os.getenv('MODEL_NAME', 'unknown'),
            "timestamp": import_time.time()
        })
        
        # Initialize Flux service with eager loading
        flux_service = FluxService()
        
        # Eager load the model
        logger.info("Eager loading FLUX model...")
        success = flux_service.load_model()
        
        if success:
            logger.info("FLUX model loaded successfully - AI service ready!")
            # Send ready event
            await send_service_event("ai_service_ready", {
                "instance_id": instance_id,
                "model_name": os.getenv('MODEL_NAME', 'unknown'), 
                "model_loaded": True,
                "timestamp": import_time.time()
            })
            # Notify instance monitor that service is ready
            await instance_monitor.send_service_ready()
        else:
            raise Exception("Failed to load FLUX model")
            
    except Exception as e:
        logger.error(f"Failed to initialize AI service: {e}")
        # Send error event
        await send_service_event("ai_service_error", {
            "instance_id": instance_id,
            "error": str(e),
            "timestamp": import_time.time()
        })
        raise
    
    logger.info("AI services initialized successfully")
    
    yield
    
    # Cleanup
    logger.info("Shutting down AI services...")
    
    # Notify instance monitor about shutdown
    instance_monitor = get_instance_monitor()
    await instance_monitor.send_service_stopping()
    instance_monitor.stop_monitoring()
    
    # Send shutdown event
    await send_service_event("ai_service_stopping", {
        "instance_id": instance_id,
        "timestamp": import_time.time()
    })
    cleanup_mqtt()

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
        # Check GPU availability
        gpu_available = torch.cuda.is_available()
        gpu_count = torch.cuda.device_count() if gpu_available else 0
        
        if gpu_available:
            device = "cuda" 
            compute_available = True
            compute_count = gpu_count
        else:
            device = "cpu"
            compute_available = True
            compute_count = 1
        
        model_name = os.getenv('MODEL_NAME', 'AI model')
        instance_id = os.getenv('EC2_INSTANCE_ID', 'unknown')
        instance_type = os.getenv('EC2_INSTANCE_TYPE', 'unknown')
        
        return {
            "status": "healthy",
            "device": device,
            "gpu_available": gpu_available,
            "gpu_count": gpu_count,
            "compute_available": compute_available,
            "compute_count": compute_count,
            "model_loaded": flux_service is not None and flux_service.is_loaded,
            "model_name": model_name,
            "instance_id": instance_id,
            "instance_type": instance_type,
            "eager_loading": True,  # Indicate this service uses eager loading
            "startup_time": import_time.time()
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
        
        # Create progress callback that sends updates via MQTT and EventBridge
        def progress_callback(progress: int, message: str):
            try:
                # Primary: Send via MQTT (real-time)
                send_progress_update(request.job_id, request.user_id, progress, message)
                
                # Secondary: Send via EventBridge (reliable)
                eb_send_progress(request.job_id, request.user_id, progress, message)
                
                # Fallback to HTTP for backward compatibility (optional)
                try:
                    backend_url = os.getenv('BACKEND_URL', 'http://localhost:3000')
                    requests.post(f"{backend_url}/api/internal/progress", json={
                        "user_id": request.user_id,
                        "job_id": request.job_id,
                        "progress": progress,
                        "message": message
                    }, timeout=1)
                except:
                    pass  # Ignore HTTP fallback errors
            except Exception as e:
                logger.warning(f"Failed to send progress update: {e}")
        
        result = await flux_service.generate_image(request.model_dump(), progress_callback)
        
        if result["status"] == "completed":
            image_url = f"data:image/png;base64,{result['image_data']}"
            
            # Send completion event via MQTT and EventBridge (without image data)
            try:
                send_completion_update(request.job_id, request.user_id)
                eb_send_completion(request.job_id, request.user_id)
            except Exception as e:
                logger.warning(f"Failed to send completion event: {e}")
            
            return GenerationResponse(
                job_id=request.job_id,
                status="completed",
                message="Image generated successfully",
                image_url=image_url
            )
        else:
            error_message = result.get("error", "Image generation failed")
            
            # Send error event via MQTT and EventBridge
            try:
                send_error_update(request.job_id, request.user_id, error_message)
                eb_send_error(request.job_id, request.user_id, error_message)
            except Exception as e:
                logger.warning(f"Failed to send error event: {e}")
            
            return GenerationResponse(
                job_id=request.job_id,
                status="failed", 
                message="Image generation failed",
                error=error_message
            )
    except Exception as e:
        logger.error(f"Error generating image: {e}")
        
        # Send error event via MQTT and EventBridge
        try:
            send_error_update(request.job_id, request.user_id, str(e))
            eb_send_error(request.job_id, request.user_id, str(e))
        except Exception as event_error:
            logger.warning(f"Failed to send error event: {event_error}")
        
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