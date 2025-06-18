import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import Session from 'supertokens-web-js/recipe/session'
import EmailPassword from 'supertokens-web-js/recipe/emailpassword'
import { SocketService } from '@/services/socketService'

export const useAuthStore = defineStore('auth', () => {
  const isAuthenticated = ref(false)
  const isLoading = ref(true)
  const user = ref<{ id: string; email?: string } | null>(null)

  const isLoggedIn = computed(() => isAuthenticated.value)
  const userId = computed(() => user.value?.id)

  async function checkSession() {
    try {
      isLoading.value = true
      const sessionExists = await Session.doesSessionExist()
      
      if (sessionExists) {
        const userId = await Session.getUserId()
        isAuthenticated.value = true
        user.value = { id: userId }
        
        // Connect to WebSocket when authenticated
        const socketService = SocketService.getInstance()
        try {
          // Disconnect first if already connected to ensure fresh connection with auth
          if (socketService.isConnected) {
            socketService.disconnect()
          }
          await socketService.connect()
          console.log('WebSocket connected for authenticated user:', userId)
        } catch (error) {
          console.error('Failed to connect to WebSocket:', error)
        }
      } else {
        isAuthenticated.value = false
        user.value = null
      }
    } catch (error) {
      console.error('Error checking session:', error)
      isAuthenticated.value = false
      user.value = null
    } finally {
      isLoading.value = false
    }
  }

  async function signIn(email: string, password: string) {
    try {
      const response = await EmailPassword.signIn({
        formFields: [
          { id: 'email', value: email },
          { id: 'password', value: password }
        ]
      })

      if (response.status === 'OK') {
        await checkSession()
        return { success: true }
      } else {
        return { 
          success: false, 
          error: response.status === 'WRONG_CREDENTIALS_ERROR' 
            ? 'Invalid email or password' 
            : 'Sign in failed'
        }
      }
    } catch (error) {
      console.error('Sign in error:', error)
      return { success: false, error: 'Network error' }
    }
  }

  async function signUp(email: string, password: string) {
    try {
      const response = await EmailPassword.signUp({
        formFields: [
          { id: 'email', value: email },
          { id: 'password', value: password }
        ]
      })

      if (response.status === 'OK') {
        await checkSession()
        return { success: true }
      } else {
        return { 
          success: false, 
          error: response.status === 'EMAIL_ALREADY_EXISTS_ERROR' 
            ? 'Email already exists' 
            : 'Sign up failed'
        }
      }
    } catch (error) {
      console.error('Sign up error:', error)
      return { success: false, error: 'Network error' }
    }
  }

  async function signOut() {
    try {
      await Session.signOut()
      isAuthenticated.value = false
      user.value = null
      
      // Disconnect WebSocket when signing out
      const socketService = SocketService.getInstance()
      socketService.disconnect()
    } catch (error) {
      console.error('Sign out error:', error)
    }
  }

  return {
    isAuthenticated,
    isLoading,
    user,
    userId,
    isLoggedIn,
    checkSession,
    signIn,
    signUp,
    signOut
  }
})