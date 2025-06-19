import AWS from 'aws-sdk'
import { Image } from '../models/Image.js'
import logger from '../utils/logger.js'
import axios from 'axios'
import { SocketService } from './socketService.js'
import { v4 as uuidv4 } from 'uuid'

interface GenerationJobData {
  userId: string
  jobId: string
  prompt: string
  width: number
  height: number
  guidance_scale: number
  num_inference_steps: number
  seed?: number
}

export class SQSQueueService {
  private static instance: SQSQueueService
  private sqs: AWS.SQS
  private queueUrl: string
  private isProcessing = false

  constructor() {
    // Configure AWS SQS
    this.sqs = new AWS.SQS({
      region: process.env.AWS_REGION || 'eu-north-1',
      accessKeyId: process.env.AWS_ACCESS_KEY_ID as string,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY as string
    })
    
    this.queueUrl = process.env.SQS_QUEUE_URL || ''
    if (!this.queueUrl) {
      throw new Error('SQS_QUEUE_URL environment variable is required')
    }
    
    logger.info('SQS Queue Service initialized', { queueUrl: this.queueUrl })
  }

  static getInstance(): SQSQueueService {
    if (!SQSQueueService.instance) {
      SQSQueueService.instance = new SQSQueueService()
    }
    return SQSQueueService.instance
  }

  async addJob(data: Omit<GenerationJobData, 'jobId'>): Promise<string> {
    const jobId = uuidv4()
    const jobData: GenerationJobData = { ...data, jobId }
    
    logger.info('Adding job to SQS queue', { jobId, userId: data.userId })
    
    try {
      const params = {
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(jobData),
        MessageAttributes: {
          jobType: {
            DataType: 'String',
            StringValue: 'image-generation'
          },
          userId: {
            DataType: 'String',
            StringValue: data.userId
          },
          jobId: {
            DataType: 'String',
            StringValue: jobId
          }
        }
      }
      
      const result = await this.sqs.sendMessage(params).promise()
      
      // Create image record in database
      const image = new Image({
        userId: data.userId,
        prompt: data.prompt,
        width: data.width,
        height: data.height,
        guidanceScale: data.guidance_scale,
        numInferenceSteps: data.num_inference_steps,
        seed: data.seed,
        jobId,
        status: 'generating'
      })
      await image.save()
      
      logger.info('Job added to SQS queue successfully', { 
        jobId, 
        messageId: result.MessageId,
        imageId: image._id
      })
      
      return jobId
    } catch (error) {
      logger.error('Error adding job to SQS queue', { jobId, error })
      throw error
    }
  }

  async startProcessing() {
    if (this.isProcessing) {
      logger.info('SQS processing already started')
      return
    }
    
    this.isProcessing = true
    logger.info('Starting SQS message processing')
    
    this.processMessages()
  }

