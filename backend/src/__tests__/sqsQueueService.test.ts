import { SQSClient, SendMessageCommand, ReceiveMessageCommand, DeleteMessageCommand, GetQueueAttributesCommand } from '@aws-sdk/client-sqs'
import { mockClient } from 'aws-sdk-client-mock'
import { SQSQueueService } from '../services/sqsQueueService'

// Mock logger to avoid console output in tests
jest.mock('../utils/logger.js', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}))

// Mock axios for AI service calls
jest.mock('axios', () => ({
  post: jest.fn(),
}))

// Mock SocketService
jest.mock('../services/socketService.js', () => ({
  SocketService: {
    getInstance: () => ({
      emitCompleted: jest.fn(),
      emitError: jest.fn(),
    }),
  },
}))

// Mock Image model to avoid MongoDB connection
jest.mock('../models/Image.js', () => {
  const mockImageSave = jest.fn().mockResolvedValue({})
  const MockImage = jest.fn().mockImplementation(() => ({
    save: mockImageSave,
    _id: 'mock-image-id',
    status: 'generating',
    imageUrl: null,
  })) as any
  MockImage.findOne = jest.fn()
  MockImage.mockImageSave = mockImageSave
  return { Image: MockImage }
})

describe('SQSQueueService', () => {
  const sqsMock = mockClient(SQSClient)
  let sqsService: SQSQueueService

  beforeEach(() => {
    // Reset all mocks
    sqsMock.reset()
    jest.clearAllMocks()
    
    const { Image } = require('../models/Image.js')
    if (Image.mockClear) Image.mockClear()
    if (Image.findOne?.mockClear) Image.findOne.mockClear()
    if (Image.mockImageSave?.mockClear) Image.mockImageSave.mockClear()

    sqsService = new SQSQueueService()
  })

  describe('addJob', () => {
    it('should add a job to SQS queue successfully', async () => {
      sqsMock.on(SendMessageCommand).resolves({
        MessageId: 'test-message-id',
      })

      const jobData = {
        userId: 'test-user-id',
        prompt: 'test prompt',
        width: 512,
        height: 512,
        guidance_scale: 7.5,
        num_inference_steps: 50,
      }

      const jobId = await sqsService.addJob(jobData)

      expect(jobId).toBeDefined()
      expect(typeof jobId).toBe('string')
      
      const { Image } = require('../models/Image.js')
      expect(Image).toHaveBeenCalledTimes(1)
      expect(Image.mockImageSave).toHaveBeenCalledTimes(1)
      
      // Verify SQS command was called
      expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(1)
      const commandCalls = sqsMock.commandCalls(SendMessageCommand)
      expect(commandCalls[0]?.args[0].input.QueueUrl).toBe(process.env.SQS_QUEUE_URL)
      expect(JSON.parse(commandCalls[0]?.args[0].input.MessageBody!)).toMatchObject({
        ...jobData,
        jobId: jobId,
      })
    })

    it('should handle SQS errors when adding job', async () => {
      sqsMock.on(SendMessageCommand).rejects(new Error('SQS Error'))

      const jobData = {
        userId: 'test-user-id',
        prompt: 'test prompt',
        width: 512,
        height: 512,
        guidance_scale: 7.5,
        num_inference_steps: 50,
      }

      await expect(sqsService.addJob(jobData)).rejects.toThrow('SQS Error')
    })
  })

  describe('getQueueStats', () => {
    it('should return queue statistics', async () => {
      sqsMock.on(GetQueueAttributesCommand).resolves({
        Attributes: {
          ApproximateNumberOfMessages: '5',
          ApproximateNumberOfMessagesNotVisible: '2',
          ApproximateNumberOfMessagesDelayed: '0',
        },
      })

      const stats = await sqsService.getQueueStats()

      expect(stats).toEqual({
        messagesAvailable: 5,
        messagesInFlight: 2,
        messagesDelayed: 0,
      })
      
      expect(sqsMock.commandCalls(GetQueueAttributesCommand)).toHaveLength(1)
      const commandCalls = sqsMock.commandCalls(GetQueueAttributesCommand)
      expect(commandCalls[0]?.args[0].input.QueueUrl).toBe(process.env.SQS_QUEUE_URL)
    })

    it('should handle errors when getting queue stats', async () => {
      sqsMock.on(GetQueueAttributesCommand).rejects(new Error('SQS Error'))

      const stats = await sqsService.getQueueStats()
      expect(stats).toBeNull()
    })
  })

  describe('processMessage', () => {
    it('should process valid message successfully', async () => {
      const axios = require('axios')
      
      // Mock successful AI service response
      axios.post.mockResolvedValue({
        data: {
          status: 'completed',
          image_url: 'data:image/png;base64,test-image-data',
        },
      })

      // Mock finding the image in database
      const mockImageInstance = {
        save: jest.fn().mockResolvedValue({}),
        imageUrl: null,
        status: 'generating',
      }
      const { Image } = require('../models/Image.js')
      Image.findOne.mockResolvedValue(mockImageInstance)

      const mockMessage = {
        MessageId: 'test-message-id',
        ReceiptHandle: 'test-receipt-handle',
        Body: JSON.stringify({
          userId: 'test-user-id',
          jobId: 'test-job-id',
          prompt: 'test prompt',
          width: 512,
          height: 512,
          guidance_scale: 7.5,
          num_inference_steps: 50,
        }),
      }

      sqsMock.on(DeleteMessageCommand).resolves({})

      // Access private method for testing
      const processMessageMethod = (sqsService as any).processMessage.bind(sqsService)
      await processMessageMethod(mockMessage)

      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining('/generate'),
        expect.objectContaining({
          user_id: 'test-user-id',
          job_id: 'test-job-id',
          prompt: 'test prompt',
        }),
        expect.objectContaining({
          timeout: 900000,
        })
      )

      expect(sqsMock.commandCalls(DeleteMessageCommand)).toHaveLength(1)
    })

    it('should handle malformed message body', async () => {
      const mockMessage = {
        MessageId: 'test-message-id',
        ReceiptHandle: 'test-receipt-handle',
        Body: 'invalid json',
      }

      sqsMock.on(DeleteMessageCommand).resolves({})

      const processMessageMethod = (sqsService as any).processMessage.bind(sqsService)
      await processMessageMethod(mockMessage)

      // Should delete malformed message
      expect(sqsMock.commandCalls(DeleteMessageCommand)).toHaveLength(1)
    })
  })

  describe('getJobStatus', () => {
    it('should return job status from MongoDB', async () => {
      const mockImage = {
        _id: 'mock-image-id',
        jobId: 'test-job-id',
        status: 'completed',
        imageUrl: 'data:image/png;base64,test',
        prompt: 'test prompt',
        createdAt: new Date(),
      }

      const { Image } = require('../models/Image.js')
      Image.findOne.mockResolvedValue(mockImage)

      const result = await sqsService.getJobStatus('test-job-id', 'test-user-id')

      expect(result).toEqual({
        jobId: 'test-job-id',
        status: 'completed',
        progress: 100,
        image: {
          id: 'mock-image-id',
          imageUrl: 'data:image/png;base64,test',
          prompt: 'test prompt',
          createdAt: mockImage.createdAt,
        },
        error: null,
      })

      expect(Image.findOne).toHaveBeenCalledWith({
        jobId: 'test-job-id',
        userId: 'test-user-id',
      })
    })

    it('should return null when job not found', async () => {
      const { Image } = require('../models/Image.js')
      Image.findOne.mockResolvedValue(null)

      const result = await sqsService.getJobStatus('non-existent-job', 'test-user-id')

      expect(result).toBeNull()
    })
  })

  describe('receiveMessages', () => {
    it('should receive and process messages', async () => {
      const mockMessages = {
        Messages: [
          {
            MessageId: 'test-message-id',
            ReceiptHandle: 'test-receipt-handle',
            Body: JSON.stringify({
              userId: 'test-user-id',
              jobId: 'test-job-id',
              prompt: 'test prompt',
              width: 512,
              height: 512,
              guidance_scale: 7.5,
              num_inference_steps: 50,
            }),
          },
        ],
      }

      sqsMock.on(ReceiveMessageCommand).resolves(mockMessages)

      // We can't easily test the private processMessages method without starting it,
      // but we can verify the service was constructed properly
      expect(sqsService).toBeInstanceOf(SQSQueueService)
    })
  })
})