import { SpotInstanceService } from './spotInstanceService.js'
import { SQSQueueService } from './sqsQueueService.js'
import logger from '../utils/logger.js'

interface AutoScalerConfig {
  enabled: boolean
  checkInterval: number // milliseconds
  maxInstances: number
  scaleUpThreshold: number // messages in queue
  scaleDownThreshold: number // messages in queue
  cooldownPeriod: number // milliseconds
}

export class AutoScalerService {
  private static instance: AutoScalerService
  private config: AutoScalerConfig
  private isRunning = false
  private checkTimer?: NodeJS.Timeout
  private lastScaleAction = 0
  private spotService: SpotInstanceService
  private sqsService: SQSQueueService

  constructor() {
    this.config = {
      enabled: process.env.AUTO_SCALE_ENABLED === 'true',
      checkInterval: parseInt(process.env.AUTO_SCALE_CHECK_INTERVAL || '300000'), // 5 minutes
      maxInstances: parseInt(process.env.MAX_SPOT_INSTANCES || '3'),
      scaleUpThreshold: parseInt(process.env.SCALE_UP_THRESHOLD || '1'),
      scaleDownThreshold: parseInt(process.env.SCALE_DOWN_THRESHOLD || '0'),
      cooldownPeriod: parseInt(process.env.SCALE_COOLDOWN_PERIOD || '600000') // 10 minutes
    }

    this.spotService = SpotInstanceService.getInstance()
    this.sqsService = SQSQueueService.getInstance()

    logger.info('AutoScalerService initialized', { 
      enabled: this.config.enabled,
      checkInterval: this.config.checkInterval,
      maxInstances: this.config.maxInstances
    })
  }

  static getInstance(): AutoScalerService {
    if (!AutoScalerService.instance) {
      AutoScalerService.instance = new AutoScalerService()
    }
    return AutoScalerService.instance
  }

  start() {
    if (!this.config.enabled) {
      logger.info('Auto-scaling is disabled')
      return
    }

    if (this.isRunning) {
      logger.warn('Auto-scaler is already running')
      return
    }

    this.isRunning = true
    logger.info('Starting auto-scaler service')
    
    this.scheduleNextCheck()
  }

  stop() {
    if (!this.isRunning) {
      return
    }

    this.isRunning = false
    
    if (this.checkTimer) {
      clearTimeout(this.checkTimer)
      this.checkTimer = undefined as any
    }

    logger.info('Auto-scaler service stopped')
  }

  private scheduleNextCheck() {
    if (!this.isRunning) {
      return
    }

    this.checkTimer = setTimeout(async () => {
      try {
        await this.checkAndScale()
      } catch (error) {
        logger.error('Auto-scaling check failed', error)
      }
      
      // Schedule next check
      this.scheduleNextCheck()
    }, this.config.checkInterval)
  }

  private async checkAndScale() {
    try {
      // Get current state
      const queueStats = await this.sqsService.getQueueStats()
      const activeInstances = await this.spotService.getAllActiveInstances()
      const runningInstances = activeInstances.filter(i => i.state === 'running')
      const pendingInstances = activeInstances.filter(i => i.state === 'pending')

      const queueDepth = queueStats?.messagesAvailable || 0
      const currentTime = Date.now()
      const timeSinceLastAction = currentTime - this.lastScaleAction

      logger.info('Auto-scaling check', {
        queueDepth,
        runningInstances: runningInstances.length,
        pendingInstances: pendingInstances.length,
        totalInstances: activeInstances.length,
        timeSinceLastAction
      })

      // Check if we're in cooldown period
      if (timeSinceLastAction < this.config.cooldownPeriod) {
        logger.debug('Auto-scaling in cooldown period', {
          remaining: this.config.cooldownPeriod - timeSinceLastAction
        })
        return
      }

      // Scale up logic
      const shouldScaleUp = (
        queueDepth >= this.config.scaleUpThreshold &&
        activeInstances.length < this.config.maxInstances &&
        pendingInstances.length === 0 // Don't launch if we're already launching
      )

      if (shouldScaleUp) {
        await this.scaleUp(queueDepth)
        return
      }

      // Scale down logic
      const shouldScaleDown = (
        queueDepth <= this.config.scaleDownThreshold &&
        runningInstances.length > 0 &&
        this.allInstancesHealthy(runningInstances)
      )

      if (shouldScaleDown) {
        await this.scaleDown(runningInstances)
        return
      }

      // Health check - terminate unhealthy instances
      await this.cleanupUnhealthyInstances(activeInstances)

    } catch (error) {
      logger.error('Auto-scaling check failed', error)
    }
  }

