import Router from 'koa-router'
import logger from '../utils/logger.js'
import { SocketService } from '../services/socketService.js'
import { EventBridgeService } from '../services/eventBridgeService.js'

export const internalRoutes = new Router()

// Internal endpoint for AI service to send progress updates (legacy - kept for compatibility)
internalRoutes.post('/progress', async (ctx: any) => {
  try {
    const { user_id, job_id, progress, message } = ctx.request.body
    
    if (!user_id || !job_id || progress === undefined) {
      ctx.status = 400
      ctx.body = { error: 'Missing required fields: user_id, job_id, progress' }
      return
    }
    
    // Send progress update via WebSocket
    const socketService = SocketService.getInstance()
    socketService.emitProgress(user_id, job_id, progress, message)
    
    logger.info(`Progress update sent: user ${user_id}, job ${job_id}, progress ${progress}%`)
    
    ctx.status = 200
    ctx.body = { success: true }
  } catch (error) {
    logger.error('Error handling progress update:', error)
    ctx.status = 500
    ctx.body = { error: 'Failed to process progress update' }
  }
})

// EventBridge webhook endpoint
internalRoutes.post('/eventbridge/webhook', async (ctx: any) => {
  try {
    const { Records } = ctx.request.body as { Records?: any[] }
    
    if (!Records || !Array.isArray(Records)) {
      ctx.status = 400
      ctx.body = { error: 'Invalid EventBridge payload' }
      return
    }

    logger.info('Received EventBridge webhook', { recordCount: Records.length })
    
    const eventBridge = EventBridgeService.getInstance()
    
    // Process each event record
    for (const record of Records) {
      try {
        await eventBridge.processEvent(record)
      } catch (error) {
        logger.error('Failed to process EventBridge record', { record, error })
        // Continue processing other records even if one fails
      }
    }
    
    ctx.body = { 
      success: true, 
      processed: Records.length,
      timestamp: new Date().toISOString()
    }
  } catch (error) {
    logger.error('EventBridge webhook error', error)
    ctx.status = 500
    ctx.body = { error: 'Failed to process EventBridge webhook' }
  }
})

// Test endpoint for EventBridge events (for development)
internalRoutes.post('/eventbridge/test', async (ctx: any) => {
  try {
    const { type, data } = ctx.request.body as { type: string, data: any }
    
    const eventBridge = EventBridgeService.getInstance()
    
    // Simulate EventBridge event format
    const testEvent = {
      source: 'fluxer.ai-service',
      'detail-type': type,
      detail: data
    }
    
    await eventBridge.processEvent(testEvent)
    
    ctx.body = { 
      success: true, 
      message: 'Test event processed',
      event: testEvent 
    }
  } catch (error) {
    logger.error('EventBridge test error', error)
    ctx.status = 500
    ctx.body = { error: 'Failed to process test event' }
  }
})