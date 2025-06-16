import { Redis } from 'ioredis'
import logger from '../utils/logger.js'

let redis: Redis

export async function connectRedis() {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'
  
  redis = new Redis(redisUrl, {
    // retryDelayOnFailover: 100,
    enableReadyCheck: false,
    maxRetriesPerRequest: null,
  })

  redis.on('connect', () => {
    logger.info('Redis client connected')
  })

  redis.on('error', (err) => {
    logger.error('Redis client error:', err)
  })

  return redis
}

export function getRedis(): Redis {
  if (!redis) {
    throw new Error('Redis not initialized. Call connectRedis() first.')
  }
  return redis
}