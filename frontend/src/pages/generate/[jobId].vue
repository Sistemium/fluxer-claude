<route lang="yaml">
meta:
  requiresAuth: true
</route>

<template>
  <v-row justify="center" class="mt-4">
    <v-col cols="12" md="8" lg="6">
      <v-card>
        <v-card-title class="text-center">
          <v-icon left>mdi-restore</v-icon>
          Restoring Generation Session
        </v-card-title>
        <v-card-text class="text-center">
          <div v-if="generatedImage">
            <!-- Show completed image -->
            <v-img
              :src="generatedImage"
              :width="400"
              :height="400"
              class="mx-auto mb-4"
              cover
            ></v-img>
            <v-alert type="success" variant="tonal" class="mb-4">
              <v-icon start>mdi-check-circle</v-icon>
              Generation completed! Redirecting to generate page...
            </v-alert>
          </div>
          
          <div v-else-if="imagesStore.isGenerating">
            <!-- Show generation progress -->
            <v-progress-circular
              :model-value="imagesStore.generationProgress"
              :rotate="360"
              :size="120"
              :width="12"
              color="primary"
              class="mb-4"
            >
              <template v-slot:default>
                {{ Math.round(imagesStore.generationProgress) }}%
              </template>
            </v-progress-circular>
            
            <h3 class="mb-2">{{ imagesStore.generationMessage || 'Generating your image...' }}</h3>
            
            <p class="text-caption text-grey mb-4">
              Job ID: {{ jobId }}
            </p>
            
            <v-progress-linear
              :model-value="imagesStore.generationProgress"
              color="primary"
              height="12"
              rounded
              class="mb-4"
            ></v-progress-linear>
            
            <v-alert type="info" variant="tonal">
              <v-icon start>mdi-restore</v-icon>
              Your generation session has been restored and will continue automatically.
            </v-alert>
          </div>
          
          <div v-else>
            <!-- Loading state while checking job status -->
            <v-progress-circular indeterminate size="64" class="mb-4"></v-progress-circular>
            <p>Checking generation status...</p>
          </div>
        </v-card-text>
      </v-card>
    </v-col>
  </v-row>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useImagesStore } from '@/stores/images'

// Props for jobId when coming from URL
const props = defineProps<{
  jobId?: string
}>()

const route = useRoute()
const router = useRouter()
const imagesStore = useImagesStore()

const generatedImage = ref<string | null>(null)

// Get jobId from props or route params
const jobId = props.jobId || route.params.jobId as string

// Restore generation state on mount
onMounted(async () => {
  // Set navigation callback for the store
  imagesStore.setNavigationCallback((path: string) => {
    router.push(path)
  })
  
  if (jobId) {
    console.log('Restoring generation state for jobId:', jobId)
    
    try {
      const result = await imagesStore.restoreGenerationState(jobId)
      
      if (result) {
        // Show the completed image
        generatedImage.value = result.imageUrl
        
        console.log('Generation state restored successfully')
        
        // Redirect to clean generate URL after showing result
        setTimeout(() => {
          router.push('/generate')
        }, 3000)
      } else {
        // Job not found or failed, redirect to generate page
        console.log('Failed to restore state, redirecting to generate')
        setTimeout(() => {
          router.push('/generate')
        }, 2000)
      }
    } catch (error) {
      console.error('Error restoring generation state:', error)
      setTimeout(() => {
        router.push('/generate')
      }, 2000)
    }
  } else {
    // No jobId provided, redirect immediately
    router.push('/generate')
  }
})
</script>