import { ref } from 'vue'

interface ToastMessage {
  id: string
  message: string
  type: 'success' | 'error' | 'info' | 'warning'
  timeout: number
  show: boolean
}

const toasts = ref<ToastMessage[]>([])

export function useToast() {
  function showToast(message: string, type: ToastMessage['type'] = 'info', timeout = 5000) {
    const id = Math.random().toString(36).substr(2, 9)
    
    const toast: ToastMessage = {
      id,
      message,
      type,
      timeout,
      show: true
    }
    
    toasts.value.push(toast)
    
    if (timeout > 0) {
      setTimeout(() => {
        hideToast(id)
      }, timeout)
    }
    
    return id
  }
  
  function hideToast(id: string) {
    const toastIndex = toasts.value.findIndex(t => t.id === id)
    if (toastIndex > -1) {
      toasts.value[toastIndex].show = false
      setTimeout(() => {
        toasts.value.splice(toastIndex, 1)
      }, 300) // Allow for fade out animation
    }
  }
  
  function success(message: string, timeout?: number) {
    return showToast(message, 'success', timeout)
  }
  
  function error(message: string, timeout?: number) {
    return showToast(message, 'error', timeout)
  }
  
  function info(message: string, timeout?: number) {
    return showToast(message, 'info', timeout)
  }
  
  function warning(message: string, timeout?: number) {
    return showToast(message, 'warning', timeout)
  }
  
  return {
    toasts,
    showToast,
    hideToast,
    success,
    error,
    info,
    warning
  }
}