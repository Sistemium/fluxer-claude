import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '@/views/HomeView.vue'
import { useAuthStore } from '@/stores/auth'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView
    },
    {
      path: '/auth',
      name: 'auth',
      component: () => import('@/views/AuthView.vue'),
      meta: { requiresGuest: true }
    },
    {
      path: '/generate',
      name: 'generate',
      component: () => import('@/views/GenerateView.vue'),
      meta: { requiresAuth: true }
    },
    {
      path: '/generate/:jobId',
      name: 'generate-with-job',
      component: () => import('@/views/GenerateView.vue'),
      meta: { requiresAuth: true },
      props: true
    },
    {
      path: '/gallery',
      name: 'gallery',
      component: () => import('@/views/GalleryView.vue'),
      meta: { requiresAuth: true }
    }
  ]
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
})

export default router