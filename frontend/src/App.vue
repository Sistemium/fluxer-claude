<template>
  <v-app>
    <AppBar />

    <v-main>
      <router-view />
    </v-main>
    
    <ToastContainer />
  </v-app>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import AppBar from '@/components/AppBar.vue'
import ToastContainer from '@/components/ToastContainer.vue'

const authStore = useAuthStore()

onMounted(() => {
  authStore.checkSession()
})
</script>