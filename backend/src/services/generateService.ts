// import { Image } from '../models/Image.js'
import logger from '../utils/logger.js'
import { SQSQueueService } from './sqsQueueService.js'

interface GenerationJobData {
  userId: string
  prompt: string
  width: number
  height: number
  guidance_scale: number
  num_inference_steps: number
  seed?: number
}

export class GenerateService {
  private static instance: GenerateService
  private sqsQueue: SQSQueueService

  constructor() {
    logger.info('GenerateService: Starting constructor')
    
    try {
      this.sqsQueue = SQSQueueService.getInstance()
      logger.info('GenerateService: SQS Queue Service initialized')
      
      // Start processing SQS messages
      this.sqsQueue.startProcessing()
      logger.info('GenerateService: SQS processing started')
      
    } catch (error) {
      logger.error('GenerateService: Error in constructor', error)
      throw error
    }
    
    logger.info('GenerateService: Constructor completed')
  }

  static getInstance(): GenerateService {
    if (!GenerateService.instance) {
      GenerateService.instance = new GenerateService()
    }
    return GenerateService.instance
  }

  async queueGeneration(data: GenerationJobData): Promise<string> {
    logger.info('GenerateService: Adding job to SQS queue', { data })
    
    try {
      const jobId = await this.sqsQueue.addJob(data)
      logger.info('GenerateService: Job added successfully', { jobId })
      return jobId
    } catch (error) {
      logger.error('GenerateService: Error adding job to SQS queue', error)
      throw error
    }
  }

  async getJobStatus(jobId: string, userId: string) {
    logger.info(`Getting job status for jobId: ${jobId}, userId: ${userId}`)
    
    try {
      const status = await this.sqsQueue.getJobStatus(jobId, userId)
      
      if (!status) {
        logger.info(`Job ${jobId} not found for user ${userId}`)
        return null
      }

      logger.info(`Job status retrieved`, { 
        jobId, 
        status: status.status 
      })

      return status
    } catch (error) {
      logger.error(`Error getting job status for ${jobId}`, error)
      throw error
    }
  }

  async getQueueStats() {
    try {
      const stats = await this.sqsQueue.getQueueStats()
      return stats
    } catch (error) {
      logger.error('Error getting queue stats', error)
      throw error
    }
  }
}