<template>
  <v-container>
    <v-row justify="center">
      <v-col cols="12" md="8">
        <v-card>
          <v-card-title class="text-h4 text-center">
            Welcome to Fluxer
          </v-card-title>
          <v-card-text class="text-center">
            <p class="text-h6 mb-4">AI-Powered Image Generation</p>
            <p>Create stunning images from text descriptions using advanced AI technology.</p>
          </v-card-text>
          <v-card-actions class="justify-center">
            <v-btn
              color="primary"
              size="large"
              to="/generate"
              prepend-icon="mdi-image-plus"
            >
              Start Generating
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup lang="ts">
// Home page component
</script>