import { Image } from '../models/Image.js'
import logger from '../utils/logger.js'

export class UserService {
  async getUserProfile(userId: string) {
    try {
      // In a real implementation, you might have a separate User model
      // For now, we'll construct profile from available data
      const [totalImages, completedImages, failedImages] = await Promise.all([
        Image.countDocuments({ userId }),
        Image.countDocuments({ userId, status: 'completed' }),
        Image.countDocuments({ userId, status: 'failed' })
      ])

      const recentImages = await Image.find({ userId, status: 'completed' })
        .sort({ createdAt: -1 })
        .limit(5)
        .select('imageUrl prompt createdAt')
        .lean()

      return {
        userId,
        stats: {
          totalImages,
          completedImages,
          failedImages,
          generatingImages: totalImages - completedImages - failedImages
        },
        recentImages: recentImages.map(img => ({
          id: img._id,
          imageUrl: img.imageUrl,
          prompt: img.prompt,
          createdAt: img.createdAt
        }))
      }
    } catch (error) {
      logger.error('Error fetching user profile:', error)
      throw error
    }
  }

  async getUserStats(userId: string) {
    try {
      const [
        totalImages,
        completedImages,
        failedImages,
        generatingImages,
        todayImages,
        weekImages,
        monthImages
      ] = await Promise.all([
        Image.countDocuments({ userId }),
        Image.countDocuments({ userId, status: 'completed' }),
        Image.countDocuments({ userId, status: 'failed' }),
        Image.countDocuments({ userId, status: 'generating' }),
        Image.countDocuments({ 
          userId, 
          createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } 
        }),
        Image.countDocuments({ 
          userId, 
          createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } 
        }),
        Image.countDocuments({ 
          userId, 
          createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } 
        })
      ])

      return {
        total: {
          totalImages,
          completedImages,
          failedImages,
          generatingImages
        },
        timeframes: {
          today: todayImages,
          thisWeek: weekImages,
          thisMonth: monthImages
        },
        successRate: totalImages > 0 ? (completedImages / totalImages) * 100 : 0
      }
    } catch (error) {
      logger.error('Error fetching user stats:', error)
      throw error
    }
  }
}