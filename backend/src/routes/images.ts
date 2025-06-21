import Router from 'koa-router'
import { ImageService } from '../services/imageService.js'
import logger from '../utils/logger.js'
import { verifySession } from 'supertokens-node/recipe/session/framework/koa/index.js'
import fetch from 'node-fetch'

export const imageRoutes = new Router()

imageRoutes.get('/', verifySession(), async (ctx: any) => {
  logger.info('GET /api/images/ - List images request')
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

imageRoutes.get('/:imageId/download', verifySession(), async (ctx: any) => {
  logger.info(`Download request for image: ${ctx.params.imageId}`)
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
    
    // Получаем изображение с S3
    const response = await fetch(image.imageUrl)
    if (!response.ok) {
      logger.error(`Failed to fetch image from S3: ${response.status} ${response.statusText}`)
      ctx.status = 404
      ctx.body = { error: 'Image file not found' }
      return
    }
    
    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const filename = `fluxer-${image.id}.png`
    
    logger.info(`Downloaded image ${image.id}, size: ${buffer.length} bytes`)
    
    // Устанавливаем заголовки для скачивания
    ctx.set('Content-Type', 'image/png')
    ctx.set('Content-Disposition', `attachment; filename="${filename}"`)
    ctx.set('Content-Length', buffer.length.toString())
    
    ctx.body = buffer
  } catch (error) {
    logger.error('Error downloading image:', error)
    ctx.status = 500
    ctx.body = { error: 'Failed to download image' }
  }
})

imageRoutes.get('/:imageId', verifySession(), async (ctx: any) => {
  logger.info(`GET /api/images/${ctx.params.imageId} - Get single image request`)
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
  logger.info(`DELETE /api/images/${ctx.params.imageId} - Delete image request`)
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