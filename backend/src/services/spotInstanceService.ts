import { 
  EC2Client, 
  TerminateInstancesCommand, 
  DescribeInstancesCommand,
  DescribeSpotInstanceRequestsCommand,
  RequestSpotInstancesCommand
} from '@aws-sdk/client-ec2'
import logger from '../utils/logger.js'
import axios from 'axios'

interface SpotInstanceConfig {
  imageId: string
  instanceType: string
  keyName: string
  securityGroupIds: string[]
  subnetId?: string
  maxPrice: string
  userData?: string
}

interface SpotInstanceInfo {
  instanceId: string
  spotRequestId: string
  state: string
  publicIp?: string
  privateIp?: string
  launchTime?: Date
  spotPrice?: string
  availabilityZone?: string
}

export class SpotInstanceService {
  private static instance: SpotInstanceService
  private ec2: EC2Client
  private config: SpotInstanceConfig
  private activeInstances: Map<string, SpotInstanceInfo> = new Map()

  constructor() {
    const spotRegion = process.env.SPOT_AWS_REGION || process.env.AWS_REGION || 'eu-west-1'
    
    this.ec2 = new EC2Client({
      region: spotRegion,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID as string,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY as string,
      },
    })

    logger.info('SpotInstanceService using region', { region: spotRegion })

    // Load configuration from environment variables
    const subnetId = process.env.AWS_SUBNET_ID
    const securityGroupIds = (process.env.AWS_SECURITY_GROUP_ID || '').split(',').filter(Boolean)
    
    this.config = {
      imageId: process.env.SPOT_AMI_ID || 'ami-0d272b151e3b29b0b', // Deep Learning OSS Nvidia Driver
      instanceType: process.env.SPOT_INSTANCE_TYPE || 'g5.xlarge',
      keyName: process.env.AWS_KEY_PAIR_NAME as string,
      securityGroupIds,
      ...(subnetId && { subnetId }),
      maxPrice: process.env.SPOT_MAX_PRICE || '0.50', // $0.50/hour max
      userData: this.generateUserData()
    }
    
    logger.info('SpotInstanceService config', { 
      region: spotRegion,
      subnetId: subnetId || 'auto-select',
      securityGroupIds: securityGroupIds.length > 0 ? securityGroupIds : 'default',
      instanceType: this.config.instanceType 
    })

