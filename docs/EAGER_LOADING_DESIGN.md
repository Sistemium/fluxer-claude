# AI Service Eager Loading & Backend Notifications

## 🎯 Цель
Предзагружать FLUX модель при старте сервиса и уведомлять backend о готовности, чтобы очередь не обрабатывалась пока AI сервис не готов.

## 🏗️ Архитектура

### 1. AI Service: Eager Loading
```python
# services/flux_service.py
class FluxService:
    def __init__(self):
        self.is_loading = False
        self.is_loaded = False
        self.load_start_time = None
        
    async def initialize(self):
        """Pre-load model on startup"""
        self.is_loading = True
        self.load_start_time = time.time()
        
        logger.info("🚀 Pre-loading FLUX.1-dev model...")
        
        try:
            # Загружаем модель сразу
            await self.load_model()
            
            # Уведомляем backend о готовности
            await self.notify_backend_ready()
            
            load_time = time.time() - self.load_start_time
            logger.info(f"✅ Model loaded successfully in {load_time:.1f}s")
            
        except Exception as e:
            logger.error(f"❌ Model loading failed: {e}")
            await self.notify_backend_error(str(e))
            raise
        finally:
            self.is_loading = False
    
    async def notify_backend_ready(self):
        """Notify backend that AI service is ready"""
        try:
            backend_url = os.getenv('BACKEND_URL')
            instance_id = self.get_instance_id()
            
            payload = {
                "instance_id": instance_id,
                "status": "ready",
                "model_name": self.model_id,
                "timestamp": time.time(),
                "load_time": time.time() - self.load_start_time
            }
            
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{backend_url}/api/internal/ai-service-ready", 
                    json=payload,
                    timeout=10
                )
                logger.info(f"✅ Backend notified: {response.status_code}")
                
        except Exception as e:
            logger.warning(f"⚠️  Failed to notify backend: {e}")
            # Не падаем если уведомление не дошло
    
    async def notify_backend_error(self, error_message):
        """Notify backend about loading error"""
        try:
            backend_url = os.getenv('BACKEND_URL')
            instance_id = self.get_instance_id()
            
            payload = {
                "instance_id": instance_id,
                "status": "error",
                "error": error_message,
                "timestamp": time.time()
            }
            
            async with httpx.AsyncClient() as client:
                await client.post(
                    f"{backend_url}/api/internal/ai-service-error", 
                    json=payload,
                    timeout=10
                )
                
        except Exception as e:
            logger.warning(f"Failed to notify backend about error: {e}")
```

### 2. Enhanced Health Check
```python
# main.py
@app.get("/health")
async def health_check():
    try:
        gpu_available = torch.cuda.is_available() if device != "neuron" else True
        
        if flux_service.is_loading:
            load_time = time.time() - flux_service.load_start_time if flux_service.load_start_time else 0
            return {
                "status": "loading",
                "model_loaded": False,
                "ready_for_requests": False,
                "loading_time": f"{load_time:.1f}s",
                "gpu_available": gpu_available,
                "device": flux_service.device
            }
        
        return {
            "status": "healthy" if flux_service.is_loaded else "initializing",
            "model_loaded": flux_service.is_loaded,
            "ready_for_requests": flux_service.is_loaded,
            "model_name": flux_service.model_id,
            "gpu_available": gpu_available,
            "device": flux_service.device
        }
    except Exception as e:
        return {
            "status": "error",
            "error": str(e),
            "model_loaded": False,
            "ready_for_requests": False
        }

@app.get("/ready")
async def readiness_check():
    """Kubernetes-style readiness probe"""
    if flux_service.is_loaded:
        return {"ready": True}
    else:
        raise HTTPException(status_code=503, detail="Service not ready")
```

### 3. Backend: AI Service Registry
```typescript
// services/aiServiceRegistry.ts
interface AIServiceStatus {
  instanceId: string
  status: 'loading' | 'ready' | 'error' | 'offline'
  lastSeen: Date
  modelName?: string
  loadTime?: number
  error?: string
}

export class AIServiceRegistry {
  private services = new Map<string, AIServiceStatus>()
  
  updateServiceStatus(instanceId: string, status: Partial<AIServiceStatus>) {
    const existing = this.services.get(instanceId) || { instanceId, status: 'offline', lastSeen: new Date() }
    
    this.services.set(instanceId, {
      ...existing,
      ...status,
      lastSeen: new Date()
    })
    
    logger.info('AI Service status updated', { instanceId, status: status.status })
  }
  
  getReadyServices(): AIServiceStatus[] {
    return Array.from(this.services.values())
      .filter(service => service.status === 'ready' && this.isRecentlySeen(service))
  }
  
  hasReadyService(): boolean {
    return this.getReadyServices().length > 0
  }
  
  private isRecentlySeen(service: AIServiceStatus): boolean {
    const maxAge = 5 * 60 * 1000 // 5 minutes
    return Date.now() - service.lastSeen.getTime() < maxAge
  }
}
```

