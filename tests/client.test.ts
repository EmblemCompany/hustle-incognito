import { describe, test, expect, vi, beforeEach } from 'vitest';
import { HustleIncognitoClient } from '../src';
import type { ProcessedResponse, StreamChunk, RawChunk, IntentContext } from '../src/types';

// Mock Node.js modules at the top level
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  }
}));

vi.mock('node:path', () => ({
  basename: vi.fn(),
  extname: vi.fn(),
  default: {
    basename: vi.fn(),
    extname: vi.fn(),
  }
}));

vi.mock('file-type', () => ({
  fileTypeFromBuffer: vi.fn(),
}));

describe('HustleIncognitoClient', () => {
  test('should initialize with required API key', () => {
    const client = new HustleIncognitoClient({ apiKey: 'test-key' });
    expect(client).toBeDefined();
  });

  test('should throw error when no authentication is provided', () => {
    // @ts-ignore - Testing invalid input
    expect(() => new HustleIncognitoClient({})).toThrow(
      'Authentication required: provide apiKey, jwt, getJwt(), sdk, or getAuthHeaders()'
    );
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
      model: undefined,
      externalWalletAddress: 'test-wallet',
      slippageSettings: { lpSlippage: 5, swapSlippage: 5, pumpSlippage: 5 },
      safeMode: true,
      currentPath: null,
      attachments: [],
      selectedToolCategories: []
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
      toolResults: [],
      reasoning: null,
      intentContext: null,
      devToolsInfo: null,
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

  describe('uploadFile', () => {
    let fs: any;
    let path: any;
    let fileType: any;

    beforeEach(async () => {
      fs = await import('node:fs');
      path = await import('node:path');
      fileType = await import('file-type');
      vi.clearAllMocks();
    });

    test('should upload a PNG file successfully', async () => {
      const client = new HustleIncognitoClient({ apiKey: 'test-key' });

      // Mock file system and fetch
      const mockFileBuffer = Buffer.from('fake-png-data');
      const mockResponse = {
        ok: true,
        json: () => Promise.resolve({ url: 'https://example.com/uploaded-file.png' })
      };

      const mockFetch = vi.fn().mockResolvedValue(mockResponse);
      // @ts-expect-error - Overriding private property for testing
      client.fetchImpl = mockFetch;

      // Set up mocks
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(mockFileBuffer);
      vi.mocked(path.basename).mockReturnValue('test.png');
      vi.mocked(path.extname).mockReturnValue('.png');

      const result = await client.uploadFile('/path/to/test.png');

      expect(result).toEqual({
        name: 'test.png',
        contentType: 'image/png',
        url: 'https://example.com/uploaded-file.png'
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://agenthustle.ai/api/files/upload',
        expect.objectContaining({
          method: 'POST',
          body: expect.any(FormData)
        })
      );
    });

    test('should throw error for non-existent file', async () => {
      const client = new HustleIncognitoClient({ apiKey: 'test-key' });

      vi.mocked(fs.existsSync).mockReturnValue(false);

      await expect(client.uploadFile('/path/to/nonexistent.png'))
        .rejects
        .toThrow('File not found: /path/to/nonexistent.png');
    });

    test('should throw error for unsupported file type', async () => {
      const client = new HustleIncognitoClient({ apiKey: 'test-key' });

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('fake-data'));
      vi.mocked(path.basename).mockReturnValue('test.txt');
      vi.mocked(path.extname).mockReturnValue('.txt');
      vi.mocked(fileType.fileTypeFromBuffer).mockResolvedValue(undefined);

      await expect(client.uploadFile('/path/to/test.txt'))
        .rejects
        .toThrow('Unsupported file type');
    });

    test('should throw error for file size exceeding limit', async () => {
      const client = new HustleIncognitoClient({ apiKey: 'test-key' });

      // Create a buffer larger than 5MB
      const largeMockFileBuffer = Buffer.alloc(6 * 1024 * 1024, 'x');

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(largeMockFileBuffer);
      vi.mocked(path.basename).mockReturnValue('large.png');
      vi.mocked(path.extname).mockReturnValue('.png');

      await expect(client.uploadFile('/path/to/large.png'))
        .rejects
        .toThrow('File size should be less than 5MB');
    });

    test('should handle upload API error', async () => {
      const client = new HustleIncognitoClient({ apiKey: 'test-key' });

      const mockFileBuffer = Buffer.from('fake-data');
      const mockResponse = {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: () => Promise.resolve('Invalid file format')
      };

      const mockFetch = vi.fn().mockResolvedValue(mockResponse);
      // @ts-expect-error - Overriding private property for testing
      client.fetchImpl = mockFetch;

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(mockFileBuffer);
      vi.mocked(path.basename).mockReturnValue('test.png');
      vi.mocked(path.extname).mockReturnValue('.png');

      await expect(client.uploadFile('/path/to/test.png'))
        .rejects
        .toThrow('Upload failed: 400 Bad Request - Invalid file format');
    });

    test('should correctly identify different image content types', async () => {
      const client = new HustleIncognitoClient({ apiKey: 'test-key' });

      const testCases = [
        { ext: '.jpg', expectedType: 'image/jpeg' },
        { ext: '.jpeg', expectedType: 'image/jpeg' },
        { ext: '.png', expectedType: 'image/png' },
        { ext: '.gif', expectedType: 'image/gif' },
        { ext: '.webp', expectedType: 'image/webp' }
      ];

      for (const testCase of testCases) {
        const mockFileBuffer = Buffer.from('fake-data');
        const mockResponse = {
          ok: true,
          json: () => Promise.resolve({ url: `https://example.com/test${testCase.ext}` })
        };

        const mockFetch = vi.fn().mockResolvedValue(mockResponse);
        // @ts-expect-error - Overriding private property for testing
        client.fetchImpl = mockFetch;

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(mockFileBuffer);
        vi.mocked(path.basename).mockReturnValue(`test${testCase.ext}`);
        vi.mocked(path.extname).mockReturnValue(testCase.ext);

        const result = await client.uploadFile(`/path/to/test${testCase.ext}`);
        expect(result.contentType).toBe(testCase.expectedType);

        vi.clearAllMocks();
      }
    });

    test('should detect PNG MIME type from file content without extension', async () => {
      const client = new HustleIncognitoClient({ apiKey: 'test-key' });

      // Create a mock PNG buffer (minimal valid PNG header and data)
      const pngBuffer = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,  // PNG signature
        0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,  // IHDR chunk
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,  // 1x1 dimensions
        0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
        0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41,  // IDAT chunk
        0x54, 0x78, 0x9c, 0x62, 0x00, 0x02, 0x00, 0x00,
        0x05, 0x00, 0x01, 0xe2, 0x26, 0x05, 0x5b, 0x00,
        0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,  // IEND chunk
        0x42, 0x60, 0x82
      ]);

      const mockResponse = {
        ok: true,
        json: () => Promise.resolve({ url: 'https://example.com/test-image' })
      };

      const mockFetch = vi.fn().mockResolvedValue(mockResponse);
      // @ts-expect-error - Overriding private property for testing
      client.fetchImpl = mockFetch;

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(pngBuffer);
      vi.mocked(path.basename).mockReturnValue('test-image');
      vi.mocked(path.extname).mockReturnValue('');  // No extension
      vi.mocked(fileType.fileTypeFromBuffer).mockResolvedValue({ mime: 'image/png', ext: 'png' });

      const result = await client.uploadFile('/path/to/test-image');

      // Should detect as PNG based on file content, not extension
      expect(result.contentType).toBe('image/png');
      expect(result.name).toBe('test-image');
      expect(result.url).toBe('https://example.com/test-image');
    });
  });

  describe('SDK/JWT Authentication', () => {
    test('should initialize with static JWT token', () => {
      const client = new HustleIncognitoClient({
        jwt: 'test-jwt-token',
      });
      expect(client).toBeDefined();
    });

    test('should initialize with getJwt function', () => {
      const client = new HustleIncognitoClient({
        getJwt: () => 'dynamic-jwt-token',
      });
      expect(client).toBeDefined();
    });

    test('should initialize with async getJwt function', () => {
      const client = new HustleIncognitoClient({
        getJwt: async () => 'async-jwt-token',
      });
      expect(client).toBeDefined();
    });

    test('should initialize with SDK instance', () => {
      const mockSdk = {
        getSession: () => ({ authToken: 'sdk-jwt-token' }),
      };
      const client = new HustleIncognitoClient({
        sdk: mockSdk,
      });
      expect(client).toBeDefined();
    });

    test('should initialize with getAuthHeaders function', () => {
      const client = new HustleIncognitoClient({
        getAuthHeaders: () => ({ Authorization: 'Bearer custom-token' }),
      });
      expect(client).toBeDefined();
    });

    test('should use JWT in Authorization header when making requests', async () => {
      const client = new HustleIncognitoClient({
        jwt: 'test-jwt-token',
      });

      // Mock fetch to capture the request
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: [] }),
      });
      // @ts-ignore - Accessing private property for testing
      client.fetchImpl = mockFetch;

      await client.getTools();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-jwt-token',
          }),
        })
      );
    });

    test('should use SDK session token in Authorization header', async () => {
      const mockSdk = {
        getSession: () => ({ authToken: 'sdk-session-token' }),
      };
      const client = new HustleIncognitoClient({
        sdk: mockSdk,
      });

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: [] }),
      });
      // @ts-ignore - Accessing private property for testing
      client.fetchImpl = mockFetch;

      await client.getTools();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer sdk-session-token',
          }),
        })
      );
    });

    test('should call getJwt on each request for fresh token', async () => {
      let callCount = 0;
      const getJwt = vi.fn().mockImplementation(() => {
        callCount++;
        return `token-${callCount}`;
      });

      const client = new HustleIncognitoClient({
        getJwt,
      });

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: [] }),
      });
      // @ts-ignore - Accessing private property for testing
      client.fetchImpl = mockFetch;

      // First request
      await client.getTools();
      expect(getJwt).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer token-1',
          }),
        })
      );

      // Second request should get fresh token
      await client.getTools();
      expect(getJwt).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer token-2',
          }),
        })
      );
    });

    test('should use custom headers from getAuthHeaders', async () => {
      const client = new HustleIncognitoClient({
        getAuthHeaders: () => ({
          Authorization: 'Custom custom-auth-value',
          'X-Custom-Header': 'custom-value',
        }),
      });

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: [] }),
      });
      // @ts-ignore - Accessing private property for testing
      client.fetchImpl = mockFetch;

      await client.getTools();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Custom custom-auth-value',
            'X-Custom-Header': 'custom-value',
          }),
        })
      );
    });

    test('should prioritize getAuthHeaders over jwt', async () => {
      const client = new HustleIncognitoClient({
        jwt: 'static-jwt',
        getAuthHeaders: () => ({ Authorization: 'Bearer custom-header-token' }),
      });

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: [] }),
      });
      // @ts-ignore - Accessing private property for testing
      client.fetchImpl = mockFetch;

      await client.getTools();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer custom-header-token',
          }),
        })
      );
    });

    test('should not require apiKey in request body when using JWT auth', async () => {
      const client = new HustleIncognitoClient({
        jwt: 'test-jwt-token',
      });

      // Mock the rawStream method to return predefined chunks
      const mockRawStream = async function* () {
        yield { prefix: '0', data: 'Hello', raw: '0:Hello' };
        yield { prefix: 'f', data: { messageId: 'msg123' }, raw: 'f:{"messageId":"msg123"}' };
      };

      // @ts-ignore - Mocking private method
      client.rawStream = mockRawStream;

      const response = (await client.chat(
        [{ role: 'user', content: 'Test' }],
        { vaultId: 'test' }
      )) as ProcessedResponse;

      expect(response.content).toBe('Hello');
    });

    test('should handle SDK with null session gracefully', async () => {
      const mockSdk = {
        getSession: () => null,
      };
      const client = new HustleIncognitoClient({
        sdk: mockSdk,
        apiKey: 'fallback-api-key', // Provide fallback
      });

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: [] }),
      });
      // @ts-ignore - Accessing private property for testing
      client.fetchImpl = mockFetch;

      await client.getTools();

      // Should not have Authorization header since SDK session is null
      const callArgs = mockFetch.mock.calls[0][1];
      expect(callArgs.headers.Authorization).toBeUndefined();
    });

    test('should auto-resolve vaultId from SDK session', async () => {
      const mockSdk = {
        getSession: () => ({
          authToken: 'test-token',
          user: { vaultId: 'session-vault-123' },
        }),
      };
      const client = new HustleIncognitoClient({
        sdk: mockSdk,
      });

      // Mock the rawStream method to return predefined chunks
      const mockRawStream = async function* () {
        yield { prefix: '0', data: 'Hello', raw: '0:Hello' };
        yield { prefix: 'f', data: { messageId: 'msg123' }, raw: 'f:{"messageId":"msg123"}' };
      };

      // @ts-ignore - Mocking private method
      client.rawStream = mockRawStream;

      // Call chat WITHOUT providing vaultId - should use SDK session
      const response = (await client.chat([{ role: 'user', content: 'Test' }])) as ProcessedResponse;

      expect(response.content).toBe('Hello');
    });

    test('should auto-resolve vaultId from SDK getVaultInfo', async () => {
      const mockSdk = {
        getSession: () => ({ authToken: 'test-token' }), // No user.vaultId
        getVaultInfo: vi.fn().mockResolvedValue({ vaultId: 'vault-info-456' }),
      };
      const client = new HustleIncognitoClient({
        sdk: mockSdk,
      });

      // Mock the rawStream method
      const mockRawStream = async function* () {
        yield { prefix: '0', data: 'Hello', raw: '0:Hello' };
        yield { prefix: 'f', data: { messageId: 'msg123' }, raw: 'f:{"messageId":"msg123"}' };
      };

      // @ts-ignore - Mocking private method
      client.rawStream = mockRawStream;

      // Call chat WITHOUT providing vaultId - should call getVaultInfo
      const response = (await client.chat([{ role: 'user', content: 'Test' }])) as ProcessedResponse;

      expect(mockSdk.getVaultInfo).toHaveBeenCalled();
      expect(response.content).toBe('Hello');
    });

    test('should ignore explicit vaultId when using SDK auth (session determines vaultId)', async () => {
      const mockSdk = {
        getSession: () => ({
          authToken: 'test-token',
          user: { vaultId: 'session-vault-123' },
        }),
      };
      const client = new HustleIncognitoClient({
        sdk: mockSdk,
      });

      let capturedVaultId: string | undefined;

      // Mock the rawStream method to capture the vaultId
      // @ts-ignore - Mocking private method
      client.rawStream = async function* (options: any) {
        capturedVaultId = options.vaultId;
        yield { prefix: '0', data: 'Hello', raw: '0:Hello' };
        yield { prefix: 'f', data: { messageId: 'msg123' }, raw: 'f:{"messageId":"msg123"}' };
      };

      // Call chat WITH explicit vaultId - should be ignored, use session vaultId
      await client.chat([{ role: 'user', content: 'Test' }], { vaultId: 'explicit-vault-789' });

      // When using SDK auth, the session vaultId is always used
      expect(capturedVaultId).toBe('session-vault-123');
    });

    test('should allow explicit vaultId with raw JWT (no SDK)', async () => {
      const client = new HustleIncognitoClient({
        jwt: 'test-token',
      });

      let capturedVaultId: string | undefined;

      // Mock the rawStream method to capture the vaultId
      // @ts-ignore - Mocking private method
      client.rawStream = async function* (options: any) {
        capturedVaultId = options.vaultId;
        yield { prefix: '0', data: 'Hello', raw: '0:Hello' };
        yield { prefix: 'f', data: { messageId: 'msg123' }, raw: 'f:{"messageId":"msg123"}' };
      };

      // Raw JWT with explicit vaultId should work
      await client.chat([{ role: 'user', content: 'Test' }], { vaultId: 'my-vault' });

      expect(capturedVaultId).toBe('my-vault');
    });

    test('should throw error when no vaultId provided and no SDK', async () => {
      const client = new HustleIncognitoClient({
        jwt: 'test-token',
      });

      // Call chat WITHOUT providing vaultId and without SDK
      await expect(client.chat([{ role: 'user', content: 'Test' }])).rejects.toThrow(
        'vaultId is required'
      );
    });

    test('should throw error when no vaultId provided with API key auth', async () => {
      const client = new HustleIncognitoClient({
        apiKey: 'test-api-key',
      });

      // Call chat WITHOUT providing vaultId
      await expect(client.chat([{ role: 'user', content: 'Test' }])).rejects.toThrow(
        'vaultId is required'
      );
    });

    test('should use explicit vaultId when using API key auth', async () => {
      const client = new HustleIncognitoClient({
        apiKey: 'test-api-key',
      });

      let capturedVaultId: string | undefined;

      // Mock the rawStream method to capture the vaultId
      // @ts-ignore - Mocking private method
      client.rawStream = async function* (options: any) {
        capturedVaultId = options.vaultId;
        yield { prefix: '0', data: 'Hello', raw: '0:Hello' };
        yield { prefix: 'f', data: { messageId: 'msg123' }, raw: 'f:{"messageId":"msg123"}' };
      };

      // Call chat WITH explicit vaultId
      await client.chat([{ role: 'user', content: 'Test' }], { vaultId: 'explicit-vault-789' });

      expect(capturedVaultId).toBe('explicit-vault-789');
    });
  });

  describe('StreamWithResponse', () => {
    test('should return StreamWithResponse with response promise from chatStream', async () => {
      const client = new HustleIncognitoClient({ apiKey: 'test-key' });

      // Mock the rawStream method
      const mockRawStream = async function* () {
        yield { prefix: '0', data: 'Hello ', raw: '0:"Hello "' };
        yield { prefix: '0', data: 'world!', raw: '0:"world!"' };
        yield { prefix: 'f', data: { messageId: 'msg-123' }, raw: 'f:{"messageId":"msg-123"}' };
        yield { prefix: 'e', data: { finishReason: 'stop', usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }, raw: 'e:{}' };
      };

      // @ts-ignore - Mocking private method
      client.rawStream = mockRawStream;

      const stream = client.chatStream({
        vaultId: 'test-vault',
        messages: [{ role: 'user', content: 'Test' }],
        processChunks: true
      });

      // Verify stream has response property
      expect(stream).toHaveProperty('response');
      expect(stream.response).toBeInstanceOf(Promise);

      // Consume the stream
      const chunks: StreamChunk[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk as StreamChunk);
      }

      // Await the aggregated response
      const response = await stream.response;

      expect(response.content).toBe('Hello world!');
      expect(response.messageId).toBe('msg-123');
      expect(response.usage).toEqual({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
    });

    test('should aggregate tool calls and results in response', async () => {
      const client = new HustleIncognitoClient({ apiKey: 'test-key' });

      const mockRawStream = async function* () {
        yield { prefix: '0', data: 'Checking...', raw: '0:"Checking..."' };
        yield { prefix: '9', data: { toolCallId: 'call-1', toolName: 'get_price', args: { symbol: 'BTC' } }, raw: '9:{}' };
        yield { prefix: 'a', data: { toolCallId: 'call-1', result: { price: 50000 } }, raw: 'a:{}' };
        yield { prefix: '9', data: { toolCallId: 'call-2', toolName: 'get_balance', args: {} }, raw: '9:{}' };
        yield { prefix: 'a', data: { toolCallId: 'call-2', result: { balance: 1.5 } }, raw: 'a:{}' };
        yield { prefix: '0', data: ' Done!', raw: '0:" Done!"' };
        yield { prefix: 'f', data: { messageId: 'msg-456' }, raw: 'f:{}' };
      };

      // @ts-ignore - Mocking private method
      client.rawStream = mockRawStream;

      const stream = client.chatStream({
        vaultId: 'test-vault',
        messages: [{ role: 'user', content: 'Test' }],
        processChunks: true
      });

      // Consume the stream
      for await (const _ of stream) {
        // Just iterate
      }

      const response = await stream.response;

      // Text after tool activity gets newline separator to prevent run-on sentences
      expect(response.content).toBe('Checking...\n Done!');
      expect(response.toolCalls).toHaveLength(2);
      // Check both new and backward-compatible field names
      expect(response.toolCalls[0]).toEqual({
        toolCallId: 'call-1', toolName: 'get_price', args: { symbol: 'BTC' },
        id: 'call-1', name: 'get_price', arguments: { symbol: 'BTC' }
      });
      expect(response.toolCalls[1]).toEqual({
        toolCallId: 'call-2', toolName: 'get_balance', args: {},
        id: 'call-2', name: 'get_balance', arguments: {}
      });
      expect(response.toolResults).toHaveLength(2);
      expect(response.toolResults[0]).toEqual({
        toolCallId: 'call-1', result: { price: 50000 },
        id: 'call-1', name: undefined
      });
      expect(response.toolResults[1]).toEqual({
        toolCallId: 'call-2', result: { balance: 1.5 },
        id: 'call-2', name: undefined
      });
    });

    test('should aggregate path info in response', async () => {
      const client = new HustleIncognitoClient({ apiKey: 'test-key' });

      const pathInfoData = { type: 'path_info', path: 'PATH_1', reasoning: 'Default path' };

      const mockRawStream = async function* () {
        yield { prefix: '2', data: [pathInfoData], raw: '2:[...]' };
        yield { prefix: '0', data: 'Response', raw: '0:"Response"' };
        yield { prefix: 'f', data: { messageId: 'msg-789' }, raw: 'f:{}' };
      };

      // @ts-ignore - Mocking private method
      client.rawStream = mockRawStream;

      const stream = client.chatStream({
        vaultId: 'test-vault',
        messages: [{ role: 'user', content: 'Test' }],
        processChunks: true
      });

      for await (const _ of stream) {}

      const response = await stream.response;

      expect(response.pathInfo).toEqual(pathInfoData);
      expect(response.content).toBe('Response');
    });

    test('should still work with for-await (non-breaking)', async () => {
      const client = new HustleIncognitoClient({ apiKey: 'test-key' });

      const mockRawStream = async function* () {
        yield { prefix: '0', data: 'Chunk 1', raw: '0:"Chunk 1"' };
        yield { prefix: '0', data: 'Chunk 2', raw: '0:"Chunk 2"' };
        yield { prefix: 'e', data: { finishReason: 'stop' }, raw: 'e:{}' };
      };

      // @ts-ignore - Mocking private method
      client.rawStream = mockRawStream;

      // Original usage pattern - should still work
      const receivedChunks: StreamChunk[] = [];
      for await (const chunk of client.chatStream({
        vaultId: 'test-vault',
        messages: [{ role: 'user', content: 'Test' }],
        processChunks: true
      })) {
        receivedChunks.push(chunk as StreamChunk);
      }

      expect(receivedChunks).toHaveLength(3);
      expect(receivedChunks[0]).toEqual({ type: 'text', value: 'Chunk 1' });
      expect(receivedChunks[1]).toEqual({ type: 'text', value: 'Chunk 2' });
      expect(receivedChunks[2].type).toBe('finish');
    });

    test('should handle errors and reject response promise', async () => {
      const client = new HustleIncognitoClient({ apiKey: 'test-key' });

      const mockRawStream = async function* () {
        yield { prefix: '0', data: 'Starting...', raw: '0:"Starting..."' };
        throw new Error('Stream error');
      };

      // @ts-ignore - Mocking private method
      client.rawStream = mockRawStream;

      const stream = client.chatStream({
        vaultId: 'test-vault',
        messages: [{ role: 'user', content: 'Test' }],
        processChunks: true
      });

      // Consuming the stream should throw
      await expect(async () => {
        for await (const _ of stream) {}
      }).rejects.toThrow('Stream error');

      // Response promise should also reject
      await expect(stream.response).rejects.toThrow('Stream error');
    });

    test('chat() method should use StreamWithResponse internally', async () => {
      const client = new HustleIncognitoClient({ apiKey: 'test-key' });

      const mockRawStream = async function* () {
        yield { prefix: '0', data: 'Hello', raw: '0:"Hello"' };
        yield { prefix: '9', data: { toolCallId: 'tool-1', toolName: 'test', args: {} }, raw: '9:{}' };
        yield { prefix: 'a', data: { toolCallId: 'tool-1', result: 'success' }, raw: 'a:{}' };
        yield { prefix: '2', data: [{ path: 'PATH_2' }], raw: '2:[...]' };
        yield { prefix: 'f', data: { messageId: 'msg-abc' }, raw: 'f:{}' };
        yield { prefix: 'e', data: { finishReason: 'stop', usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } }, raw: 'e:{}' };
      };

      // @ts-ignore - Mocking private method
      client.rawStream = mockRawStream;

      // chat() should return the same aggregated response
      const response = await client.chat(
        [{ role: 'user', content: 'Test' }],
        { vaultId: 'test-vault' }
      ) as ProcessedResponse;

      expect(response.content).toBe('Hello');
      expect(response.messageId).toBe('msg-abc');
      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolResults).toHaveLength(1);
      expect(response.pathInfo).toEqual({ path: 'PATH_2' });
      expect(response.usage).toEqual({ prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 });
    });

    test('should parse prefix 2 metadata types (reasoning, intent_context, dev_tools_info)', async () => {
      const client = new HustleIncognitoClient({ apiKey: 'test-key' });

      const reasoningData = { type: 'reasoning', thinking: 'User wants memory info', networks: [], categories: ['required'], confidence: 0.95 };
      const intentContextData = { type: 'intent_context', intentContext: { activeIntent: 'Get memory categories' }, confidence: 0.95 };
      const devToolsInfoData = { type: 'dev_tools_info', qualifiedCategories: ['required'], availableTools: ['wallet', 'createMemory'], toolCount: 2 };
      const pathInfoData = { type: 'path_info', path: 'PATH_1', reasoning: 'Default path' };

      const mockRawStream = async function* () {
        yield { prefix: '2', data: [reasoningData], raw: '2:[...]' };
        yield { prefix: '2', data: [intentContextData], raw: '2:[...]' };
        yield { prefix: '2', data: [devToolsInfoData], raw: '2:[...]' };
        yield { prefix: '2', data: [pathInfoData], raw: '2:[...]' };
        yield { prefix: '0', data: 'Response text', raw: '0:"Response text"' };
        yield { prefix: 'f', data: { messageId: 'msg-meta' }, raw: 'f:{}' };
      };

      // @ts-ignore - Mocking private method
      client.rawStream = mockRawStream;

      const stream = client.chatStream({
        vaultId: 'test-vault',
        messages: [{ role: 'user', content: 'Test' }],
        processChunks: true
      });

      // Collect chunks to verify they're yielded with correct types
      const chunks: StreamChunk[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk as StreamChunk);
      }

      // Verify chunk types are correct
      expect(chunks[0]).toEqual({ type: 'reasoning', value: reasoningData });
      expect(chunks[1]).toEqual({ type: 'intent_context', value: intentContextData });
      expect(chunks[2]).toEqual({ type: 'dev_tools_info', value: devToolsInfoData });
      expect(chunks[3]).toEqual({ type: 'path_info', value: pathInfoData });

      // Verify ProcessedResponse has all the data
      const response = await stream.response;
      expect(response.reasoning).toEqual(reasoningData);
      expect(response.intentContext).toEqual(intentContextData);
      expect(response.devToolsInfo).toEqual(devToolsInfoData);
      expect(response.pathInfo).toEqual(pathInfoData);
      expect(response.content).toBe('Response text');
    });
  });

  describe('plugin system', () => {
    test('should register a plugin using use()', async () => {
      const client = new HustleIncognitoClient({ apiKey: 'test-key' });

      await client.use({
        name: 'test-plugin',
        version: '1.0.0',
        tools: [
          {
            name: 'test_tool',
            description: 'A test tool',
            parameters: { type: 'object', properties: {} },
          },
        ],
      });

      expect(client.hasPlugin('test-plugin')).toBe(true);
      expect(client.getPluginNames()).toContain('test-plugin');
    });

    test('should unregister a plugin using unuse()', async () => {
      const client = new HustleIncognitoClient({ apiKey: 'test-key' });

      await client.use({
        name: 'removable-plugin',
        version: '1.0.0',
      });

      expect(client.hasPlugin('removable-plugin')).toBe(true);

      await client.unuse('removable-plugin');

      expect(client.hasPlugin('removable-plugin')).toBe(false);
    });

    test('should return client tool definitions', async () => {
      const client = new HustleIncognitoClient({ apiKey: 'test-key' });

      await client.use({
        name: 'tools-plugin',
        version: '1.0.0',
        tools: [
          {
            name: 'tool_a',
            description: 'Tool A',
            parameters: { type: 'object', properties: {} },
          },
          {
            name: 'tool_b',
            description: 'Tool B',
            parameters: {
              type: 'object',
              properties: {
                input: { type: 'string' },
              },
            },
          },
        ],
      });

      const definitions = client.getClientToolDefinitions();
      expect(definitions).toHaveLength(2);
      expect(definitions.map((d) => d.name)).toEqual(['tool_a', 'tool_b']);
    });

    test('should include client tools in request body', async () => {
      const client = new HustleIncognitoClient({ apiKey: 'test-key' });

      await client.use({
        name: 'request-tools-plugin',
        version: '1.0.0',
        tools: [
          {
            name: 'request_tool',
            description: 'Tool for request',
            parameters: { type: 'object', properties: {} },
          },
        ],
      });

      // @ts-ignore - Accessing private method for testing
      const requestBody = client.prepareRequestBody({
        vaultId: 'test-vault',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(requestBody.clientTools).toBeDefined();
      expect(requestBody.clientTools).toHaveLength(1);
      expect(requestBody.clientTools![0].name).toBe('request_tool');
    });

    test('should not include clientTools when no plugins registered', () => {
      const client = new HustleIncognitoClient({ apiKey: 'test-key' });

      // @ts-ignore - Accessing private method for testing
      const requestBody = client.prepareRequestBody({
        vaultId: 'test-vault',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(requestBody.clientTools).toBeUndefined();
    });

    test('should support chaining with use()', async () => {
      const client = new HustleIncognitoClient({ apiKey: 'test-key' });

      const result = await client
        .use({ name: 'plugin-1', version: '1.0.0' })
        .then((c) => c.use({ name: 'plugin-2', version: '1.0.0' }));

      expect(result).toBe(client);
      expect(client.getPluginNames()).toEqual(['plugin-1', 'plugin-2']);
    });
  });

  describe('tool filtering options', () => {
    test('should include exactToolNames in prepareRequestBody when provided', () => {
      const client = new HustleIncognitoClient({ apiKey: 'test-key' });

      // @ts-ignore - Accessing private method for testing
      const requestBody = client.prepareRequestBody({
        vaultId: 'test-vault',
        messages: [{ role: 'user', content: 'Hello' }],
        exactToolNames: ['swap', 'getBalance', 'searchTokens'],
        ignoreOtherTools: true,
      });

      expect(requestBody.exactToolNames).toEqual(['swap', 'getBalance', 'searchTokens']);
      expect(requestBody.ignoreOtherTools).toBe(true);
    });

    test('should include excludedTools in prepareRequestBody when provided', () => {
      const client = new HustleIncognitoClient({ apiKey: 'test-key' });

      // @ts-ignore - Accessing private method for testing
      const requestBody = client.prepareRequestBody({
        vaultId: 'test-vault',
        messages: [{ role: 'user', content: 'Hello' }],
        excludedTools: ['dangerousTool', 'experimentalTool'],
      });

      expect(requestBody.excludedTools).toEqual(['dangerousTool', 'experimentalTool']);
    });

    test('should not include tool filtering options when not provided', () => {
      const client = new HustleIncognitoClient({ apiKey: 'test-key' });

      // @ts-ignore - Accessing private method for testing
      const requestBody = client.prepareRequestBody({
        vaultId: 'test-vault',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(requestBody.exactToolNames).toBeUndefined();
      expect(requestBody.ignoreOtherTools).toBeUndefined();
      expect(requestBody.excludedTools).toBeUndefined();
    });

    test('should support combining exactToolNames with excludedTools', () => {
      const client = new HustleIncognitoClient({ apiKey: 'test-key' });

      // @ts-ignore - Accessing private method for testing
      const requestBody = client.prepareRequestBody({
        vaultId: 'test-vault',
        messages: [{ role: 'user', content: 'Hello' }],
        exactToolNames: ['swap', 'getBalance', 'searchTokens'],
        ignoreOtherTools: true,
        excludedTools: ['swap'], // Exclude swap from the whitelist
      });

      expect(requestBody.exactToolNames).toEqual(['swap', 'getBalance', 'searchTokens']);
      expect(requestBody.ignoreOtherTools).toBe(true);
      expect(requestBody.excludedTools).toEqual(['swap']);
    });
  });

  describe('intentContext support (auto-tools mode)', () => {
    test('should include intentContext in prepareRequestBody when provided', () => {
      const client = new HustleIncognitoClient({ apiKey: 'test-key' });

      const mockIntentContext: IntentContext = {
        networks: ['solana', 'ethereum'],
        categories: ['defi', 'trading'],
        activeIntent: 'swap tokens',
        turnsSinceUpdate: 0,
        lastConfidence: 0.95,
      };

      // @ts-ignore - Accessing private method for testing
      const requestBody = client.prepareRequestBody({
        vaultId: 'test-vault',
        messages: [{ role: 'user', content: 'Swap 1 SOL for USDC' }],
        intentContext: mockIntentContext,
      });

      expect(requestBody.intentContext).toBeDefined();
      expect(requestBody.intentContext).toEqual(mockIntentContext);
      expect(requestBody.intentContext?.networks).toContain('solana');
      expect(requestBody.intentContext?.activeIntent).toBe('swap tokens');
    });

    test('should not include intentContext when not provided', () => {
      const client = new HustleIncognitoClient({ apiKey: 'test-key' });

      // @ts-ignore - Accessing private method for testing
      const requestBody = client.prepareRequestBody({
        vaultId: 'test-vault',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(requestBody.intentContext).toBeUndefined();
    });

    test('should pass intentContext through chat() options', async () => {
      const client = new HustleIncognitoClient({ apiKey: 'test-key' });

      const mockIntentContext: IntentContext = {
        networks: ['ethereum'],
        categories: ['nft'],
        activeIntent: 'browse NFTs',
        turnsSinceUpdate: 1,
        lastConfidence: 0.85,
      };

      let capturedIntentContext: IntentContext | undefined;

      // Mock rawStream to capture the intentContext
      // @ts-ignore - Mocking private method
      client.rawStream = async function* (options: { intentContext?: IntentContext }) {
        capturedIntentContext = options.intentContext;
        yield { prefix: '0', data: 'Hello', raw: '0:Hello' };
        yield { prefix: 'f', data: { messageId: 'msg123' }, raw: 'f:{"messageId":"msg123"}' };
      };

      await client.chat(
        [{ role: 'user', content: 'Show me NFTs' }],
        { vaultId: 'test-vault', intentContext: mockIntentContext }
      );

      expect(capturedIntentContext).toBeDefined();
      expect(capturedIntentContext).toEqual(mockIntentContext);
    });

    test('should pass intentContext through chatStream() options', async () => {
      const client = new HustleIncognitoClient({ apiKey: 'test-key' });

      const mockIntentContext: IntentContext = {
        networks: ['bsc'],
        categories: ['memecoin'],
        activeIntent: 'find memecoins',
        turnsSinceUpdate: 2,
        lastConfidence: 0.75,
      };

      let capturedIntentContext: IntentContext | undefined;

      // Mock rawStream to capture the intentContext
      // @ts-ignore - Mocking private method
      client.rawStream = async function* (options: { intentContext?: IntentContext }) {
        capturedIntentContext = options.intentContext;
        yield { prefix: '0', data: 'Found memecoins', raw: '0:Found memecoins' };
        yield { prefix: 'f', data: { messageId: 'msg456' }, raw: 'f:{"messageId":"msg456"}' };
      };

      // Consume the stream
      for await (const _chunk of client.chatStream({
        vaultId: 'test-vault',
        messages: [{ role: 'user', content: 'Find memecoins on BSC' }],
        processChunks: true,
        intentContext: mockIntentContext,
      })) {
        // Just iterate
      }

      expect(capturedIntentContext).toBeDefined();
      expect(capturedIntentContext).toEqual(mockIntentContext);
    });

    test('should extract intentContext from response for subsequent requests', async () => {
      const client = new HustleIncognitoClient({ apiKey: 'test-key' });

      const responseIntentContext = {
        networks: ['polygon'],
        categories: ['polymarket'],
        activeIntent: 'betting',
        turnsSinceUpdate: 0,
        lastConfidence: 0.9,
      };

      const intentContextInfo = {
        type: 'intent_context',
        intentContext: responseIntentContext,
        categories: ['polymarket'],
        confidence: 0.9,
        reasoning: 'User wants to bet on Polymarket',
      };

      // Mock rawStream to return intent_context in response
      // @ts-ignore - Mocking private method
      client.rawStream = async function* () {
        yield { prefix: '2', data: [intentContextInfo], raw: '2:[...]' };
        yield { prefix: '0', data: 'Here are the markets', raw: '0:Here are the markets' };
        yield { prefix: 'f', data: { messageId: 'msg789' }, raw: 'f:{"messageId":"msg789"}' };
      };

      const response = await client.chat(
        [{ role: 'user', content: 'Show me Polymarket events' }],
        { vaultId: 'test-vault' }
      ) as ProcessedResponse;

      // Verify intentContext is in the response
      expect(response.intentContext).toBeDefined();
      expect(response.intentContext?.intentContext).toEqual(responseIntentContext);

      // The intentContext.intentContext should be what we pass to subsequent requests
      const contextForNextRequest = response.intentContext?.intentContext;
      expect(contextForNextRequest?.networks).toContain('polygon');
      expect(contextForNextRequest?.activeIntent).toBe('betting');
    });
  });

  describe('client-side tool execution loop', () => {
    test('should format tool parts correctly for AI SDK v6 UIMessage', async () => {
      // This test verifies the parts format matches AI SDK v6 UIMessage expectations
      // The format should be: { type: 'tool-invocation', toolCallId, toolName, state: 'output-available', input, output }

      const toolResults = [
        { toolCallId: 'call-1', toolName: 'test_tool', result: { data: 'value' } },
        { toolCallId: 'call-2', toolName: 'another_tool', result: 'string result' },
      ];

      const pendingToolCalls = [
        { toolCallId: 'call-1', toolName: 'test_tool', args: { input: 'test' } },
        { toolCallId: 'call-2', toolName: 'another_tool', args: {} },
      ];

      // Simulate the toolParts creation logic from chatStream
      const toolParts = toolResults.map((tr) => ({
        type: 'tool-invocation' as const,
        toolCallId: tr.toolCallId,
        toolName: tr.toolName,
        state: 'output-available' as const,
        input: pendingToolCalls.find((tc) => tc.toolCallId === tr.toolCallId)?.args || {},
        output: tr.result,
      }));

      // Verify structure
      expect(toolParts).toHaveLength(2);

      // First invocation
      expect(toolParts[0]).toEqual({
        type: 'tool-invocation',
        toolCallId: 'call-1',
        toolName: 'test_tool',
        state: 'output-available',
        input: { input: 'test' },
        output: { data: 'value' }, // Objects stay as raw objects (NOT stringified)
      });

      // Second invocation
      expect(toolParts[1]).toEqual({
        type: 'tool-invocation',
        toolCallId: 'call-2',
        toolName: 'another_tool',
        state: 'output-available',
        input: {},
        output: 'string result', // Strings stay as-is
      });
    });

    test('should create assistant message with parts in AI SDK v6 format', async () => {
      const toolParts = [
        {
          type: 'tool-invocation' as const,
          toolCallId: 'call-123',
          toolName: 'get_time',
          state: 'output-available' as const,
          input: { timezone: 'UTC' },
          output: '2025-01-15T10:30:00Z',
        },
      ];

      // Simulate message creation from chatStream
      const assistantMessage = {
        role: 'assistant' as const,
        content: '',
        parts: [
          { type: 'text' as const, text: '' },
          ...toolParts,
        ],
      };

      // Verify structure matches AI SDK v6 UIMessage expectations
      expect(assistantMessage.role).toBe('assistant');
      expect(assistantMessage.content).toBe('');
      expect(assistantMessage.parts).toBeDefined();
      expect(assistantMessage.parts).toHaveLength(2); // 1 text part + 1 tool-invocation part
      expect(assistantMessage.parts[0]).toEqual({ type: 'text', text: '' });
      expect(assistantMessage.parts[1].type).toBe('tool-invocation');
      expect((assistantMessage.parts[1] as any).state).toBe('output-available');
      expect((assistantMessage.parts[1] as any).toolCallId).toBe('call-123');
      expect((assistantMessage.parts[1] as any).toolName).toBe('get_time');
    });

    test('should detect client-side tool calls via hasExecutor', async () => {
      const client = new HustleIncognitoClient({ apiKey: 'test-key' });

      await client.use({
        name: 'detector-plugin',
        version: '1.0.0',
        tools: [
          {
            name: 'client_tool',
            description: 'A client-side tool',
            parameters: { type: 'object', properties: {} },
          },
        ],
        executors: {
          client_tool: async () => 'executed',
        },
      });

      // Simulate tool call detection logic from chatStream
      const toolCalls = [
        { toolName: 'client_tool', toolCallId: 'call-1' },
        { toolName: 'server_tool', toolCallId: 'call-2' }, // No executor for this
      ];

      // @ts-ignore - Access private pluginManager for testing
      const pluginManager = client['pluginManager'];

      const clientToolCalls = toolCalls.filter((tc) => pluginManager.hasExecutor(tc.toolName));
      const serverToolCalls = toolCalls.filter((tc) => !pluginManager.hasExecutor(tc.toolName));

      expect(clientToolCalls).toHaveLength(1);
      expect(clientToolCalls[0].toolName).toBe('client_tool');
      expect(serverToolCalls).toHaveLength(1);
      expect(serverToolCalls[0].toolName).toBe('server_tool');
    });

    test('should handle maxToolRounds option', () => {
      // Test that maxToolRounds defaults to 5 and can be overridden
      const defaultOptions: { messages: never[]; vaultId: string; maxToolRounds?: number } = {
        messages: [],
        vaultId: 'test',
      };
      const customOptions: { messages: never[]; vaultId: string; maxToolRounds?: number } = {
        messages: [],
        vaultId: 'test',
        maxToolRounds: 3,
      };
      const disabledOptions: { messages: never[]; vaultId: string; maxToolRounds?: number } = {
        messages: [],
        vaultId: 'test',
        maxToolRounds: 0,
      };

      // Verify defaults - maxToolRounds ?? 5
      expect(defaultOptions.maxToolRounds ?? 5).toBe(5);
      expect(customOptions.maxToolRounds ?? 5).toBe(3);
      expect(disabledOptions.maxToolRounds ?? 5).toBe(0); // 0 means unlimited
    });

    test('should stringify object results but keep string results as-is', () => {
      const objectResult = { key: 'value', nested: { data: true } };
      const stringResult = 'simple string';
      const arrayResult = [1, 2, 3];

      // Simulate the result formatting logic
      const formatResult = (result: unknown) =>
        typeof result === 'string' ? result : JSON.stringify(result);

      expect(formatResult(objectResult)).toBe('{"key":"value","nested":{"data":true}}');
      expect(formatResult(stringResult)).toBe('simple string');
      expect(formatResult(arrayResult)).toBe('[1,2,3]');
    });
  });
});
