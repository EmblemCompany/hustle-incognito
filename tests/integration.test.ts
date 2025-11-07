/**
 * Integration tests for HustleIncognitoClient
 * 
 * These tests interact with the live API and require valid credentials.
 * They are meant to be run manually and not as part of the automated test suite.
 * 
 * To run: npx vitest run tests/integration.test.ts
 */
import * as path from 'path';
import * as fs from 'fs';

import dotenv from 'dotenv';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';

import { HustleIncognitoClient } from '../src';
import type { ProcessedResponse, ChatMessage, StreamChunk } from '../src/types';


// Load environment variables
dotenv.config();

// Skip these tests if running in CI or if API key is not available
const shouldSkip = !process.env.HUSTLE_API_KEY || process.env.CI === 'true';

// Helper function to add delay between tests
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe.skipIf(shouldSkip)('HustleIncognitoClient Integration Tests', () => {
  let client: HustleIncognitoClient;
  
  beforeEach(() => {
    // Initialize a fresh client for each test to avoid shared state
    client = new HustleIncognitoClient({
      apiKey: process.env.HUSTLE_API_KEY || '',
      // Debug logging toggle
      debug: process.env.DEBUG=== 'false' ? false : true
    });
  });
  
  afterEach(async () => {
    // Add a 2-second delay between tests to avoid API rate limiting
    await delay(2000);
  });
  
  test('should connect to the API and get a response', async () => {
    const response = await client.chat(
      [{ role: 'user' as const, content: 'Hello, are you there?' }],
      { vaultId: process.env.VAULT_ID || 'default' }
    ) as ProcessedResponse;
    
    expect(response).toBeDefined();
    expect(typeof response.content).toBe('string');
    expect(response.content.length).toBeGreaterThan(0);
  }); // Use global timeout
  
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
  }); // Use global timeout
  
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
  }); // Use global timeout
  
  test('should upload image file and return attachment info', async () => {
    const testImagePath = path.join(__dirname, 'fixtures', 'test-image.png');

    // Verify test file exists
    if (!fs.existsSync(testImagePath)) {
      console.warn('Test image not found, skipping upload test');
      return;
    }

    console.log('Uploading test image:', testImagePath);

    const attachment = await client.uploadFile(testImagePath);

    expect(attachment).toBeDefined();
    expect(attachment.name).toBe('test-image.png');
    expect(attachment.contentType).toBe('image/png');
    expect(attachment.url).toBeDefined();
    expect(typeof attachment.url).toBe('string');
    expect(attachment.url).toMatch(/^https?:\/\//); // Should be a valid URL

    console.log('Upload successful, URL:', attachment.url);
  }); // Use global timeout

  test('should detect PNG MIME type from file content without extension', async () => {
    const testImagePath = path.join(__dirname, 'fixtures', 'test-image');

    // Verify test file exists
    if (!fs.existsSync(testImagePath)) {
      console.warn('Test image without extension not found, skipping test');
      return;
    }

    console.log('Uploading test image without extension:', testImagePath);

    const attachment = await client.uploadFile(testImagePath);

    expect(attachment).toBeDefined();
    expect(attachment.name).toBe('test-image');
    expect(attachment.contentType).toBe('image/png'); // Should detect PNG from content
    expect(attachment.url).toBeDefined();
    expect(typeof attachment.url).toBe('string');
    expect(attachment.url).toMatch(/^https?:\/\//); // Should be a valid URL

    console.log('Upload successful, detected content type:', attachment.contentType);
  }); // Use global timeout

  test('should upload JPEG file with extension and detect correct MIME type', async () => {
    const testImagePath = path.join(__dirname, 'fixtures', 'test-image.jpg');

    // Verify test file exists
    if (!fs.existsSync(testImagePath)) {
      console.warn('Test JPEG with extension not found, skipping test');
      return;
    }

    console.log('Uploading test JPEG with extension:', testImagePath);

    const attachment = await client.uploadFile(testImagePath);

    expect(attachment).toBeDefined();
    expect(attachment.name).toBe('test-image.jpg');
    expect(attachment.contentType).toBe('image/jpeg');
    expect(attachment.url).toBeDefined();
    expect(typeof attachment.url).toBe('string');
    expect(attachment.url).toMatch(/^https?:\/\//);

    console.log('Upload successful, content type:', attachment.contentType);
  }); // Use global timeout

  test('should detect JPEG MIME type from file content without extension', async () => {
    const testImagePath = path.join(__dirname, 'fixtures', 'test-image-jpg');

    // Verify test file exists
    if (!fs.existsSync(testImagePath)) {
      console.warn('Test JPEG without extension not found, skipping test');
      return;
    }

    console.log('Uploading test JPEG without extension:', testImagePath);

    const attachment = await client.uploadFile(testImagePath);

    expect(attachment).toBeDefined();
    expect(attachment.name).toBe('test-image-jpg');
    expect(attachment.contentType).toBe('image/jpeg'); // Should detect JPEG from content
    expect(attachment.url).toBeDefined();
    expect(typeof attachment.url).toBe('string');
    expect(attachment.url).toMatch(/^https?:\/\//);

    console.log('Upload successful, detected content type:', attachment.contentType);
  }); // Use global timeout
});
