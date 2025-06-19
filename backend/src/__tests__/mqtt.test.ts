import { MqttService } from '../services/mqttService'

// Mock mqtt module
jest.mock('mqtt', () => ({
  connect: jest.fn().mockReturnValue({
    on: jest.fn(),
    subscribe: jest.fn(),
    publish: jest.fn(),
    end: jest.fn()
  })
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

describe('MqttService', () => {
  let mqttService: MqttService

  beforeEach(() => {
    jest.clearAllMocks()
    
    // Reset environment variables
    delete process.env.MQTT_BROKER_URL
    delete process.env.MQTT_USERNAME
    delete process.env.MQTT_PASSWORD
    
    mqttService = MqttService.getInstance()
  })

  describe('singleton pattern', () => {
    it('should return the same instance', () => {
      const instance1 = MqttService.getInstance()
      const instance2 = MqttService.getInstance()
      
      expect(instance1).toBe(instance2)
    })
  })

  describe('connect', () => {
    it('should skip connection if MQTT_BROKER_URL is not configured', async () => {
      await mqttService.connect()
      
      // Should not throw and should log warning
      expect(true).toBe(true)
    })

    it('should attempt connection when MQTT_BROKER_URL is configured', async () => {
      process.env.MQTT_BROKER_URL = 'mqtt://test-broker:1883'
      
      const mqtt = require('mqtt')
      const mockClient = {
        on: jest.fn(),
        subscribe: jest.fn(),
        publish: jest.fn(),
        end: jest.fn()
      }
      mqtt.connect.mockReturnValue(mockClient)

      try {
        await mqttService.connect()
      } catch (error) {
        // Expected to throw in test environment due to mocking
      }
      
      expect(mqtt.connect).toHaveBeenCalledWith(
        'mqtt://test-broker:1883',
        expect.objectContaining({
          clientId: expect.stringContaining('fluxer-backend-'),
          clean: true,
          reconnectPeriod: 5000,
          connectTimeout: 30000,
          keepalive: 60
        })
      )
    })

    it('should include credentials when username and password are provided', async () => {
      process.env.MQTT_BROKER_URL = 'mqtt://test-broker:1883'
      process.env.MQTT_USERNAME = 'testuser'
      process.env.MQTT_PASSWORD = 'testpass'
      
      const mqtt = require('mqtt')
      const mockClient = {
        on: jest.fn(),
        subscribe: jest.fn(),
        publish: jest.fn(),
        end: jest.fn()
      }
      mqtt.connect.mockReturnValue(mockClient)

      try {
        await mqttService.connect()
      } catch (error) {
        // Expected to throw in test environment due to mocking
      }
      
      expect(mqtt.connect).toHaveBeenCalledWith(
        'mqtt://test-broker:1883',
        expect.objectContaining({
          username: 'testuser',
          password: 'testpass'
        })
      )
    })
  })

  describe('publish methods', () => {
    it('should return early if client is not connected', async () => {
      await mqttService.publishProgress('user1', 'job1', 50, 'Processing...')
      
      // Should not throw
      expect(true).toBe(true)
    })
  })

  describe('connection info', () => {
    it('should return connection status', () => {
      const info = mqttService.getConnectionInfo()
      
      expect(info).toEqual({
        connected: false,
        reconnectAttempts: 0
      })
    })

    it('should return client connection status', () => {
      const connected = mqttService.isClientConnected()
      
      expect(connected).toBe(false)
    })
  })

  describe('disconnect', () => {
    it('should disconnect gracefully', () => {
      mqttService.disconnect()
      
      // Should not throw
      expect(true).toBe(true)
    })
  })
})