import Bull from 'bull'
import { Image } from '../models/Image.js'
import logger from '../utils/logger.js'
import axios from 'axios'

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
  private queue: Bull.Queue

  constructor() {
    logger.info('GenerateService: Starting constructor')
    
    // Parse Redis URL or use individual host/port
    let redisConfig: any
    if (process.env.REDIS_URL) {
      const url = new URL(process.env.REDIS_URL)
      redisConfig = {
        host: url.hostname,
        port: parseInt(url.port || '6379'),
        connectTimeout: 10000,
        lazyConnect: true,
        maxRetriesPerRequest: 3
      }
    } else {
      redisConfig = {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        connectTimeout: 10000,
        lazyConnect: true,
        maxRetriesPerRequest: 3
      }
    }
    
    logger.info('GenerateService: Redis config', redisConfig)
    
    try {
      logger.info('GenerateService: Creating Bull queue instance')
      this.queue = new Bull('image generation', {
        redis: redisConfig
      })
      
      logger.info('GenerateService: Bull queue instance created')
      
      // Test if queue is ready
      this.queue.on('ready', () => {
        logger.info('GenerateService: Bull queue is ready')
      })
      
      this.queue.on('error', (error) => {
        logger.error('GenerateService: Bull queue error', error)
      })
      
      logger.info('GenerateService: Setting up queue processing')
      this.setupQueueProcessing()
      logger.info('GenerateService: Queue processing setup complete')
      
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

  private setupQueueProcessing() {
    logger.info('Setting up queue processing...')
    
    // Set concurrency to 1 to process jobs one at a time
    this.queue.process(1, async (job) => {
      logger.info(`Processing job ${job.id} started`, { data: job.data })
      const { userId, prompt, width, height, guidance_scale, num_inference_steps, seed } = job.data as GenerationJobData

      try {
        logger.info(`Creating image record for job ${job.id}`)
        // Create image record in database
        const image = new Image({
          userId,
          prompt,
          width,
          height,
          guidanceScale: guidance_scale,
          numInferenceSteps: num_inference_steps,
          seed,
          jobId: job.id,
          status: 'generating'
        })
        await image.save()
        logger.info(`Image record created for job ${job.id}`, { imageId: image._id })

        // Call real AI service
        const aiServiceUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000'
        logger.info(`Calling AI service at ${aiServiceUrl} for job ${job.id}`)
        
        // Use axios directly
        
        const response = await axios.post(`${aiServiceUrl}/generate`, {
          user_id: userId,
          prompt,
          width,
          height,
          guidance_scale,
          num_inference_steps,
          seed
        }, { timeout: 300000 }) // 5 minute timeout

        logger.info(`AI service response for job ${job.id}:`, {
          status: response.data.status,
          message: response.data.message,
          hasImageUrl: !!response.data.image_url,
          imageUrlLength: response.data.image_url?.length || 0
        })

        if (response.data.status === 'completed') {
          // Update image record with result
          if (!response.data.image_url) {
            throw new Error('AI service completed but no image_url provided')
          }
          
          image.imageUrl = response.data.image_url
          image.status = 'completed'
          await image.save()
          
          logger.info(`Image generation completed for job ${job.id}`, { 
            imageUrlStart: response.data.image_url.substring(0, 50) + '...'
          })
          return { success: true, imageUrl: response.data.image_url }
        } else if (response.data.status === 'failed') {
          throw new Error(response.data.error || 'AI service failed to generate image')
        } else {
          throw new Error(`Unexpected AI service response status: ${response.data.status}`)
        }
        
      } catch (error) {
        logger.error(`Image generation failed for job ${job.id}:`, error)
        
        // Update image record with failure
        const image = await Image.findOne({ jobId: job.id })
        if (image) {
          image.status = 'failed'
          await image.save()
        }
        
        throw error
      }
    })

    this.queue.on('completed', (job) => {
      logger.info(`Job ${job.id} completed successfully`)
    })

    this.queue.on('failed', (job, err) => {
      logger.error(`Job ${job.id} failed:`, err)
    })
  }

  async queueGeneration(data: GenerationJobData): Promise<Bull.Job> {
    logger.info('GenerateService: Adding job to queue', { data })
    
    try {
      logger.info('GenerateService: Calling queue.add...')
      
      // Add timeout to the queue operation
      const addJobPromise = this.queue.add(data, {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000
        }
      })
      
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Queue add operation timed out after 15 seconds')), 15000)
      })
      
      const job = await Promise.race([addJobPromise, timeoutPromise])
      
      logger.info('GenerateService: Job added successfully', { jobId: job.id })
      
      // Force queue to process pending jobs
      logger.info('GenerateService: Starting queue processing')
      this.queue.resume()
      
      return job
    } catch (error) {
      logger.error('GenerateService: Error adding job to queue', error)
      throw error
    }
  }

  async getJobStatus(jobId: string, userId: string) {
    logger.info(`Getting job status for jobId: ${jobId}, userId: ${userId}`)
    
    try {
      const job = await this.queue.getJob(jobId)
      logger.info(`Job found in queue:`, { found: !!job, jobId })
      
      if (!job) {
        logger.info(`Job ${jobId} not found in queue`)
        return null
      }

      logger.info(`Job data:`, { jobData: job.data })

      // Check if job belongs to user
      if (job.data.userId !== userId) {
        logger.info(`Job ${jobId} does not belong to user ${userId}`)
        return null
      }

      const image = await Image.findOne({ jobId })
      logger.info(`Image found in database:`, { found: !!image, jobId })

      const jobState = await job.getState()
      logger.info(`Job state:`, { jobId, state: jobState })

      // Determine actual status based on image record
      let actualStatus = jobState
      if (image) {
        if (image.status === 'completed') {
          actualStatus = 'completed'
        } else if (image.status === 'generating') {
          actualStatus = 'active'
        } else if (image.status === 'failed') {
          actualStatus = 'failed'
        }
      }

      logger.info(`Actual status determined:`, { jobId, bullStatus: jobState, imageStatus: image?.status, actualStatus })

      return {
        jobId,
        status: actualStatus,
        progress: actualStatus === 'completed' ? 100 : (actualStatus === 'active' ? 50 : 0),
        image: image ? {
          id: image._id,
          imageUrl: image.imageUrl,
          prompt: image.prompt,
          createdAt: image.createdAt
        } : null,
        error: job.failedReason
      }
    } catch (error) {
      logger.error(`Error getting job status for ${jobId}:`, error)
      throw error
    }
  }

  async forceProcessJob(jobId: string) {
    logger.info(`Force processing job ${jobId}`)
    try {
      const job = await this.queue.getJob(jobId)
      if (!job) {
        logger.error(`Job ${jobId} not found for force processing`)
        return
      }

      logger.info(`Found job ${jobId}, forcing processing`)
      
      // Manually trigger job processing using the same logic as regular processing
      const { userId, prompt, width, height, guidance_scale, num_inference_steps, seed } = job.data as GenerationJobData

      // Create image record in database if it doesn't exist
      let image = await Image.findOne({ jobId })
      if (!image) {
        image = new Image({
          userId,
          prompt,
          width,
          height,
          guidanceScale: guidance_scale,
          numInferenceSteps: num_inference_steps,
          seed,
          jobId: job.id,
          status: 'generating'
        })
        await image.save()
        logger.info(`Image record created for job ${jobId}`, { imageId: image._id })
      }

      // Call real AI service
      const aiServiceUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000'
      logger.info(`Calling AI service at ${aiServiceUrl} for job ${jobId}`)
      
      // Use axios directly
      
      const response = await axios.post(`${aiServiceUrl}/generate`, {
        user_id: userId,
        prompt,
        width,
        height,
        guidance_scale,
        num_inference_steps,
        seed
      }, { timeout: 300000 }) // 5 minute timeout

      logger.info(`AI service response for job ${jobId}:`, {
        status: response.data.status,
        message: response.data.message,
        hasImageUrl: !!response.data.image_url,
        imageUrlLength: response.data.image_url?.length || 0
      })

      if (response.data.status === 'completed') {
        // Update image record with result
        if (!response.data.image_url) {
          throw new Error('AI service completed but no image_url provided')
        }
        
        image.imageUrl = response.data.image_url
        image.status = 'completed'
        await image.save()
        
        logger.info(`Image generation completed for job ${jobId}`, { 
          imageUrlStart: response.data.image_url.substring(0, 50) + '...'
        })
        
        // Mark job as completed in Bull queue
        try {
          const jobState = await job.getState()
          logger.info(`Job ${jobId} current state before completion: ${jobState}`)
          
          if (jobState === 'active' || jobState === 'waiting') {
            await job.moveToCompleted(JSON.stringify({ success: true, imageUrl: response.data.image_url }), true)
            logger.info(`Job ${jobId} marked as completed in Bull queue`)
          } else {
            logger.info(`Job ${jobId} already in final state: ${jobState}, skipping completion`)
          }
        } catch (error: any) {
          logger.warn(`Could not mark job ${jobId} as completed (may already be finished):`, error.message)
        }
      } else if (response.data.status === 'failed') {
        image.status = 'failed'
        await image.save()
        throw new Error(response.data.error || 'AI service failed to generate image')
      } else {
        throw new Error(`Unexpected AI service response status: ${response.data.status}`)
      }
      
    } catch (error) {
      logger.error(`Error force processing job ${jobId}:`, error)
      
      // Update image record with failure
      try {
        const image = await Image.findOne({ jobId })
        if (image && image.status !== 'completed') {
          image.status = 'failed'
          await image.save()
          logger.info(`Marked job ${jobId} as failed in database`)
        }
      } catch (dbError) {
        logger.error(`Error updating job ${jobId} status to failed:`, dbError)
      }
    }
  }
}