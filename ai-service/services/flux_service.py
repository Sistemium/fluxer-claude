import torch
import logging
import os
from diffusers import FluxPipeline
from PIL import Image
import io
import base64
from typing import Optional, Dict, Any
from huggingface_hub import login

logger = logging.getLogger(__name__)

class FluxService:
    def __init__(self):
        self.pipeline: Optional[FluxPipeline] = None
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.is_loaded = False
        self.model_id = os.getenv("MODEL_NAME", "black-forest-labs/FLUX.1-dev")
        
    async def initialize(self):
        """Initialize the AI model"""
        try:
            # Login to HuggingFace if token is provided
            hf_token = os.getenv("HUGGINGFACE_TOKEN")
            if hf_token:
                logger.info("Logging in to HuggingFace...")
                login(token=hf_token)
            
            logger.info(f"Loading {self.model_id} model on {self.device}...")
            
            # Load the pipeline
            model_id = self.model_id
            
            try:
                if model_id == "black-forest-labs/FLUX.1-dev":
                    from diffusers import FluxPipeline
                    self.pipeline = FluxPipeline.from_pretrained(
                        model_id,
                        torch_dtype=torch.bfloat16 if self.device == "cuda" else torch.float32,
                        use_safetensors=True
                    )
                else:
                    # Fallback to Stable Diffusion XL for development
                    from diffusers import StableDiffusionXLPipeline
                    self.pipeline = StableDiffusionXLPipeline.from_pretrained(
                        "stabilityai/stable-diffusion-xl-base-1.0",
                        torch_dtype=torch.float16 if self.device == "cuda" else torch.float32,
                        use_safetensors=True
                    )
            except Exception as e:
                logger.warning(f"Failed to load {model_id}, falling back to SDXL: {e}")
                # Fallback to SDXL if FLUX fails
                from diffusers import StableDiffusionXLPipeline
                self.pipeline = StableDiffusionXLPipeline.from_pretrained(
                    "stabilityai/stable-diffusion-xl-base-1.0",
                    torch_dtype=torch.float16 if self.device == "cuda" else torch.float32,
                    use_safetensors=True
                )
            
            if self.device == "cuda":
                self.pipeline = self.pipeline.to("cuda")
                # Enable memory efficient attention if available
                try:
                    self.pipeline.enable_xformers_memory_efficient_attention()
                except:
                    logger.warning("xformers not available, using default attention")
                
                # Enable CPU offload for memory optimization
                self.pipeline.enable_model_cpu_offload()
            
            self.is_loaded = True
            logger.info(f"{self.model_id} model loaded successfully")
            
        except Exception as e:
            logger.error(f"Failed to load {self.model_id} model: {e}")
            raise
    
    async def generate_image(self, request_data: Dict[str, Any]) -> Dict[str, Any]:
        """Generate an image from the request data"""
        if not self.is_loaded or not self.pipeline:
            raise ValueError("Model not loaded")
        
        try:
            prompt = request_data["prompt"]
            width = request_data.get("width", 512)
            height = request_data.get("height", 512)
            guidance_scale = request_data.get("guidance_scale", 7.5)
            num_inference_steps = request_data.get("num_inference_steps", 50)
            seed = request_data.get("seed")
            
            # Set seed for reproducibility
            if seed is not None:
                torch.manual_seed(seed)
                if torch.cuda.is_available():
                    torch.cuda.manual_seed(seed)
            
            logger.info(f"Generating image with prompt: {prompt[:50]}...")
            
            # Generate the image
            with torch.inference_mode():
                result = self.pipeline(
                    prompt=prompt,
                    width=width,
                    height=height,
                    guidance_scale=guidance_scale,
                    num_inference_steps=num_inference_steps,
                    max_sequence_length=256,
                )
                
                image = result.images[0]
            
            # Convert image to base64 for transmission
            buffer = io.BytesIO()
            image.save(buffer, format="PNG")
            image_b64 = base64.b64encode(buffer.getvalue()).decode()
            
            logger.info("Image generation completed successfully")
            
            return {
                "status": "completed",
                "image_data": image_b64,
                "metadata": {
                    "prompt": prompt,
                    "width": width,
                    "height": height,
                    "guidance_scale": guidance_scale,
                    "num_inference_steps": num_inference_steps,
                    "seed": seed
                }
            }
            
        except Exception as e:
            logger.error(f"Error generating image: {e}")
            return {
                "status": "failed",
                "error": str(e)
            }
    
    def get_model_info(self) -> Dict[str, Any]:
        """Get information about the loaded model"""
        return {
            "model_name": self.model_id,
            "device": self.device,
            "is_loaded": self.is_loaded,
            "memory_usage": torch.cuda.memory_allocated() if torch.cuda.is_available() else 0
        }