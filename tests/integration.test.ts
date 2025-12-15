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
import { Wallet } from 'ethers';

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
      vaultId: process.env.VAULT_ID,
      hustleApiUrl: process.env.HUSTLE_API_URL,
      // Debug logging toggle
      debug: process.env.DEBUG=== 'false' ? false : true
    });
  });

  afterEach(async () => {
    // Add a 2-second delay between tests to avoid API rate limiting
    await delay(2000);
  });

  test('should get models and chat with specific model', async () => {
    // Get models from API to verify endpoint works
    const models = await client.getModels();
    expect(models.length).toBeGreaterThan(0);
    console.log(`Found ${models.length} available models`);

    // Use specific model
    const modelId = 'openai/gpt-4.1-nano';
    console.log(`Using model: ${modelId}`);

    // Send a small prompt with the specified model
    const response = await client.chat(
      [{ role: 'user' as const, content: 'Say hello' }],
      {
        vaultId: process.env.VAULT_ID,
        model: modelId
      }
    ) as ProcessedResponse;

    expect(response).toBeDefined();
    expect(typeof response.content).toBe('string');
    expect(response.content.length).toBeGreaterThan(0);

    console.log(`Response from ${modelId}:`, response.content);
  });

  test('should maintain conversation context across model switches', async () => {
    const nanoModel = 'openai/gpt-4.1-nano';
    const claudeModel = 'anthropic/claude-3.5-haiku';
    const secretWord = 'banana';

    // First message: Tell nano model the secret word
    console.log(`Step 1: Telling ${nanoModel} the secret word is "${secretWord}"`);
    const firstResponse = await client.chat(
      [{ role: 'user' as const, content: `Remember this: the secret word is "${secretWord}". Just acknowledge you understand.` }],
      {
        vaultId: process.env.VAULT_ID,
        model: nanoModel
      }
    ) as ProcessedResponse;

    expect(firstResponse).toBeDefined();
    expect(firstResponse.content.length).toBeGreaterThan(0);
    console.log(`${nanoModel} response:`, firstResponse.content);

    // Second message: Ask Claude what the secret word was (include conversation history)
    console.log(`Step 2: Asking ${claudeModel} what the secret word was`);
    const secondResponse = await client.chat(
      [
        { role: 'user' as const, content: `Remember this: the secret word is "${secretWord}". Just acknowledge you understand.` },
        { role: 'assistant' as const, content: firstResponse.content },
        { role: 'user' as const, content: 'What was the secret word I told you?' }
      ],
      {
        vaultId: process.env.VAULT_ID,
        model: claudeModel
      }
    ) as ProcessedResponse;

    expect(secondResponse).toBeDefined();
    expect(secondResponse.content.length).toBeGreaterThan(0);
    console.log(`${claudeModel} response:`, secondResponse.content);

    // Verify Claude remembered the secret word from the conversation context
    expect(secondResponse.content.toLowerCase()).toContain(secretWord);
    console.log(`✓ Claude correctly identified the secret word: ${secretWord}`);
  });

  test('should fetch models with apiKey + vaultId auth', async () => {
    const models = await client.getModels();

    expect(models).toBeDefined();
    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThan(0);

    // Verify first model has expected structure
    const firstModel = models[0];
    expect(firstModel.id).toBeDefined();
    expect(typeof firstModel.id).toBe('string');
    expect(firstModel.name).toBeDefined();
    expect(typeof firstModel.name).toBe('string');
    expect(firstModel.context_length).toBeDefined();
    expect(typeof firstModel.context_length).toBe('number');
    expect(firstModel.pricing).toBeDefined();
    expect(firstModel.pricing.prompt).toBeDefined();
    expect(firstModel.pricing.completion).toBeDefined();

    console.log(`Fetched ${models.length} models`);

    // Find Claude models
    const claudeModels = models.filter(m => m.id.includes('claude') || m.name.toLowerCase().includes('claude'));
    expect(claudeModels.length).toBeGreaterThan(0);
    console.log(`Found ${claudeModels.length} Claude models`);
  });

  test('should fail to fetch models with no auth headers', async () => {
    // Client with no apiKey/vaultId - should not send x-api-key/x-vault-id headers
    const noAuthClient = new HustleIncognitoClient({
      jwt: 'placeholder-to-pass-constructor', // Minimal auth to pass constructor
      hustleApiUrl: process.env.HUSTLE_API_URL,
      debug: false
    });
    // Override vaultId to undefined so no headers are sent
    // Note: JWT auth also fails on server for models endpoint currently

    await expect(noAuthClient.getModels()).rejects.toThrow(/401|Unauthorized|Failed/);
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
      [{ role: 'user' as const, content: 'what memory categories are available? ' }],
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
    expect(response.content.toLowerCase()).toMatch(/memory/);
  }); // Use global timeout
  
  test('should stream responses with tool calls', async () => {
    const messages: ChatMessage[] = [{ role: 'user', content: 'what memory categories are available? ' }];
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
    console.log(`Processed ${chunks.length} chunks, including ${textChunks} text chunks`);
    console.log('Saw tool call:', sawToolCall);

    // The response should have either text or tool calls (or both)
    // Some queries may trigger direct tool calls without any text
    expect(textChunks > 0 || sawToolCall).toBe(true);
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

  test('should send chat message with image attachment', async () => {
    const testImagePath = path.join(__dirname, 'fixtures', 'test-image.png');

    // Verify test file exists
    if (!fs.existsSync(testImagePath)) {
      console.warn('Test image not found, skipping chat with attachment test');
      return;
    }

    console.log('Uploading image for chat with attachment test');

    // First upload the image to get attachment
    const attachment = await client.uploadFile(testImagePath);
    expect(attachment).toBeDefined();
    expect(attachment.url).toBeDefined();

    console.log('Sending chat message with image attachment');

    // Send chat message with the attachment
    const response = await client.chat(
      [{ role: 'user' as const, content: 'What do you see in this image?' }],
      {
        vaultId: process.env.VAULT_ID || 'default',
        attachments: [attachment]
      }
    ) as ProcessedResponse;

    expect(response).toBeDefined();
    expect(typeof response.content).toBe('string');
    expect(response.content.length).toBeGreaterThan(0);

    console.log('Chat response with attachment received');
    console.log('Response content preview:', response.content.substring(0, 200) + '...');
  }); // Use global timeout

  test('should stream chat with image attachment', async () => {
    const testImagePath = path.join(__dirname, 'fixtures', 'test-image.png');

    // Verify test file exists
    if (!fs.existsSync(testImagePath)) {
      console.warn('Test image not found, skipping stream with attachment test');
      return;
    }

    console.log('Uploading image for stream with attachment test');

    // First upload the image to get attachment
    const attachment = await client.uploadFile(testImagePath);
    expect(attachment).toBeDefined();
    expect(attachment.url).toBeDefined();

    console.log('Streaming chat message with image attachment');

    const messages: ChatMessage[] = [
      { role: 'user', content: 'Describe what you see in this image' }
    ];

    const chunks: StreamChunk[] = [];
    let textContent = '';
    const MAX_CHUNKS = 150;

    for await (const chunk of client.chatStream({
      vaultId: process.env.VAULT_ID || 'default',
      messages,
      processChunks: true,
      attachments: [attachment]
    })) {
      if ('type' in chunk) {
        chunks.push(chunk);

        if (chunk.type === 'text' && typeof chunk.value === 'string') {
          textContent += chunk.value;
        }

        // Break after finish event or if we've processed enough chunks
        if (chunk.type === 'finish' || chunks.length >= MAX_CHUNKS) {
          break;
        }
      }
    }

    expect(chunks.length).toBeGreaterThan(0);
    expect(textContent.length).toBeGreaterThan(0);

    console.log(`Stream with attachment processed ${chunks.length} chunks`);
    console.log('Response content preview:', textContent.substring(0, 200) + '...');
  }); // Use global timeout

  test('should send chat with multiple image attachments', async () => {
    const testPngPath = path.join(__dirname, 'fixtures', 'test-image.png');
    const testJpgPath = path.join(__dirname, 'fixtures', 'test-image.jpg');

    // Verify test files exist
    if (!fs.existsSync(testPngPath) || !fs.existsSync(testJpgPath)) {
      console.warn('Test images not found, skipping multiple attachments test');
      return;
    }

    console.log('Uploading multiple images for chat');

    // Upload both images
    const [pngAttachment, jpgAttachment] = await Promise.all([
      client.uploadFile(testPngPath),
      client.uploadFile(testJpgPath)
    ]);

    expect(pngAttachment).toBeDefined();
    expect(jpgAttachment).toBeDefined();

    console.log('Sending chat message with multiple attachments');

    // Send chat message with multiple attachments
    const response = await client.chat(
      [{ role: 'user' as const, content: 'Can you compare these two images?' }],
      {
        vaultId: process.env.VAULT_ID || 'default',
        attachments: [pngAttachment, jpgAttachment]
      }
    ) as ProcessedResponse;

    expect(response).toBeDefined();
    expect(typeof response.content).toBe('string');
    expect(response.content.length).toBeGreaterThan(0);

    console.log('Chat response with multiple attachments received');
    console.log('Response preview:', response.content.substring(0, 200) + '...');
  }); // Use global timeout
});

