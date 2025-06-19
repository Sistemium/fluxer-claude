import dotenv from 'dotenv'

// Load test environment variables
dotenv.config({ path: '.env.test' })

// Mock environment variables for tests
process.env.NODE_ENV = 'test'
process.env.SQS_QUEUE_URL = 'https://sqs.eu-west-1.amazonaws.com/123456789/test-queue'
process.env.AWS_REGION = 'eu-west-1'
process.env.AWS_ACCESS_KEY_ID = 'test-key'
process.env.AWS_SECRET_ACCESS_KEY = 'test-secret'
process.env.AI_SERVICE_URL = 'http://localhost:8000'

// Mock console to reduce noise in tests
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}

// Increase test timeout for integration tests
jest.setTimeout(30000)