import { createRouter, createWebHistory } from 'vue-router'
import { routes } from 'vue-router/auto-routes'
import { useAuthStore } from '@/stores/auth'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes
})

// Navigation guard
router.beforeEach(async (to) => {
  const authStore = useAuthStore()
  
  // Check session on first navigation
  if (authStore.isLoading) {
    await authStore.checkSession()
  }

  // Redirect to auth if not authenticated and route requires auth
  if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    return '/auth'
  }

  // Redirect to home if authenticated and trying to access auth page
  if (to.meta.requiresGuest && authStore.isAuthenticated) {
    return '/'
  }

  // Check admin access for admin routes
  if (to.meta.requiresAdmin && !authStore.isAdmin) {
    return '/'
  }
})

export default router