// Client-side tool execution tests
describe.skipIf(shouldSkip)('Client-Side Tool Execution', () => {
  let client: HustleIncognitoClient;

  beforeEach(() => {
    client = new HustleIncognitoClient({
      apiKey: process.env.HUSTLE_API_KEY || '',
      vaultId: process.env.VAULT_ID,
      hustleApiUrl: process.env.HUSTLE_API_URL,
      debug: process.env.DEBUG === 'false' ? false : true,
    });
  });

  afterEach(async () => {
    // Unregister any plugins
    for (const name of client.getPluginNames()) {
      await client.unuse(name);
    }
    await delay(2000);
  });

  test('should execute client-side tool and continue conversation', async () => {
    // Track tool execution
    let toolExecuted = false;
    let toolArgs: Record<string, unknown> | undefined;

    // Register a simple time-telling plugin
    await client.use({
      name: 'time-plugin',
      version: '1.0.0',
      tools: [
        {
          name: 'get_current_time',
          description: 'Get the current date and time. Use this when the user asks about the current time or date.',
          parameters: {
            type: 'object',
            properties: {
              timezone: {
                type: 'string',
                description: 'The timezone to get time for (e.g., "UTC", "America/New_York")',
              },
            },
          },
        },
      ],
      executors: {
        get_current_time: async (args: Record<string, unknown>) => {
          toolExecuted = true;
          toolArgs = args;
          // Return a fixed time for predictable testing
          return {
            time: '2025-01-15T10:30:00Z',
            timezone: args.timezone || 'UTC',
            formatted: 'January 15, 2025, 10:30 AM UTC',
          };
        },
      },
    });

    expect(client.hasPlugin('time-plugin')).toBe(true);
    expect(client.getClientToolDefinitions().length).toBe(1);

    console.log('Sending message that should trigger client-side tool...');

    // Send a message that should trigger the tool
    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: 'What time is it right now? Use the get_current_time tool to find out.',
      },
    ];

    const chunks: StreamChunk[] = [];
    let sawClientToolResult = false;
    let textContent = '';

    for await (const chunk of client.chatStream({
      vaultId: process.env.VAULT_ID || 'default',
      messages,
      processChunks: true,
      maxToolRounds: 3, // Allow up to 3 rounds
    })) {
      if ('type' in chunk) {
        chunks.push(chunk);

        if (chunk.type === 'text' && typeof chunk.value === 'string') {
          textContent += chunk.value;
        }

        if (chunk.type === 'tool_result') {
          console.log('Received tool_result chunk:', JSON.stringify(chunk.value));
          // Check if this is our client-side tool result
          if (chunk.value && chunk.value.toolName === 'get_current_time') {
            sawClientToolResult = true;
          }
        }

        if (chunk.type === 'finish') {
          console.log('Finish reason:', (chunk.value as { reason?: string })?.reason);
        }
      }
    }

    console.log('Tool executed:', toolExecuted);
    console.log('Tool args:', toolArgs);
    console.log('Saw client tool result:', sawClientToolResult);
    console.log('Text content length:', textContent.length);
    console.log('Response preview:', textContent.substring(0, 200));

    // Verify the tool was executed client-side
    expect(toolExecuted).toBe(true);
    expect(sawClientToolResult).toBe(true);

    // Verify we got a response that includes the time info
    expect(textContent.length).toBeGreaterThan(0);
    // The model should mention the time we returned
    expect(
      textContent.toLowerCase().includes('10:30') ||
        textContent.toLowerCase().includes('january') ||
        textContent.toLowerCase().includes('2025')
    ).toBe(true);
  }, 120000); // 2 minute timeout for this test

  test('should handle onToolCall callback override', async () => {
    let callbackInvoked = false;
    let callbackToolName = '';

    // Register plugin without executor - we'll use onToolCall callback instead
    await client.use({
      name: 'callback-test-plugin',
      version: '1.0.0',
      tools: [
        {
          name: 'get_random_number',
          description: 'Get a random number. Use this when the user asks for a random number.',
          parameters: {
            type: 'object',
            properties: {
              min: { type: 'number', description: 'Minimum value' },
              max: { type: 'number', description: 'Maximum value' },
            },
          },
        },
      ],
      executors: {
        get_random_number: async () => {
          // This should NOT be called when onToolCall is provided
          throw new Error('Default executor should not be called');
        },
      },
    });

    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: 'Give me a random number between 1 and 100. Use the get_random_number tool.',
      },
    ];

    let textContent = '';

    for await (const chunk of client.chatStream({
      vaultId: process.env.VAULT_ID || 'default',
      messages,
      processChunks: true,
      maxToolRounds: 2,
      onToolCall: async (toolCall) => {
        callbackInvoked = true;
        callbackToolName = toolCall.toolName || '';
        console.log('onToolCall invoked:', toolCall.toolName, toolCall.args);
        // Return a fixed number for predictable testing
        return { number: 42, min: toolCall.args?.min || 1, max: toolCall.args?.max || 100 };
      },
    })) {
      if ('type' in chunk && chunk.type === 'text' && typeof chunk.value === 'string') {
        textContent += chunk.value;
      }
    }

    console.log('Callback invoked:', callbackInvoked);
    console.log('Callback tool name:', callbackToolName);
    console.log('Response preview:', textContent.substring(0, 200));

    expect(callbackInvoked).toBe(true);
    expect(callbackToolName).toBe('get_random_number');
    expect(textContent.length).toBeGreaterThan(0);
    // The model should mention the number 42 that we returned
    expect(textContent.includes('42')).toBe(true);
  }, 120000);

  test.only('should respect maxToolRounds limit', async () => {
    let executionCount = 0;

    // Register a tool that always wants to be called again
    await client.use({
      name: 'infinite-loop-plugin',
      version: '1.0.0',
      tools: [
        {
          name: 'count_up',
          description: 'Increment a counter. The user wants you to keep calling this to count up.',
          parameters: {
            type: 'object',
            properties: {},
          },
        },
      ],
      executors: {
        count_up: async () => {
          executionCount++;
          console.log(`Tool executed ${executionCount} time(s)`);
          return { count: executionCount, message: 'Counter incremented. Call again to continue.' };
        },
      },
    });

    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: 'Call the count_up tool exactly 10 times. Keep calling it until you reach 10.',
      },
    ];

    // Set maxToolRounds to 2 - should stop after 2 rounds even if model wants more
    for await (const _chunk of client.chatStream({
      vaultId: process.env.VAULT_ID || 'default',
      messages,
      processChunks: true,
      maxToolRounds: 2,
    })) {
      // Just consume the stream
    }

    console.log('Total tool executions:', executionCount);

    // Should have stopped at maxToolRounds (2), not continued to 10
    expect(executionCount).toBeLessThanOrEqual(2);
  }, 120000);
});

