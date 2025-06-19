from pydantic import BaseModel, Field
from typing import Optional

class GenerationRequest(BaseModel):
    user_id: str
    job_id: Optional[str] = Field(default="direct")
    prompt: str = Field(..., min_length=1, max_length=1000)
    width: int = Field(default=512, ge=256, le=1024)
    height: int = Field(default=512, ge=256, le=1024)
    guidance_scale: float = Field(default=7.5, ge=1.0, le=20.0)
    num_inference_steps: int = Field(default=50, ge=10, le=100)
    seed: Optional[int] = Field(default=None, ge=0)

    model_config = {
        "json_schema_extra": {
            "example": {
                "user_id": "user123",
                "prompt": "A beautiful sunset over mountains",
                "width": 512,
                "height": 512,
                "guidance_scale": 7.5,
                "num_inference_steps": 50,
                "seed": 42
            }
        }
    }

class GenerationResponse(BaseModel):
    job_id: str
    status: str
    message: str
    image_url: Optional[str] = None
    error: Optional[str] = None