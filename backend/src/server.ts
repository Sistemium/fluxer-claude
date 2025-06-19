import Koa from 'koa'
import Router from 'koa-router'
import bodyParser from 'koa-bodyparser'
import cors from '@koa/cors'
import mongoose from 'mongoose'
import { initSupertokens } from './config/supertokens.js'
import supertokens from "supertokens-node"
import { connectRedis } from './config/redis.js'
import logger from './utils/logger.js'
import { errorHandler } from './middleware/errorHandler.js'
import { apiRoutes } from './routes/index.js'
// import { authRoutes } from './routes/auth.js'
import { middleware } from 'supertokens-node/framework/koa/index.js'
import { SocketService } from './services/socketService.js'
import { AutoScalerService } from './services/autoScalerService.js'
import { EventBridgeService } from './services/eventBridgeService.js'
import { MqttService } from './services/mqttService.js'
// import { GenerateService } from './services/generateService.js'

const app = new Koa()

const PORT = process.env.PORT || 3000
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/fluxer'

async function startServer() {
  try {
    // Connect to MongoDB
    await mongoose.connect(MONGODB_URI)
    logger.info('Connected to MongoDB')

    // Connect to Redis
    await connectRedis()
    logger.info('Connected to Redis')

    // Initialize SuperTokens
    initSupertokens()
    logger.info('SuperTokens initialized')

    // Middleware
    app.use(errorHandler)

    // CORS configuration
    app.use(cors({
      origin: process.env.FRONTEND_URL || 'http://localhost:5173',
      credentials: true,
      allowHeaders: ['Content-Type', ...supertokens.getAllCORSHeaders()],
    }))

    // SuperTokens middleware
    app.use(middleware())
    app.use(bodyParser())

    // Logging middleware
    app.use(async (ctx, next) => {
      logger.info(`${ctx.method} ${ctx.url}`)
      await next()
      logger.info(`Response status: ${ctx.status}`)
    })


    // Routes  
    const router = new Router()
    router.use('/api', apiRoutes.routes())

    app.use(router.routes())
    app.use(router.allowedMethods())

    // Initialize WebSocket server
    const socketService = SocketService.getInstance()
    const server = socketService.initialize(app)

    // Initialize MQTT
    const mqttService = MqttService.getInstance()
    try {
      await mqttService.connect()
      logger.info('MQTT service initialized')
    } catch (error) {
      logger.warn('MQTT service failed to initialize, continuing without MQTT', error)
    }

    // Initialize EventBridge
    const eventBridge = EventBridgeService.getInstance()
    await eventBridge.ensureEventBusExists()
    logger.info('EventBridge service initialized')

    // Initialize and start AutoScaler
    const autoScaler = AutoScalerService.getInstance()
    autoScaler.start()
    logger.info('AutoScaler service initialized')

    server.listen(PORT, () => {
      logger.info(`Server running on port ${PORT} with WebSocket support`)
    })
  } catch (error) {
    logger.error('Failed to start server:', error)
    process.exit(1)
  }
}

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully')
  
  // Stop MQTT
  const mqttService = MqttService.getInstance()
  mqttService.disconnect()
  
  // Stop AutoScaler
  const autoScaler = AutoScalerService.getInstance()
  autoScaler.stop()
  
  await mongoose.disconnect()
  process.exit(0)
})

startServer()