import mqtt from 'mqtt'
import logger from '../utils/logger.js'
import { SocketService } from './socketService.js'
import { Image } from '../models/Image.js'

interface MqttProgressMessage {
  jobId: string
  userId: string
  progress: number
  message: string
  timestamp: string
}

interface MqttCompletionMessage {
  jobId: string
  userId: string
  imageUrl: string
  timestamp: string
}

interface MqttErrorMessage {
  jobId: string
  userId: string
  error: string
  timestamp: string
}

export class MqttService {
  private static instance: MqttService
  private client: mqtt.MqttClient | null = null
  private isConnected = false
  private reconnectAttempts = 0
  private maxReconnectAttempts = 10

  constructor() {
    logger.info('MqttService initialized')
  }

  static getInstance(): MqttService {
    if (!MqttService.instance) {
      MqttService.instance = new MqttService()
    }
    return MqttService.instance
  }

  async connect(): Promise<void> {
    try {
      const brokerUrl = process.env.MQTT_BROKER_URL
      const username = process.env.MQTT_USERNAME
      const password = process.env.MQTT_PASSWORD

      if (!brokerUrl) {
        logger.warn('MQTT_BROKER_URL not configured, MQTT service disabled')
        return
      }

      logger.info('Connecting to MQTT broker', { brokerUrl })

      const options: mqtt.IClientOptions = {
        clientId: `fluxer-backend-${Math.random().toString(16).substr(2, 8)}`,
        clean: true,
        reconnectPeriod: 5000,
        connectTimeout: 30000,
        keepalive: 60,
        protocolVersion: 4,
        ...(username && password && {
          username,
          password
        })
      }

      this.client = mqtt.connect(brokerUrl, options)

      return new Promise((resolve, reject) => {
        if (!this.client) {
          reject(new Error('Failed to create MQTT client'))
          return
        }

        this.client.on('connect', () => {
          logger.info('Connected to MQTT broker')
          this.isConnected = true
          this.reconnectAttempts = 0
          this.subscribeToTopics()
          resolve()
        })

        this.client.on('error', (error) => {
          logger.error('MQTT connection error', error)
          this.isConnected = false
          if (this.reconnectAttempts === 0) {
            reject(error)
          }
        })

        this.client.on('close', () => {
          logger.warn('MQTT connection closed')
          this.isConnected = false
        })

        this.client.on('reconnect', () => {
          this.reconnectAttempts++
          logger.info(`MQTT reconnecting (attempt ${this.reconnectAttempts})`)
          
          if (this.reconnectAttempts > this.maxReconnectAttempts) {
            logger.error('Max MQTT reconnect attempts reached')
            this.client?.end()
          }
        })

        this.client.on('message', this.handleMessage.bind(this))
      })
    } catch (error) {
      logger.error('Failed to connect to MQTT broker', error)
      throw error
    }
  }

  private subscribeToTopics(): void {
    if (!this.client || !this.isConnected) {
      return
    }

    const topics = [
      'fluxer/ai/progress/+/+',     // fluxer/ai/progress/{userId}/{jobId}
      'fluxer/ai/error/+/+'        // fluxer/ai/error/{userId}/{jobId}
    ]

    topics.forEach(topic => {
      this.client!.subscribe(topic, { qos: 1 }, (error) => {
        if (error) {
          logger.error(`Failed to subscribe to topic ${topic}`, error)
        } else {
          logger.info(`Subscribed to MQTT topic: ${topic}`)
        }
      })
    })
  }

  private async handleMessage(topic: string, payload: Buffer): Promise<void> {
    try {
      const message = payload.toString()
      logger.debug('Received MQTT message', { topic, message })

      if (topic.startsWith('fluxer/ai/progress/')) {
        await this.handleProgressMessage(topic, message)
      } else if (topic.startsWith('fluxer/ai/error/')) {
        await this.handleErrorMessage(topic, message)
      }
    } catch (error) {
      logger.error('Error handling MQTT message', { topic, error })
    }
  }

  private async handleProgressMessage(topic: string, message: string): Promise<void> {
    try {
      const data: MqttProgressMessage = JSON.parse(message)
      
      logger.info('Processing MQTT progress message', { 
        jobId: data.jobId, 
        progress: data.progress,
        message: data.message 
      })

      // Send WebSocket progress update to frontend
      const socketService = SocketService.getInstance()
      socketService.emitProgress(data.userId, data.jobId, data.progress, data.message)

    } catch (error) {
      logger.error('Failed to handle MQTT progress message', { topic, message, error })
    }
  }


