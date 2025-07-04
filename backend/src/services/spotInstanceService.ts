import {
  EC2Client,
  TerminateInstancesCommand,
  DescribeInstancesCommand,
  DescribeSpotInstanceRequestsCommand,
  RequestSpotInstancesCommand,
  RequestSpotFleetCommand,
  DescribeSpotFleetRequestsCommand
} from '@aws-sdk/client-ec2'
import { SpotRegionService } from './spotRegionService.js'
import logger from '../utils/logger.js'
import axios from 'axios'
import uniq from 'lodash/uniq.js'

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
  spotFleetId?: string  // For Spot Fleet requests
  state: string
  publicIp?: string
  privateIp?: string
  launchTime?: Date
  spotPrice?: string
  availabilityZone?: string
  instanceType?: string
}

export class SpotInstanceService {
  private static instance: SpotInstanceService
  private ec2: EC2Client
  private config: SpotInstanceConfig
  private activeInstances: Map<string, SpotInstanceInfo> = new Map()

  constructor() {
    // Initialize with default region - will be updated from DB
    const defaultRegion = process.env.SPOT_AWS_REGION || process.env.AWS_REGION || 'us-east-1'

    this.ec2 = new EC2Client({
      region: defaultRegion,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID as string,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY as string,
      },
    })

    logger.info('SpotInstanceService initializing with default region', { region: defaultRegion })

    const { SPOT_INSTANCE_TYPE } = process.env

    if (!SPOT_INSTANCE_TYPE) {
      throw Error('empty SPOT_INSTANCE_TYPE')
    }

    // Initialize with fallback configuration - will be updated from DB
    this.config = {
      imageId: process.env.SPOT_AMI_ID || 'ami-0866a3c8686eaeeba', // Fallback AMI
      instanceType: SPOT_INSTANCE_TYPE as string,
      keyName: process.env.AWS_KEY_PAIR_NAME as string,
      securityGroupIds: (process.env.AWS_SECURITY_GROUP_ID || '').split(',').filter(Boolean),
      maxPrice: process.env.SPOT_MAX_PRICE || '0.50',
      userData: this.generateUserData()
    }

