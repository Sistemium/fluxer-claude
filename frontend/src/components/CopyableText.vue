<template>
  <div class="d-flex align-center gap-2">
    <div :class="textClass">{{ text }}</div>
    <v-btn
      icon="mdi-content-copy"
      size="x-small"
      variant="tonal"
      @click="copyToClipboard"
      class="ml-2"
    >
      <v-icon>{{ copied ? 'mdi-check' : 'mdi-content-copy' }}</v-icon>
    </v-btn>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

interface Props {
  text: string
  textClass?: string
  iconColor?: string
}

const props = withDefaults(defineProps<Props>(), {
  textClass: 'text-body-1',
  iconColor: 'white'
})

const copied = ref(false)

const copyToClipboard = async () => {
  try {
    await navigator.clipboard.writeText(props.text)
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 2000)
  } catch (err) {
    console.error('Failed to copy text: ', err)
  }
}
</script>