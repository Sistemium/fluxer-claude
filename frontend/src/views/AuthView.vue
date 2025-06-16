<template>
  <v-container class="fill-height" fluid>
    <v-row justify="center" align="center">
      <v-col cols="12" sm="8" md="4">
        <v-card>
          <v-card-title class="text-center">
            <h1 class="display-1">{{ isSignUp ? 'Sign Up' : 'Sign In' }}</h1>
          </v-card-title>

          <v-card-text>
            <v-form @submit.prevent="handleSubmit">
              <v-text-field
                v-model="email"
                label="Email"
                type="email"
                variant="outlined"
                :rules="emailRules"
                required
                :disabled="loading"
              ></v-text-field>

              <v-text-field
                v-model="password"
                label="Password"
                type="password"
                variant="outlined"
                :rules="passwordRules"
                required
                :disabled="loading"
              ></v-text-field>

              <v-alert
                v-if="error"
                type="error"
                class="mb-4"
              >
                {{ error }}
              </v-alert>

              <v-btn
                type="submit"
                color="primary"
                block
                size="large"
                :loading="loading"
                :disabled="!isFormValid"
              >
                {{ isSignUp ? 'Sign Up' : 'Sign In' }}
              </v-btn>
            </v-form>
          </v-card-text>

          <v-card-actions class="justify-center">
            <v-btn
              variant="text"
              @click="toggleMode"
              :disabled="loading"
            >
              {{ isSignUp ? 'Already have an account? Sign In' : 'Need an account? Sign Up' }}
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const authStore = useAuthStore()

const isSignUp = ref(false)
const email = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')

const emailRules = [
  (v: string) => !!v || 'Email is required',
  (v: string) => /.+@.+\..+/.test(v) || 'Email must be valid'
]

const passwordRules = [
  (v: string) => !!v || 'Password is required',
  (v: string) => v.length >= 6 || 'Password must be at least 6 characters'
]

const isFormValid = computed(() => {
  return email.value && password.value && password.value.length >= 6 && /.+@.+\..+/.test(email.value)
})

const toggleMode = () => {
  isSignUp.value = !isSignUp.value
  error.value = ''
}

const handleSubmit = async () => {
  if (!isFormValid.value) return

  loading.value = true
  error.value = ''

  try {
    const result = isSignUp.value 
      ? await authStore.signUp(email.value, password.value)
      : await authStore.signIn(email.value, password.value)

    if (result.success) {
      router.push('/')
    } else {
      error.value = result.error || 'Authentication failed'
    }
  } catch (err: any) {
    error.value = err.message || 'Network error'
  } finally {
    loading.value = false
  }
}
</script>