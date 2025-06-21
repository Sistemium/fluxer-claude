<template>
  <v-card>
    <v-img
      :src="image.imageUrl"
      :alt="image.prompt"
      height="200"
      cover
      class="cursor-pointer"
      @click="showFullscreen = true"
    >
      <template v-slot:placeholder>
        <v-row
          class="fill-height ma-0"
          align="center"
          justify="center"
        >
          <v-progress-circular
            indeterminate
            color="grey-lighten-5"
          ></v-progress-circular>
        </v-row>
      </template>
    </v-img>
    
    <v-card-text>
      <div class="text-truncate">
        {{ image.prompt }}
      </div>
      <div class="text-caption text-grey">
        {{ formatDate(image.createdAt) }}
      </div>
    </v-card-text>

    <v-card-actions>
      <v-btn
        icon="mdi-fullscreen"
        size="small"
        @click="showFullscreen = true"
      ></v-btn>
      <v-btn
        icon="mdi-download"
        size="small"
        @click="onDownload"
      ></v-btn>
      <v-btn
        icon="mdi-delete"
        size="small"
        color="error"
        @click="onDelete"
      ></v-btn>
    </v-card-actions>
  </v-card>

  <ImageDialog
    v-model="showFullscreen"
    :image="image"
    @download="onDownload"
  />
</template>

<script setup lang="ts">
import { ref } from 'vue'
import ImageDialog from './ImageDialog.vue'

interface ImageType {
  id: string
  imageUrl: string
  prompt: string
  createdAt: string
}

interface Props {
  image: ImageType
}

interface Emits {
  (e: 'download', image: ImageType): void
  (e: 'delete', id: string): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const showFullscreen = ref(false)

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

const onDelete = () => {
  emit('delete', props.image.id)
}
</script>