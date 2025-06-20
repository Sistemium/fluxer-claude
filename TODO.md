# Fluxer Project - TODO & Development Plans

## 🎯 Current Status
- ✅ **SQS Migration Complete**: Bull Queue → AWS SQS 
- ✅ **WebSocket Progress**: Real-time updates working
- ✅ **MongoDB Integration**: Job status stored in database
- ✅ **AI Service**: Cleaned from Redis dependencies
- ✅ **Jest Tests**: Basic test coverage implemented
- ✅ **AWS SDK v3**: Migrated from v2 → v3 (no more maintenance warnings)

## 🚀 Next Major Feature: AWS Spot Instances

### Architecture Plan
```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Frontend      │───▶│    Backend       │───▶│  AI Service     │
│  (localhost)    │    │  (localhost)     │    │ (AWS Spot g5.xl)│
│                 │    │   + SQS Queue    │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

### Implementation Tasks

#### 1. AWS Spot Instance Management Service
- [ ] **SpotInstanceService** class for managing EC2 Spot Instances
  - Launch/terminate spot instances
  - Health monitoring  
  - Auto-restart on interruption
- [ ] **CloudWatch Events** integration for spot interruption warnings
- [ ] **Auto-scaling** logic based on queue depth

#### 2. Admin UI for Spot Management  
- [ ] **AdminView.vue** component with:
  - Spot instance status display
  - Launch/terminate controls
  - Real-time health monitoring
  - Cost tracking
- [ ] **Backend API endpoints**:
  - `POST /admin/spot/launch`
  - `POST /admin/spot/terminate` 
  - `GET /admin/spot/status`
  - `GET /admin/ai/health`

#### 3. AI Service Deployment
- [ ] **Docker image** optimized for spot instances
- [ ] **User Data script** for automatic startup
- [ ] **S3 integration** for model caching
- [ ] **Health check endpoint** improvements

#### 4. Monitoring & Reliability
- [ ] **Queue depth monitoring** → auto-scale spot instances
- [ ] **Cost optimization** → terminate idle instances
- [ ] **Failover logic** → graceful handling of spot interruptions
- [ ] **Progress preservation** → checkpoint long-running jobs

### Technical Details

#### AWS Resources Needed
- **AMI**: `ami-0d272b151e3b29b0b` (Deep Learning OSS Nvidia Driver)
- **Instance Type**: `g5.xlarge` (A10G 24GB VRAM, $1.006/hr on-demand)
- **Security Group**: AI service ports (8000)
- **IAM Role**: S3 access for model storage
- **SQS Queue**: Already created `fluxer-generation-queue`

#### Environment Variables
```env
# Backend
AWS_KEY_PAIR_NAME=your-key-pair
AWS_SECURITY_GROUP_ID=sg-your-group
SPOT_MAX_PRICE=0.50