  private async handleErrorMessage(topic: string, message: string): Promise<void> {
    try {
      const data: MqttErrorMessage = JSON.parse(message)
      
      logger.error('Processing MQTT error message', { 
        jobId: data.jobId, 
        userId: data.userId,
        error: data.error 
      })

      // Update image record in database
      try {
        const image = await Image.findOne({ jobId: data.jobId, userId: data.userId })
        if (image) {
          image.status = 'failed'
          await image.save()
          
          logger.info('Image status updated to failed', { 
            jobId: data.jobId, 
            imageId: image._id 
          })
        }
      } catch (dbError) {
        logger.warn('Failed to update job status to failed', { jobId: data.jobId, dbError })
      }

      // Send WebSocket error notification
      const socketService = SocketService.getInstance()
      socketService.emitError(data.userId, data.jobId, data.error)

    } catch (error) {
      logger.error('Failed to handle MQTT error message', { topic, message, error })
    }
  }

  // Method to publish messages (mainly for testing)
  async publishProgress(userId: string, jobId: string, progress: number, message: string): Promise<void> {
    if (!this.client || !this.isConnected) {
      logger.warn('MQTT client not connected, cannot publish progress')
      return
    }

    const topic = `fluxer/ai/progress/${userId}/${jobId}`
    const payload: MqttProgressMessage = {
      jobId,
      userId,
      progress,
      message,
      timestamp: new Date().toISOString()
    }

    this.client.publish(topic, JSON.stringify(payload), { qos: 1 }, (error) => {
      if (error) {
        logger.error('Failed to publish MQTT progress message', error)
      } else {
        logger.debug('Published MQTT progress message', { topic, payload })
      }
    })
  }

  async publishCompletion(userId: string, jobId: string, imageUrl: string): Promise<void> {
    if (!this.client || !this.isConnected) {
      logger.warn('MQTT client not connected, cannot publish completion')
      return
    }

    const topic = `fluxer/ai/completed/${userId}/${jobId}`
    const payload: MqttCompletionMessage = {
      jobId,
      userId,
      imageUrl,
      timestamp: new Date().toISOString()
    }

    this.client.publish(topic, JSON.stringify(payload), { qos: 1 }, (error) => {
      if (error) {
        logger.error('Failed to publish MQTT completion message', error)
      } else {
        logger.debug('Published MQTT completion message', { topic, payload })
      }
    })
  }

  async publishError(userId: string, jobId: string, error: string): Promise<void> {
    if (!this.client || !this.isConnected) {
      logger.warn('MQTT client not connected, cannot publish error')
      return
    }

    const topic = `fluxer/ai/error/${userId}/${jobId}`
    const payload: MqttErrorMessage = {
      jobId,
      userId,
      error,
      timestamp: new Date().toISOString()
    }

    this.client.publish(topic, JSON.stringify(payload), { qos: 1 }, (error) => {
      if (error) {
        logger.error('Failed to publish MQTT error message', error)
      } else {
        logger.debug('Published MQTT error message', { topic, payload })
      }
    })
  }

  disconnect(): void {
    if (this.client) {
      logger.info('Disconnecting from MQTT broker')
      this.client.end()
      this.client = null
      this.isConnected = false
    }
  }

  isClientConnected(): boolean {
    return this.isConnected
  }

  getConnectionInfo(): { connected: boolean, reconnectAttempts: number } {
    return {
      connected: this.isConnected,
      reconnectAttempts: this.reconnectAttempts
    }
  }

  /**
   * Subscribe to custom MQTT topic with handler
   */
  async subscribeToTopic(topic: string, handler: (message: any) => void): Promise<void> {
    if (!this.client || !this.isConnected) {
      throw new Error('MQTT client not connected')
    }

    return new Promise((resolve, reject) => {
      this.client!.subscribe(topic, { qos: 1 }, (error) => {
        if (error) {
          logger.error(`Failed to subscribe to topic ${topic}`, error)
          reject(error)
        } else {
          logger.info(`Subscribed to MQTT topic: ${topic}`)
          
          // Add message handler
          this.client!.on('message', (receivedTopic, payload) => {
            if (receivedTopic === topic || this.topicMatches(receivedTopic, topic)) {
              try {
                const message = JSON.parse(payload.toString())
                handler(message)
              } catch (parseError) {
                logger.error('Failed to parse MQTT message', { topic: receivedTopic, error: parseError })
              }
            }
          })
          
          resolve()
        }
      })
    })
  }

  /**
   * Unsubscribe from MQTT topic
   */
  async unsubscribeFromTopic(topic: string): Promise<void> {
    if (!this.client || !this.isConnected) {
      return
    }

    return new Promise((resolve, reject) => {
      this.client!.unsubscribe(topic, (error) => {
        if (error) {
          logger.error(`Failed to unsubscribe from topic ${topic}`, error)
          reject(error)
        } else {
          logger.info(`Unsubscribed from MQTT topic: ${topic}`)
          resolve()
        }
      })
    })
  }

  /**
   * Check if topic matches pattern (with + wildcards)
   */
  private topicMatches(topic: string, pattern: string): boolean {
    const topicParts = topic.split('/')
    const patternParts = pattern.split('/')
    
    if (topicParts.length !== patternParts.length) {
      return false
    }
    
    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i] !== '+' && patternParts[i] !== topicParts[i]) {
        return false
      }
    }
    
    return true
  }
}