    this.validateConfig()
    logger.info('SpotInstanceService initialized', { 
      instanceType: this.config.instanceType,
      maxPrice: this.config.maxPrice 
    })
  }

  static getInstance(): SpotInstanceService {
    if (!SpotInstanceService.instance) {
      SpotInstanceService.instance = new SpotInstanceService()
    }
    return SpotInstanceService.instance
  }

  async initialize(): Promise<void> {
    try {
      logger.info('Initializing SpotInstanceService - loading existing instances')
      await this.loadExistingInstances()
      
      // Start periodic refresh of instance status
      this.startPeriodicRefresh()
    } catch (error) {
      logger.error('Failed to initialize SpotInstanceService', error)
    }
  }

  private startPeriodicRefresh(): void {
    // Refresh instance status every 2 minutes
    setInterval(async () => {
      try {
        await this.refreshInstanceStatus()
      } catch (error) {
        logger.error('Error during periodic instance refresh', error)
      }
    }, 120000) // 2 minutes
  }

  private async refreshInstanceStatus(): Promise<void> {
    if (this.activeInstances.size === 0) return

    try {
      const instanceIds = Array.from(this.activeInstances.keys())
      logger.debug('Refreshing instance status', { instanceIds })
      
      for (const instanceId of instanceIds) {
        try {
          const currentInfo = await this.getInstanceInfo(instanceId)
          this.activeInstances.set(instanceId, {
            ...this.activeInstances.get(instanceId)!,
            ...currentInfo
          })
        } catch (error) {
          // Instance might be terminated
          logger.warn('Failed to refresh instance, removing from active list', { 
            instanceId, 
            error: (error as Error).message 
          })
          this.activeInstances.delete(instanceId)
        }
      }
    } catch (error) {
      logger.error('Error refreshing instance status', error)
    }
  }

  private async loadExistingInstances(): Promise<void> {
    try {
      // Find running instances with our tags or name pattern
      const command = new DescribeInstancesCommand({
        Filters: [
          {
            Name: 'instance-state-name',
            Values: ['running', 'pending', 'stopping']
          },
          {
            Name: 'instance-type',
            Values: [this.config.instanceType]
          },
          {
            Name: 'key-name',
            Values: [this.config.keyName]
          }
        ]
      })

      const response = await this.ec2.send(command)
      const instances: SpotInstanceInfo[] = []

      for (const reservation of response.Reservations || []) {
        for (const instance of reservation.Instances || []) {
          if (instance.InstanceId) {
            const instanceInfo: SpotInstanceInfo = {
              instanceId: instance.InstanceId,
              spotRequestId: instance.SpotInstanceRequestId || '',
              state: instance.State?.Name || 'unknown',
              ...(instance.PublicIpAddress && { publicIp: instance.PublicIpAddress }),
              ...(instance.PrivateIpAddress && { privateIp: instance.PrivateIpAddress }),
              ...(instance.LaunchTime && { launchTime: instance.LaunchTime }),
              ...(instance.Placement?.AvailabilityZone && { availabilityZone: instance.Placement.AvailabilityZone })
            }
            
            instances.push(instanceInfo)
            this.activeInstances.set(instance.InstanceId, instanceInfo)
          }
        }
      }

      logger.info('Loaded existing instances', { 
        count: instances.length,
        instances: instances.map(i => ({ 
          instanceId: i.instanceId, 
          state: i.state, 
          publicIp: i.publicIp 
        }))
      })

    } catch (error) {
      logger.error('Error loading existing instances', error)
    }
  }

  private validateConfig() {
    const required = ['keyName', 'securityGroupIds']
    const missing = required.filter(key => {
      const value = this.config[key as keyof SpotInstanceConfig]
      return !value || (Array.isArray(value) && value.length === 0)
    })

    if (missing.length > 0) {
      throw new Error(`Missing required Spot Instance configuration: ${missing.join(', ')}`)
    }
  }

  private generateUserData(): string {
    // Base64 encoded startup script for AI service
    const script = `#!/bin/bash
set -e

# Update system
apt-get update -y

# Install Docker if not present
if ! command -v docker &> /dev/null; then
    apt-get install -y docker.io
    systemctl start docker
    systemctl enable docker
    usermod -a -G docker ubuntu
fi

# Install git if not present
apt-get install -y git curl

# Set up environment variables
cat << 'EOF' > /opt/ai-service.env
AWS_REGION=${process.env.SPOT_AWS_REGION || process.env.AWS_REGION || 'eu-west-1'}
BACKEND_URL=${process.env.BACKEND_URL || 'http://localhost:3000'}
MODEL_CACHE_S3_BUCKET=${process.env.MODEL_CACHE_S3_BUCKET || ''}
SQS_QUEUE_URL=${process.env.SQS_QUEUE_URL || ''}
EVENTBRIDGE_BUS_NAME=${process.env.EVENTBRIDGE_BUS_NAME || 'fluxer-ai-events'}
MQTT_BROKER_HOST=${process.env.MQTT_BROKER_HOST || ''}
MQTT_BROKER_PORT=${process.env.MQTT_BROKER_PORT || '1883'}
MQTT_USERNAME=${process.env.MQTT_USERNAME || ''}
MQTT_PASSWORD=${process.env.MQTT_PASSWORD || ''}
AWS_ACCESS_KEY_ID=${process.env.AWS_ACCESS_KEY_ID || ''}
AWS_SECRET_ACCESS_KEY=${process.env.AWS_SECRET_ACCESS_KEY || ''}
MODEL_NAME=flux-dev
CUDA_VISIBLE_DEVICES=0
EOF

# Install Python and pip for direct AI service
apt-get install -y python3 python3-pip

# Install Python dependencies for AI service
pip3 install fastapi uvicorn torch diffusers transformers accelerate safetensors pillow requests boto3 paho-mqtt

# Create simple AI service directly
mkdir -p /opt/ai-service
cd /opt/ai-service

# Create AI service using our actual structure
cat << 'PYTHON_EOF' > main.py
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
import torch
import os
import json
import logging
from typing import Optional
from datetime import datetime

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),  # stdout/stderr for systemd journal
        logging.FileHandler('/var/log/ai-service/ai-service.log', mode='a')
    ]
)
logger = logging.getLogger(__name__)

# Log startup
logger.info("Starting Fluxer AI Service")

app = FastAPI(
    title="Fluxer AI Service", 
    description="AI image generation service using FLUX",
    version="1.0.0"
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pydantic models
class GenerationRequest(BaseModel):
    user_id: str
    job_id: str
    prompt: str
    width: int = 1024
    height: int = 1024
    guidance_scale: float = 7.5
    num_inference_steps: int = 25
    seed: Optional[int] = None

class GenerationResponse(BaseModel):
    job_id: str
    status: str
    message: str
    image_url: Optional[str] = None
    error: Optional[str] = None

@app.get("/")
async def root():
    model_name = os.getenv('MODEL_NAME', 'AI model')
    return {"message": f"Fluxer AI Service - {model_name}", "status": "running"}

@app.get("/health")
async def health_check():
    try:
        gpu_available = torch.cuda.is_available()
        gpu_count = torch.cuda.device_count() if gpu_available else 0
        
        model_name = os.getenv('MODEL_NAME', 'AI model')
        return {
            "status": "healthy",
            "gpu_available": gpu_available,
            "gpu_count": gpu_count,
            "model_name": model_name,
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
async def generate_image(request: GenerationRequest):
    try:
        logger.info(f"Generating image for job {request.job_id}")
        
        # For now, return a placeholder response
        # TODO: Implement actual FLUX generation
        import base64
        import io
        from PIL import Image
        
        # Create a simple test image
        img = Image.new('RGB', (request.width, request.height), color='blue')
        img_buffer = io.BytesIO()
        img.save(img_buffer, format='PNG')
        img_base64 = base64.b64encode(img_buffer.getvalue()).decode()
        
        image_url = f"data:image/png;base64,{img_base64}"
        
        # TODO: Send progress updates via MQTT and EventBridge
        logger.info(f"Generated test image for job {request.job_id}")
        
        return GenerationResponse(
            job_id=request.job_id,
            status="completed",
            message="Test image generated successfully",
            image_url=image_url
        )
        
    except Exception as e:
        logger.error(f"Error generating image for job {request.job_id}: {e}")
        return GenerationResponse(
            job_id=request.job_id,
            status="failed", 
            message="Image generation failed",
            error=str(e)
        )

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
PYTHON_EOF

# Create systemd service for AI service
cat << 'SERVICE_EOF' > /etc/systemd/system/ai-service.service
[Unit]
Description=Fluxer AI Service
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/ai-service
Environment=PATH=/usr/bin:/usr/local/bin
EnvironmentFile=/opt/ai-service.env
ExecStart=/usr/bin/python3 main.py
Restart=always
RestartSec=10

# Logging configuration
StandardOutput=journal
StandardError=journal
SyslogIdentifier=ai-service

# Security settings
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
SERVICE_EOF

# Create log directory and set permissions
mkdir -p /var/log/ai-service
chown ubuntu:ubuntu /var/log/ai-service
chmod 755 /var/log/ai-service

# Start AI service
systemctl daemon-reload
systemctl enable ai-service
systemctl start ai-service

# Wait for service to start
sleep 10

# Check service status
systemctl status ai-service || true

# Signal successful startup via MQTT and EventBridge
INSTANCE_ID=$(curl -s http://169.254.169.254/latest/meta-data/instance-id)
echo "Instance $INSTANCE_ID startup completed, AI service is ready"

# Test AI service health
curl -f http://localhost:8000/health && echo "AI service health check passed" || echo "AI service health check failed"

echo "Spot instance startup script completed"
echo ""
echo "=== AI Service Log Commands ==="
echo "View service status: sudo systemctl status ai-service"
echo "View realtime logs: sudo journalctl -u ai-service -f"
echo "View recent logs: sudo journalctl -u ai-service --no-pager"
echo "View log file: sudo tail -f /var/log/ai-service/ai-service.log"
echo "Restart service: sudo systemctl restart ai-service"
echo "============================"
`

    return Buffer.from(script).toString('base64')
  }

  async launchSpotInstance(): Promise<SpotInstanceInfo> {
    try {
      logger.info('Launching spot instance', { 
        instanceType: this.config.instanceType,
        maxPrice: this.config.maxPrice,
        imageId: this.config.imageId,
        keyName: this.config.keyName,
        securityGroupIds: this.config.securityGroupIds,
        subnetId: this.config.subnetId || 'auto-select',
        region: this.ec2.config.region
      })

      const command = new RequestSpotInstancesCommand({
        InstanceCount: 1,
        LaunchSpecification: {
          ImageId: this.config.imageId,
          InstanceType: this.config.instanceType as any,
          KeyName: this.config.keyName,
          SecurityGroupIds: this.config.securityGroupIds,
          SubnetId: this.config.subnetId,
          UserData: this.config.userData,
          // IAM instance profile for S3 access
          IamInstanceProfile: {
            Name: process.env.SPOT_IAM_INSTANCE_PROFILE || 'ai-service-role'
          },
          // Block device mapping for larger storage
          BlockDeviceMappings: [
            {
              DeviceName: '/dev/xvda',
              Ebs: {
                VolumeSize: 50, // GB
                VolumeType: 'gp3',
                DeleteOnTermination: true
              }
            }
          ]
        },
        SpotPrice: this.config.maxPrice,
        Type: 'one-time',
        InstanceInterruptionBehavior: 'terminate'
      })

      const response = await this.ec2.send(command)
      const spotRequest = response.SpotInstanceRequests?.[0]

      if (!spotRequest?.SpotInstanceRequestId) {
        throw new Error('Failed to create spot instance request')
      }

      logger.info('Spot instance request created', { 
        spotRequestId: spotRequest.SpotInstanceRequestId 
      })

      // Wait for instance to be assigned
      const instanceInfo = await this.waitForSpotInstance(spotRequest.SpotInstanceRequestId)
      
      // Store in active instances
      this.activeInstances.set(instanceInfo.instanceId, instanceInfo)

      logger.info('Spot instance launched successfully', { 
        instanceId: instanceInfo.instanceId,
        spotRequestId: instanceInfo.spotRequestId 
      })

      return instanceInfo

    } catch (error) {
      logger.error('Failed to launch spot instance', error)
      throw error
    }
  }

  private async waitForSpotInstance(spotRequestId: string, maxWaitTime = 300000): Promise<SpotInstanceInfo> {
    const startTime = Date.now()
    
    while (Date.now() - startTime < maxWaitTime) {
      try {
        const command = new DescribeSpotInstanceRequestsCommand({
          SpotInstanceRequestIds: [spotRequestId]
        })
        
        const response = await this.ec2.send(command)
        const request = response.SpotInstanceRequests?.[0]

        if (request?.State === 'failed') {
          throw new Error(`Spot request failed: ${request.Fault?.Message || 'Unknown error'}`)
        }

        if (request?.InstanceId && request.State === 'active') {
          // Get instance details
          const instanceInfo = await this.getInstanceInfo(request.InstanceId)
          const spotPrice = request.SpotPrice
          return {
            ...instanceInfo,
            spotRequestId,
            ...(spotPrice && { spotPrice })
          }
        }

        logger.info('Waiting for spot instance...', { 
          spotRequestId, 
          state: request?.State 
        })
        
        await new Promise(resolve => setTimeout(resolve, 10000)) // Wait 10 seconds
      } catch (error: any) {
        // Handle case where spot request was immediately failed and removed
        if (error.name === 'InvalidSpotInstanceRequestID.NotFound') {
          throw new Error(`Spot request ${spotRequestId} failed immediately and was removed by AWS. This usually indicates configuration issues like invalid AMI, instance type not available in region, insufficient capacity, or network configuration problems.`)
        }
        
        logger.error('Error checking spot instance status', error)
        throw error
      }
    }

    throw new Error('Timeout waiting for spot instance to launch')
  }

  async getInstanceInfo(instanceId: string): Promise<SpotInstanceInfo> {
    try {
      const command = new DescribeInstancesCommand({
        InstanceIds: [instanceId]
      })

      const response = await this.ec2.send(command)
      const instance = response.Reservations?.[0]?.Instances?.[0]

      if (!instance) {
        throw new Error(`Instance ${instanceId} not found`)
      }

      return {
        instanceId: instance.InstanceId!,
        spotRequestId: '', // Will be filled by caller if needed
        state: instance.State?.Name || 'unknown',
        ...(instance.PublicIpAddress && { publicIp: instance.PublicIpAddress }),
        ...(instance.PrivateIpAddress && { privateIp: instance.PrivateIpAddress }),
        ...(instance.LaunchTime && { launchTime: instance.LaunchTime }),
        ...(instance.Placement?.AvailabilityZone && { availabilityZone: instance.Placement.AvailabilityZone })
      }
    } catch (error) {
      logger.error('Failed to get instance info', { instanceId, error })
      throw error
    }
  }

  async terminateInstance(instanceId: string): Promise<void> {
    try {
      logger.info('Terminating spot instance', { instanceId })

      const command = new TerminateInstancesCommand({
        InstanceIds: [instanceId]
      })

      await this.ec2.send(command)
      
      // Remove from active instances
      this.activeInstances.delete(instanceId)

      logger.info('Spot instance terminated', { instanceId })
    } catch (error) {
      logger.error('Failed to terminate instance', { instanceId, error })
      throw error
    }
  }

  async getAllActiveInstances(): Promise<SpotInstanceInfo[]> {
    const instances: SpotInstanceInfo[] = []
    
    for (const [instanceId, info] of this.activeInstances.entries()) {
      try {
        // Refresh instance state
        const currentInfo = await this.getInstanceInfo(instanceId)
        const updatedInfo = { ...info, ...currentInfo }
        
        // Update in map
        this.activeInstances.set(instanceId, updatedInfo)
        instances.push(updatedInfo)
      } catch (error) {
        logger.warn('Failed to refresh instance info', { instanceId, error })
        // Remove from active instances if it doesn't exist
        this.activeInstances.delete(instanceId)
      }
    }

    return instances
  }

  async checkInstanceHealth(instanceId: string): Promise<boolean> {
    try {
      const info = await this.getInstanceInfo(instanceId)
      
      if (info.state !== 'running' || !info.publicIp) {
        return false
      }

      // Check AI service health endpoint
      const healthUrl = `http://${info.publicIp}:8000/health`
      const response = await axios.get(healthUrl, { 
        timeout: 10000 
      })
      
      return response.status === 200
    } catch (error) {
      logger.warn('Instance health check failed', { instanceId, error })
      return false
    }
  }

  getConfig(): SpotInstanceConfig {
    return { ...this.config }
  }

  getActiveInstancesCount(): number {
    return this.activeInstances.size
  }

  async getActiveAIServiceUrl(): Promise<string | null> {
    try {
      const instances = await this.getAllActiveInstances()
      const runningInstance = instances.find(i => i.state === 'running' && i.publicIp)
      
      if (runningInstance && runningInstance.publicIp) {
        const serviceUrl = `http://${runningInstance.publicIp}:8000`
        logger.info('Found active AI service', { 
          instanceId: runningInstance.instanceId,
          serviceUrl 
        })
        return serviceUrl
      }
      
      logger.warn('No running AI service instances found')
      return null
    } catch (error) {
      logger.error('Error getting active AI service URL', error)
      return null
    }
  }
}