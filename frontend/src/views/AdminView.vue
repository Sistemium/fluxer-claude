<template>
  <v-container>
    <v-row>
      <v-col cols="12">
        <h1 class="text-h4 mb-4">
          <v-icon class="mr-2">mdi-cog</v-icon>
          Admin Panel - Spot Instance Management
        </h1>
      </v-col>
    </v-row>

    <!-- Status Cards -->
    <v-row>
      <v-col cols="12" md="4">
        <v-card>
          <v-card-title>
            <v-icon class="mr-2">mdi-server</v-icon>
            Spot Instances
          </v-card-title>
          <v-card-text>
            <div class="text-h5 mb-2">{{ activeInstances.length }}</div>
            <div class="text-subtitle-2 text-grey">Active Instances</div>
            <v-chip 
              v-for="instance in activeInstances" 
              :key="instance.instanceId"
              :color="getInstanceColor(instance.state)"
              class="mr-1 mt-1"
              small
            >
              {{ instance.state }}
            </v-chip>
          </v-card-text>
        </v-card>
      </v-col>

      <v-col cols="12" md="4">
        <v-card>
          <v-card-title>
            <v-icon class="mr-2">mdi-queue-first-in-last-out</v-icon>
            Queue Status
          </v-card-title>
          <v-card-text>
            <div class="text-h5 mb-2">{{ queueStats?.messagesAvailable || 0 }}</div>
            <div class="text-subtitle-2 text-grey">Messages in Queue</div>
            <div class="mt-2">
              <small>Visible: {{ queueStats?.messagesVisible || 0 }}</small><br>
              <small>In Flight: {{ queueStats?.messagesInFlight || 0 }}</small>
            </div>
          </v-card-text>
        </v-card>
      </v-col>

      <v-col cols="12" md="4">
        <v-card>
          <v-card-title>
            <v-icon class="mr-2">mdi-auto-fix</v-icon>
            Auto-Scaler
          </v-card-title>
          <v-card-text>
            <div class="text-h5 mb-2">
              <v-chip :color="autoScalerStatus?.enabled ? 'success' : 'error'">
                {{ autoScalerStatus?.enabled ? 'ON' : 'OFF' }}
              </v-chip>
            </div>
            <div class="text-subtitle-2 text-grey">Auto-Scaling Status</div>
            <div class="mt-2" v-if="autoScalerStatus">
              <small>Last Check: {{ formatTime(autoScalerStatus.lastCheck) }}</small><br>
              <small>Check Interval: {{ autoScalerStatus.checkInterval }}ms</small>
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Control Buttons -->
    <v-row class="mt-4">
      <v-col cols="12">
        <v-card>
          <v-card-title>Quick Actions</v-card-title>
          <v-card-text>
            <v-btn 
              color="success" 
              @click="launchInstance" 
              :loading="loading.launch"
              :disabled="hasRunningInstances"
              class="mr-2 mb-2"
            >
              <v-icon left>mdi-rocket-launch</v-icon>
              Launch Spot Instance
            </v-btn>

            <v-btn 
              color="error" 
              @click="showTerminateDialog = true" 
              :disabled="!hasRunningInstances"
              class="mr-2 mb-2"
            >
              <v-icon left>mdi-server-off</v-icon>
              Terminate Instance
            </v-btn>

            <v-btn 
              :color="autoScalerStatus?.enabled ? 'warning' : 'primary'" 
              @click="toggleAutoScaler" 
              :loading="loading.autoScaler"
              class="mr-2 mb-2"
            >
              <v-icon left>mdi-auto-fix</v-icon>
              {{ autoScalerStatus?.enabled ? 'Stop' : 'Start' }} Auto-Scaler
            </v-btn>

            <v-btn 
              color="info" 
              @click="refreshStatus" 
              :loading="loading.refresh"
              class="mr-2 mb-2"
            >
              <v-icon left>mdi-refresh</v-icon>
              Refresh Status
            </v-btn>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Instances Table -->
    <v-row class="mt-4">
      <v-col cols="12">
        <v-card>
          <v-card-title>
            <v-icon class="mr-2">mdi-view-list</v-icon>
            Active Instances
            <v-spacer></v-spacer>
            <v-text-field
              v-model="search"
              append-icon="mdi-magnify"
              label="Search"
              single-line
              hide-details
              dense
            ></v-text-field>
          </v-card-title>

          <v-data-table
            :headers="headers"
            :items="activeInstances"
            :search="search"
            :loading="loading.refresh"
            class="elevation-1"
          >
            <template v-slot:item.state="{ item }">
              <v-chip :color="getInstanceColor(item.state)" small>
                {{ item.state }}
              </v-chip>
            </template>

            <template v-slot:item.launchTime="{ item }">
              {{ formatTime(item.launchTime) }}
            </template>

            <template v-slot:item.actions="{ item }">
              <v-btn 
                icon 
                small 
                @click="checkHealth(item.instanceId)"
                :loading="loading.health[item.instanceId]"
              >
                <v-icon>mdi-heart-pulse</v-icon>
              </v-btn>
              
              <v-btn 
                icon 
                small 
                color="error"
                @click="selectedInstance = item; showTerminateDialog = true"
              >
                <v-icon>mdi-delete</v-icon>
              </v-btn>
            </template>
          </v-data-table>
        </v-card>
      </v-col>
    </v-row>

    <!-- Health Status -->
    <v-row class="mt-4" v-if="healthStatus">
      <v-col cols="12">
        <v-card>
          <v-card-title>
            <v-icon class="mr-2">mdi-heart-pulse</v-icon>
            Health Check Results
          </v-card-title>
          <v-card-text>
            <v-alert 
              :type="healthStatus.healthy ? 'success' : 'error'"
              :icon="healthStatus.healthy ? 'mdi-check-circle' : 'mdi-alert-circle'"
            >
              Instance {{ healthStatus.instanceId }} is {{ healthStatus.healthy ? 'healthy' : 'unhealthy' }}
              <div class="mt-2">
                <strong>State:</strong> {{ healthStatus.state }}<br>
                <strong>Public IP:</strong> {{ healthStatus.publicIp }}<br>  
                <strong>Last Checked:</strong> {{ formatTime(healthStatus.lastChecked) }}
              </div>
            </v-alert>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Terminate Dialog -->
    <v-dialog v-model="showTerminateDialog" max-width="500px">
      <v-card>
        <v-card-title>
          <v-icon color="error" class="mr-2">mdi-alert</v-icon>
          Confirm Termination
        </v-card-title>
        <v-card-text>
          Are you sure you want to terminate 
          {{ selectedInstance ? `instance ${selectedInstance.instanceId}` : 'all instances' }}?
          This action cannot be undone.
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn text @click="showTerminateDialog = false">Cancel</v-btn>
          <v-btn 
            color="error" 
            @click="terminateInstance" 
            :loading="loading.terminate"
          >
            Terminate
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

  </v-container>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import api from '@/utils/api'

