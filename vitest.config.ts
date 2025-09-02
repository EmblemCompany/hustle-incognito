import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Set a global timeout for all tests
    testTimeout: 60000, // 60 seconds
    
    // Run tests in sequence for integration tests to avoid API rate limiting
    sequence: {
      concurrent: false, // Run tests sequentially
    },
    
    // Pool configuration
    pool: 'threads',
    poolOptions: {
      threads: {
        minThreads: 1,
        maxThreads: 1 // Force single thread for integration tests
      }
    },
    
    // Environment variables
    env: {
      NODE_ENV: 'test'
    }
  }
})
