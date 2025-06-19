import Router from 'koa-router'
import { Context } from 'koa'
import { SpotInstanceService } from '../services/spotInstanceService.js'
import { SQSQueueService } from '../services/sqsQueueService.js'
import { AutoScalerService } from '../services/autoScalerService.js'
import logger from '../utils/logger.js'
import { verifySession } from 'supertokens-node/recipe/session/framework/koa/index.js'

const router = new Router()

// Admin middleware - check if user has admin rights
async function requireAdmin(ctx: Context, next: () => Promise<void>) {
  try {
    // Get user ID from SuperTokens session
    const session = ctx.session
    if (!session) {
      ctx.status = 401
      ctx.body = { error: 'Authentication required' }
      return
    }
    
    const userId = session.getUserId()
    const adminUsers = (process.env.ADMIN_USER_IDS || '').split(',').filter(Boolean)
    
    if (!adminUsers.includes(userId)) {
      ctx.status = 403
      ctx.body = { error: 'Admin access required' }
      return
    }
    
    // Store userId in context for use in handlers
    ctx.state.userId = userId
    
    await next()
  } catch (error) {
    logger.error('Admin middleware error:', error)
    ctx.status = 401
    ctx.body = { error: 'Invalid session' }
  }
}

// Get spot instance status
router.get('/spot/status', verifySession(), requireAdmin, async (ctx: Context) => {
  try {
    const spotService = SpotInstanceService.getInstance()
    const instances = await spotService.getAllActiveInstances()
    const queueService = SQSQueueService.getInstance()
    const queueStats = await queueService.getQueueStats()

    ctx.body = {
      instances: instances.map(instance => ({
        instanceId: instance.instanceId,
        state: instance.state,
        publicIp: instance.publicIp,
        launchTime: instance.launchTime,
        spotPrice: instance.spotPrice,
        availabilityZone: instance.availabilityZone
      })),
      queueStats,
      config: {
        instanceType: spotService.getConfig().instanceType,
        maxPrice: spotService.getConfig().maxPrice,
        activeCount: spotService.getActiveInstancesCount()
      }
    }
  } catch (error) {
    logger.error('Failed to get spot status', error)
    ctx.status = 500
    ctx.body = { error: 'Failed to get spot instance status' }
  }
})

// Launch new spot instance
router.post('/spot/launch', verifySession(), requireAdmin, async (ctx: Context) => {
  try {
    const spotService = SpotInstanceService.getInstance()
    
    // Check if we already have instances running
    const activeInstances = await spotService.getAllActiveInstances()
    const runningInstances = activeInstances.filter(i => i.state === 'running')
    
    if (runningInstances.length > 0) {
      ctx.status = 400
      ctx.body = { error: 'Spot instance already running', instances: runningInstances }
      return
    }

    logger.info('Admin launching spot instance', { userId: ctx.state.userId })
    
    const instance = await spotService.launchSpotInstance()
    
    ctx.body = {
      success: true,
      message: 'Spot instance launch initiated',
      instance: {
        instanceId: instance.instanceId,
        spotRequestId: instance.spotRequestId,
        state: instance.state
      }
    }
  } catch (error) {
    logger.error('Failed to launch spot instance', error)
    ctx.status = 500
    ctx.body = { error: (error as Error).message || 'Failed to launch spot instance' }
  }
})

// Terminate spot instance
router.post('/spot/terminate', verifySession(), requireAdmin, async (ctx: Context) => {
  try {
    const { instanceId } = ctx.request.body as { instanceId: string }
    
    if (!instanceId) {
      ctx.status = 400
      ctx.body = { error: 'instanceId is required' }
      return
    }

    const spotService = SpotInstanceService.getInstance()
    
    logger.info('Admin terminating spot instance', { 
      userId: ctx.state.userId, 
      instanceId 
    })
    
    await spotService.terminateInstance(instanceId)
    
    ctx.body = {
      success: true,
      message: 'Spot instance terminated',
      instanceId
    }
  } catch (error) {
    logger.error('Failed to terminate spot instance', error)
    ctx.status = 500
    ctx.body = { error: (error as Error).message || 'Failed to terminate spot instance' }
  }
})

// Check AI service health on specific instance
router.get('/ai/health/:instanceId', verifySession(), requireAdmin, async (ctx: Context) => {
  try {
    const { instanceId } = ctx.params
    const spotService = SpotInstanceService.getInstance()
    
    const isHealthy = await spotService.checkInstanceHealth(instanceId)
    const instanceInfo = await spotService.getInstanceInfo(instanceId)
    
    ctx.body = {
      instanceId,
      healthy: isHealthy,
      state: instanceInfo.state,
      publicIp: instanceInfo.publicIp,
      lastChecked: new Date().toISOString()
    }
  } catch (error) {
    logger.error('Failed to check AI service health', error)
    ctx.status = 500
    ctx.body = { error: 'Failed to check AI service health' }
  }
})

// Get queue statistics
router.get('/queue/stats', verifySession(), requireAdmin, async (ctx: Context) => {
  try {
    const queueService = SQSQueueService.getInstance()
    const stats = await queueService.getQueueStats()
    
    ctx.body = {
      stats,
      timestamp: new Date().toISOString()
    }
  } catch (error) {
    logger.error('Failed to get queue stats', error)
    ctx.status = 500
    ctx.body = { error: 'Failed to get queue statistics' }
  }
})

