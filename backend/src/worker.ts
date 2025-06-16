// import { GenerateService } from './services/generateService.js'
import logger from './utils/logger.js'
import dotenv from 'dotenv-flow'

// Load environment variables
dotenv.config()

async function startWorker() {
  logger.info('Starting queue worker...')
  
  try {
    // const generateService = GenerateService.getInstance()
    logger.info('Queue worker started successfully')
    
    // Keep the process alive
    process.on('SIGTERM', () => {
      logger.info('Worker received SIGTERM, shutting down')
      process.exit(0)
    })
    
    process.on('SIGINT', () => {
      logger.info('Worker received SIGINT, shutting down')
      process.exit(0)
    })
    
  } catch (error) {
    logger.error('Failed to start worker:', error)
    process.exit(1)
  }
}

startWorker()