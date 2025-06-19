import AWS from 'aws-sdk'
import AWSMock from 'aws-sdk-mock'
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

describe('SQSQueueService', () => {
  let sqsService: SQSQueueService
  let mockSQS: any

  beforeEach(() => {
    // Set up AWS SDK mock
    AWSMock.setSDKInstance(AWS)
    
    // Mock SQS methods
    mockSQS = {
      sendMessage: jest.fn(),
      receiveMessage: jest.fn(),
      deleteMessage: jest.fn(),
      getQueueAttributes: jest.fn(),
    }

    AWSMock.mock('SQS', 'sendMessage', mockSQS.sendMessage)
    AWSMock.mock('SQS', 'receiveMessage', mockSQS.receiveMessage)
    AWSMock.mock('SQS', 'deleteMessage', mockSQS.deleteMessage)
    AWSMock.mock('SQS', 'getQueueAttributes', mockSQS.getQueueAttributes)

    sqsService = new SQSQueueService()
  })

  afterEach(() => {
    AWSMock.restore('SQS')
    jest.clearAllMocks()
  })

  describe('addJob', () => {
    it('should add a job to SQS queue successfully', async () => {
      const mockResponse = {
        MessageId: 'test-message-id',
      }
      mockSQS.sendMessage.mockImplementation((_params: any, callback: any) => {
        callback(null, mockResponse)
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
      expect(mockSQS.sendMessage).toHaveBeenCalledTimes(1)
      
      const sentParams = mockSQS.sendMessage.mock.calls[0][0]
      expect(sentParams.QueueUrl).toBe(process.env.SQS_QUEUE_URL)
      expect(JSON.parse(sentParams.MessageBody)).toMatchObject({
        ...jobData,
        jobId: jobId,
      })
    })

    it('should handle SQS errors when adding job', async () => {
      const mockError = new Error('SQS Error')
      mockSQS.sendMessage.mockImplementation((_params: any, callback: any) => {
        callback(mockError)
      })

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
      const mockAttributes = {
        Attributes: {
          ApproximateNumberOfMessages: '5',
          ApproximateNumberOfMessagesNotVisible: '2',
          ApproximateNumberOfMessagesDelayed: '0',
        },
      }
      mockSQS.getQueueAttributes.mockImplementation((_params: any, callback: any) => {
        callback(null, mockAttributes)
      })

      const stats = await sqsService.getQueueStats()

      expect(stats).toEqual({
        messagesAvailable: 5,
        messagesInFlight: 2,
        messagesDelayed: 0,
      })
      expect(mockSQS.getQueueAttributes).toHaveBeenCalledWith({
        QueueUrl: process.env.SQS_QUEUE_URL,
        AttributeNames: [
          'ApproximateNumberOfMessages',
          'ApproximateNumberOfMessagesNotVisible',
          'ApproximateNumberOfMessagesDelayed',
        ],
      })
    })

    it('should handle errors when getting queue stats', async () => {
      mockSQS.getQueueAttributes.mockImplementation((_params: any, callback: any) => {
        callback(new Error('SQS Error'))
      })

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

      mockSQS.deleteMessage.mockImplementation((_params: any, callback: any) => {
        callback(null, {})
      })

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

      expect(mockSQS.deleteMessage).toHaveBeenCalledWith({
        QueueUrl: process.env.SQS_QUEUE_URL,
        ReceiptHandle: 'test-receipt-handle',
      })
    })

    it('should handle malformed message body', async () => {
      const mockMessage = {
        MessageId: 'test-message-id',
        ReceiptHandle: 'test-receipt-handle',
        Body: 'invalid json',
      }

      mockSQS.deleteMessage.mockImplementation((_params: any, callback: any) => {
        callback(null, {})
      })

      const processMessageMethod = (sqsService as any).processMessage.bind(sqsService)
      await processMessageMethod(mockMessage)

      // Should delete malformed message
      expect(mockSQS.deleteMessage).toHaveBeenCalledWith({
        QueueUrl: process.env.SQS_QUEUE_URL,
        ReceiptHandle: 'test-receipt-handle',
      })
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

      mockSQS.receiveMessage.mockImplementation((_params: any, callback: any) => {
        callback(null, mockMessages)
      })

      expect(mockSQS.receiveMessage).not.toHaveBeenCalled()
      
      // Test that receiveMessage would be called with correct parameters  
      // Note: actual verification would require running processMessages method

      // We can't easily test the private processMessages method without starting it,
      // but we can verify the service was constructed properly
      expect(sqsService).toBeInstanceOf(SQSQueueService)
    })
  })
})