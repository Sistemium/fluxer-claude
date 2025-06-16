import Router from 'koa-router'
import { UserService } from '../services/userService.js'
import logger from '../utils/logger.js'

export const userRoutes = new Router()

userRoutes.get('/profile', async (ctx: any) => {
  try {
    const userId = ctx.session.getUserId()
    const userService = new UserService()
    const profile = await userService.getUserProfile(userId)
    
    ctx.body = profile
  } catch (error) {
    logger.error('Error fetching user profile:', error)
    ctx.status = 500
    ctx.body = { error: 'Failed to fetch profile' }
  }
})

userRoutes.get('/stats', async (ctx: any) => {
  try {
    const userId = ctx.session.getUserId()
    const userService = new UserService()
    const stats = await userService.getUserStats(userId)
    
    ctx.body = stats
  } catch (error) {
    logger.error('Error fetching user stats:', error)
    ctx.status = 500
    ctx.body = { error: 'Failed to fetch stats' }
  }
})