    logger.info('SpotInstanceService initialized with fallback config')
  }

  static getInstance(): SpotInstanceService {
    if (!SpotInstanceService.instance) {
      SpotInstanceService.instance = new SpotInstanceService()
    }
    return SpotInstanceService.instance
  }

  async initialize(): Promise<void> {
    try {
      logger.info('Initializing SpotInstanceService - loading config from DB')

      // Load region configuration from database
      await this.loadRegionConfig()

      logger.info('Loading existing instances')
      await this.loadExistingInstances()

      // Start periodic refresh of instance status
      this.startPeriodicRefresh()
    } catch (error) {
      logger.error('Failed to initialize SpotInstanceService', error)
    }
  }

  async loadRegionConfig(): Promise<void> {
    try {
      const regionService = SpotRegionService.getInstance()
      const defaultRegion = await regionService.getDefaultRegion()

      if (!defaultRegion) {
        logger.warn('No default region found in database, using environment config')
        this.validateConfig()
        return
      }

      // Update EC2 client with new region
      this.ec2 = new EC2Client({
        region: defaultRegion.regionCode,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID as string,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY as string,
        },
      })

      // Update configuration from database
      this.config = {
        imageId: defaultRegion.amiId,
        instanceType: process.env.SPOT_INSTANCE_TYPE as string,
        keyName: process.env.AWS_KEY_PAIR_NAME as string, // Still from env
        securityGroupIds: defaultRegion.securityGroupIds,
        maxPrice: defaultRegion.spotPrice.toString(),
        userData: this.generateUserData()
      }

      logger.info('Loaded spot configuration from database', {
        region: defaultRegion.regionCode,
        regionName: defaultRegion.regionName,
        amiId: defaultRegion.amiId,
        instanceType: this.config.instanceType,
        maxPrice: this.config.maxPrice,
        securityGroupCount: defaultRegion.securityGroupIds.length,
        availableInstanceTypes: defaultRegion.instanceTypes
      })

      this.validateConfig()
    } catch (error) {
      logger.error('Failed to load region config from database, using environment config', error)
      this.validateConfig()
    }
  }

  private startPeriodicRefresh(): void {
    // Reduced frequency since we now have EventBridge events
    // Refresh instance status every 10 minutes (backup to events)
    setInterval(async () => {
      try {
        await this.refreshInstanceStatus()
      } catch (error) {
        logger.error('Error during periodic instance refresh', error)
      }
    }, 600000) // 10 minutes
  }

  private async refreshInstanceStatus(): Promise<void> {
    try {
      // First, update existing instances in cache
      const cachedInstanceIds = Array.from(this.activeInstances.keys())
      logger.debug('Refreshing cached instance status', { instanceIds: cachedInstanceIds })

      for (const instanceId of cachedInstanceIds) {
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

      // Then, scan for new instances that might have been created (e.g., spot replacement)
      logger.debug('Scanning for new instances')
      await this.loadExistingInstances()

    } catch (error) {
      logger.error('Error refreshing instance status', error)
    }
  }

  private async loadExistingInstances(): Promise<void> {
    try {
      // Get all possible instance types from current region config
      const regionService = SpotRegionService.getInstance()
      const currentRegion = await regionService.getDefaultRegion()
      const instanceTypes = uniq([
        this.config.instanceType, ...(currentRegion?.instanceTypes || [])
      ])

      logger.debug('Searching for existing instances', {
        region: this.ec2.config.region,
        instanceTypes,
        keyName: this.config.keyName
      })

      // Find running instances with our configuration
      const command = new DescribeInstancesCommand({
        Filters: [
          {
            Name: 'instance-state-name',
            Values: ['running', 'pending', 'stopping']
          },
          {
            Name: 'instance-type',
            Values: instanceTypes
          },
          {
            Name: 'key-name',
            Values: [this.config.keyName]
          }
        ]
      })

      let response = await this.ec2.send(command)

      // If no instances found with current config, try broader search
      if (!response.Reservations || response.Reservations.length === 0) {
        logger.info('No instances found with current config, trying broader search...')

        const fallbackCommand = new DescribeInstancesCommand({
          Filters: [
            {
              Name: 'instance-state-name',
              Values: ['running', 'pending', 'stopping']
            },
            {
              Name: 'key-name',
              Values: [this.config.keyName]
            }
          ]
        })

        response = await this.ec2.send(fallbackCommand)
      }

      const instances: SpotInstanceInfo[] = []

      let newInstancesCount = 0
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

            // Only log if this is a new instance
            if (!this.activeInstances.has(instance.InstanceId)) {
              newInstancesCount++
              logger.info('Found new instance', {
                instanceId: instance.InstanceId,
                state: instanceInfo.state,
                publicIp: instanceInfo.publicIp
              })
            }

            this.activeInstances.set(instance.InstanceId, instanceInfo)
          }
        }
      }

      if (newInstancesCount > 0) {
        logger.info('Discovered new instances', {
          newInstancesCount,
          totalInstancesCount: instances.length
        })
      } else {
        logger.debug('No new instances found', {
          totalInstancesCount: instances.length
        })
      }

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
    // Download and run setup script from Git repo
    const script = `#!/bin/bash
set -e

# Set environment variables for setup script
export SPOT_AWS_REGION="${process.env.SPOT_AWS_REGION || process.env.AWS_REGION || 'eu-west-1'}"
export AWS_REGION="${process.env.AWS_REGION || 'eu-west-1'}"
export BACKEND_URL="${process.env.BACKEND_URL || 'http://localhost:3000'}"
export SQS_QUEUE_URL="${process.env.SQS_QUEUE_URL || ''}"
export GITHUB_REPO="${process.env.GITHUB_REPO || 'Sistemium/fluxer-claude'}"

# Download and run setup script from GitHub
# Choose script based on instance type
INSTANCE_TYPE="${process.env.SPOT_INSTANCE_TYPE}"
if [[ "\$INSTANCE_TYPE" == inf2* ]]; then
    SETUP_SCRIPT="setup-ai-instance-ubuntu-inf2.sh"
    echo "Downloading Ubuntu + Inferentia2 setup script from GitHub..."
else
    SETUP_SCRIPT="setup-ai-instance.sh"
    echo "Downloading GPU setup script from GitHub..."
fi

curl -fsSL https://raw.githubusercontent.com/\${GITHUB_REPO}/main/scripts/\$SETUP_SCRIPT -o /tmp/setup-ai-instance.sh
chmod +x /tmp/setup-ai-instance.sh

echo "Running setup script for \$INSTANCE_TYPE..."
/tmp/setup-ai-instance.sh

echo "Instance setup completed!"
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
                VolumeSize: Number(process.env.SPOT_VOLUME_SIZE || '75'), // GB - OS and FLUX model (24GB) 
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

  async launchSpotFleet(): Promise<SpotInstanceInfo> {
    try {
      logger.info('Launching spot fleet', {
        instanceTypes: [this.config.instanceType], // Fallback types
        maxPrice: this.config.maxPrice,
        imageId: this.config.imageId,
        keyName: this.config.keyName,
        securityGroupIds: this.config.securityGroupIds,
        region: this.ec2.config.region
      })

      // Use direct launch specification (simpler than launch templates)
      const fleetConfig = {
        SpotFleetRequestConfig: {
          IamFleetRole: `arn:aws:iam::${process.env.AWS_ACCOUNT_ID || '554658909973'}:role/aws-ec2-spot-fleet-tagging-role`,
          AllocationStrategy: 'lowestPrice' as const,
          TargetCapacity: 1,
          SpotPrice: this.config.maxPrice,
          LaunchSpecifications: [
            {
              ImageId: this.config.imageId,
              InstanceType: this.config.instanceType as any,
              KeyName: this.config.keyName,
              SecurityGroups: this.config.securityGroupIds.map(id => ({ GroupId: id })),
              UserData: this.config.userData,
              IamInstanceProfile: {
                Name: process.env.SPOT_IAM_INSTANCE_PROFILE || 'ai-service-role'
              },
              BlockDeviceMappings: [
                {
                  DeviceName: '/dev/sda1',
                  Ebs: {
                    VolumeSize: 100,
                    VolumeType: 'gp3' as const,
                    DeleteOnTermination: true
                  }
                }
              ]
            },
          ]
        }
      }

      const command = new RequestSpotFleetCommand(fleetConfig)
      const response = await this.ec2.send(command)

      if (!response.SpotFleetRequestId) {
        throw new Error('Failed to create spot fleet request')
      }

      logger.info('Spot fleet request created', {
        spotFleetId: response.SpotFleetRequestId
      })

      // Wait for fleet to launch instances
      const instanceInfo = await this.waitForSpotFleet(response.SpotFleetRequestId)

      // Store in active instances
      this.activeInstances.set(instanceInfo.instanceId, instanceInfo)

      logger.info('Spot fleet launched successfully', {
        instanceId: instanceInfo.instanceId,
        spotFleetId: instanceInfo.spotFleetId
      })

      return instanceInfo

    } catch (error) {
      logger.error('Failed to launch spot fleet', error)
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

  private async waitForSpotFleet(spotFleetId: string, maxWaitTime = 300000): Promise<SpotInstanceInfo> {
    const startTime = Date.now()

    while (Date.now() - startTime < maxWaitTime) {
      try {
        const command = new DescribeSpotFleetRequestsCommand({
          SpotFleetRequestIds: [spotFleetId]
        })

        const response = await this.ec2.send(command)
        const fleetRequest = response.SpotFleetRequestConfigs?.[0]

        if (fleetRequest?.SpotFleetRequestState === 'failed' || fleetRequest?.SpotFleetRequestState === 'cancelled') {
          throw new Error(`Spot fleet request failed: ${fleetRequest.SpotFleetRequestState}`)
        }

        if (fleetRequest?.SpotFleetRequestState === 'active') {
          // Get instances launched by the fleet
          const instancesCommand = new DescribeInstancesCommand({
            Filters: [
              {
                Name: 'tag:aws:ec2spot:fleet-request-id',
                Values: [spotFleetId]
              },
              {
                Name: 'instance-state-name',
                Values: ['running', 'pending']
              }
            ]
          })

          const instancesResponse = await this.ec2.send(instancesCommand)
          const instance = instancesResponse.Reservations?.[0]?.Instances?.[0]

          if (instance && instance.InstanceId) {
            const instanceInfo: SpotInstanceInfo = {
              instanceId: instance.InstanceId,
              spotRequestId: instance.SpotInstanceRequestId || '',
              spotFleetId: spotFleetId,
              state: instance.State?.Name || 'unknown',
              instanceType: instance.InstanceType || 'unknown',
              ...(instance.PublicIpAddress && { publicIp: instance.PublicIpAddress }),
              ...(instance.PrivateIpAddress && { privateIp: instance.PrivateIpAddress }),
              ...(instance.LaunchTime && { launchTime: instance.LaunchTime }),
              ...(instance.Placement?.AvailabilityZone && { availabilityZone: instance.Placement.AvailabilityZone })
            }

            return instanceInfo
          }
        }

        logger.info('Waiting for spot fleet to launch instances...', {
          spotFleetId,
          state: fleetRequest?.SpotFleetRequestState
        })

        await new Promise(resolve => setTimeout(resolve, 10000)) // Wait 10 seconds
      } catch (error: any) {
        logger.error('Error checking spot fleet status', error)
        throw error
      }
    }

    throw new Error('Timeout waiting for spot fleet to launch instances')
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

  /**
   * Handle EC2 state change events from EventBridge
   */
  async handleInstanceStateChange(instanceId: string, newState: string): Promise<void> {
    try {
      logger.info('Handling instance state change event', { instanceId, newState })

      // Check if this is one of our instances
      const existingInstance = this.activeInstances.get(instanceId)

      if (existingInstance) {
        // Update state in our cache
        existingInstance.state = newState
        this.activeInstances.set(instanceId, existingInstance)

        logger.info('Updated instance state in cache', { instanceId, newState })
      } else if (newState === 'running' || newState === 'pending') {
        // This might be a new instance we launched, try to discover it
        logger.info('New instance detected, triggering discovery', { instanceId, newState })
        await this.loadExistingInstances()
      }

      // Handle specific state changes
      switch (newState) {
        case 'running':
          await this.handleInstanceRunning(instanceId)
          break
        case 'terminated':
          await this.handleInstanceTerminated(instanceId)
          break
        case 'stopped':
          await this.handleInstanceStopped(instanceId)
          break
      }

    } catch (error) {
      logger.error('Error handling instance state change', { instanceId, newState, error })
    }
  }

  /**
   * Handle instance entering running state
   */
  private async handleInstanceRunning(instanceId: string): Promise<void> {
    try {
      logger.info('Instance entered running state', { instanceId })

      // Refresh instance info to get IP address
      const instanceInfo = await this.getInstanceInfo(instanceId)
      this.activeInstances.set(instanceId, instanceInfo)

      // Could add health check or notification here

    } catch (error) {
      logger.error('Error handling running instance', { instanceId, error })
    }
  }

  /**
   * Handle instance termination
   */
  private async handleInstanceTerminated(instanceId: string): Promise<void> {
    try {
      logger.info('Instance terminated, removing from active instances', { instanceId })

      // Remove from our cache
      this.activeInstances.delete(instanceId)

      // Could trigger automatic replacement here if needed

    } catch (error) {
      logger.error('Error handling terminated instance', { instanceId, error })
    }
  }

  /**
   * Handle instance stopping
   */
  private async handleInstanceStopped(instanceId: string): Promise<void> {
    try {
      logger.info('Instance stopped', { instanceId })

      // Update state but keep in cache for potential restart
      const existingInstance = this.activeInstances.get(instanceId)
      if (existingInstance) {
        existingInstance.state = 'stopped'
        this.activeInstances.set(instanceId, existingInstance)
      }

    } catch (error) {
      logger.error('Error handling stopped instance', { instanceId, error })
    }
  }
}