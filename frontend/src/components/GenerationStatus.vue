<template>
  <v-card>
    <v-card-title class="text-center">
      <v-icon left>mdi-restore</v-icon>
      Generation Status
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
          Generation completed!
        </v-alert>
      </div>
      
      <div v-else-if="isGenerating">
        <!-- Show generation progress -->
        <v-progress-circular
          :model-value="progress"
          :rotate="360"
          :size="120"
          :width="12"
          color="primary"
          class="mb-4"
        >
          <template v-slot:default>
            {{ Math.round(progress) }}%
          </template>
        </v-progress-circular>
        
        <h3 class="mb-2">{{ message || 'Generating your image...' }}</h3>
        
        <p class="text-caption text-grey mb-4">
          Job ID: {{ jobId }}
        </p>
        
        <v-progress-linear
          :model-value="progress"
          color="primary"
          height="12"
          rounded
          class="mb-4"
        ></v-progress-linear>
        
        <v-alert type="info" variant="tonal" v-if="showRestoreMessage">
          <v-icon start>mdi-restore</v-icon>
          Your generation session has been restored and will continue automatically.
        </v-alert>
      </div>
      
      <div v-else-if="error">
        <!-- Show error state -->
        <v-alert type="error" variant="tonal" class="mb-4">
          <v-icon start>mdi-alert-circle</v-icon>
          {{ error }}
        </v-alert>
      </div>
      
      <div v-else>
        <!-- Loading state while checking job status -->
        <v-progress-circular indeterminate size="64" class="mb-4"></v-progress-circular>
        <p>Checking generation status...</p>
      </div>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
interface Props {
  jobId: string
  isGenerating?: boolean
  progress?: number
  message?: string
  error?: string | null
  generatedImage?: string | null
  showRestoreMessage?: boolean
}

withDefaults(defineProps<Props>(), {
  isGenerating: false,
  progress: 0,
  message: '',
  error: null,
  generatedImage: null,
  showRestoreMessage: false
})
</script>