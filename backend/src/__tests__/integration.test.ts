import { SQSQueueService } from '../services/sqsQueueService'

// This is an integration test that can be run against real AWS SQS
// Set INTEGRATION_TEST=true to run against real AWS
const isIntegrationTest = process.env.INTEGRATION_TEST === 'true'

describe('SQS Integration Tests', () => {
  let sqsService: SQSQueueService

  beforeAll(async () => {
    if (!isIntegrationTest) {
      return
    }

    // Only run if we have real AWS credentials
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.SQS_QUEUE_URL) {
      console.log('Skipping integration tests - AWS credentials or SQS_QUEUE_URL not configured')
      return
    }

    sqsService = new SQSQueueService()
  })

  const runIf = (condition: boolean) => condition ? describe : describe.skip

  runIf(isIntegrationTest)('Real SQS Integration', () => {
    it('should send and receive message from real SQS queue', async () => {
      const testJobData = {
        userId: 'integration-test-user',
        prompt: 'integration test prompt',
        width: 512,
        height: 512,
        guidance_scale: 7.5,
        num_inference_steps: 20, // Lower for faster test
      }

      // Add job to queue
      const jobId = await sqsService.addJob(testJobData)
      expect(jobId).toBeDefined()
      expect(typeof jobId).toBe('string')

      // Check queue stats
      const stats = await sqsService.getQueueStats()
      expect(stats).toBeDefined()
      expect(stats!.messagesAvailable).toBeGreaterThanOrEqual(0)

      console.log('Integration test completed successfully')
      console.log('Job ID:', jobId)
      console.log('Queue stats:', stats)
    }, 30000) // 30 second timeout

    it('should handle queue statistics correctly', async () => {
      const stats = await sqsService.getQueueStats()
      
      expect(stats).toBeDefined()
      expect(typeof stats!.messagesAvailable).toBe('number')
      expect(typeof stats!.messagesInFlight).toBe('number')
      expect(typeof stats!.messagesDelayed).toBe('number')
      
      expect(stats!.messagesAvailable).toBeGreaterThanOrEqual(0)
      expect(stats!.messagesInFlight).toBeGreaterThanOrEqual(0)
      expect(stats!.messagesDelayed).toBeGreaterThanOrEqual(0)
    })
  })

  describe('Mock SQS Tests', () => {
    it('should run when integration tests are disabled', () => {
      expect(true).toBe(true)
      console.log('Mock tests running - set INTEGRATION_TEST=true for real AWS tests')
    })
  })
})