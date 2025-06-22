<route lang="yaml">
meta:
  requiresAuth: true
</route>

<template>
  <v-row justify="center"
         class="mt-4">
    <v-col cols="12"
           md="8"
           lg="6">
      <GenerationStatus :job-id="jobId"
                        :is-generating="imagesStore.isGenerating"
                        :progress="imagesStore.generationProgress"
                        :message="imagesStore.generationMessage"
                        :error="imagesStore.generationError"
                        :generated-image="generatedImage"
                        :show-restore-message="showRestoreMessage" />
    </v-col>
  </v-row>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useImagesStore } from '@/stores/images'
import GenerationStatus from '@/components/GenerationStatus.vue'

// Props for jobId when coming from URL
const props = defineProps<{
  jobId?: string
}>()

const route = useRoute<'/generate/[jobId]'>()
const router = useRouter()
const imagesStore = useImagesStore()

const generatedImage = ref<string | null>(null)
const showRestoreMessage = ref(false)

// Get jobId from props or route params
const jobId = props.jobId || route.params.jobId as string

// Restore generation state on mount
onMounted(async () => {
  // Set navigation callback for the store
  imagesStore.setNavigationCallback((path: string) => {
    router.push(path)
  })

  console.log('Restoring generation state for jobId:', jobId)

  try {
    const result = await imagesStore.restoreGenerationState(jobId)

    if (result) {
      if (typeof result === 'object' && 'imageUrl' in result) {
        // Show the completed image
        generatedImage.value = result.imageUrl
        console.log('Generation state restored successfully')

      } else {
        // Job is in progress, show restore message
        showRestoreMessage.value = true
      }
    } else {
      // Job not found or failed, redirect to generate page
      console.log('Failed to restore state, redirecting to generate')
      setTimeout(() => {
        router.replace('/generate')
      }, 2000)
    }
  } catch (error) {
    console.error('Error restoring generation state:', error)
    setTimeout(() => {
      router.replace('/generate')
    }, 2000)
  }

})
</script>