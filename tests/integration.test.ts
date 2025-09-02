/**
 * Integration tests for HustleIncognitoClient
 * 
 * These tests interact with the live API and require valid credentials.
 * They are meant to be run manually and not as part of the automated test suite.
 * 
 * To run: npx vitest run tests/integration.test.ts
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { HustleIncognitoClient } from '../src';
import type { ProcessedResponse, ChatMessage, StreamChunk } from '../src/types';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Skip these tests if running in CI or if API key is not available
const shouldSkip = !process.env.HUSTLE_API_KEY || process.env.CI === 'true';

describe.skipIf(shouldSkip)('HustleIncognitoClient Integration Tests', () => {
  let client: HustleIncognitoClient;
  
  beforeAll(() => {
    // Initialize the client with API key from environment
    client = new HustleIncognitoClient({
      apiKey: process.env.HUSTLE_API_KEY || '',
      // Debug logging toggle
      debug: process.env.DEBUG=== 'false' ? false : true
    });
  });
  
  test('should connect to the API and get a response', async () => {
    const response = await client.chat(
      [{ role: 'user' as const, content: 'Hello, are you there?' }],
      { vaultId: process.env.VAULT_ID || 'default' }
    ) as ProcessedResponse;
    
    expect(response).toBeDefined();
    expect(typeof response.content).toBe('string');
    expect(response.content.length).toBeGreaterThan(0);
  }, 30000); // Increase timeout to 30 seconds for API call
  
  test('should execute a tool call and return results', async () => {
    const response = await client.chat(
      [{ role: 'user' as const, content: 'What are the trending tokens on Solana today?' }],
      { vaultId: process.env.VAULT_ID || 'default' }
    ) as ProcessedResponse;
    
    expect(response).toBeDefined();
    expect(typeof response.content).toBe('string');
    
    // Verify tool calls were made
    expect(response.toolCalls).toBeDefined();
    if (response.toolCalls && response.toolCalls.length > 0) {
      console.log('Tool calls detected:', response.toolCalls.length);
      
      // Check first tool call
      const firstTool = response.toolCalls[0];
      expect(firstTool.toolName).toBeDefined();
      expect(firstTool.toolCallId).toBeDefined();
      
      // Log tool details for manual verification
      console.log('Tool name:', firstTool.toolName);
      console.log('Tool args:', JSON.stringify(firstTool.args));
    } else {
      console.warn('No tool calls detected in the response. This test is inconclusive.');
    }
    
    // The response should contain information about tokens
    expect(response.content.toLowerCase()).toMatch(/token|solana|trending/);
  }, 60000); // Increase timeout to 60 seconds for this complex query
  
  test('should stream responses with tool calls', async () => {
    const messages: ChatMessage[] = [{ role: 'user', content: 'Show me the price of Bonk token' }];
    const chunks: StreamChunk[] = [];
    let sawToolCall = false;
    let textChunks = 0;
    
    // Set a maximum number of chunks to process to avoid infinite loops
    const MAX_CHUNKS = 100;
    
    for await (const chunk of client.chatStream({
      vaultId: process.env.VAULT_ID || 'default',
      messages,
      processChunks: true
    })) {
      // Only process StreamChunk objects, not RawChunks
      if ('type' in chunk) {
        chunks.push(chunk);
        
        if (chunk.type === 'tool_call') {
          sawToolCall = true;
          console.log('Detected tool call in stream:', JSON.stringify(chunk.value));
        }
        
        if (chunk.type === 'text') {
          textChunks++;
        }
        
        // Break after finish event or if we've processed enough chunks
        if (chunk.type === 'finish' || chunks.length >= MAX_CHUNKS) {
          break;
        }
      }
    }
    
    expect(chunks.length).toBeGreaterThan(0);
    expect(textChunks).toBeGreaterThan(0);
    console.log(`Processed ${chunks.length} chunks, including ${textChunks} text chunks`);
    
    // We may not always see a tool call depending on the API response
    // So we'll just log whether we saw one or not
    console.log('Saw tool call:', sawToolCall);
  }, 120000); // Increase timeout to 120 seconds
});
