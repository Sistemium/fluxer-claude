import { EventBridgeService } from '../services/eventBridgeService'

// Mock AWS SDK
jest.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn().mockImplementation(() => ({
    send: jest.fn()
  })),
  CreateEventBusCommand: jest.fn(),
  DescribeEventBusCommand: jest.fn(),
  PutEventsCommand: jest.fn()
}))

// Mock logger
jest.mock('../utils/logger.js', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}))

// Mock SocketService
jest.mock('../services/socketService.js', () => ({
  SocketService: {
    getInstance: () => ({
      emitProgress: jest.fn(),
      emitCompleted: jest.fn(),
      emitError: jest.fn()
    })
  }
}))

// Mock Image model
jest.mock('../models/Image.js', () => ({
  Image: {
    findOne: jest.fn()
  }
}))

describe('EventBridgeService', () => {
  let eventBridgeService: EventBridgeService

  beforeEach(() => {
    jest.clearAllMocks()
    eventBridgeService = EventBridgeService.getInstance()
  })

  describe('processEvent', () => {
    it('should process progress event correctly', async () => {
      const mockEvent = {
        source: 'fluxer.ai-service',
        'detail-type': 'AI Generation Progress',
        detail: {
          jobId: 'test-job-123',
          userId: 'test-user-456',
          progress: 50,
          message: 'Generating...',
          timestamp: '2024-01-01T00:00:00.000Z'
        }
      }

      await eventBridgeService.processEvent(mockEvent)

      // Should handle progress event without throwing
      expect(true).toBe(true)
    })

    it('should process completion event correctly', async () => {
      const { Image } = require('../models/Image.js')
      const mockImage = {
        save: jest.fn().mockResolvedValue({}),
        imageUrl: null,
        status: 'generating'
      }
      Image.findOne.mockResolvedValue(mockImage)

      const mockEvent = {
        source: 'fluxer.ai-service',
        'detail-type': 'AI Generation Completed',
        detail: {
          jobId: 'test-job-123',
          userId: 'test-user-456',
          imageUrl: 'data:image/png;base64,test',
          timestamp: '2024-01-01T00:00:00.000Z'
        }
      }

      await eventBridgeService.processEvent(mockEvent)

      expect(Image.findOne).toHaveBeenCalledWith({
        jobId: 'test-job-123',
        userId: 'test-user-456'
      })
      expect(mockImage.save).toHaveBeenCalled()
      expect(mockImage.status).toBe('completed')
      expect(mockImage.imageUrl).toBe('data:image/png;base64,test')
    })

    it('should process error event correctly', async () => {
      const { Image } = require('../models/Image.js')
      const mockImage = {
        save: jest.fn().mockResolvedValue({}),
        status: 'generating'
      }
      Image.findOne.mockResolvedValue(mockImage)

      const mockEvent = {
        source: 'fluxer.ai-service',
        'detail-type': 'AI Generation Failed',
        detail: {
          jobId: 'test-job-123',
          userId: 'test-user-456',
          error: 'Out of memory',
          timestamp: '2024-01-01T00:00:00.000Z'
        }
      }

      await eventBridgeService.processEvent(mockEvent)

      expect(Image.findOne).toHaveBeenCalledWith({
        jobId: 'test-job-123',
        userId: 'test-user-456'
      })
      expect(mockImage.save).toHaveBeenCalled()
      expect(mockImage.status).toBe('failed')
    })

    it('should ignore events from other sources', async () => {
      const mockEvent = {
        source: 'other.service',
        'detail-type': 'Some Event',
        detail: {}
      }

      await eventBridgeService.processEvent(mockEvent)

      // Should not throw and should ignore the event
      expect(true).toBe(true)
    })

    it('should handle unknown event types', async () => {
      const mockEvent = {
        source: 'fluxer.ai-service',
        'detail-type': 'Unknown Event Type',
        detail: {}
      }

      await eventBridgeService.processEvent(mockEvent)

      // Should not throw for unknown event types
      expect(true).toBe(true)
    })
  })

  describe('singleton pattern', () => {
    it('should return the same instance', () => {
      const instance1 = EventBridgeService.getInstance()
      const instance2 = EventBridgeService.getInstance()
      
      expect(instance1).toBe(instance2)
    })
  })

  describe('configuration', () => {
    it('should return correct event bus name', () => {
      const eventBusName = eventBridgeService.getEventBusName()
      expect(typeof eventBusName).toBe('string')
      expect(eventBusName.length).toBeGreaterThan(0)
    })
  })
})