<route lang="yaml">
meta:
  requiresAuth: true
</route>

<template>
  <v-col cols="12" sm="6">
    <GenerationStatus :job-id="jobId"
                      :is-generating="generation?.status === 'generating'"
                      :progress="generation?.progress || 0"
                      :message="generation?.message || ''"
                      :error="generation?.error || null"
                      :generated-image="generation?.image?.imageUrl || null"
                      :show-restore-message="false" />
  </v-col>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useImagesStore } from '@/stores/images'
import GenerationStatus from '@/components/GenerationStatus.vue'


const route = useRoute<'/generate/[jobId]'>()
const router = useRouter()
const imagesStore = useImagesStore()
const jobId = computed(() => route.params.jobId)

// Get reactive generation info from store
const generation = computed(() => imagesStore.getGenerationInfo(jobId.value))

// Restore generation state on mount
watch(jobId, async jobIdValue => {
  console.log('Restoring generation state for jobId:', jobIdValue)

  try {
    const result = await imagesStore.restoreGenerationState(jobIdValue)

    if (!result) {
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

}, { immediate: true })
</script>