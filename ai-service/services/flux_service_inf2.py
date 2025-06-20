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
        self.device_type = os.getenv("DEVICE_TYPE", "auto")
        
        # Determine device based on environment
        if self.device_type == "neuron":
            self.device = "neuron"
        elif torch.cuda.is_available():
            self.device = "cuda"
        else:
            self.device = "cpu"
            
        self.is_loaded = False
        self.model_id = os.getenv("MODEL_NAME", "black-forest-labs/FLUX.1-dev")
        
        logger.info(f"FluxService initialized for device: {self.device}")
        
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
                    
                    if self.device == "neuron":
                        logger.info("Loading FLUX.1-dev for AWS Inferentia2...")
                        
                        # Try to load with Neuron optimizations
                        try:
                            # Import Neuron specific modules if available
                            import torch_neuronx
                            logger.info("torch-neuronx imported successfully")
                            
                            self.pipeline = FluxPipeline.from_pretrained(
                                model_id,
                                torch_dtype=torch.float32,  # Neuron prefers float32
                                use_safetensors=True,
                                low_cpu_mem_usage=True
                            )
                            
                            # For Neuron, we don't move to device immediately
                            # Neuron will handle device placement automatically
                            logger.info("FLUX pipeline loaded for Neuron")
                            
                        except ImportError as e:
                            logger.warning(f"torch-neuronx not available: {e}")
                            logger.info("Falling back to CPU mode...")
                            self.device = "cpu"
                            self.pipeline = FluxPipeline.from_pretrained(
                                model_id,
                                torch_dtype=torch.float32,
                                use_safetensors=True,
                                low_cpu_mem_usage=True
                            )
                            
                    elif self.device == "cpu":
                        self.pipeline = FluxPipeline.from_pretrained(
                            model_id,
                            torch_dtype=torch.float32,
                            use_safetensors=True,
                            low_cpu_mem_usage=True
                        )
                    else:  # CUDA
                        # Simple CUDA loading as fallback
                        self.pipeline = FluxPipeline.from_pretrained(
                            model_id,
                            torch_dtype=torch.bfloat16,
                            use_safetensors=True,
                            low_cpu_mem_usage=True
                        )
                        self.pipeline = self.pipeline.to("cuda")
                        
                else:
                    # Fallback to Stable Diffusion XL for development
                    from diffusers import StableDiffusionXLPipeline
                    self.pipeline = StableDiffusionXLPipeline.from_pretrained(
                        "stabilityai/stable-diffusion-xl-base-1.0",
                        torch_dtype=torch.float16 if self.device == "cuda" else torch.float32,
                        use_safetensors=True
                    )
                    
                    if self.device == "cuda":
                        self.pipeline = self.pipeline.to("cuda")
                        
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
            
            self.is_loaded = True
            logger.info(f"{self.model_id} model loaded successfully on {self.device}")
            
        except Exception as e:
            logger.error(f"Failed to load {self.model_id} model: {e}")
            raise
    
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
            
            logger.info(f"Generating image with prompt: {prompt[:50]} on {self.device}...")
            
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
                if self.device == "neuron":
                    # For Neuron, use optimized parameters
                    result = self.pipeline(
                        prompt=prompt,
                        width=width,
                        height=height,
                        guidance_scale=guidance_scale,
                        num_inference_steps=num_inference_steps,
                        max_sequence_length=256,
                        callback_on_step_end=step_callback
                    )
                else:
                    # Standard generation for CUDA/CPU
                    result = self.pipeline(
                        prompt=prompt,
                        width=width,
                        height=height,
                        guidance_scale=guidance_scale,
                        num_inference_steps=num_inference_steps,
                        max_sequence_length=256,
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
                        "seed": seed,
                        "device": self.device
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
        memory_info = {}
        
        if self.device == "cuda" and torch.cuda.is_available():
            memory_info["cuda_memory"] = torch.cuda.memory_allocated()
        elif self.device == "neuron":
            # Try to get Neuron device info
            try:
                import subprocess
                result = subprocess.run(['neuron-ls'], capture_output=True, text=True)
                memory_info["neuron_devices"] = result.stdout if result.returncode == 0 else "unavailable"
            except:
                memory_info["neuron_devices"] = "unavailable"
        
        return {
            "model_name": self.model_id,
            "device": self.device,
            "is_loaded": self.is_loaded,
            **memory_info
        }