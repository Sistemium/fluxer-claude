# Fluxer - AI Image Generation Platform

A full-stack application for AI image generation using Flux.1-dev model.

## Architecture

- **Frontend**: Vue 3 + Vuetify + TypeScript
- **Backend**: Koa.js + TypeScript + MongoDB Atlas + SuperTokens
- **AI Service**: Python + FastAPI + Flux.1-dev
- **Queue**: Redis + Bull
- **Deployment**: AWS (S3 + EC2)

## Project Structure

```
├── frontend/     # Vue 3 + Vuetify app
├── backend/      # Koa + TypeScript API
├── ai-service/   # Python Flux.1-dev service
└── deployment/   # AWS deployment configs
```

## Quick Start

1. **Prerequisites**:
   - Node.js 18+
   - Python 3.11+
   - Your existing Redis server
   - MongoDB Atlas account

2. **Clone and setup**:
   ```bash
   cd fluxer-claude
   
   # Frontend
   cd frontend && npm install && cd ..
   
   # Backend
   cd backend && npm install && cd ..
   
   # AI Service
   cd ai-service && pip install -r requirements.txt && cd ..
   ```

3. **Configure environment variables**:
   Update `.env.local` files in each service directory

4. **Development**:
   ```bash
   # Terminal 1 - AI Service
   cd ai-service && python main.py
   
   # Terminal 2 - Backend
   cd backend && npm run dev
   
   # Terminal 3 - Frontend
   cd frontend && npm run dev
   ```

5. **Docker (Alternative)**:
   ```bash
   docker-compose up
   ```

## Development

Each service has its own README with detailed setup instructions.

## Environment Variables

- Frontend: `.env.local`, `.env.test.local`
- Backend: Uses `dotenv-flow` with `node -r dotenv-flow`