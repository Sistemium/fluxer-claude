import { Server } from 'socket.io'
import { createServer } from 'http'
import type Koa from 'koa'
import logger from '../utils/logger.js'

export class SocketService {
  private static instance: SocketService
  private io: Server | null = null
  
  static getInstance(): SocketService {
    if (!SocketService.instance) {
      SocketService.instance = new SocketService()
    }
    return SocketService.instance
  }

  initialize(app: Koa) {
    const server = createServer(app.callback())
    
    this.io = new Server(server, {
      cors: {
        origin: process.env.FRONTEND_URL || "http://localhost:3000",
        methods: ["GET", "POST"],
        credentials: true
      }
    })

    this.io.on('connection', (socket) => {
      logger.info(`WebSocket client connected: ${socket.id}`)
      
      // Join user-specific room
      socket.on('join', (userId: string) => {
        socket.join(`user:${userId}`)
        logger.info(`User ${userId} joined room with socket ${socket.id}`)
      })

      socket.on('disconnect', () => {
        logger.info(`WebSocket client disconnected: ${socket.id}`)
      })
    })

    return server
  }

  // Send progress update to specific user
  emitProgress(userId: string, jobId: string, progress: number, message?: string) {
    if (!this.io) return
    
    const progressData = {
      jobId: String(jobId), // Ensure jobId is always a string
      progress,
      message,
      timestamp: new Date().toISOString()
    }
    
    this.io.to(`user:${userId}`).emit('generation:progress', progressData)
    
    logger.info(`Sent progress to user ${userId}: job ${jobId} - ${progress}%`, { progressData })
  }

  // Send completion notification
  emitCompleted(userId: string, jobId: string, imageUrl: string) {
    if (!this.io) return
    
    this.io.to(`user:${userId}`).emit('generation:completed', {
      jobId: String(jobId),
      imageUrl,
      timestamp: new Date().toISOString()
    })
    
    logger.info(`Sent completion to user ${userId}: job ${jobId}`)
  }

  // Send error notification
  emitError(userId: string, jobId: string, error: string) {
    if (!this.io) return
    
    this.io.to(`user:${userId}`).emit('generation:error', {
      jobId: String(jobId),
      error,
      timestamp: new Date().toISOString()
    })
    
    logger.info(`Sent error to user ${userId}: job ${jobId} - ${error}`)
  }
}