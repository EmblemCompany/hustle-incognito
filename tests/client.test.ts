import { describe, test, expect, vi } from 'vitest';
import { HustleIncognitoClient } from '../src';
import type { ProcessedResponse, StreamChunk, RawChunk } from '../src/types';

describe('HustleIncognitoClient', () => {
  test('should initialize with required API key', () => {
    const client = new HustleIncognitoClient({ apiKey: 'test-key' });
    expect(client).toBeDefined();
  });

  test('should throw error when API key is missing', () => {
    // @ts-ignore - Testing invalid input
    expect(() => new HustleIncognitoClient({})).toThrow('API key is required');
  });

  test('should use default production URL when not specified', () => {
    const client = new HustleIncognitoClient({ apiKey: 'test-key' });
    // @ts-ignore - Accessing private property for testing
    expect(client.baseUrl).toBe('https://agenthustle.ai');
  });

  test('should use custom URL when specified', () => {
    const client = new HustleIncognitoClient({ 
      apiKey: 'test-key',
      hustleApiUrl: 'https://custom-api.example.com'
    });
    // @ts-ignore - Accessing private property for testing
    expect(client.baseUrl).toBe('https://custom-api.example.com');
  });

  test('should prepare correct request body', () => {
    const client = new HustleIncognitoClient({ apiKey: 'test-key' });
    // @ts-ignore - Accessing private method for testing
    const requestBody = client.prepareRequestBody({
      vaultId: 'test-vault',
      messages: [{ role: 'user', content: 'Hello' }],
      externalWalletAddress: 'test-wallet'
    });
    
    expect(requestBody).toEqual({
      id: 'chat-test-vault',
      messages: [{ role: 'user', content: 'Hello' }],
      apiKey: 'test-key',
      vaultId: 'test-vault',
      externalWalletAddress: 'test-wallet',
      slippageSettings: { lpSlippage: 5, swapSlippage: 5, pumpSlippage: 5 },
      safeMode: true,
      currentPath: null,
      attachments: []
    });
  });

  test('should use override function when provided', async () => {
    const client = new HustleIncognitoClient({ apiKey: 'test-key' });
    const mockResponse: ProcessedResponse = {
      content: 'Mocked response',
      messageId: 'mock-id',
      toolCalls: [
        { toolCallId: 'tool1', toolName: 'test-tool', args: { param: 'value' } }
      ],
      usage: null,
      pathInfo: null,
      toolResults: []
    };
    
    const overrideFunc = vi.fn().mockResolvedValue(mockResponse);
    
    const result = await client.chat(
      [{ role: 'user', content: 'Hello' }],
      { vaultId: 'test-vault' },
      overrideFunc
    );
    
    expect(overrideFunc).toHaveBeenCalledWith('test-key', {
      messages: [{ role: 'user', content: 'Hello' }],
      vaultId: 'test-vault'
    });
    
    expect(result).toEqual(mockResponse);
  });

  test('should properly parse tool calls from stream chunks', async () => {
    const client = new HustleIncognitoClient({ apiKey: 'test-key' });
    
    // Mock the rawStream method to return predefined chunks
    const mockRawStream = async function* () {
      yield { prefix: '0', data: 'Hello', raw: '0:Hello' };
      yield { 
        prefix: '9', 
        data: { 
          toolCallId: 'tool123', 
          toolName: 'test-tool', 
          args: { param: 'value' } 
        }, 
        raw: '9:{"toolCallId":"tool123","toolName":"test-tool","args":{"param":"value"}}' 
      };
      yield { 
        prefix: 'a', 
        data: { 
          toolCallId: 'tool123', 
          result: { success: true } 
        }, 
        raw: 'a:{"toolCallId":"tool123","result":{"success":true}}' 
      };
      yield { prefix: 'f', data: { messageId: 'msg123' }, raw: 'f:{"messageId":"msg123"}' };
    };
    
    // @ts-ignore - Mocking private method
    client.rawStream = mockRawStream;
    
    const response = await client.chat(
      [{ role: 'user', content: 'Test' }],
      { vaultId: 'test' }
    ) as ProcessedResponse;
    
    expect(response.content).toBe('Hello');
    expect(response.messageId).toBe('msg123');
    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls[0].toolCallId).toBe('tool123');
    expect(response.toolCalls[0].toolName).toBe('test-tool');
    expect(response.toolResults).toHaveLength(1);
    expect(response.toolResults[0].toolCallId).toBe('tool123');
  });

  test('should use override function in chatStream method', async () => {
    const client = new HustleIncognitoClient({ apiKey: 'test-key' });
    
    // Create mock stream chunks
    const mockStreamChunks: StreamChunk[] = [
      { type: 'text', value: 'Hello' },
      { type: 'text', value: ' world' },
      { type: 'finish', value: { reason: 'stop', usage: { promptTokens: 10, completionTokens: 5 } } }
    ];
    
    // Create a generator function that yields the mock chunks
    const mockGenerator = async function* () {
      for (const chunk of mockStreamChunks) {
        yield chunk;
      }
    };
    
    // Create a mock override function that returns the generator
    const overrideFunc = vi.fn().mockImplementation(() => mockGenerator());
    
    // Collect the streamed chunks
    const receivedChunks: StreamChunk[] = [];
    for await (const chunk of client.chatStream({
      vaultId: 'test-vault',
      messages: [{ role: 'user', content: 'Hello' }],
      processChunks: true
    }, overrideFunc)) {
      receivedChunks.push(chunk as StreamChunk);
    }
    
    // Verify the override function was called with the correct parameters
    expect(overrideFunc).toHaveBeenCalledWith('test-key', {
      vaultId: 'test-vault',
      messages: [{ role: 'user', content: 'Hello' }],
      processChunks: true
    });
    
    // Verify we received all the mock chunks
    expect(receivedChunks).toHaveLength(mockStreamChunks.length);
    expect(receivedChunks[0]).toEqual(mockStreamChunks[0]);
    expect(receivedChunks[1]).toEqual(mockStreamChunks[1]);
    expect(receivedChunks[2]).toEqual(mockStreamChunks[2]);
  });

  test('should process different chunk types correctly in chatStream', async () => {
    const client = new HustleIncognitoClient({ apiKey: 'test-key' });
    
    // Mock the rawStream method to return various chunk types
    const mockRawStream = async function* () {
      yield { prefix: '0', data: 'Hello', raw: '0:Hello' };
      yield { prefix: '0', data: ' world', raw: '0: world' };
      yield { 
        prefix: '9', 
        data: { 
          toolCallId: 'tool123', 
          toolName: 'test-tool', 
          args: { param: 'value' } 
        }, 
        raw: '9:{"toolCallId":"tool123","toolName":"test-tool","args":{"param":"value"}}' 
      };
      yield { 
        prefix: 'a', 
        data: { 
          toolCallId: 'tool123', 
          result: { success: true } 
        }, 
        raw: 'a:{"toolCallId":"tool123","result":{"success":true}}' 
      };
      yield { prefix: 'f', data: { messageId: 'msg123' }, raw: 'f:{"messageId":"msg123"}' };
      yield { 
        prefix: '2', 
        data: [{ type: 'path_info', path: 'PATH_1', timestamp: '2023-01-01T00:00:00Z' }], 
        raw: '2:[{"type":"path_info","path":"PATH_1","timestamp":"2023-01-01T00:00:00Z"}]' 
      };
      yield { 
        prefix: 'e', 
        data: { finishReason: 'stop', usage: { promptTokens: 10, completionTokens: 5 } }, 
        raw: 'e:{"finishReason":"stop","usage":{"promptTokens":10,"completionTokens":5}}' 
      };
    };
    
    // @ts-ignore - Mocking private method
    client.rawStream = mockRawStream;
    
    // Collect the processed chunks
    const processedChunks: StreamChunk[] = [];
    for await (const chunk of client.chatStream({
      vaultId: 'test-vault',
      messages: [{ role: 'user', content: 'Test' }],
      processChunks: true
    })) {
      processedChunks.push(chunk as StreamChunk);
    }
    
    // Verify we processed all chunk types correctly
    expect(processedChunks).toHaveLength(7);
    
    // Text chunks
    expect(processedChunks[0]).toEqual({ type: 'text', value: 'Hello' });
    expect(processedChunks[1]).toEqual({ type: 'text', value: ' world' });
    
    // Tool call
    expect(processedChunks[2]).toEqual({ 
      type: 'tool_call', 
      value: { 
        toolCallId: 'tool123', 
        toolName: 'test-tool', 
        args: { param: 'value' } 
      } 
    });
    
    // Tool result
    expect(processedChunks[3]).toEqual({ 
      type: 'tool_result', 
      value: { 
        toolCallId: 'tool123', 
        result: { success: true } 
      } 
    });
    
    // Message ID
    expect(processedChunks[4]).toEqual({ type: 'message_id', value: 'msg123' });
    
    // Path info
    expect(processedChunks[5]).toEqual({ 
      type: 'path_info', 
      value: { type: 'path_info', path: 'PATH_1', timestamp: '2023-01-01T00:00:00Z' } 
    });
    
    // Finish event
    expect(processedChunks[6]).toEqual({ 
      type: 'finish', 
      value: { 
        reason: 'stop', 
        usage: { promptTokens: 10, completionTokens: 5 } 
      } 
    });
  });

  test('should handle non-processed chunks in chatStream', async () => {
    const client = new HustleIncognitoClient({ apiKey: 'test-key' });
    
    // Mock raw chunks to be returned
    const mockRawChunks = [
      { prefix: '0', data: 'Hello', raw: '0:Hello' },
      { prefix: 'e', data: { finishReason: 'stop' }, raw: 'e:{"finishReason":"stop"}' }
    ];
    
    // Mock the rawStream method
    const mockRawStream = async function* () {
      for (const chunk of mockRawChunks) {
        yield chunk;
      }
    };
    
    // @ts-ignore - Mocking private method
    client.rawStream = mockRawStream;
    
    // Collect the raw chunks when processChunks is false
    const receivedChunks: RawChunk[] = [];
    for await (const chunk of client.chatStream({
      vaultId: 'test-vault',
      messages: [{ role: 'user', content: 'Test' }],
      processChunks: false
    })) {
      receivedChunks.push(chunk as RawChunk);
    }
    
    // Verify we received the raw chunks unchanged
    expect(receivedChunks).toHaveLength(mockRawChunks.length);
    expect(receivedChunks[0]).toEqual(mockRawChunks[0]);
    expect(receivedChunks[1]).toEqual(mockRawChunks[1]);
  });

  test('should enable debug mode when specified', () => {
    // Mock console.log to verify debug output
    const originalConsoleLog = console.log;
    const mockConsoleLog = vi.fn();
    console.log = mockConsoleLog;
    
    try {
      // Create client with debug enabled
      new HustleIncognitoClient({ 
        apiKey: 'test-key',
        debug: true
      });
      
      // Verify debug logs were output
      expect(mockConsoleLog).toHaveBeenCalled();
      expect(mockConsoleLog.mock.calls[0][0]).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z\] Emblem Vault Hustle Incognito SDK v/);
    } finally {
      // Restore original console.log
      console.log = originalConsoleLog;
    }
  });
});
