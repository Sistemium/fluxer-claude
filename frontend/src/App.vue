<template>
  <v-app>
    <v-app-bar app color="primary" dark>
      <v-app-bar-title>Fluxer</v-app-bar-title>
      
      <template v-if="!authStore.isLoading">
        <v-spacer></v-spacer>
        
        <!-- Navigation for authenticated users -->
        <template v-if="authStore.isAuthenticated">
          <v-btn to="/" variant="text">Home</v-btn>
          <v-btn to="/generate" variant="text">Generate</v-btn>
          <v-btn to="/gallery" variant="text">Gallery</v-btn>
          
          <v-menu>
            <template v-slot:activator="{ props }">
              <v-btn icon v-bind="props">
                <v-icon>mdi-account</v-icon>
              </v-btn>
            </template>
            <v-list>
              <v-list-item @click="handleSignOut">
                <v-list-item-title>Sign Out</v-list-item-title>
              </v-list-item>
            </v-list>
          </v-menu>
        </template>
        
        <!-- Navigation for guests -->
        <template v-else>
          <v-btn to="/auth" variant="text">Sign In</v-btn>
        </template>
        
        <v-btn icon @click="toggleTheme">
          <v-icon>{{ theme.global.current.value.dark ? 'mdi-brightness-7' : 'mdi-brightness-4' }}</v-icon>
        </v-btn>
      </template>
    </v-app-bar>

    <v-main>
      <router-view />
    </v-main>
  </v-app>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useTheme } from 'vuetify'
import { useAuthStore } from '@/stores/auth'

const theme = useTheme()
const router = useRouter()
const authStore = useAuthStore()

const toggleTheme = () => {
  theme.global.name.value = theme.global.current.value.dark ? 'light' : 'dark'
}

const handleSignOut = async () => {
  await authStore.signOut()
  router.push('/')
}

onMounted(() => {
  authStore.checkSession()
})
</script>