<template>
  <v-container>
    <v-row>
      <v-col cols="12">
        <h1 class="text-h4 mb-4">Image Gallery</h1>
      </v-col>
    </v-row>

    <v-row>
      <v-col
        v-for="image in imagesStore.images"
        :key="image.id"
        cols="12"
        sm="6"
        md="4"
        lg="3"
      >
        <v-card>
          <v-img
            :src="image.imageUrl"
            :alt="image.prompt"
            height="200"
            cover
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
              icon="mdi-download"
              size="small"
              @click="downloadImage(image)"
            ></v-btn>
            <v-btn
              icon="mdi-delete"
              size="small"
              color="error"
              @click="deleteImage(image.id)"
            ></v-btn>
          </v-card-actions>
        </v-card>
      </v-col>
    </v-row>

    <v-row v-if="imagesStore.images.length === 0">
      <v-col cols="12" class="text-center">
        <v-icon size="64" color="grey-lighten-1">mdi-image-multiple-outline</v-icon>
        <p class="text-h6 mt-4">No images yet</p>
        <p>Start generating some images to see them here!</p>
        <v-btn color="primary" to="/generate">Generate Images</v-btn>
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useImagesStore } from '@/stores/images'

const imagesStore = useImagesStore()

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

const downloadImage = (image: any) => {
  const link = document.createElement('a')
  link.href = image.imageUrl
  link.download = `fluxer-${image.id}.png`
  link.click()
}

const deleteImage = async (id: string) => {
  try {
    await imagesStore.deleteImage(id)
  } catch (error) {
    console.error('Failed to delete image:', error)
  }
}

onMounted(() => {
  imagesStore.loadImages()
})
</script>