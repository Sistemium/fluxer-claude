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

  async function generateImage(request: GenerationRequest) {
    try {
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

      // Use WebSocket for real-time updates instead of polling
      const result = await useWebSocketUpdates(String(jobId))
      
      // Reset UI state after successful completion
      console.log('Generation completed successfully')
      isGenerating.value = false
      currentJobId.value = null
      
      // Update URL back to /generate
      if (navigationCallback.value) {
        navigationCallback.value('/generate')
      }
      
      setTimeout(() => {
        generationProgress.value = 0
        generationMessage.value = ''
      }, 2000)
      
      return result
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

  async function useWebSocketUpdates(jobId: string): Promise<GeneratedImage> {
    return new Promise(async (resolve, reject) => {
      const socketService = SocketService.getInstance()
      
      // Connect to WebSocket if not already connected
      if (!socketService.isConnected) {
        try {
          await socketService.connect()
          console.log('WebSocket connected for job:', jobId)
        } catch (error) {
          console.error('Failed to connect WebSocket:', error)
          reject(error)
          return
        }
      }

      console.log('Setting up progress callback for job:', jobId, 'type:', typeof jobId)
      
      // Subscribe to progress updates
      socketService.onProgress(jobId, (progress) => {
        console.log('Store received progress for job:', jobId, 'progress:', progress.progress, 'message:', progress.message)
        console.log('Progress event job ID:', progress.jobId, 'matches expected:', progress.jobId === jobId)
        generationProgress.value = progress.progress
        generationMessage.value = progress.message || 'Generating...'
      })

      // Subscribe to completion
      socketService.onCompleted(jobId, async (completed) => {
        console.log('WebSocket completion event received for job:', jobId, completed)
        try {
          // Fetch the full image data from API
          console.log('Fetching image status from API for job:', jobId)
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
            // Add to images list
            images.value.unshift(image)
            
            // Cleanup
            socketService.unsubscribe(jobId)
            currentJobId.value = null
            resolve(image)
          } else {
            console.warn('Completion event received but image not ready:', status)
            reject(new Error('Image not ready'))
          }
        } catch (error) {
          console.error('Error handling completion event:', error)
          socketService.unsubscribe(jobId)
          reject(error)
        }
      })

      // Subscribe to errors
      socketService.onError(jobId, (error) => {
        generationError.value = error.error
        currentJobId.value = null
        socketService.unsubscribe(jobId)
        reject(new Error(error.error))
      })
    })
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
        isGenerating.value = true
        generationProgress.value = status.progress || 0
        generationMessage.value = 'Restoring generation...'
        generationError.value = null
        
        // Continue listening for updates via WebSocket
        const result = await useWebSocketUpdates(jobId)
        
        // Reset state after completion
        isGenerating.value = false
        currentJobId.value = null
        
        // Update URL back to /generate
        if (navigationCallback.value) {
          navigationCallback.value('/generate')
        }
        
        setTimeout(() => {
          generationProgress.value = 0
          generationMessage.value = ''
        }, 2000)
        
        return result
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