// Auto-scaling logic - launch instance based on queue depth
router.post('/spot/auto-scale', verifySession(), requireAdmin, async (ctx: Context) => {
  try {
    const spotService = SpotInstanceService.getInstance()
    const queueService = SQSQueueService.getInstance()
    
    const queueStats = await queueService.getQueueStats()
    const activeInstances = await spotService.getAllActiveInstances()
    const runningInstances = activeInstances.filter(i => i.state === 'running')
    
    const queueDepth = queueStats?.messagesAvailable || 0
    const shouldScale = queueDepth > 0 && runningInstances.length === 0
    
    logger.info('Auto-scale check', { 
      queueDepth, 
      runningInstances: runningInstances.length,
      shouldScale 
    })
    
    if (shouldScale) {
      const instance = await spotService.launchSpotInstance()
      
      ctx.body = {
        action: 'launched',
        message: 'Auto-scaled up due to queue depth',
        queueDepth,
        instance: {
          instanceId: instance.instanceId,
          spotRequestId: instance.spotRequestId
        }
      }
    } else {
      ctx.body = {
        action: 'none',
        message: 'No scaling needed',
        queueDepth,
        runningInstances: runningInstances.length
      }
    }
  } catch (error) {
    logger.error('Auto-scaling failed', error)
    ctx.status = 500
    ctx.body = { error: 'Auto-scaling failed' }
  }
})

// Auto-scaler management endpoints

// Get auto-scaler status
router.get('/autoscaler/status', verifySession(), requireAdmin, async (ctx: Context) => {
  try {
    const autoScaler = AutoScalerService.getInstance()
    const status = autoScaler.getStatus()
    
    ctx.body = status
  } catch (error) {
    logger.error('Failed to get auto-scaler status', error)
    ctx.status = 500
    ctx.body = { error: 'Failed to get auto-scaler status' }
  }
})

// Start auto-scaler
router.post('/autoscaler/start', verifySession(), requireAdmin, async (ctx: Context) => {
  try {
    const autoScaler = AutoScalerService.getInstance()
    autoScaler.start()
    
    logger.info('Auto-scaler started by admin', { userId: ctx.state.userId })
    
    ctx.body = {
      success: true,
      message: 'Auto-scaler started'
    }
  } catch (error) {
    logger.error('Failed to start auto-scaler', error)
    ctx.status = 500
    ctx.body = { error: 'Failed to start auto-scaler' }
  }
})

// Stop auto-scaler
router.post('/autoscaler/stop', verifySession(), requireAdmin, async (ctx: Context) => {
  try {
    const autoScaler = AutoScalerService.getInstance()
    autoScaler.stop()
    
    logger.info('Auto-scaler stopped by admin', { userId: ctx.state.userId })
    
    ctx.body = {
      success: true,
      message: 'Auto-scaler stopped'
    }
  } catch (error) {
    logger.error('Failed to stop auto-scaler', error)
    ctx.status = 500
    ctx.body = { error: 'Failed to stop auto-scaler' }
  }
})

// Force scale up
router.post('/autoscaler/scale-up', verifySession(), requireAdmin, async (ctx: Context) => {
  try {
    const autoScaler = AutoScalerService.getInstance()
    const instance = await autoScaler.forceScaleUp()
    
    logger.info('Forced scale up by admin', { 
      userId: ctx.state.userId,
      instanceId: instance.instanceId 
    })
    
    ctx.body = {
      success: true,
      message: 'Forced scale up initiated',
      instance: {
        instanceId: instance.instanceId,
        spotRequestId: instance.spotRequestId
      }
    }
  } catch (error) {
    logger.error('Failed to force scale up', error)
    ctx.status = 500
    ctx.body = { error: (error as Error).message || 'Failed to force scale up' }
  }
})

// Force scale down
router.post('/autoscaler/scale-down', verifySession(), requireAdmin, async (ctx: Context) => {
  try {
    const autoScaler = AutoScalerService.getInstance()
    await autoScaler.forceScaleDown()
    
    logger.info('Forced scale down by admin', { userId: ctx.state.userId })
    
    ctx.body = {
      success: true,
      message: 'Forced scale down initiated'
    }
  } catch (error) {
    logger.error('Failed to force scale down', error)
    ctx.status = 500
    ctx.body = { error: (error as Error).message || 'Failed to force scale down' }
  }
})

// Webhook endpoint for spot instance notifications
router.post('/spot/notify', async (ctx: Context) => {
  try {
    const { instanceId, status, message } = ctx.request.body as {
      instanceId: string
      status: string
      message?: string
    }
    
    logger.info('Spot instance notification', { instanceId, status, message })
    
    // Handle different notification types
    switch (status) {
      case 'ready':
        logger.info('Spot instance is ready for work', { instanceId })
        break
      case 'terminating':
        logger.warn('Spot instance terminating', { instanceId, message })
        // Could implement graceful shutdown logic here
        break
      case 'error':
        logger.error('Spot instance error', { instanceId, message })
        break
    }
    
    ctx.body = { received: true }
  } catch (error) {
    logger.error('Failed to process spot notification', error)
    ctx.status = 500
    ctx.body = { error: 'Failed to process notification' }
  }
})

export default router