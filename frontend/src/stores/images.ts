import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/utils/api'

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

  async function generateImage(request: GenerationRequest) {
    try {
      isGenerating.value = true
      generationError.value = null

      const response = await api.post('/generate', request)
      const { jobId } = response.data

      // Poll for completion
      return pollJobStatus(jobId)
    } catch (error: any) {
      generationError.value = error.response?.data?.error || 'Failed to generate image'
      throw error
    } finally {
      isGenerating.value = false
    }
  }

  async function pollJobStatus(jobId: string): Promise<GeneratedImage> {
    return new Promise((resolve, reject) => {
      const poll = async () => {
        try {
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
            resolve(image)
            return
          }

          if (status.status === 'failed') {
            reject(new Error(status.error || 'Generation failed'))
            return
          }

          // Continue polling
          setTimeout(poll, 2000)
        } catch (error) {
          reject(error)
        }
      }

      poll()
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
    generateImage,
    loadImages,
    deleteImage
  }
})