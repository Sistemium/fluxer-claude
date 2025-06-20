import { 
  EventBridgeClient, 
  PutEventsCommand,
  CreateEventBusCommand,
  DescribeEventBusCommand
} from '@aws-sdk/client-eventbridge'
import logger from '../utils/logger.js'
import { SocketService } from './socketService.js'
import { Image } from '../models/Image.js'

interface ProgressEvent {
  jobId: string
  userId: string
  progress: number
  message: string
  timestamp: string
}

interface CompletionEvent {
  jobId: string
  userId: string
  status: string
  timestamp: string
}

interface ErrorEvent {
  jobId: string
  userId: string
  error: string
  timestamp: string
}

export class EventBridgeService {
  private static instance: EventBridgeService
  private eventBridge: EventBridgeClient
  private eventBusName: string

  constructor() {
    this.eventBridge = new EventBridgeClient({
      region: process.env.AWS_REGION || 'eu-west-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID as string,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY as string,
      },
    })

    this.eventBusName = process.env.EVENTBRIDGE_BUS_NAME || 'fluxer-ai-events'
    
    logger.info('EventBridgeService initialized', { eventBusName: this.eventBusName })
  }

  static getInstance(): EventBridgeService {
    if (!EventBridgeService.instance) {
      EventBridgeService.instance = new EventBridgeService()
    }
    return EventBridgeService.instance
  }

  async ensureEventBusExists(): Promise<void> {
    try {
      // Check if event bus exists
      const describeCommand = new DescribeEventBusCommand({
        Name: this.eventBusName
      })
      
      await this.eventBridge.send(describeCommand)
      logger.info('EventBus already exists', { eventBusName: this.eventBusName })
    } catch (error: any) {
      if (error.name === 'ResourceNotFoundException') {
        // Create event bus
        try {
          const createCommand = new CreateEventBusCommand({
            Name: this.eventBusName
          })
          
          await this.eventBridge.send(createCommand)
          logger.info('EventBus created successfully', { eventBusName: this.eventBusName })
        } catch (createError) {
          logger.error('Failed to create EventBus', createError)
          throw createError
        }
      } else {
        logger.error('Error checking EventBus', error)
        throw error
      }
    }
  }

  async handleProgressEvent(event: ProgressEvent): Promise<void> {
    try {
      logger.info('Processing progress event', { 
        jobId: event.jobId, 
        progress: event.progress,
        message: event.message 
      })

      // Send WebSocket progress update to frontend
      const socketService = SocketService.getInstance()
      socketService.emitProgress(event.userId, event.jobId, event.progress, event.message)

      // Optionally update progress in database
      try {
        const image = await Image.findOne({ jobId: event.jobId, userId: event.userId })
        if (image) {
          // You could store progress in database if needed
          logger.debug('Progress event processed for existing job', { jobId: event.jobId })
        }
      } catch (dbError) {
        logger.warn('Failed to update progress in database', { jobId: event.jobId, dbError })
      }

    } catch (error) {
      logger.error('Failed to handle progress event', { event, error })
      throw error
    }
  }

  async handleCompletionEvent(event: CompletionEvent): Promise<void> {
    try {
      logger.info('Processing completion event', { 
        jobId: event.jobId, 
        userId: event.userId,
        status: event.status 
      })

      // Update image record in database (status only, imageUrl already set by SQS handler)
      const image = await Image.findOne({ jobId: event.jobId, userId: event.userId })
      if (image) {
        // Only update status if not already completed (SQS handler might have already processed this)
        if (image.status !== 'completed') {
          image.status = 'completed'
          await image.save()
          
          logger.info('Image status updated in database via EventBridge', { 
            jobId: event.jobId, 
            imageId: image._id 
          })
        } else {
          logger.debug('Image already marked as completed, skipping EventBridge update', {
            jobId: event.jobId
          })
        }
      } else {
        logger.warn('Job not found in database for completion event', { 
          jobId: event.jobId, 
          userId: event.userId 
        })
      }

      // Send WebSocket completion notification with image URL from database
      if (image && image.imageUrl) {
        const socketService = SocketService.getInstance()
        socketService.emitCompleted(event.userId, event.jobId, image.imageUrl)
      }

    } catch (error) {
      logger.error('Failed to handle completion event', { event, error })
      throw error
    }
  }

  async handleErrorEvent(event: ErrorEvent): Promise<void> {
    try {
      logger.error('Processing error event', { 
        jobId: event.jobId, 
        userId: event.userId,
        error: event.error 
      })

      // Update image record in database
      try {
        const image = await Image.findOne({ jobId: event.jobId, userId: event.userId })
        if (image) {
          image.status = 'failed'
          await image.save()
          
          logger.info('Image status updated to failed', { 
            jobId: event.jobId, 
            imageId: image._id 
          })
        }
      } catch (dbError) {
        logger.warn('Failed to update job status to failed', { jobId: event.jobId, dbError })
      }

      // Send WebSocket error notification
      const socketService = SocketService.getInstance()
      socketService.emitError(event.userId, event.jobId, event.error)

    } catch (error) {
      logger.error('Failed to handle error event', { event, error })
      throw error
    }
  }

  // Method to send events (mainly for testing, AI service will send directly)
  async sendProgressEvent(progress: ProgressEvent): Promise<void> {
    try {
      const command = new PutEventsCommand({
        Entries: [
          {
            Source: 'fluxer.ai-service',
            DetailType: 'AI Generation Progress',
            Detail: JSON.stringify(progress),
            EventBusName: this.eventBusName
          }
        ]
      })

      const result = await this.eventBridge.send(command)
      logger.info('Progress event sent to EventBridge', { 
        jobId: progress.jobId, 
        eventId: result.Entries?.[0]?.EventId 
      })
    } catch (error) {
      logger.error('Failed to send progress event', { progress, error })
      throw error
    }
  }

  async sendCompletionEvent(completion: CompletionEvent): Promise<void> {
    try {
      const command = new PutEventsCommand({
        Entries: [
          {
            Source: 'fluxer.ai-service',
            DetailType: 'AI Generation Completed',
            Detail: JSON.stringify(completion),
            EventBusName: this.eventBusName
          }
        ]
      })

      const result = await this.eventBridge.send(command)
      logger.info('Completion event sent to EventBridge', { 
        jobId: completion.jobId, 
        eventId: result.Entries?.[0]?.EventId 
      })
    } catch (error) {
      logger.error('Failed to send completion event', { completion, error })
      throw error
    }
  }

  async sendErrorEvent(errorEvent: ErrorEvent): Promise<void> {
    try {
      const command = new PutEventsCommand({
        Entries: [
          {
            Source: 'fluxer.ai-service',
            DetailType: 'AI Generation Failed',
            Detail: JSON.stringify(errorEvent),
            EventBusName: this.eventBusName
          }
        ]
      })

      const result = await this.eventBridge.send(command)
      logger.info('Error event sent to EventBridge', { 
        jobId: errorEvent.jobId, 
        eventId: result.Entries?.[0]?.EventId 
      })
    } catch (error) {
      logger.error('Failed to send error event', { errorEvent, error })
      throw error
    }
  }

  // Helper method to process any event from EventBridge webhook/Lambda
  async processEvent(eventDetail: any): Promise<void> {
    try {
      const { source, 'detail-type': detailType, detail } = eventDetail

      if (source !== 'fluxer.ai-service') {
        logger.debug('Ignoring event from different source', { source })
        return
      }

      switch (detailType) {
        case 'AI Generation Progress':
          await this.handleProgressEvent(detail as ProgressEvent)
          break
        case 'AI Generation Completed':
          await this.handleCompletionEvent(detail as CompletionEvent)
          break
        case 'AI Generation Failed':
          await this.handleErrorEvent(detail as ErrorEvent)
          break
        default:
          logger.warn('Unknown event type', { detailType, detail })
      }
    } catch (error) {
      logger.error('Failed to process event', { eventDetail, error })
      throw error
    }
  }

  getEventBusName(): string {
    return this.eventBusName
  }
}