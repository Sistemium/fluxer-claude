import axios from 'axios'
import Session from 'supertokens-web-js/recipe/session'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3000/api',
  withCredentials: true,
})

// Add request interceptor to handle authentication
api.interceptors.request.use(async (config) => {
  // Add session token if authenticated
  if (await Session.doesSessionExist()) {
    // SuperTokens automatically handles cookies, no need to manually add headers
  }
  return config
})

// Add response interceptor to handle 401 errors
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      // Session expired or invalid
      await Session.signOut()
      window.location.href = '/auth'
    }
    return Promise.reject(error)
  }
)

export default api