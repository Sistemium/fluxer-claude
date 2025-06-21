import Router from 'koa-router'
import Joi from 'joi'
import { GenerateService } from '../services/generateService.js'
import logger from '../utils/logger.js'
import { verifySession } from 'supertokens-node/recipe/session/framework/koa/index.js'

export const generateRoutes = new Router()

const generateSchema = Joi.object({
  prompt: Joi.string().required().min(1).max(3000),
  width: Joi.number().valid(256, 512, 768, 1024).default(512),
  height: Joi.number().valid(256, 512, 768, 1024).default(512),
  guidance_scale: Joi.number().min(1).max(20).default(7.5),
  num_inference_steps: Joi.number().min(10).max(100).default(50)
})

generateRoutes.post('/', verifySession(), async (ctx: any) => {
  try {
    logger.info('Step 1: Generate route called')
    
    logger.info('Step 2: Validating request body')
    const { error, value } = generateSchema.validate(ctx.request.body)
    
    if (error) {
      logger.info('Step 3: Validation failed')
      ctx.status = 400
      ctx.body = { error: 'Validation error', details: error.details }
      return
    }

    logger.info('Step 4: Validation passed')
    const userId = ctx.session.getUserId()
    
    logger.info('Step 5: Getting GenerateService instance')
    const generateService = GenerateService.getInstance()
    
    logger.info('Step 6: Queueing generation')
    const jobId = await generateService.queueGeneration({
      userId,
      ...value
    })

    logger.info('Step 7: Generation queued successfully')
    ctx.body = {
      jobId,
      status: 'queued',
      message: 'Image generation queued successfully'
    }
    
    logger.info(`Step 8: Response sent, job ${jobId}`)
  } catch (error) {
    logger.error('Error in generate route:', error)
    ctx.status = 500
    ctx.body = { error: 'Failed to queue image generation' }
  }
})

generateRoutes.get('/status/:jobId', verifySession(), async (ctx: any) => {
  try {
    const { jobId } = ctx.params
    const userId = ctx.session.getUserId()
    
    const generateService = GenerateService.getInstance()
    const status = await generateService.getJobStatus(jobId as string, userId)
    
    if (!status) {
      ctx.status = 404
      ctx.body = { error: 'Job not found' }
      return
    }
    
    ctx.body = status
  } catch (error) {
    logger.error('Error getting job status:', error)
    ctx.status = 500
    ctx.body = { error: 'Failed to get job status' }
  }
})