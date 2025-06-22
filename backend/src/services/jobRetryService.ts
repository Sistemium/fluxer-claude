import logger from '../utils/logger.js'
import { IImage, Image } from '../models/Image.js'
import { SQSQueueService } from './sqsQueueService.js'
import { SpotInstanceService } from './spotInstanceService.js'

export class JobRetryService {
  private static instance: JobRetryService
  private retryInterval: NodeJS.Timeout | null = null
  private readonly RETRY_INTERVAL_MS = 60000 // 1 minute
  private readonly MAX_JOB_AGE_MS = 30 * 60 * 1000 // 30 minutes

  static getInstance(): JobRetryService {
    if (!JobRetryService.instance) {
      JobRetryService.instance = new JobRetryService()
    }
    return JobRetryService.instance
  }

  start(): void {
    if (this.retryInterval) {
      return
    }

    logger.info('Starting job retry service')
    this.retryInterval = setInterval(() => {
      this.retryStuckJobs()
    }, this.RETRY_INTERVAL_MS)

    // Run immediately
    this.retryStuckJobs()
  }

  stop(): void {
    if (this.retryInterval) {
      clearInterval(this.retryInterval)
      this.retryInterval = null
      logger.info('Job retry service stopped')
    }
  }

  private async retryStuckJobs(): Promise<void> {
    try {
      // Check if AI service is available
      const spotInstanceService = SpotInstanceService.getInstance()
      const aiServiceUrl = await spotInstanceService.getActiveAIServiceUrl()
      
      if (!aiServiceUrl || aiServiceUrl === 'http://localhost:8000') {
        logger.debug('No active AI service available, skipping retry')
        return
      }

      // Find jobs that are stuck in 'generating' status for too long
      const stuckJobsThreshold = new Date(Date.now() - this.MAX_JOB_AGE_MS)
      
      const stuckJobs = await Image.find({
        status: 'generating',
        createdAt: { $lt: stuckJobsThreshold },
        updatedAt: { $lt: stuckJobsThreshold }
      })

      if (stuckJobs.length > 0) {
        logger.info(`Found ${stuckJobs.length} stuck jobs to retry`)
        
        for (const job of stuckJobs) {
          await this.retryJob(job)
        }
      }

      // Also find jobs that are 'queued' for a while when AI service is available
      const queuedJobs = await Image.find({
        status: 'queued',
        createdAt: { $lt: new Date(Date.now() - 5 * 60 * 1000) } // 5 minutes old
      })

      if (queuedJobs.length > 0) {
        logger.info(`Found ${queuedJobs.length} queued jobs to retry`)
        
        for (const job of queuedJobs) {
          await this.retryJob(job)
        }
      }

    } catch (error) {
      logger.error('Error in job retry service', error)
    }
  }

  private async retryJob(job: IImage): Promise<void> {
    try {
      logger.info(`Retrying stuck job ${job.jobId}`, {
        status: job.status,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt
      })

      // Add to SQS queue for processing (will update status to 'generating')
      const sqsService = SQSQueueService.getInstance()
      await sqsService.addJob({
        jobId: job.jobId,
        userId: job.userId,
        prompt: job.prompt,
        width: job.width || 512,
        height: job.height || 512,
        guidance_scale: job.guidanceScale || 7.5,
        num_inference_steps: job.numInferenceSteps || 20,
        seed: job.seed || Math.floor(Math.random() * 1000000)
      })

      logger.info(`Successfully requeued job ${job.jobId}`)

    } catch (error) {
      logger.error(`Failed to retry job ${job.jobId}`, error)
      
      // Mark job as failed if retry fails
      try {
        job.status = 'failed'
        job.updatedAt = new Date()
        await job.save()
      } catch (saveError) {
        logger.error(`Failed to mark job ${job.jobId} as failed`, saveError)
      }
    }
  }

  // Manual retry for specific job
  async retryJobById(jobId: string): Promise<boolean> {
    try {
      const job: IImage | null = await Image.findOne({ jobId })
      if (!job) {
        logger.warn(`Job ${jobId} not found for manual retry`)
        return false
      }

      if (job.status === 'completed') {
        logger.info(`Job ${jobId} is already completed`)
        return false
      }

      await this.retryJob(job)
      return true

    } catch (error) {
      logger.error(`Failed to manually retry job ${jobId}`, error)
      return false
    }
  }
}