### 4. Backend: API Endpoints
```typescript
// routes/internal.ts
const aiRegistry = AIServiceRegistry.getInstance()

router.post('/ai-service-ready', async (ctx) => {
  const { instance_id, status, model_name, load_time } = ctx.request.body
  
  aiRegistry.updateServiceStatus(instance_id, {
    status: 'ready',
    modelName: model_name,
    loadTime: load_time
  })
  
  logger.info('AI Service ready', { instance_id, model_name, load_time })
  
  ctx.body = { success: true }
})

router.post('/ai-service-error', async (ctx) => {
  const { instance_id, error } = ctx.request.body
  
  aiRegistry.updateServiceStatus(instance_id, {
    status: 'error',
    error
  })
  
  logger.error('AI Service error', { instance_id, error })
  
  ctx.body = { success: true }
})

router.get('/ai-services/status', async (ctx) => {
  ctx.body = {
    services: Array.from(aiRegistry.services.values()),
    ready_count: aiRegistry.getReadyServices().length
  }
})
```

### 5. Queue Processing: Conditional Logic
```typescript
// services/sqsService.ts - обновленная версия
export class SQSService {
  private aiRegistry = AIServiceRegistry.getInstance()
  
  async processQueue(): Promise<void> {
    // Проверяем готовность AI сервисов
    if (!this.aiRegistry.hasReadyService()) {
      logger.info('No ready AI services available, skipping queue processing')
      return
    }
    
    const readyServices = this.aiRegistry.getReadyServices()
    logger.debug(`Processing queue with ${readyServices.length} ready AI services`)
    
    // Обычная логика обработки очереди
    await this.processMessages()
  }
  
  async getActiveAIServiceUrl(): Promise<string | null> {
    const readyServices = this.aiRegistry.getReadyServices()
    
    if (readyServices.length === 0) {
      logger.warn('No ready AI services available')
      return null
    }
    
    // Используем первый готовый сервис или load balancing
    const service = readyServices[0]
    const spotService = SpotInstanceService.getInstance()
    const instanceInfo = await spotService.getInstanceInfo(service.instanceId)
    
    return instanceInfo.publicIp ? `http://${instanceInfo.publicIp}:8000` : null
  }
}
```

### 6. Startup Sequence
```python
# main.py - обновленный lifespan
@asynccontextmanager
async def lifespan(app: FastAPI):
    global flux_service
    
    logger.info("🚀 Starting AI Service...")
    
    try:
        # Инициализируем сервис с таймаутом
        flux_service = FluxService()
        
        # Даем 15 минут на загрузку модели
        await asyncio.wait_for(
            flux_service.initialize(), 
            timeout=900  # 15 minutes
        )
        
        logger.info("✅ AI Service fully initialized and ready")
        
    except asyncio.TimeoutError:
        logger.error("❌ Model loading timeout (15 minutes)")
        await flux_service.notify_backend_error("Model loading timeout")
        raise
    except Exception as e:
        logger.error(f"❌ AI Service initialization failed: {e}")
        await flux_service.notify_backend_error(str(e))
        raise
    
    yield
    
    # Cleanup
    logger.info("🛑 Shutting down AI Service...")
    cleanup_mqtt()
```

## 🔧 Environment Variables

```bash
# AI Service
BACKEND_URL=http://your-backend:3000
MODEL_PRELOAD=true
STARTUP_TIMEOUT=900

# Backend  
AI_SERVICE_HEALTH_CHECK_INTERVAL=30000  # 30 seconds
AI_SERVICE_MAX_AGE=300000              # 5 minutes
```

## 📊 Monitoring & Metrics

### Health Check Endpoints:
- `GET /health` - Full status including loading state
- `GET /ready` - Kubernetes-style readiness (503 if not ready)

### Backend Endpoints:
- `GET /api/internal/ai-services/status` - All AI services status
- `POST /api/internal/ai-service-ready` - AI ready notification
- `POST /api/internal/ai-service-error` - AI error notification

### Logs:
- AI Service: Loading progress, ready notification
- Backend: Service registry updates, queue processing decisions

## 🚀 Implementation Priority

1. **Phase 1**: Basic eager loading in FluxService
2. **Phase 2**: Backend notifications and registry
3. **Phase 3**: Conditional queue processing
4. **Phase 4**: Enhanced monitoring and metrics

---
*Документ будет обновляться по мере реализации*