  private async scaleUp(queueDepth: number) {
    try {
      logger.info('Scaling up - launching new spot fleet', { queueDepth })
      
      const instance = await this.spotService.launchSpotFleet()
      this.lastScaleAction = Date.now()
      
      logger.info('Auto-scaled up successfully', {
        instanceId: instance.instanceId,
        spotRequestId: instance.spotRequestId,
        queueDepth
      })
    } catch (error) {
      logger.error('Failed to scale up', error)
      throw error
    }
  }

  private async scaleDown(runningInstances: any[]) {
    try {
      // For now, terminate the oldest instance
      // In production, you might want more sophisticated logic
      const oldestInstance = runningInstances.reduce((oldest, current) => {
        const currentTime = current.launchTime || new Date(0)
        const oldestTime = oldest.launchTime || new Date(0)
        return (currentTime < oldestTime) ? current : oldest
      })

      logger.info('Scaling down - terminating instance', {
        instanceId: oldestInstance.instanceId,
        launchTime: oldestInstance.launchTime
      })

      await this.spotService.terminateInstance(oldestInstance.instanceId)
      this.lastScaleAction = Date.now()

      logger.info('Auto-scaled down successfully', {
        terminatedInstance: oldestInstance.instanceId
      })
    } catch (error) {
      logger.error('Failed to scale down', error)
      throw error
    }
  }

  private async allInstancesHealthy(instances: any[]): Promise<boolean> {
    if (instances.length === 0) {
      return true
    }

    try {
      const healthChecks = await Promise.all(
        instances.map(async (instance) => {
          try {
            return await this.spotService.checkInstanceHealth(instance.instanceId)
          } catch {
            return false
          }
        })
      )

      return healthChecks.every(healthy => healthy)
    } catch {
      return false
    }
  }

  private async cleanupUnhealthyInstances(instances: any[]) {
    const unhealthyInstances = []

    for (const instance of instances) {
      try {
        // Skip if instance is not running
        if (instance.state !== 'running') {
          continue
        }

        const isHealthy = await this.spotService.checkInstanceHealth(instance.instanceId)
        
        if (!isHealthy) {
          unhealthyInstances.push(instance)
        }
      } catch (error) {
        logger.warn('Health check failed for instance', {
          instanceId: instance.instanceId,
          error
        })
        unhealthyInstances.push(instance)
      }
    }

    // Terminate unhealthy instances
    for (const instance of unhealthyInstances) {
      try {
        logger.warn('Terminating unhealthy instance', {
          instanceId: instance.instanceId,
          state: instance.state
        })
        
        await this.spotService.terminateInstance(instance.instanceId)
      } catch (error) {
        logger.error('Failed to terminate unhealthy instance', {
          instanceId: instance.instanceId,
          error
        })
      }
    }
  }

  // Force scale up/down (for admin use)
  async forceScaleUp(): Promise<any> {
    if (!this.config.enabled) {
      throw new Error('Auto-scaling is disabled')
    }

    const activeInstances = await this.spotService.getAllActiveInstances()
    
    if (activeInstances.length >= this.config.maxInstances) {
      throw new Error(`Maximum instances limit reached (${this.config.maxInstances})`)
    }

    const instance = await this.spotService.launchSpotFleet()
    this.lastScaleAction = Date.now()
    
    return instance
  }

  async forceScaleDown(): Promise<void> {
    if (!this.config.enabled) {
      throw new Error('Auto-scaling is disabled')
    }

    const activeInstances = await this.spotService.getAllActiveInstances()
    const runningInstances = activeInstances.filter(i => i.state === 'running')

    if (runningInstances.length === 0) {
      throw new Error('No running instances to terminate')
    }

    // Terminate the newest instance (to preserve work on older instances)
    const newestInstance = runningInstances.reduce((newest, current) => {
      const currentTime = current.launchTime || new Date(0)
      const newestTime = newest.launchTime || new Date(0)
      return (currentTime > newestTime) ? current : newest
    })

    await this.spotService.terminateInstance(newestInstance.instanceId)
    this.lastScaleAction = Date.now()
  }

  getStatus() {
    return {
      enabled: this.config.enabled,
      running: this.isRunning,
      config: this.config,
      lastScaleAction: this.lastScaleAction,
      nextCheckIn: this.checkTimer ? this.config.checkInterval : null
    }
  }

  updateConfig(newConfig: Partial<AutoScalerConfig>) {
    this.config = { ...this.config, ...newConfig }
    logger.info('Auto-scaler configuration updated', this.config)
  }
}