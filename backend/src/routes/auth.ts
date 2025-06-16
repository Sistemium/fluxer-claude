import Router from 'koa-router'

export const authRoutes = new Router()

// Временные маршруты для тестирования без SuperTokens
authRoutes.post('/signup', async (ctx: any) => {
  try {
    const { email, password } = ctx.request.body.formFields.reduce((acc: any, field: any) => {
      acc[field.id] = field.value
      return acc
    }, {})

    // Простая валидация
    if (!email || !password) {
      ctx.status = 400
      ctx.body = { status: 'FIELD_ERROR', formFields: [{ id: 'email', error: 'Email is required' }] }
      return
    }

    // Мок успешной регистрации
    ctx.body = { status: 'OK' }
  } catch (error) {
    console.error('Auth signup error:', error)
    ctx.status = 500
    ctx.body = { status: 'GENERAL_ERROR', message: 'Something went wrong' }
  }
})

authRoutes.post('/signin', async (ctx: any) => {
  try {
    const { email, password } = ctx.request.body.formFields.reduce((acc: any, field: any) => {
      acc[field.id] = field.value
      return acc
    }, {})

    // Простая валидация
    if (!email || !password) {
      ctx.status = 400
      ctx.body = { status: 'FIELD_ERROR', formFields: [{ id: 'email', error: 'Email is required' }] }
      return
    }

    // Мок успешного входа
    ctx.body = { status: 'OK' }
  } catch (error) {
    console.error('Auth signin error:', error)
    ctx.status = 500
    ctx.body = { status: 'GENERAL_ERROR', message: 'Something went wrong' }
  }
})