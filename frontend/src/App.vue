<template>
  <v-app>
    <AppBar />

    <v-main>
      <router-view />
    </v-main>
  </v-app>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import AppBar from '@/components/AppBar.vue'

const authStore = useAuthStore()

onMounted(() => {
  authStore.checkSession()
})
</script>