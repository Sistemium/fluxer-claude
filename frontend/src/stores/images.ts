import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '@/utils/api'
import { SocketService } from '@/services/socketService'

interface GeneratedImage {
  id: string
  prompt: string
  imageUrl: string
  width: number
  height: number
  createdAt: string
}

interface GenerationInfo {
  jobId: string
  status: 'queued' | 'generating' | 'completed' | 'failed'
  progress: number
  message: string
  error?: string
  image?: GeneratedImage
  createdAt: string
}

export interface GenerationRequest {
  prompt: string
  width: number
  height: number
  guidance_scale?: number
  num_inference_steps?: number
}

export interface GenerationResponse {
  jobId: string
  status: "queued"
  message: string
}

export const useImagesStore = defineStore('images', () => {
  const images = ref<GeneratedImage[]>([])
  const generations = ref(new Map<string, GenerationInfo>())
  const navigationCallback = ref<((path: string) => void) | null>(null)
  
  // Computed for backwards compatibility
  const isGenerating = computed(() => {
    return Array.from(generations.value.values()).some(gen => gen.status === 'generating')
  })
  
  const generationError = computed(() => {
    const errorGen = Array.from(generations.value.values()).find(gen => gen.error)
    return errorGen?.error || null
  })
  
  const generationProgress = computed(() => {
    const activeGen = Array.from(generations.value.values()).find(gen => gen.status === 'generating')
    return activeGen?.progress || 0
  })
  
  const generationMessage = computed(() => {
    const activeGen = Array.from(generations.value.values()).find(gen => gen.status === 'generating')
    return activeGen?.message || ''
  })
  
  const currentJobId = computed(() => {
    const activeGen = Array.from(generations.value.values()).find(gen => gen.status === 'generating')
    return activeGen?.jobId || null
  })

  // WebSocket initialization flag
  let isWebSocketInitialized = false
  const socketService = SocketService.getInstance()

  // Initialize WebSocket once with global handlers
  async function initializeWebSocket() {
    if (isWebSocketInitialized) return

    try {
      await socketService.connect()
      console.log('WebSocket connected globally')
      
      // Set up global event handlers
      socketService.setProgressHandler((progress) => {
        console.log('Global progress handler:', progress)
        const generation = generations.value.get(progress.jobId)
        if (generation) {
          generation.progress = progress.progress
          generation.message = progress.message || 'Generating...'
          generations.value.set(progress.jobId, { ...generation })
        }
      })
      
      socketService.setCompletedHandler(async (completed) => {
        console.log('Global completion handler:', completed)
        await handleJobCompletion(completed.jobId)
      })
      
      socketService.setErrorHandler((error) => {
        console.log('Global error handler:', error)
        const generation = generations.value.get(error.jobId)
        if (generation) {
          generation.status = 'failed'
          generation.error = error.error
          generations.value.set(error.jobId, { ...generation })
        }
      })

      isWebSocketInitialized = true
    } catch (error) {
      console.error('Failed to initialize WebSocket:', error)
      throw error
    }
  }

  // Handle job completion
  async function handleJobCompletion(jobId: string) {
    try {
      console.log('Handling completion for job:', jobId)
      const response = await api.get(`/generate/status/${jobId}`)
      const status = response.data
      console.log('API status response:', status)

      if (status.status === 'completed' && status.image) {
        const image: GeneratedImage = {
          id: status.image.id,
          prompt: status.image.prompt,
          imageUrl: status.image.imageUrl,
          width: status.image.width || 512,
          height: status.image.height || 512,
          createdAt: status.image.createdAt
        }

        console.log('Adding completed image to store:', image.id)
        images.value.unshift(image)

        // Update generation state
        const generation = generations.value.get(jobId)
        if (generation) {
          generation.status = 'completed'
          generation.progress = 100
          generation.message = 'Completed!'
          generation.image = image
          generations.value.set(jobId, { ...generation })
        }
        
        // Show toast if user is not on the job page
        if (typeof window !== 'undefined') {
          const currentPath = window.location.pathname
          if (!currentPath.includes(jobId)) {
            // Import composable dynamically to avoid circular dependencies
            import('@/composables/useToast').then(({ useToast }) => {
              const { success } = useToast()
              success(`Image generation completed! Job: ${jobId}`, 8000)
            })
          }
        }

        return image
      } else {
        console.warn('Completion event received but image not ready:', status)
        throw new Error('Image not ready')
      }
    } catch (error) {
      console.error('Error handling completion:', error)
      const generation = generations.value.get(jobId)
      if (generation) {
        generation.status = 'failed'
        generation.error = 'Failed to load completed image'
        generations.value.set(jobId, { ...generation })
      }
      throw error
    }
  }

  async function generateImage(request: GenerationRequest): Promise<{ jobId: string }> {
    try {
      // Initialize WebSocket if not already done
      await initializeWebSocket()

      const response = await api.post<GenerationResponse>('/generate', request)
      const { jobId } = response.data
      console.log('Generation started with jobId:', jobId, 'type:', typeof jobId)
      
      // Create generation info
      const generationInfo: GenerationInfo = {
        jobId: String(jobId),
        status: 'queued',
        progress: 0,
        message: 'Starting generation...',
        createdAt: new Date().toISOString()
      }
      
      generations.value.set(String(jobId), generationInfo)

      // Return jobId immediately for navigation
      return { jobId: String(jobId) }
    } catch (error: any) {
      console.error('Generation error:', error)
      throw error
    }
  }



  async function loadImages() {
    try {
      const response = await api.get('/images')
      images.value = response.data.images
    } catch (error) {
      console.error('Failed to load images:', error)
    }
  }

  async function deleteImage(imageId: string) {
    try {
      await api.delete(`/images/${imageId}`)
      images.value = images.value.filter(img => img.id !== imageId)
    } catch (error) {
      console.error('Failed to delete image:', error)
      throw error
    }
  }

  // Function to restore generation state from jobId
  async function restoreGenerationState(jobId: string) {
    try {
      console.log('Restoring generation state for job:', jobId)

      // Check job status from API
      const response = await api.get(`/generate/status/${jobId}`)
      const status = response.data
      console.log('Job status on restore:', status)

      if (!status) {
        console.log('Job not found, redirecting to generate page')
        return undefined
      }

      if (status.status === 'generating') {
        // Job is still in progress, restore generating state
        await initializeWebSocket()

        const generationInfo: GenerationInfo = {
          jobId,
          status: 'generating',
          progress: status.progress || 0,
          message: 'Restoring generation...',
          createdAt: status.createdAt || new Date().toISOString()
        }
        
        generations.value.set(jobId, generationInfo)
        console.log('Restored generation state for job:', jobId)

        return true
      } else if (status.status === 'completed') {
        // Job already completed, show result and redirect
        console.log('Job already completed, showing result')

        if (status.image) {
          const image: GeneratedImage = {
            id: status.image.id,
            prompt: status.image.prompt,
            imageUrl: status.image.imageUrl,
            width: status.image.width || 512,
            height: status.image.height || 512,
            createdAt: status.image.createdAt
          }

          // Add to images if not already there
          const existingImage = images.value.find(img => img.id === image.id)
          if (!existingImage) {
            images.value.unshift(image)
          }
          
          // Store completed generation info
          const generationInfo: GenerationInfo = {
            jobId,
            status: 'completed',
            progress: 100,
            message: 'Completed!',
            image,
            createdAt: status.createdAt || new Date().toISOString()
          }
          
          generations.value.set(jobId, generationInfo)

          return image
        }
      } else if (status.status === 'failed') {
        // Job failed, show error
        const generationInfo: GenerationInfo = {
          jobId,
          status: 'failed',
          progress: 0,
          message: 'Generation failed',
          error: status.error || 'Generation failed',
          createdAt: status.createdAt || new Date().toISOString()
        }
        
        generations.value.set(jobId, generationInfo)
        return false
      }

      return false
    } catch (error) {
      console.error('Error restoring generation state:', error)
      const generationInfo: GenerationInfo = {
        jobId,
        status: 'failed',
        progress: 0,
        message: 'Failed to restore generation state',
        error: 'Failed to restore generation state',
        createdAt: new Date().toISOString()
      }
      
      generations.value.set(jobId, generationInfo)
      return false
    }
  }
  
  // Get generation info by jobId
  function getGenerationInfo(jobId: string) {
    return computed(() => generations.value.get(jobId))
  }

  // Function to set navigation callback to avoid circular imports
  function setNavigationCallback(callback: (path: string) => void) {
    navigationCallback.value = callback
  }

  return {
    images,
    generations,
    isGenerating,
    generationError,
    generationProgress,
    generationMessage,
    currentJobId,
    generateImage,
    loadImages,
    deleteImage,
    restoreGenerationState,
    getGenerationInfo,
    setNavigationCallback
  }
})