interface SpotInstance {
  instanceId: string
  state: string
  publicIp?: string
  launchTime?: string
  spotPrice?: string
  availabilityZone?: string
}

interface QueueStats {
  messagesAvailable: number
  messagesVisible: number
  messagesInFlight: number
}

interface AutoScalerStatus {
  enabled: boolean
  lastCheck?: string
  checkInterval?: number
}

interface HealthStatus {
  instanceId: string
  healthy: boolean
  state: string
  publicIp?: string
  lastChecked: string
}

// Reactive data
const activeInstances = ref<SpotInstance[]>([])
const queueStats = ref<QueueStats | null>(null)
const autoScalerStatus = ref<AutoScalerStatus | null>(null)
const healthStatus = ref<HealthStatus | null>(null)
const selectedInstance = ref<SpotInstance | null>(null)
const showTerminateDialog = ref(false)
const search = ref('')

const loading = ref({
  launch: false,
  terminate: false,
  autoScaler: false,
  refresh: false,
  health: {} as Record<string, boolean>
})

// Table headers
const headers = [
  { text: 'Instance ID', value: 'instanceId' },
  { text: 'State', value: 'state' },
  { text: 'Public IP', value: 'publicIp' },
  { text: 'Launch Time', value: 'launchTime' },
  { text: 'Spot Price', value: 'spotPrice' },
  { text: 'AZ', value: 'availabilityZone' },
  { text: 'Actions', value: 'actions', sortable: false }
]

// Computed
const hasRunningInstances = computed(() => 
  activeInstances.value.some(i => i.state === 'running')
)

// Methods
function getInstanceColor(state: string): string {
  switch (state) {
    case 'running': return 'success'
    case 'pending': return 'warning'
    case 'stopping': return 'orange'
    case 'stopped': return 'error'
    case 'terminated': return 'grey'
    default: return 'primary'
  }
}

function formatTime(timestamp?: string): string {
  if (!timestamp) return 'N/A'
  return new Date(timestamp).toLocaleString()
}

async function refreshStatus() {
  loading.value.refresh = true
  try {
    const [statusResponse, autoScalerResponse] = await Promise.all([
      api.get('/admin/spot/status'),
      api.get('/admin/autoscaler/status')
    ])
    
    activeInstances.value = statusResponse.data.instances || []
    queueStats.value = statusResponse.data.queueStats || null
    autoScalerStatus.value = autoScalerResponse.data || null
  } catch (error) {
    console.error('Failed to refresh status:', error)
  }
  loading.value.refresh = false
}

async function launchInstance() {
  loading.value.launch = true
  try {
    await api.post('/admin/spot/launch')
    await refreshStatus()
  } catch (error) {
    console.error('Failed to launch instance:', error)
  }
  loading.value.launch = false
}

async function terminateInstance() {
  loading.value.terminate = true
  try {
    if (selectedInstance.value) {
      await api.post('/admin/spot/terminate', {
        instanceId: selectedInstance.value.instanceId
      })
    }
    showTerminateDialog.value = false
    selectedInstance.value = null
    await refreshStatus()
  } catch (error) {
    console.error('Failed to terminate instance:', error)
  }
  loading.value.terminate = false
}

async function toggleAutoScaler() {
  loading.value.autoScaler = true
  try {
    const endpoint = autoScalerStatus.value?.enabled ? 'stop' : 'start'
    await api.post(`/admin/autoscaler/${endpoint}`)
    await refreshStatus()
  } catch (error) {
    console.error('Failed to toggle auto-scaler:', error)
  }
  loading.value.autoScaler = false
}

async function checkHealth(instanceId: string) {
  loading.value.health[instanceId] = true
  try {
    const response = await api.get(`/admin/ai/health/${instanceId}`)
    healthStatus.value = response.data
  } catch (error) {
    console.error('Failed to check health:', error)
  }
  loading.value.health[instanceId] = false
}

// Lifecycle
onMounted(() => {
  refreshStatus()
  
  // Auto-refresh every 30 seconds
  setInterval(refreshStatus, 30000)
})
</script>

<style scoped>
.v-card {
  margin-bottom: 16px;
}

.text-h5 {
  font-weight: 600;
}

.v-chip {
  font-weight: 500;
}
</style>