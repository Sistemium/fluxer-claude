import { Image, IImage } from '../models/Image.js'
import { S3Service } from './s3Service.js'
import logger from '../utils/logger.js'

export class ImageService {
  async getUserImages(userId: string, page: number = 1, limit: number = 20) {
    try {
      const skip = (page - 1) * limit
      
      const [images, total] = await Promise.all([
        Image.find({ userId, status: 'completed' })
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Image.countDocuments({ userId, status: 'completed' })
      ])

      return {
        images: images.map(image => ({
          id: image._id,
          prompt: image.prompt,
          imageUrl: image.imageUrl,
          width: image.width,
          height: image.height,
          createdAt: image.createdAt
        })),
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      }
    } catch (error) {
      logger.error('Error fetching user images:', error)
      throw error
    }
  }

  async getImage(imageId: string, userId: string) {
    try {
      const image = await Image.findOne({ 
        _id: imageId, 
        userId,
        status: 'completed' 
      }).lean()

      if (!image) {
        return null
      }

      return {
        id: image._id,
        prompt: image.prompt,
        imageUrl: image.imageUrl,
        width: image.width,
        height: image.height,
        guidanceScale: image.guidanceScale,
        numInferenceSteps: image.numInferenceSteps,
        seed: image.seed,
        createdAt: image.createdAt
      }
    } catch (error) {
      logger.error('Error fetching image:', error)
      throw error
    }
  }

  async deleteImage(imageId: string, userId: string): Promise<boolean> {
    try {
      // First get the image to extract S3 key
      const image = await Image.findOne({ 
        _id: imageId, 
        userId 
      })

      if (!image) {
        return false
      }

      // Delete from S3 if it's an S3 URL
      if (image.imageUrl && !image.imageUrl.startsWith('data:image/')) {
        const s3Service = S3Service.getInstance()
        const s3Key = s3Service.extractS3Key(image.imageUrl)
        
        if (s3Key) {
          logger.info('Deleting image from S3', { imageId, s3Key })
          const deleted = await s3Service.deleteImage(s3Key)
          
          if (!deleted) {
            logger.warn('Failed to delete image from S3, continuing with database deletion', { 
              imageId, 
              s3Key 
            })
          }
        }
      }

      // Delete from database
      const result = await Image.deleteOne({ 
        _id: imageId, 
        userId 
      })

      if (result.deletedCount === 0) {
        return false
      }

      logger.info(`Image ${imageId} deleted by user ${userId}`)
      return true
    } catch (error) {
      logger.error('Error deleting image:', error)
      throw error
    }
  }

  async updateImageStatus(jobId: string, status: 'completed' | 'failed', imageUrl?: string) {
    try {
      const updateData: Partial<IImage> = { status }
      if (imageUrl) {
        updateData.imageUrl = imageUrl
      }

      const image = await Image.findOneAndUpdate(
        { jobId },
        updateData,
        { new: true }
      )

      return image
    } catch (error) {
      logger.error('Error updating image status:', error)
      throw error
    }
  }
}