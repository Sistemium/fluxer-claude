<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    :fullscreen="false"
    transition="dialog-bottom-transition"
    max-width="1000"
  >
    <v-card>
      <v-toolbar dark color="black">
        <v-btn
          icon="mdi-close"
          @click="$emit('update:modelValue', false)"
        ></v-btn>
        <v-toolbar-title>{{ image.prompt }}</v-toolbar-title>
        <v-spacer></v-spacer>
        <v-btn
          icon="mdi-download"
          @click="onDownload"
        ></v-btn>
      </v-toolbar>
      
      <v-card-text class="mt-4 pa-0 align-center justify-center black">
        <v-img
          :src="image.imageUrl"
          :alt="image.prompt"
          max-height="70vh"
          contain
        ></v-img>
      </v-card-text>
      
      <v-card-actions class="justify-center pa-4 black">
        <div class="text-center">
          <CopyableText 
            :text="image.prompt" 
            text-class="text-body-1 white--text mb-2"
            icon-color="black"
          />
          <div class="text-caption grey--text">{{ formatDate(image.createdAt) }}</div>
        </div>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import CopyableText from './CopyableText.vue'

interface ImageType {
  id: string
  imageUrl: string
  prompt: string
  createdAt: string
}

interface Props {
  modelValue: boolean
  image: ImageType
}

interface Emits {
  (e: 'update:modelValue', value: boolean): void
  (e: 'download', image: ImageType): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const formatDate = (dateString: string) => {
  const date = new Date(dateString)
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

const onDownload = () => {
  emit('download', props.image)
}
</script>