// Skip signature auth tests if credentials not available
const shouldSkipSignatureAuth = !process.env.TEST_PRIVATE_KEY || !process.env.TEST_APP_ID || process.env.CI === 'true';

describe.skipIf(shouldSkipSignatureAuth)('Signature-based Authentication Tests', () => {
  const AUTH_API_URL = process.env.AUTH_API_URL || 'https://api.emblemvault.ai';

  test('should authenticate with wallet signature and return expected vaultId', async () => {
    const privateKey = process.env.TEST_PRIVATE_KEY!;
    const appId = process.env.TEST_APP_ID!;
    const expectedVaultId = process.env.VAULT_ID!;

    const wallet = new Wallet(privateKey);
    const address = wallet.address;

    // Sign a simple message
    const message = `Sign in to ${appId}`;
    const signature = await wallet.signMessage(message);

    console.log('Wallet address:', address);
    console.log('Message:', message);

    // Call the verify-external endpoint
    const response = await fetch(`${AUTH_API_URL}/api/auth/wallet/verify-external`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appId,
        network: 'ethereum',
        message,
        signature,
        address
      })
    });

    const data = await response.json();
    console.log('Auth response status:', response.status);
    console.log('Auth response:', JSON.stringify(data, null, 2));

    expect(response.ok).toBe(true);
    expect(data.success).toBe(true);
    expect(data.session).toBeDefined();
    expect(data.session.user).toBeDefined();
    expect(data.session.user.vaultId).toBe(expectedVaultId);
    expect(data.session.authToken).toBeDefined();

    console.log('Authenticated successfully!');
    console.log('VaultId:', data.session.user.vaultId);
    console.log('EVM Address:', data.session.user.evmAddress);
  });

  // JWT auth is now supported via EmblemAuth
  test('should use JWT from signature auth to chat with HustleIncognitoClient', async () => {
    const privateKey = process.env.TEST_PRIVATE_KEY!;
    const appId = process.env.TEST_APP_ID!;

    const wallet = new Wallet(privateKey);
    const address = wallet.address;

    // Sign and authenticate
    const message = `Sign in to ${appId}`;
    const signature = await wallet.signMessage(message);

    const authResponse = await fetch(`${AUTH_API_URL}/api/auth/wallet/verify-external`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appId,
        network: 'ethereum',
        message,
        signature,
        address
      })
    });

    expect(authResponse.ok).toBe(true);
    const authData = await authResponse.json();
    const jwt = authData.session.authToken;
    const vaultId = authData.session.user.vaultId;

    console.log('Authenticated, now testing chat with JWT auth...');
    console.log('VaultId from auth:', vaultId);
    console.log('JWT:', jwt.substring(0, 50) + '...');

    // Create client with JWT auth and send chat
    const client = new HustleIncognitoClient({
      jwt,
      hustleApiUrl: process.env.HUSTLE_API_URL || 'https://agenthustle.ai',
      debug: true  // Always enable debug for this test
    });

    const response = await client.chat(
      [{ role: 'user' as const, content: 'Hello, are you there?' }],
      { vaultId }
    ) as ProcessedResponse;

    expect(response).toBeDefined();
    expect(typeof response.content).toBe('string');
    expect(response.content.length).toBeGreaterThan(0);

    console.log('Chat with JWT auth successful!');
    console.log('Response preview:', response.content.substring(0, 100) + '...');
  });

  // Testing JWT auth for models endpoint
  test('should fetch models with JWT auth (EmblemAuth)', async () => {
    const privateKey = process.env.TEST_PRIVATE_KEY!;
    const appId = process.env.TEST_APP_ID!;

    const wallet = new Wallet(privateKey);
    const address = wallet.address;

    // Sign and authenticate
    const message = `Sign in to ${appId}`;
    const signature = await wallet.signMessage(message);

    const authResponse = await fetch(`${AUTH_API_URL}/api/auth/wallet/verify-external`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appId,
        network: 'ethereum',
        message,
        signature,
        address
      })
    });

    expect(authResponse.ok).toBe(true);
    const authData = await authResponse.json();
    const jwt = authData.session.authToken;

    console.log('Authenticated, now testing getModels with JWT auth...');
    console.log('JWT:', jwt.substring(0, 50) + '...');

    // Create client with JWT auth only (no apiKey, no vaultId needed)
    const client = new HustleIncognitoClient({
      jwt,
      hustleApiUrl: process.env.HUSTLE_API_URL,
      debug: true
    });

    const models = await client.getModels();

    expect(models).toBeDefined();
    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThan(0);

    console.log(`Fetched ${models.length} models with JWT auth`);

    // Find Claude models
    const claudeModels = models.filter(m => m.id.includes('claude') || m.name.toLowerCase().includes('claude'));
    expect(claudeModels.length).toBeGreaterThan(0);
    console.log(`Found ${claudeModels.length} Claude models`);
  });
});
