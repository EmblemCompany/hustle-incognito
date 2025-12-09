import { defineConfig } from 'vitest/config'
import pkg from './package.json'

export default defineConfig({
  define: {
    __SDK_VERSION__: JSON.stringify(pkg.version)
  },
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
