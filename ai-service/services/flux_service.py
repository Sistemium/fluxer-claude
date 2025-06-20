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
                    
                    # CPU optimizations for FLUX
                    if self.device == "cpu":
                        self.pipeline = FluxPipeline.from_pretrained(
                            model_id,
                            torch_dtype=torch.float32,
                            use_safetensors=True,
                            low_cpu_mem_usage=True
                        )
                    else:
                        self.pipeline = FluxPipeline.from_pretrained(
                            model_id,
                            torch_dtype=torch.bfloat16,
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
            return True
            
        except Exception as e:
            logger.error(f"Failed to load {self.model_id} model: {e}")
            return False
    
    def load_model(self) -> bool:
        """Synchronous wrapper for model loading (for eager loading)"""
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
                    
                    # CPU optimizations for FLUX
                    if self.device == "cpu":
                        self.pipeline = FluxPipeline.from_pretrained(
                            model_id,
                            torch_dtype=torch.float32,
                            use_safetensors=True,
                            low_cpu_mem_usage=True
                        )
                    else:
                        self.pipeline = FluxPipeline.from_pretrained(
                            model_id,
                            torch_dtype=torch.bfloat16,
                            use_safetensors=True,
                            low_cpu_mem_usage=True
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
            return True
            
        except Exception as e:
            logger.error(f"Failed to load {self.model_id} model: {e}")
            return False
    
    async def generate_image(self, request_data: Dict[str, Any], progress_callback=None) -> Dict[str, Any]:
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
            
            if progress_callback:
                progress_callback(10, "Setting up generation...")
            
            # Set seed for reproducibility
            if seed is not None:
                torch.manual_seed(seed)
                if torch.cuda.is_available():
                    torch.cuda.manual_seed(seed)
            
            logger.info(f"Generating image with prompt: {prompt[:50]}...")
            
            if progress_callback:
                progress_callback(20, "Starting diffusion process...")
            
            # Create a progress callback for the pipeline
            def step_callback(pipe, step: int, timestep: int, callback_kwargs):
                if progress_callback:
                    progress = 20 + int((step / num_inference_steps) * 70)  # 20% to 90%
                    progress_callback(progress, f"Diffusion step {step}/{num_inference_steps}")
                return callback_kwargs
            
            # Generate the image
            with torch.inference_mode():
                result = self.pipeline(
                    prompt=prompt,
                    width=width,
                    height=height,
                    guidance_scale=guidance_scale,
                    num_inference_steps=num_inference_steps,
                    max_sequence_length=512,
                    callback_on_step_end=step_callback
                )
                
                image = result.images[0]
            
            if progress_callback:
                progress_callback(95, "Converting image...")
            
            try:
                # Convert image to base64 for transmission
                logger.info("Starting image conversion to base64...")
                buffer = io.BytesIO()
                image.save(buffer, format="PNG")
                logger.info(f"Image saved to buffer, size: {buffer.tell()} bytes")
                
                image_b64 = base64.b64encode(buffer.getvalue()).decode()
                logger.info(f"Image converted to base64, length: {len(image_b64)} characters")
                
                if progress_callback:
                    progress_callback(100, "Image generation completed!")
                
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
                logger.error(f"Error during image conversion: {e}")
                if progress_callback:
                    progress_callback(95, f"Image conversion failed: {str(e)}")
                raise
            
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