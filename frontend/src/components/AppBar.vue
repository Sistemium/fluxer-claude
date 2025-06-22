<template>
  <v-app-bar app color="primary" dark>
    <v-app-bar-title>Fluxer</v-app-bar-title>
    
    <template v-if="!authStore.isLoading">
      <v-spacer></v-spacer>
      
      <!-- Navigation for authenticated users -->
      <template v-if="authStore.isAuthenticated">
        <v-btn to="/" variant="text">Home</v-btn>
        <v-btn to="/generate" variant="text">Generate</v-btn>
        <v-btn to="/gallery" variant="text">Gallery</v-btn>
        <v-btn 
          v-if="authStore.isAdmin" 
          to="/admin" 
          variant="text" 
          color="orange"
        >
          <v-icon left>mdi-cog</v-icon>
          Admin
        </v-btn>
        
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
</template>

<script setup lang="ts">
import { useTheme } from 'vuetify'
import { useAuthStore } from '@/stores/auth'
import { signOut } from 'supertokens-web-js/recipe/session'

const theme = useTheme()
const authStore = useAuthStore()

const toggleTheme = () => {
  theme.global.name.value = theme.global.current.value.dark ? 'light' : 'dark'
}

const handleSignOut = async () => {
  try {
    await signOut()
    authStore.setAuthenticated(false)
    authStore.setAdmin(false)
  } catch (error) {
    console.error('Sign out error:', error)
  }
}
</script>