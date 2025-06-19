import { GenerateService } from '../services/generateService'
import { SQSQueueService } from '../services/sqsQueueService'

// Mock SQSQueueService
jest.mock('../services/sqsQueueService')
const MockSQSQueueService = SQSQueueService as jest.MockedClass<typeof SQSQueueService>

// Mock logger
jest.mock('../utils/logger.js', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}))

describe('GenerateService', () => {
  let generateService: GenerateService
  let mockSQSInstance: jest.Mocked<SQSQueueService>

  beforeEach(() => {
    // Create mock instance
    mockSQSInstance = {
      addJob: jest.fn(),
      getJobStatus: jest.fn(),
      getQueueStats: jest.fn(),
      startProcessing: jest.fn(),
      stopProcessing: jest.fn(),
    } as any

    // Mock SQSQueueService.getInstance()
    MockSQSQueueService.getInstance = jest.fn().mockReturnValue(mockSQSInstance)

    generateService = new GenerateService()
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('queueGeneration', () => {
    it('should queue generation job successfully', async () => {
      const mockJobId = 'test-job-id-123'
      mockSQSInstance.addJob.mockResolvedValue(mockJobId)

      const jobData = {
        userId: 'test-user-id',
        prompt: 'test prompt',
        width: 512,
        height: 512,
        guidance_scale: 7.5,
        num_inference_steps: 50,
      }

      const result = await generateService.queueGeneration(jobData)

      expect(result).toBe(mockJobId)
      expect(mockSQSInstance.addJob).toHaveBeenCalledWith(jobData)
      expect(mockSQSInstance.addJob).toHaveBeenCalledTimes(1)
    })

    it('should handle errors when queueing generation', async () => {
      const mockError = new Error('SQS Queue Error')
      mockSQSInstance.addJob.mockRejectedValue(mockError)

      const jobData = {
        userId: 'test-user-id',
        prompt: 'test prompt',
        width: 512,
        height: 512,
        guidance_scale: 7.5,
        num_inference_steps: 50,
      }

      await expect(generateService.queueGeneration(jobData)).rejects.toThrow('SQS Queue Error')
      expect(mockSQSInstance.addJob).toHaveBeenCalledWith(jobData)
    })
  })

  describe('getJobStatus', () => {
    it('should return job status when job exists', async () => {
      const mockStatus = {
        jobId: 'test-job-id',
        status: 'generating' as const,
        progress: 50,
        image: null,
        error: null,
      }
      mockSQSInstance.getJobStatus.mockResolvedValue(mockStatus)

      const result = await generateService.getJobStatus('test-job-id', 'test-user-id')

      expect(result).toEqual(mockStatus)
      expect(mockSQSInstance.getJobStatus).toHaveBeenCalledWith('test-job-id', 'test-user-id')
    })

    it('should return null when job does not exist', async () => {
      const mockStatus = {
        jobId: 'non-existent-job',
        status: 'generating' as const,
        progress: 50,
        image: null,
        error: null,
      }
      mockSQSInstance.getJobStatus.mockResolvedValue(mockStatus)

      const result = await generateService.getJobStatus('non-existent-job', 'test-user-id')

      expect(result).toEqual(mockStatus)
      expect(mockSQSInstance.getJobStatus).toHaveBeenCalledWith('non-existent-job', 'test-user-id')
    })

    it('should handle errors when getting job status', async () => {
      const mockError = new Error('Database Error')
      mockSQSInstance.getJobStatus.mockRejectedValue(mockError)

      await expect(
        generateService.getJobStatus('test-job-id', 'test-user-id')
      ).rejects.toThrow('Database Error')
    })
  })

  describe('getQueueStats', () => {
    it('should return queue statistics', async () => {
      const mockStats = {
        messagesAvailable: 5,
        messagesInFlight: 2,
        messagesDelayed: 0,
      }
      mockSQSInstance.getQueueStats.mockResolvedValue(mockStats)

      const result = await generateService.getQueueStats()

      expect(result).toEqual(mockStats)
      expect(mockSQSInstance.getQueueStats).toHaveBeenCalledTimes(1)
    })

    it('should handle errors when getting queue stats', async () => {
      const mockError = new Error('SQS Error')
      mockSQSInstance.getQueueStats.mockRejectedValue(mockError)

      await expect(generateService.getQueueStats()).rejects.toThrow('SQS Error')
    })
  })

  describe('initialization', () => {
    it('should initialize SQS queue service and start processing', () => {
      expect(MockSQSQueueService.getInstance).toHaveBeenCalledTimes(1)
      expect(mockSQSInstance.startProcessing).toHaveBeenCalledTimes(1)
    })

    it('should be a singleton', () => {
      const instance1 = GenerateService.getInstance()
      const instance2 = GenerateService.getInstance()
      
      expect(instance1).toBe(instance2)
    })
  })
})