# AI Service  
MODEL_CACHE_S3_BUCKET=fluxr-models
BACKEND_URL=http://your-backend-url:3000
```

## 🔧 Technical Debt & Improvements

### Code Quality
- ✅ **Complete Jest test coverage** (all SQS tests now passing)
- [ ] **TypeScript strict mode** enforcement
- [ ] **ESLint + Prettier** configuration
- [ ] **CI/CD pipeline** setup

### Performance Optimizations  
- [ ] **Model caching** in S3 for faster startup
- [ ] **Connection pooling** for MongoDB
- [ ] **Redis caching** for frequently accessed data
- [ ] **Image compression** for faster delivery

### Security & Production Readiness
- [ ] **Secrets management** with AWS Secrets Manager
- [ ] **Rate limiting** on API endpoints
- [ ] **Input validation** improvements
- [ ] **Error handling** standardization
- [ ] **Logging** structured logging with Winston

### Features & UX
- [ ] **Queue position indicator** for users
- [ ] **Generation history** with filtering
- [ ] **Batch generation** support
- [ ] **Image editing** tools
- [ ] **Prompt suggestions** & templates

### Image Storage Optimization
- [ ] **S3 Image Storage** - move generated images from base64 in EventBridge/MQTT to S3
- [ ] **Remove base64 images** from EventBridge events (only send S3 URLs)
- [ ] **Remove base64 images** from MQTT messages (only send S3 URLs) 
- [ ] **Remove base64 images** from MongoDB storage (only store S3 URLs)
- [ ] **S3 Bucket setup** for generated images with proper lifecycle policies
- [ ] **Presigned URLs** for secure image access from frontend

## 📊 Metrics & Monitoring

### Current Status
- **SQS Queue**: `fluxer-generation-queue` (eu-west-1)
- **Database**: MongoDB Atlas cluster
- **Frontend**: Vue 3 + Vuetify  
- **Backend**: Koa.js + TypeScript
- **AI Service**: FastAPI + PyTorch + FLUX/SDXL

### Key Metrics to Track
- [ ] **Generation success rate** 
- [ ] **Average generation time**
- [ ] **Queue depth & processing rate**
- [ ] **Spot instance uptime**
- [ ] **Cost per generation**

## 🎯 Immediate Next Steps

1. ✅ **Test current SQS implementation** thoroughly
2. ✅ **Fix remaining Jest test failures** 
3. ✅ **Implement SpotInstanceService** class  
4. ✅ **Deploy first spot instance** manually for testing
5. **Create Custom AMI** with pre-installed AI packages
6. **Create Admin UI** for spot management

## 📝 Session Notes (2025-06-19)

### ✅ Major Progress Made Today
- **SpotInstanceService** implemented and working
- **Deep Learning AMI** properly configured for eu-north-1
- **User Data script** optimized for package installation
- **AI Service** successfully running with GPU support
- **FLUX.1-dev model** loading and working

### 🔥 Critical Issues Resolved
1. **User Data size limit** - reduced from 16KB to ~4KB
2. **CUDA runtime conflicts** - resolved PyTorch/xformers ABI issues  
3. **Disk space problems** - optimized package installation paths
4. **Wrong AMI region** - found correct Deep Learning AMI for eu-north-1
5. **Instance store misconception** - learned snapshots impossible

### 🛠 Current Configuration
- **AMI**: `ami-0d272b151e3b29b0b` (Deep Learning OSS Nvidia Driver PyTorch 2.7 Ubuntu 22.04 eu-north-1)
- **Disk Setup**: 45GB root EBS + 229GB instance store at `/opt/dlami/nvme`
- **Package Strategy**: All packages installed to instance store to save root disk space
- **CUDA**: Pre-configured on Deep Learning AMI
- **Repository**: Code pulled from `Sistemium/fluxer-claude` GitHub repo

### 🚨 Key Discovery: Instance Store Limitations
- **Instance store cannot be snapshotted** - it's ephemeral per-host storage
- **Only EBS volumes** can be snapshotted and reused
- **Solution**: Create **Custom AMI** instead of disk snapshots

### 🎯 Next Session Plan
1. **Create Custom AMI** from current working instance:
   ```bash
   aws ec2 create-image --instance-id $(curl -s http://169.254.169.254/latest/meta-data/instance-id) --name "fluxer-ai-ready-$(date +%Y%m%d)"
   ```
2. **Test new instances** launching from custom AMI
3. **Build Admin UI** for spot instance management  
4. **Add auto-scaling** based on SQS queue depth

### 💡 Architecture Insights
- **Deep Learning AMI** = best foundation (drivers, PyTorch pre-installed)
- **Instance store** = perfect for model cache, pip cache (229GB free)
- **Custom AMI** = fastest deployment strategy for pre-configured environments
- **EBS** = only for persistent data that needs snapshots

### 📋 Working Instance Status
- **AI Service**: Running and healthy ✅
- **GPU**: CUDA working, PyTorch sees GPU ✅  
- **FLUX Model**: Loaded and ready for generation ✅
- **Packages**: All dependencies installed ✅

---
*Last updated: 2025-06-19 22:00*  
*Status: Spot Instance service working, ready to create Custom AMI*