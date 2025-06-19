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
    this.ec2 = new EC2Client({
      region: process.env.AWS_REGION || 'eu-west-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID as string,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY as string,
      },
    })

    // Load configuration from environment variables
    const subnetId = process.env.AWS_SUBNET_ID
    this.config = {
      imageId: process.env.SPOT_AMI_ID || 'ami-0d272b151e3b29b0b', // Deep Learning OSS Nvidia Driver
      instanceType: process.env.SPOT_INSTANCE_TYPE || 'g5.xlarge',
      keyName: process.env.AWS_KEY_PAIR_NAME as string,
      securityGroupIds: (process.env.AWS_SECURITY_GROUP_ID || '').split(',').filter(Boolean),
      ...(subnetId && { subnetId }),
      maxPrice: process.env.SPOT_MAX_PRICE || '0.50', // $0.50/hour max
      userData: this.generateUserData()
    }

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
yum update -y

# Install Docker if not present
if ! command -v docker &> /dev/null; then
    amazon-linux-extras install docker -y
    systemctl start docker
    systemctl enable docker
    usermod -a -G docker ec2-user
fi

# Install git if not present
yum install -y git

# Set up environment variables
cat << 'EOF' > /opt/ai-service.env
AWS_REGION=${process.env.AWS_REGION || 'eu-west-1'}
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

# Clone AI service repository (update with your actual repo)
cd /opt
if [ ! -d "fluxer-ai-service" ]; then
    git clone https://github.com/your-username/fluxer-ai-service.git || {
        echo "Repository not found, using local copy"
        mkdir -p fluxer-ai-service
    }
fi

cd fluxer-ai-service

# Build and run AI service container
cat << 'EOF' > Dockerfile
FROM pytorch/pytorch:2.1.0-cuda12.1-cudnn8-runtime

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \\
    git \\
    wget \\
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \\
    CMD curl -f http://localhost:8000/health || exit 1

# Run the application
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
EOF

# Create requirements.txt if not exists
cat << 'EOF' > requirements.txt
fastapi==0.104.1
uvicorn[standard]==0.24.0
torch==2.1.0
torchvision==0.16.0
diffusers==0.25.0
transformers==4.35.0
accelerate==0.24.1
safetensors==0.4.0
pillow==10.1.0
requests==2.31.0
python-multipart==0.0.6
pydantic==2.5.0
boto3==1.34.0
paho-mqtt==1.6.1
EOF

# Build Docker image
docker build -t ai-service .

# Run container with health monitoring
docker run -d \\
    --name ai-service \\
    --restart unless-stopped \\
    --env-file /opt/ai-service.env \\
    -p 8000:8000 \\
    --gpus all \\
    ai-service

# Set up log rotation
echo "*/5 * * * * docker logs ai-service --tail 100 > /var/log/ai-service.log 2>&1" | crontab -

# Signal successful startup
curl -X POST "${process.env.BACKEND_URL || 'http://localhost:3000'}/api/internal/spot-instance/started" \\
    -H "Content-Type: application/json" \\
    -d '{"instanceId":"'$(curl -s http://169.254.169.254/latest/meta-data/instance-id)'","status":"ready"}' || true

logger.info('Spot instance startup script completed'
`

    return Buffer.from(script).toString('base64')
  }

  async launchSpotInstance(): Promise<SpotInstanceInfo> {
    try {
      logger.info('Launching spot instance', { 
        instanceType: this.config.instanceType,
        maxPrice: this.config.maxPrice 
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
      } catch (error) {
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
}