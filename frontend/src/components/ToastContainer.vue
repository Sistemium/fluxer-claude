<template>
  <v-container class="toast-container">
    <v-snackbar 
      v-for="toast in toasts"
      :key="toast.id"
      :model-value="toast.show"
      :timeout="toast.timeout"
      :color="getToastColor(toast.type)"
      location="top right"
      multi-line
      @update:model-value="handleToastUpdate(toast.id, $event)"
    >
      <v-icon start>{{ getToastIcon(toast.type) }}</v-icon>
      {{ toast.message }}
      
      <template #actions>
        <v-btn 
          icon="mdi-close"
          size="small"
          @click="hideToast(toast.id)"
        />
      </template>
    </v-snackbar>
  </v-container>
</template>

<script setup lang="ts">
import { useToast } from '@/composables/useToast'

const { toasts, hideToast } = useToast()

function getToastColor(type: string) {
  switch (type) {
    case 'success': return 'success'
    case 'error': return 'error'
    case 'warning': return 'warning'
    case 'info': 
    default: 
      return 'info'
  }
}

function getToastIcon(type: string) {
  switch (type) {
    case 'success': return 'mdi-check-circle'
    case 'error': return 'mdi-alert-circle'
    case 'warning': return 'mdi-alert'
    case 'info':
    default:
      return 'mdi-information'
  }
}

function handleToastUpdate(id: string, show: boolean) {
  if (!show) {
    hideToast(id)
  }
}
</script>

<style scoped>
.toast-container {
  position: fixed;
  top: 0;
  right: 0;
  z-index: 9999;
  pointer-events: none;
}

.toast-container .v-snackbar {
  pointer-events: auto;
  margin-bottom: 8px;
}
</style>