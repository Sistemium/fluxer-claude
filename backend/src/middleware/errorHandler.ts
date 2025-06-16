import { Context, Next } from 'koa'
import logger from '../utils/logger.js'

export async function errorHandler(ctx: Context, next: Next) {
  try {
    await next()
  } catch (error) {
    const err = error as Error
    
    logger.error('Unhandled error:', {
      error: err.message,
      stack: err.stack,
      url: ctx.url,
      method: ctx.method,
      headers: ctx.headers,
    })

    ctx.status = 500
    ctx.body = {
      error: 'Internal Server Error',
      message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
    }
  }
}