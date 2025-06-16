import Router from 'koa-router'
// import { verifySession } from 'supertokens-node/recipe/session/framework/koa/index.js'
import { generateRoutes } from './generate.js'
import { imageRoutes } from './images.js'
import { userRoutes } from './users.js'

export const apiRoutes = new Router()

// Public routes
apiRoutes.get('/health', (ctx) => {
  ctx.body = { status: 'ok', timestamp: new Date().toISOString() }
})

// Protected routes 
apiRoutes.use('/generate', generateRoutes.routes())
apiRoutes.use('/images', imageRoutes.routes())
apiRoutes.use('/users', userRoutes.routes())