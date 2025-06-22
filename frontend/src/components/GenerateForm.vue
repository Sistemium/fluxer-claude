<template>
  <v-card>
    <v-card-title>Generate Image</v-card-title>
    <v-card-text>
      <v-form @submit.prevent="onSubmit">
        <v-textarea
          :model-value="modelValue.prompt"
          @update:model-value="updateField('prompt', $event)"
          label="Enter your prompt"
          placeholder="A beautiful sunset over mountains..."
          rows="4"
          variant="outlined"
          :disabled="disabled"
        ></v-textarea>
        
        <!-- Token Counter -->
        <div class="text-caption mt-2 mb-4">
          <v-chip 
            :color="tokenCount > 77 ? 'error' : tokenCount > 60 ? 'warning' : 'success'"
            size="small"
            class="mr-2"
          >
            <v-icon left size="small">mdi-counter</v-icon>
            {{ tokenCount }} / 77 tokens
          </v-chip>
          <span class="text-grey-darken-1">
            <template v-if="tokenCount <= 77">
              ✓ Optimal for CLIP encoder
            </template>
            <template v-else>
              ⚠ Exceeds CLIP limit ({{ tokenCount - 77 }} tokens will be ignored)
            </template>
          </span>
        </div>

        <v-row class="mt-4">
          <v-col cols="6">
            <v-select
              :model-value="modelValue.width"
              @update:model-value="updateField('width', $event)"
              :items="dimensions"
              label="Width"
              variant="outlined"
              :disabled="disabled"
            ></v-select>
          </v-col>
          <v-col cols="6">
            <v-select
              :model-value="modelValue.height"
              @update:model-value="updateField('height', $event)"
              :items="dimensions"
              label="Height"
              variant="outlined"
              :disabled="disabled"
            ></v-select>
          </v-col>
        </v-row>

        <v-row class="mt-2">
          <v-col cols="6">
            <v-text-field
              :model-value="modelValue.num_inference_steps"
              @update:model-value="updateField('num_inference_steps', Number($event))"
              type="number"
              :min="10"
              :max="100"
              label="Inference Steps"
              variant="outlined"
              :disabled="disabled"
              hint="10-100 steps (more = better quality, slower)"
              persistent-hint
            ></v-text-field>
          </v-col>
          <v-col cols="6">
            <v-text-field
              :model-value="modelValue.guidance_scale"
              @update:model-value="updateField('guidance_scale', Number($event))"
              type="number"
              :min="1"
              :max="20"
              :step="0.5"
              label="Guidance Scale"
              variant="outlined"
              :disabled="disabled"
              hint="1-20 (higher = follows prompt more strictly)"
              persistent-hint
            ></v-text-field>
          </v-col>
        </v-row>

        <v-btn
          type="submit"
          color="primary"
          block
          size="large"
          :loading="loading"
          :disabled="!modelValue.prompt.trim() || disabled"
        >
          Generate Image
        </v-btn>
      </v-form>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { TokenService } from '@/services/tokenService'

export interface GenerateFormData {
  prompt: string
  width: number
  height: number
  num_inference_steps: number
  guidance_scale: number
}

interface Props {
  modelValue: GenerateFormData
  disabled?: boolean
  loading?: boolean
}

interface Emits {
  (e: 'update:modelValue', value: GenerateFormData): void
  (e: 'submit', data: GenerateFormData): void
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
  loading: false
})

const emit = defineEmits<Emits>()

const dimensions = [256, 512, 768, 1024]

const tokenCount = computed(() => TokenService.estimateTokens(props.modelValue.prompt))

const updateField = <K extends keyof GenerateFormData>(field: K, value: GenerateFormData[K]) => {
  emit('update:modelValue', {
    ...props.modelValue,
    [field]: value
  })
}

const onSubmit = () => {
  emit('submit', props.modelValue)
}
</script>