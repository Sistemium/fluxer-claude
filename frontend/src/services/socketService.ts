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
  private progressCallbacks = new Map<string, (progress: ProgressEvent) => void>()
  private completedCallbacks = new Map<string, (completed: CompletedEvent) => void>()
  private errorCallbacks = new Map<string, (error: ErrorEvent) => void>()

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
          const callback = this.progressCallbacks.get(data.jobId)
          console.log('Progress callback found:', !!callback, 'for job:', data.jobId)
          if (callback) {
            callback(data)
          }
        })

        // Listen for completion events
        this.socket.on('generation:completed', (data: CompletedEvent) => {
          console.log('Generation completed received:', data)
          const callback = this.completedCallbacks.get(data.jobId)
          console.log('Completion callback found:', !!callback, 'for job:', data.jobId)
          if (callback) {
            callback(data)
          }
        })

        // Listen for error events
        this.socket.on('generation:error', (data: ErrorEvent) => {
          console.log('Generation error received:', data)
          const callback = this.errorCallbacks.get(data.jobId)
          console.log('Error callback found:', !!callback, 'for job:', data.jobId)
          if (callback) {
            callback(data)
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
    this.progressCallbacks.clear()
    this.completedCallbacks.clear()
    this.errorCallbacks.clear()
  }

  // Subscribe to progress updates for a specific job
  onProgress(jobId: string, callback: (progress: ProgressEvent) => void) {
    console.log('Registering progress callback for job:', jobId)
    this.progressCallbacks.set(jobId, callback)
    console.log('Total progress callbacks:', this.progressCallbacks.size)
  }

  // Subscribe to completion for a specific job
  onCompleted(jobId: string, callback: (completed: CompletedEvent) => void) {
    console.log('Registering completion callback for job:', jobId)
    this.completedCallbacks.set(jobId, callback)
  }

  // Subscribe to errors for a specific job
  onError(jobId: string, callback: (error: ErrorEvent) => void) {
    console.log('Registering error callback for job:', jobId)
    this.errorCallbacks.set(jobId, callback)
  }

  // Unsubscribe from all events for a specific job
  unsubscribe(jobId: string) {
    this.progressCallbacks.delete(jobId)
    this.completedCallbacks.delete(jobId)
    this.errorCallbacks.delete(jobId)
  }

  get isConnected(): boolean {
    return this.socket?.connected || false
  }
}