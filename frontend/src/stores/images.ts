import { defineStore } from 'pinia'
import { ref } from 'vue'
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

interface GenerationRequest {
  prompt: string
  width: number
  height: number
  guidance_scale?: number
  num_inference_steps?: number
}

export const useImagesStore = defineStore('images', () => {
  const images = ref<GeneratedImage[]>([])
  const isGenerating = ref(false)
  const generationError = ref<string | null>(null)
  const generationProgress = ref(0)
  const generationMessage = ref('')
  const currentJobId = ref<string | null>(null)
  const navigationCallback = ref<((path: string) => void) | null>(null)
  
  // WebSocket initialization flag
  let isWebSocketInitialized = false
  const socketService = SocketService.getInstance()

  // Initialize WebSocket once with global handlers
  async function initializeWebSocket() {
    if (isWebSocketInitialized) return
    
    try {
      await socketService.connect()
      console.log('WebSocket connected globally')
      
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
        
        // Reset generation state
        isGenerating.value = false
        generationProgress.value = 100
        generationMessage.value = 'Completed!'
        currentJobId.value = null
        
        return image
      } else {
        console.warn('Completion event received but image not ready:', status)
        throw new Error('Image not ready')
      }
    } catch (error) {
      console.error('Error handling completion:', error)
      generationError.value = 'Failed to load completed image'
      isGenerating.value = false
      currentJobId.value = null
      throw error
    }
  }

  async function generateImage(request: GenerationRequest) {
    try {
      // Initialize WebSocket if not already done
      await initializeWebSocket()
      
      isGenerating.value = true
      generationError.value = null
      generationProgress.value = 0
      generationMessage.value = 'Starting generation...'

      const response = await api.post('/generate', request)
      const { jobId } = response.data
      currentJobId.value = String(jobId)
      console.log('Generation started with jobId:', jobId, 'type:', typeof jobId)

      // Update URL to include jobId for state restoration
      if (navigationCallback.value) {
        navigationCallback.value(`/generate/${jobId}`)
      }

      // Return a promise that resolves when generation completes
      return new Promise<GeneratedImage>((resolve, reject) => {
        console.log('Setting up WebSocket callbacks for job:', jobId)
        
        // Register progress callback for this job
        socketService.onProgress(jobId, (progress) => {
          console.log('Progress for job:', jobId, progress.progress)
          generationProgress.value = progress.progress
          generationMessage.value = progress.message || 'Generating...'
        })
        
        // Register completion callback for this job
        socketService.onCompleted(jobId, async (completed) => {
          console.log('Completion for job:', jobId)
          try {
            const image = await handleJobCompletion(jobId)
            socketService.unsubscribe(jobId)
            resolve(image)
          } catch (error) {
            socketService.unsubscribe(jobId)
            reject(error)
          }
        })
        
        // Register error callback for this job
        socketService.onError(jobId, (error) => {
          console.log('Error for job:', jobId, error.error)
          generationError.value = error.error
          isGenerating.value = false
          currentJobId.value = null
          socketService.unsubscribe(jobId)
          reject(new Error(error.error))
        })
      })
    } catch (error: any) {
      generationError.value = error.response?.data?.error || 'Failed to generate image'
      console.error('Generation error:', error)
      isGenerating.value = false
      generationProgress.value = 0
      generationMessage.value = ''
      currentJobId.value = null
      
      // Update URL back to /generate on error
      if (navigationCallback.value) {
        navigationCallback.value('/generate')
      }
      
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
        return false
      }
      
      currentJobId.value = jobId
      
      if (status.status === 'generating') {
        // Job is still in progress, restore generating state
        await initializeWebSocket()
        
        isGenerating.value = true
        generationProgress.value = status.progress || 0
        generationMessage.value = 'Restoring generation...'
        generationError.value = null
        
        // Register WebSocket callbacks for this job
        console.log('Setting up WebSocket callbacks for restored job:', jobId)
        
        socketService.onProgress(jobId, (progress) => {
          console.log('Restored progress for job:', jobId, progress.progress)
          generationProgress.value = progress.progress
          generationMessage.value = progress.message || 'Generating...'
        })
        
        socketService.onCompleted(jobId, async (completed) => {
          console.log('Restored completion for job:', jobId)
          try {
            await handleJobCompletion(jobId)
            socketService.unsubscribe(jobId)
            
            // Reset state after completion
            isGenerating.value = false
            currentJobId.value = null
            
            // Update URL back to /generate
            if (navigationCallback.value) {
              navigationCallback.value('/generate')
            }
          } catch (error) {
            console.error('Error handling restored completion:', error)
            socketService.unsubscribe(jobId)
          }
        })
        
        socketService.onError(jobId, (error) => {
          console.log('Restored error for job:', jobId, error.error)
          generationError.value = error.error
          isGenerating.value = false
          currentJobId.value = null
          socketService.unsubscribe(jobId)
        })
        
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
          
          return image
        }
      } else if (status.status === 'failed') {
        // Job failed, show error
        generationError.value = status.error || 'Generation failed'
        return false
      }
      
      return false
    } catch (error) {
      console.error('Error restoring generation state:', error)
      generationError.value = 'Failed to restore generation state'
      return false
    }
  }
  
  // Function to set navigation callback to avoid circular imports
  function setNavigationCallback(callback: (path: string) => void) {
    navigationCallback.value = callback
  }
  
  return {
    images,
    isGenerating,
    generationError,
    generationProgress,
    generationMessage,
    currentJobId,
    generateImage,
    loadImages,
    deleteImage,
    restoreGenerationState,
    setNavigationCallback
  }
})