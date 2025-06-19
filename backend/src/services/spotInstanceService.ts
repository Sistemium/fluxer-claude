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
    // Minimal startup script - code from Git, models from snapshot/ephemeral disk
    const script = `#!/bin/bash
set -e

# Update system and install essentials
apt-get update -y
apt-get install -y git curl python3 python3-pip awscli

# Find CUDA libraries (AMI already has NVIDIA drivers)
CUDA_FILE=$(find /usr -name "libcudart.so*" 2>/dev/null | head -n1)
if [ -n "$CUDA_FILE" ]; then
    CUDA_LIB_PATH=$(dirname "$CUDA_FILE")
else
    CUDA_LIB_PATH="/usr/lib/x86_64-linux-gnu"
fi
echo "Found CUDA libraries at: $CUDA_LIB_PATH"

# Also check common NVIDIA library paths
for path in /usr/lib/x86_64-linux-gnu /usr/local/cuda*/lib64 /opt/nvidia/lib64; do
    if [ -f "$path/libcudart.so" ]; then
        CUDA_LIB_PATH="$path:$CUDA_LIB_PATH"
        echo "Added CUDA path: $path"
    fi
done

# Get HuggingFace token from AWS Secrets Manager
SPOT_REGION="${process.env.SPOT_AWS_REGION || 'eu-west-1'}"
HF_TOKEN=""
if aws secretsmanager get-secret-value --secret-id "fluxer/huggingface-token" --region "$SPOT_REGION" --query SecretString --output text > /tmp/hf_token.json 2>/dev/null; then
    HF_TOKEN=$(cat /tmp/hf_token.json | python3 -c "import sys, json; print(json.load(sys.stdin).get('token', ''))")
    rm -f /tmp/hf_token.json
fi

# Setup instance store for ML models (229GB free ephemeral storage)
# Find instance store device
INSTANCE_STORE=""
for device in /dev/nvme2n1 /dev/nvme3n1 /dev/xvdb /dev/sdb /dev/nvme1n1; do
    if [ -b "$device" ]; then
        INSTANCE_STORE="$device"
        echo "Found instance store at: $device"
        break
    fi
done

if [ -n "$INSTANCE_STORE" ]; then
    mkdir -p /mnt/instance-store
    mount "$INSTANCE_STORE" /mnt/instance-store 2>/dev/null || {
        echo "Formatting instance store..."
        mkfs.ext4 "$INSTANCE_STORE"
        mount "$INSTANCE_STORE" /mnt/instance-store
    }
    
    # Create ML directories with proper permissions
    mkdir -p /mnt/instance-store/python
    mkdir -p /mnt/instance-store/huggingface  
    mkdir -p /mnt/instance-store/torch-cache
    mkdir -p /mnt/instance-store/pip-cache
    
    # Set ownership before pip install
    chown -R ubuntu:ubuntu /mnt/instance-store
    chmod -R 755 /mnt/instance-store
    
    echo "Instance store mounted - 229GB available, installing Python deps as ubuntu user..."
    
    # Set temp directory to instance store to avoid filling up root disk
    mkdir -p /mnt/instance-store/tmp
    chown ubuntu:ubuntu /mnt/instance-store/tmp
    
    # Install Python packages in stages to handle dependencies
    echo "Step 1: Installing torch first..."
    sudo -u ubuntu TMPDIR=/mnt/instance-store/tmp \
        PIP_BUILD_DIR=/mnt/instance-store/tmp/pip-build \
        pip3 install \
        --target /mnt/instance-store/python \
        --cache-dir /mnt/instance-store/pip-cache \
        --index-url https://download.pytorch.org/whl/cu118 \
        torch torchvision
    
    echo "Step 2: Installing other packages..."
    sudo -u ubuntu TMPDIR=/mnt/instance-store/tmp \
        PIP_BUILD_DIR=/mnt/instance-store/tmp/pip-build \
        PYTHONPATH=/mnt/instance-store/python \
        pip3 install \
        --target /mnt/instance-store/python \
        --cache-dir /mnt/instance-store/pip-cache \
        --extra-index-url https://pypi.org/simple \
        fastapi uvicorn diffusers transformers accelerate \
        safetensors pillow requests boto3 paho-mqtt huggingface_hub protobuf \
        sentencepiece python-dotenv
    
    echo "Step 3: Installing xformers (needs torch in path)..."
    sudo -u ubuntu TMPDIR=/mnt/instance-store/tmp \
        PIP_BUILD_DIR=/mnt/instance-store/tmp/pip-build \
        PYTHONPATH=/mnt/instance-store/python \
        pip3 install \
        --target /mnt/instance-store/python \
        --cache-dir /mnt/instance-store/pip-cache \
        --extra-index-url https://pypi.org/simple \
        xformers || echo "xformers install failed, continuing without it"
    
    echo "Python dependencies installed to instance store"
else
    echo "Warning: Instance store not found, installing to system"
    pip3 install fastapi uvicorn torch torchvision diffusers transformers accelerate \
        safetensors pillow requests boto3 paho-mqtt huggingface_hub protobuf \
        sentencepiece xformers
fi

# Clone AI service code from Git
cd /opt
git clone https://github.com/${process.env.GITHUB_REPO || 'Sistemium/fluxer-claude'}.git ai-service-repo
cp -r ai-service-repo/ai-service /opt/ai-service || mkdir -p /opt/ai-service
cd /opt/ai-service

# Set up environment with dynamic CUDA path
cat << EOF > /opt/ai-service.env
AWS_REGION=${process.env.SPOT_AWS_REGION || process.env.AWS_REGION || 'eu-west-1'}
BACKEND_URL=${process.env.BACKEND_URL || 'http://localhost:3000'}
SQS_QUEUE_URL=${process.env.SQS_QUEUE_URL || ''}
HUGGINGFACE_TOKEN=\$HF_TOKEN
PYTHONPATH=/mnt/instance-store/python:\$PYTHONPATH
HUGGINGFACE_HUB_CACHE=/mnt/instance-store/huggingface
TORCH_HOME=/mnt/instance-store/torch-cache
CUDA_VISIBLE_DEVICES=0
LD_LIBRARY_PATH=\$CUDA_LIB_PATH:\$LD_LIBRARY_PATH
EOF

# Create systemd service with dynamic CUDA environment
cat << EOF > /etc/systemd/system/ai-service.service
[Unit]
Description=Fluxer AI Service
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/ai-service
EnvironmentFile=/opt/ai-service.env
Environment=LD_LIBRARY_PATH=\$CUDA_LIB_PATH
ExecStart=/usr/bin/python3 main.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Start service
systemctl daemon-reload
systemctl enable ai-service
systemctl start ai-service

echo "AI service started from Git repo"
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
          // Block device mapping - small root disk, use instance store for ML
          BlockDeviceMappings: [
            {
              DeviceName: '/dev/sda1', // Root device for AMI
              Ebs: {
                VolumeSize: 15, // GB - just OS and basic tools 
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