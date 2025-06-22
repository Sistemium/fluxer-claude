<route lang="yaml">
meta:
  requiresAuth: true
</route>

<template>
  <v-container>
    <v-row justify="center">
      <v-col cols="12" sm="6">
        <GenerateForm
          v-model="formData"
          :disabled="imagesStore.isGenerating"
          :loading="imagesStore.isGenerating"
          @submit="generateImage"
        />
      </v-col>
      <!-- Child routes (like [jobId]) will be rendered here -->
      <router-view />
    </v-row>
    
  </v-container>
</template>

<script setup lang="ts">
import { reactive } from 'vue'
import { useRouter } from 'vue-router'
import { useImagesStore, type GenerationRequest } from '@/stores/images'
import GenerateForm from '@/components/GenerateForm.vue'

const router = useRouter()
const imagesStore = useImagesStore()

const formData = reactive<GenerationRequest>({
  prompt: '',
  width: Number(import.meta.env.VITE_DEFAULT_WIDTH) || 1024,
  height: Number(import.meta.env.VITE_DEFAULT_HEIGHT) || 1024,
  guidance_scale: Number(import.meta.env.VITE_DEFAULT_GUIDANCE_SCALE) || 3.5,
  num_inference_steps: Number(import.meta.env.VITE_DEFAULT_NUM_INFERENCE_STEPS) || 50
})


async function generateImage (data?: GenerationRequest) {
  const generateData = data || formData
  
  if (!generateData.prompt.trim()) return

  try {
    const result = await imagesStore.generateImage(generateData)
    
    // Navigate to the job-specific page to show progress/result
    if (result.jobId) {
      router.push(`/generate/${result.jobId}`)
    }
  } catch (error) {
    console.error('Error generating image:', error)
  }
}
</script>