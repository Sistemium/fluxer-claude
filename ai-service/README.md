# Fluxer AI Service

FastAPI service for running Flux.1-dev image generation model.

## Setup

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Configure environment:
```bash
cp .env.example .env
```

3. Update `.env`:
```bash
# Redis connection (your existing server)
REDIS_HOST=localhost
REDIS_PORT=6379

# Model configuration
DEVICE=cuda  # or cpu for development
```

## Development

For CPU development (slower but works on any machine):
```bash
DEVICE=cpu python main.py
```

For GPU development (requires CUDA):
```bash
python main.py
```

## API Endpoints

- `GET /` - Service status
- `GET /health` - Health check with GPU info
- `POST /generate` - Queue image generation
- `GET /job/{job_id}` - Get job status

## Model Requirements

- **GPU**: Recommended NVIDIA GPU with 12GB+ VRAM for optimal performance
- **CPU**: Works but significantly slower (20-30x slower)
- **Memory**: 16GB+ RAM recommended
- **Storage**: ~20GB for model files

## Production Deployment

For AWS GPU instance (G4/P3):
1. Use CUDA-enabled Docker image
2. Install NVIDIA Docker runtime
3. Use `black-forest-labs/FLUX.1-dev` model
4. Configure S3 for image storage

## Tech Stack

- FastAPI
- PyTorch + CUDA
- Diffusers (Hugging Face)
- Redis (job queue)
- Pillow (image processing)