import { SQSClient, SendMessageCommand, ReceiveMessageCommand, DeleteMessageCommand, GetQueueAttributesCommand } from '@aws-sdk/client-sqs'
import type { Message } from '@aws-sdk/client-sqs'
import { Image } from '../models/Image.js'
import logger from '../utils/logger.js'
import axios from 'axios'
import { SocketService } from './socketService.js'
import { SpotInstanceService } from './spotInstanceService.js'
import { S3Service } from './s3Service.js'
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
  private sqs: SQSClient
  private queueUrl: string
  private isProcessing = false

  constructor() {
    // Configure AWS SQS v3
    this.sqs = new SQSClient({
      region: process.env.AWS_REGION || 'eu-north-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID as string,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY as string,
      },
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
      
      const command = new SendMessageCommand(params)
      const result = await this.sqs.send(command)
      
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
        const command = new ReceiveMessageCommand({
          QueueUrl: this.queueUrl,
          MaxNumberOfMessages: 1,
          VisibilityTimeout: 900, // 15 minutes for image generation
          WaitTimeSeconds: 20, // Long polling
          MessageAttributeNames: ['All']
        })
        const messages = await this.sqs.send(command)
        
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

  private async processMessage(message: Message) {
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

      // Get dynamic AI service URL from active Spot Instance
      const spotInstanceService = SpotInstanceService.getInstance()
      const aiServiceUrl = await spotInstanceService.getActiveAIServiceUrl() || 
                          process.env.AI_SERVICE_URL || 
                          'http://localhost:8000'
      
      if (!aiServiceUrl || aiServiceUrl === 'http://localhost:8000') {
        throw new Error('No active AI service instance available. Please start a Spot Instance.')
      }
      
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
        
        // If image_url is base64, upload to S3
        let finalImageUrl = response.data.image_url
        
        if (response.data.image_url.startsWith('data:image/')) {
          logger.info('Converting base64 image to S3 upload', { jobId: jobData.jobId })
          
          const s3Service = S3Service.getInstance()
          const uploadResult = await s3Service.uploadBase64Image(
            response.data.image_url,
            jobData.userId,
            jobData.jobId
          )
          
          if (uploadResult.success && uploadResult.url) {
            finalImageUrl = uploadResult.url
            logger.info('Image uploaded to S3 successfully', {
              jobId: jobData.jobId,
              s3Url: finalImageUrl
            })
          } else {
            logger.error('Failed to upload image to S3', {
              jobId: jobData.jobId,
              error: uploadResult.error
            })
            // Continue with base64 URL as fallback
          }
        }
        
        // Update image record with result
        const image = await Image.findOne({ jobId: jobData.jobId })
        if (image) {
          image.imageUrl = finalImageUrl
          image.status = 'completed'
          await image.save()
        }
        
        // Send WebSocket completion notification
        const socketService = SocketService.getInstance()
        socketService.emitCompleted(jobData.userId, jobData.jobId, finalImageUrl)
        
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

  private async deleteMessage(message: Message) {
    try {
      const command = new DeleteMessageCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: message.ReceiptHandle!
      })
      await this.sqs.send(command)
    } catch (error) {
      logger.error('Error deleting SQS message', error)
    }
  }

  async getQueueStats() {
    try {
      const command = new GetQueueAttributesCommand({
        QueueUrl: this.queueUrl,
        AttributeNames: [
          'ApproximateNumberOfMessages',
          'ApproximateNumberOfMessagesNotVisible',
          'ApproximateNumberOfMessagesDelayed'
        ]
      })
      const attributes = await this.sqs.send(command)
      
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
        imageId: image._id,
        hasImageUrl: !!image.imageUrl,
        imageUrl: image.imageUrl?.substring(0, 100) + '...' // Log first 100 chars
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