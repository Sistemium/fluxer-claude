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

  async function generateImage(request: GenerationRequest) {
    try {
      isGenerating.value = true
      generationError.value = null
      generationProgress.value = 0
      generationMessage.value = 'Starting generation...'

      const response = await api.post('/generate', request)
      const { jobId } = response.data
      console.log('Generation started with jobId:', jobId, 'type:', typeof jobId)

      // Use WebSocket for real-time updates instead of polling
      const result = await useWebSocketUpdates(String(jobId))
      
      // Reset UI state after successful completion
      console.log('Generation completed successfully')
      isGenerating.value = false
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
        try {
          // Fetch the full image data from API
          const response = await api.get(`/generate/status/${jobId}`)
          const status = response.data

          if (status.status === 'completed' && status.image) {
            const image: GeneratedImage = {
              id: status.image.id,
              prompt: status.image.prompt,
              imageUrl: status.image.imageUrl,
              width: status.image.width || 512,
              height: status.image.height || 512,
              createdAt: status.image.createdAt
            }
            
            // Add to images list
            images.value.unshift(image)
            
            // Cleanup
            socketService.unsubscribe(jobId)
            resolve(image)
          }
        } catch (error) {
          socketService.unsubscribe(jobId)
          reject(error)
        }
      })

      // Subscribe to errors
      socketService.onError(jobId, (error) => {
        generationError.value = error.error
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

  return {
    images,
    isGenerating,
    generationError,
    generationProgress,
    generationMessage,
    generateImage,
    loadImages,
    deleteImage
  }
})