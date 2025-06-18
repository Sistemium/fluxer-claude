import Router from 'koa-router'
import { ImageService } from '../services/imageService.js'
import logger from '../utils/logger.js'
import { verifySession } from 'supertokens-node/recipe/session/framework/koa/index.js'

export const imageRoutes = new Router()

imageRoutes.get('/', verifySession(), async (ctx: any) => {
  try {
    const userId = ctx.session.getUserId()
    const page = parseInt(ctx.query.page as string) || 1
    const limit = parseInt(ctx.query.limit as string) || 20
    
    const imageService = new ImageService()
    const images = await imageService.getUserImages(userId, page, limit)
    
    ctx.body = images
  } catch (error) {
    logger.error('Error fetching user images:', error)
    ctx.status = 500
    ctx.body = { error: 'Failed to fetch images' }
  }
})

imageRoutes.get('/:imageId', verifySession(), async (ctx: any) => {
  try {
    const { imageId } = ctx.params
    const userId = ctx.session.getUserId()
    
    const imageService = new ImageService()
    const image = await imageService.getImage(imageId as string, userId)
    
    if (!image) {
      ctx.status = 404
      ctx.body = { error: 'Image not found' }
      return
    }
    
    ctx.body = image
  } catch (error) {
    logger.error('Error fetching image:', error)
    ctx.status = 500
    ctx.body = { error: 'Failed to fetch image' }
  }
})

imageRoutes.delete('/:imageId', verifySession(), async (ctx: any) => {
  try {
    const { imageId } = ctx.params
    const userId = ctx.session.getUserId()
    
    const imageService = new ImageService()
    const deleted = await imageService.deleteImage(imageId as string, userId)
    
    if (!deleted) {
      ctx.status = 404
      ctx.body = { error: 'Image not found' }
      return
    }
    
    ctx.body = { message: 'Image deleted successfully' }
  } catch (error) {
    logger.error('Error deleting image:', error)
    ctx.status = 500
    ctx.body = { error: 'Failed to delete image' }
  }
})