  private async processMessages() {
    while (this.isProcessing) {
      try {
        const messages = await this.sqs.receiveMessage({
          QueueUrl: this.queueUrl,
          MaxNumberOfMessages: 1,
          VisibilityTimeout: 900, // 15 minutes for image generation
          WaitTimeSeconds: 20, // Long polling
          MessageAttributeNames: ['All']
        }).promise()
        
        if (messages.Messages && messages.Messages.length > 0) {
          for (const message of messages.Messages) {
            await this.processMessage(message)
          }
        }
      } catch (error) {
        logger.error('Error receiving SQS messages', error)
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 5000))
      }
    }
  }

  private async processMessage(message: AWS.SQS.Message) {
    let jobData: GenerationJobData
    
    try {
      jobData = JSON.parse(message.Body!)
      logger.info(`Processing SQS job ${jobData.jobId}`, { 
        userId: jobData.userId,
        prompt: jobData.prompt.substring(0, 50) + '...'
      })
    } catch (error) {
      logger.error('Failed to parse SQS message body', { 
        messageId: message.MessageId,
        error 
      })
      await this.deleteMessage(message)
      return
    }

    try {
      logger.info(`Starting AI service call for job ${jobData.jobId}`)

      // Call AI service
      const aiServiceUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000'
      logger.info(`Calling AI service for job ${jobData.jobId}`, { aiServiceUrl })
      
      const response = await axios.post(`${aiServiceUrl}/generate`, {
        user_id: jobData.userId,
        job_id: jobData.jobId,
        prompt: jobData.prompt,
        width: jobData.width,
        height: jobData.height,
        guidance_scale: jobData.guidance_scale,
        num_inference_steps: jobData.num_inference_steps,
        seed: jobData.seed
      }, { timeout: 900000 }) // 15 minute timeout

      logger.info(`AI service response for job ${jobData.jobId}`, {
        status: response.data.status,
        hasImageUrl: !!response.data.image_url
      })

      if (response.data.status === 'completed') {
        if (!response.data.image_url) {
          throw new Error('AI service completed but no image_url provided')
        }
        
        // Update image record with result
        const image = await Image.findOne({ jobId: jobData.jobId })
        if (image) {
          image.imageUrl = response.data.image_url
          image.status = 'completed'
          await image.save()
        }
        
        // Send WebSocket completion notification
        const socketService = SocketService.getInstance()
        socketService.emitCompleted(jobData.userId, jobData.jobId, response.data.image_url)
        
        logger.info(`Job ${jobData.jobId} completed successfully`)
        
        // Delete message from queue
        await this.deleteMessage(message)
        
      } else if (response.data.status === 'failed') {
        throw new Error(response.data.error || 'AI service failed to generate image')
      } else {
        throw new Error(`Unexpected AI service response status: ${response.data.status}`)
      }
      
    } catch (error) {
      logger.error(`Job ${jobData.jobId} failed`, error)
      
      // Update image record with failure
      try {
        const image = await Image.findOne({ jobId: jobData.jobId })
        if (image) {
          image.status = 'failed'
          await image.save()
        }
      } catch (dbError) {
        logger.error(`Error updating job ${jobData.jobId} status to failed`, dbError)
      }
      
      // Send WebSocket error notification
      const socketService = SocketService.getInstance()
      socketService.emitError(jobData.userId, jobData.jobId, (error as Error).message)
      
      // Delete message from queue (move to DLQ if configured)
      await this.deleteMessage(message)
    }
  }

  private async deleteMessage(message: AWS.SQS.Message) {
    try {
      await this.sqs.deleteMessage({
        QueueUrl: this.queueUrl,
        ReceiptHandle: message.ReceiptHandle!
      }).promise()
    } catch (error) {
      logger.error('Error deleting SQS message', error)
    }
  }

  async getQueueStats() {
    try {
      const attributes = await this.sqs.getQueueAttributes({
        QueueUrl: this.queueUrl,
        AttributeNames: [
          'ApproximateNumberOfMessages',
          'ApproximateNumberOfMessagesNotVisible',
          'ApproximateNumberOfMessagesDelayed'
        ]
      }).promise()
      
      return {
        messagesAvailable: parseInt(attributes.Attributes?.ApproximateNumberOfMessages || '0'),
        messagesInFlight: parseInt(attributes.Attributes?.ApproximateNumberOfMessagesNotVisible || '0'),
        messagesDelayed: parseInt(attributes.Attributes?.ApproximateNumberOfMessagesDelayed || '0')
      }
    } catch (error) {
      logger.error('Error getting queue stats', error)
      return null
    }
  }

  async getJobStatus(jobId: string, userId: string) {
    logger.info(`Getting job status for jobId: ${jobId}, userId: ${userId}`)
    
    try {
      // Check database for job status
      const image = await Image.findOne({ jobId, userId })
      
      if (!image) {
        logger.info(`Job ${jobId} not found for user ${userId}`)
        return null
      }

      logger.info(`Job found in database`, { 
        jobId, 
        status: image.status,
        imageId: image._id 
      })

      return {
        jobId,
        status: image.status,
        progress: image.status === 'completed' ? 100 : (image.status === 'generating' ? 50 : 0),
        image: image.status === 'completed' ? {
          id: image._id,
          imageUrl: image.imageUrl,
          prompt: image.prompt,
          createdAt: image.createdAt
        } : null,
        error: image.status === 'failed' ? 'Generation failed' : null
      }
    } catch (error) {
      logger.error(`Error getting job status for ${jobId}`, error)
      throw error
    }
  }

  stopProcessing() {
    this.isProcessing = false
    logger.info('SQS processing stopped')
  }
}