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
        <ImageCard
          :image="image"
          @download="downloadImage"
          @delete="deleteImage"
        />
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
import ImageCard from '@/components/ImageCard.vue'

const imagesStore = useImagesStore()


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