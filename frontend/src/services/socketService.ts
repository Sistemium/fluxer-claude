import { io, Socket } from 'socket.io-client'
import { useAuthStore } from '@/stores/auth'

interface ProgressEvent {
  jobId: string
  progress: number
  message?: string
  timestamp: string
}

interface CompletedEvent {
  jobId: string
  imageUrl: string
  timestamp: string
}

interface ErrorEvent {
  jobId: string
  error: string
  timestamp: string
}

export class SocketService {
  private static instance: SocketService
  private socket: Socket | null = null
  private globalProgressHandler: ((progress: ProgressEvent) => void) | null = null
  private globalCompletedHandler: ((completed: CompletedEvent) => void) | null = null
  private globalErrorHandler: ((error: ErrorEvent) => void) | null = null

  static getInstance(): SocketService {
    if (!SocketService.instance) {
      SocketService.instance = new SocketService()
    }
    return SocketService.instance
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Use dedicated WebSocket URL or extract base URL from API URL
        let socketUrl = import.meta.env.VITE_WS_URL
        if (!socketUrl) {
          const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000'
          socketUrl = apiUrl.replace('/api', '')
        }
        
        console.log('Connecting to WebSocket at:', socketUrl)
        
        this.socket = io(socketUrl, {
          withCredentials: true,
          transports: ['websocket', 'polling']
        })

        this.socket.on('connect', () => {
          console.log('WebSocket connected:', this.socket?.id)
          
          // Join user-specific room
          const authStore = useAuthStore()
          console.log('Auth store user ID:', authStore.userId)
          console.log('Auth store user object:', authStore.user)
          console.log('Auth store isAuthenticated:', authStore.isAuthenticated)
          
          if (authStore.userId) {
            this.socket?.emit('join', authStore.userId)
            console.log('Joined room for user:', authStore.userId)
          } else {
            console.warn('Cannot join room: user ID is undefined')
          }
          
          resolve()
        })

        this.socket.on('connect_error', (error) => {
          console.error('WebSocket connection error:', error)
          reject(error)
        })

        this.socket.on('disconnect', () => {
          console.log('WebSocket disconnected')
        })

        // Listen for progress events
        this.socket.on('generation:progress', (data: ProgressEvent) => {
          console.log('Progress update received:', data)
          if (this.globalProgressHandler) {
            this.globalProgressHandler(data)
          }
        })

        // Listen for completion events
        this.socket.on('generation:completed', (data: CompletedEvent) => {
          console.log('Generation completed received:', data)
          if (this.globalCompletedHandler) {
            this.globalCompletedHandler(data)
          }
        })

        // Listen for error events
        this.socket.on('generation:error', (data: ErrorEvent) => {
          console.log('Generation error received:', data)
          if (this.globalErrorHandler) {
            this.globalErrorHandler(data)
          }
        })

      } catch (error) {
        reject(error)
      }
    })
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect()
      this.socket = null
    }
    this.globalProgressHandler = null
    this.globalCompletedHandler = null
    this.globalErrorHandler = null
  }

  // Set global progress handler
  setProgressHandler(callback: (progress: ProgressEvent) => void) {
    console.log('Setting global progress handler')
    this.globalProgressHandler = callback
  }

  // Set global completion handler
  setCompletedHandler(callback: (completed: CompletedEvent) => void) {
    console.log('Setting global completion handler')
    this.globalCompletedHandler = callback
  }

  // Set global error handler
  setErrorHandler(callback: (error: ErrorEvent) => void) {
    console.log('Setting global error handler')
    this.globalErrorHandler = callback
  }

  // Clear all handlers
  clearHandlers() {
    this.globalProgressHandler = null
    this.globalCompletedHandler = null
    this.globalErrorHandler = null
  }

  get isConnected(): boolean {
    return this.socket?.connected || false
  }
}