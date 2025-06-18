import asyncio
import json
import logging
import uuid
from typing import Optional, Dict, Any
import redis
from datetime import datetime

logger = logging.getLogger(__name__)

class QueueService:
    def __init__(self, redis_client: redis.Redis, flux_service):
        self.redis = redis_client
        self.flux_service = flux_service
        self.queue_name = "image_generation_queue"
        self.processing = False
        self.worker_task: Optional[asyncio.Task] = None
        
    async def add_job(self, job_data: Dict[str, Any]) -> str:
        """Add a new job to the queue"""
        job_id = str(uuid.uuid4())
        
        job = {
            "id": job_id,
            "data": job_data,
            "status": "queued",
            "created_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat()
        }
        
        # Add to queue
        self.redis.lpush(self.queue_name, json.dumps(job))
        
        # Store job status
        self.redis.hset(f"job:{job_id}", mapping={
            "status": "queued",
            "created_at": job["created_at"],
            "updated_at": job["updated_at"],
            "data": json.dumps(job_data)
        })
        
        # Set expiration (24 hours)
        self.redis.expire(f"job:{job_id}", 86400)
        
        logger.info(f"Job {job_id} added to queue")
        return job_id
    
    async def get_job_status(self, job_id: str) -> Optional[Dict[str, Any]]:
        """Get the status of a job"""
        job_data = self.redis.hgetall(f"job:{job_id}")
        
        if not job_data:
            return None
            
        return {
            "job_id": job_id,
            "status": job_data.get("status"),
            "created_at": job_data.get("created_at"),
            "updated_at": job_data.get("updated_at"),
            "image_url": job_data.get("image_url"),
            "error": job_data.get("error")
        }
    
    async def update_job_status(self, job_id: str, status: str, **kwargs):
        """Update job status and additional data"""
        update_data = {
            "status": status,
            "updated_at": datetime.utcnow().isoformat()
        }
        update_data.update(kwargs)
        
        self.redis.hset(f"job:{job_id}", mapping=update_data)
        logger.info(f"Job {job_id} status updated to {status}")
    
    async def process_job(self, job: Dict[str, Any]):
        """Process a single job"""
        job_id = job["id"]
        job_data = job["data"]
        
        try:
            await self.update_job_status(job_id, "processing")
            
            # Generate the image
            result = await self.flux_service.generate_image(job_data)
            
            if result["status"] == "completed":
                # In a real implementation, you would upload the image to S3
                # and store the URL. For now, we'll store the base64 data.
                image_url = f"data:image/png;base64,{result['image_data']}"
                
                await self.update_job_status(
                    job_id, 
                    "completed", 
                    image_url=image_url,
                    metadata=json.dumps(result["metadata"])
                )
            else:
                await self.update_job_status(
                    job_id, 
                    "failed", 
                    error=result.get("error", "Unknown error")
                )
                
        except Exception as e:
            logger.error(f"Error processing job {job_id}: {e}")
            await self.update_job_status(job_id, "failed", error=str(e))
    
    async def worker(self):
        """Background worker to process jobs"""
        logger.info("Queue worker started")
        
        while self.processing:
            try:
                # Get job from queue (blocking with timeout)
                job_data = self.redis.brpop(self.queue_name, timeout=5)
                
                if job_data:
                    _, job_json = job_data
                    job = json.loads(job_json)
                    
                    logger.info(f"Processing job {job['id']}")
                    await self.process_job(job)
                    
            except redis.exceptions.TimeoutError:
                # This is normal - just means no jobs in queue
                continue
            except Exception as e:
                logger.error(f"Error in queue worker: {e}")
                await asyncio.sleep(1)
        
        logger.info("Queue worker stopped")
    
    async def start_worker(self):
        """Start the background worker"""
        if self.worker_task and not self.worker_task.done():
            return
            
        self.processing = True
        self.worker_task = asyncio.create_task(self.worker())
    
    async def stop_worker(self):
        """Stop the background worker"""
        self.processing = False
        
        if self.worker_task and not self.worker_task.done():
            self.worker_task.cancel()
            try:
                await self.worker_task
            except asyncio.CancelledError:
                pass