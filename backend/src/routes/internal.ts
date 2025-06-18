import Router from 'koa-router'
import logger from '../utils/logger.js'
import { SocketService } from '../services/socketService.js'

export const internalRoutes = new Router()

// Internal endpoint for AI service to send progress updates
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