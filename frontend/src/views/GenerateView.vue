<template>
  <v-container>
    <v-row>
      <v-col cols="12" md="6">
        <v-card>
          <v-card-title>Generate Image</v-card-title>
          <v-card-text>
            <v-form @submit.prevent="generateImage">
              <v-textarea
                v-model="prompt"
                label="Enter your prompt"
                placeholder="A beautiful sunset over mountains..."
                rows="4"
                variant="outlined"
                :disabled="imagesStore.isGenerating"
              ></v-textarea>

              <v-row class="mt-4">
                <v-col cols="6">
                  <v-select
                    v-model="width"
                    :items="dimensions"
                    label="Width"
                    variant="outlined"
                    :disabled="imagesStore.isGenerating"
                  ></v-select>
                </v-col>
                <v-col cols="6">
                  <v-select
                    v-model="height"
                    :items="dimensions"
                    label="Height"
                    variant="outlined"
                    :disabled="imagesStore.isGenerating"
                  ></v-select>
                </v-col>
              </v-row>

              <v-row class="mt-2">
                <v-col cols="6">
                  <v-text-field
                    v-model="num_inference_steps"
                    type="number"
                    :min="10"
                    :max="100"
                    label="Inference Steps"
                    variant="outlined"
                    :disabled="imagesStore.isGenerating"
                    hint="10-100 steps (more = better quality, slower)"
                    persistent-hint
                  ></v-text-field>
                </v-col>
                <v-col cols="6">
                  <v-text-field
                    v-model="guidance_scale"
                    type="number"
                    :min="1"
                    :max="20"
                    :step="0.5"
                    label="Guidance Scale"
                    variant="outlined"
                    :disabled="imagesStore.isGenerating"
                    hint="1-20 (higher = follows prompt more strictly)"
                    persistent-hint
                  ></v-text-field>
                </v-col>
              </v-row>

              <v-btn
                type="submit"
                color="primary"
                block
                size="large"
                :loading="imagesStore.isGenerating"
                :disabled="!prompt.trim()"
              >
                Generate Image
              </v-btn>
            </v-form>
          </v-card-text>
        </v-card>
      </v-col>

      <v-col cols="12" md="6">
        <v-card>
          <v-card-title>Preview</v-card-title>
          <v-card-text>
            <div v-if="generatedImage" class="text-center">
              <v-img
                :src="generatedImage"
                :width="300"
                :height="300"
                class="mx-auto"
                cover
              ></v-img>
            </div>
            <div v-else-if="imagesStore.isGenerating" class="text-center">
              <v-progress-circular
                :model-value="imagesStore.generationProgress"
                :rotate="360"
                :size="100"
                :width="8"
                color="primary"
              >
                <template v-slot:default>
                  {{ Math.round(imagesStore.generationProgress) }}%
                </template>
              </v-progress-circular>
              <p class="mt-4">{{ imagesStore.generationMessage || 'Generating your image...' }}</p>
              
              <!-- Show job ID for reference -->
              <p v-if="imagesStore.currentJobId" class="text-caption text-grey mt-2">
                Job ID: {{ imagesStore.currentJobId }}
              </p>
              
              <v-progress-linear
                :model-value="imagesStore.generationProgress"
                color="primary"
                height="8"
                rounded
                class="mt-4"
              ></v-progress-linear>
              
              <!-- Show restoration notice if this is a restored session -->
              <v-alert
                v-if="isRestoredSession"
                type="info"
                variant="tonal"
                class="mt-4"
                density="compact"
                closable
              >
                <v-icon start>mdi-restore</v-icon>
                Session restored! Your generation will continue.
              </v-alert>
            </div>
            <div v-else class="text-center text-grey">
              <v-icon size="64" color="grey-lighten-1">mdi-image-outline</v-icon>
              <p>Your generated image will appear here</p>
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
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

const prompt = ref('')
const width = ref(512)
const height = ref(512)
const guidance_scale = ref(7.5)
const num_inference_steps = ref(50)
const generatedImage = ref<string | null>(null)
const isRestoredSession = ref(false)

const dimensions = [256, 512, 768, 1024]

async function generateImage () {
  if (!prompt.value.trim()) return

  generatedImage.value = null

  try {
    const result = await imagesStore.generateImage({
      prompt: prompt.value,
      width: width.value,
      height: height.value,
      guidance_scale: guidance_scale.value,
      num_inference_steps: num_inference_steps.value
    })
    
    generatedImage.value = result.imageUrl
  } catch (error) {
    console.error('Error generating image:', error)
  }
}

// Restore state if jobId is provided in URL
onMounted(async () => {
  // Set navigation callback for the store
  imagesStore.setNavigationCallback((path: string) => {
    router.push(path)
  })
  
  const jobIdFromRoute = props.jobId || route.params.jobId as string
  
  if (jobIdFromRoute) {
    console.log('Restoring generation state for jobId:', jobIdFromRoute)
    isRestoredSession.value = true
    
    try {
      const result = await imagesStore.restoreGenerationState(jobIdFromRoute)
      
      if (result) {
        // Show the completed image
        generatedImage.value = result.imageUrl
        
        // Show success message
        console.log('Generation state restored successfully')
        
        // Redirect to clean generate URL after showing result
        setTimeout(() => {
          router.push('/generate')
        }, 5000)
      } else {
        // Job not found or failed, redirect to generate page
        console.log('Failed to restore state, redirecting to generate')
        setTimeout(() => {
          router.push('/generate')
        }, 1000)
      }
    } catch (error) {
      console.error('Error restoring generation state:', error)
      setTimeout(() => {
        router.push('/generate')
      }, 1000)
    }
  }
})
</script>