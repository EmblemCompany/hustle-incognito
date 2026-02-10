import { describe, test, expect, vi, beforeEach } from 'vitest';
import { HustleIncognitoClient, mapSSEEventToRawChunk } from '../src';
import type { ProcessedResponse, StreamChunk, RawChunk } from '../src/types';

// Mock Node.js modules at the top level
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  },
}));

vi.mock('node:path', () => ({
  basename: vi.fn(),
  extname: vi.fn(),
  default: {
    basename: vi.fn(),
    extname: vi.fn(),
  },
}));

vi.mock('file-type', () => ({
  fileTypeFromBuffer: vi.fn(),
}));

// ============================================================================
// A. mapSSEEventToRawChunk — unit tests for event → RawChunk mapping
// ============================================================================

describe('mapSSEEventToRawChunk', () => {
  const RAW = 'data: {}'; // placeholder raw line

  test('text-delta → prefix 0 with delta string', () => {
    const event = { type: 'text-delta', delta: 'Hello world' };
    const result = mapSSEEventToRawChunk(event, RAW);
    expect(result).toEqual({ prefix: '0', data: 'Hello world', raw: RAW });
  });

  test('start → prefix f with messageId', () => {
    const event = { type: 'start', messageId: 'msg-abc-123' };
    const result = mapSSEEventToRawChunk(event, RAW);
    expect(result).toEqual({ prefix: 'f', data: { messageId: 'msg-abc-123' }, raw: RAW });
  });

  test('data-custom with path_info → prefix 2 with inner array', () => {
    const innerData = [{ type: 'path_info', path: 'PATH_1', tokensIn: 100, tokensOut: 50 }];
    const event = { type: 'data-custom', data: innerData };
    const result = mapSSEEventToRawChunk(event, RAW);
    expect(result).toEqual({ prefix: '2', data: innerData, raw: RAW });
  });

  test('data-custom with reasoning → prefix 2 with inner array', () => {
    const innerData = [
      {
        type: 'reasoning',
        thinking: 'User wants token info',
        networks: ['solana'],
        categories: ['required'],
        confidence: 0.95,
      },
    ];
    const event = { type: 'data-custom', data: innerData };
    const result = mapSSEEventToRawChunk(event, RAW);
    expect(result).toEqual({ prefix: '2', data: innerData, raw: RAW });
  });

  test('data-custom with intent_context → prefix 2 with inner array', () => {
    const innerData = [
      {
        type: 'intent_context',
        intentContext: { networks: ['solana'], categories: ['defi'], turnsSinceUpdate: 0, lastConfidence: 0.9 },
        confidence: 0.9,
      },
    ];
    const event = { type: 'data-custom', data: innerData };
    const result = mapSSEEventToRawChunk(event, RAW);
    expect(result).toEqual({ prefix: '2', data: innerData, raw: RAW });
  });

  test('data-custom with dev_tools_info → prefix 2 with inner array', () => {
    const innerData = [
      {
        type: 'dev_tools_info',
        qualifiedCategories: ['required'],
        availableTools: ['wallet', 'createMemory'],
        toolCount: 2,
      },
    ];
    const event = { type: 'data-custom', data: innerData };
    const result = mapSSEEventToRawChunk(event, RAW);
    expect(result).toEqual({ prefix: '2', data: innerData, raw: RAW });
  });

  test('data-custom with token_usage → prefix 2 with inner array', () => {
    const innerData = [
      {
        type: 'token_usage',
        tokensIn: 500,
        tokensOut: 200,
        totalTokens: 700,
        maxToolsReached: false,
        timedOut: false,
      },
    ];
    const event = { type: 'data-custom', data: innerData };
    const result = mapSSEEventToRawChunk(event, RAW);
    expect(result).toEqual({ prefix: '2', data: innerData, raw: RAW });
  });

  test('data-custom with path_complete → prefix 2 with inner array', () => {
    const innerData = [{ type: 'path_complete', path: 'PATH_1', totalCostUsd: 0.005 }];
    const event = { type: 'data-custom', data: innerData };
    const result = mapSSEEventToRawChunk(event, RAW);
    expect(result).toEqual({ prefix: '2', data: innerData, raw: RAW });
  });

  test('finish → prefix e with finishReason and usage', () => {
    const event = {
      type: 'finish',
      finishReason: 'stop',
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    };
    const result = mapSSEEventToRawChunk(event, RAW);
    expect(result).toEqual({
      prefix: 'e',
      data: {
        finishReason: 'stop',
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        isContinued: undefined,
      },
      raw: RAW,
    });
  });

  test('finish with isContinued → prefix e preserves isContinued', () => {
    const event = {
      type: 'finish',
      finishReason: 'tool-calls',
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      isContinued: true,
    };
    const result = mapSSEEventToRawChunk(event, RAW);
    expect(result!.data.isContinued).toBe(true);
  });

  test('tool-call → prefix 9 with toolCallId, toolName, args', () => {
    const event = {
      type: 'tool-call',
      toolCallId: 'call-123',
      toolName: 'get_price',
      args: { symbol: 'SOL' },
    };
    const result = mapSSEEventToRawChunk(event, RAW);
    expect(result).toEqual({
      prefix: '9',
      data: { toolCallId: 'call-123', toolName: 'get_price', args: { symbol: 'SOL' } },
      raw: RAW,
    });
  });

  test('tool-result → prefix a with toolCallId, toolName, result', () => {
    const event = {
      type: 'tool-result',
      toolCallId: 'call-123',
      toolName: 'get_price',
      result: { price: 145.5 },
    };
    const result = mapSSEEventToRawChunk(event, RAW);
    expect(result).toEqual({
      prefix: 'a',
      data: { toolCallId: 'call-123', toolName: 'get_price', result: { price: 145.5 } },
      raw: RAW,
    });
  });

  test('tool-input-available → prefix 9 with input mapped to args', () => {
    const event = {
      type: 'tool-input-available',
      toolCallId: 'ask_user:0',
      toolName: 'ask_user',
      input: { question: 'What color?', choices: ['red', 'blue'] },
      providerMetadata: { some: 'meta' },
    };
    const result = mapSSEEventToRawChunk(event, RAW);
    expect(result).toEqual({
      prefix: '9',
      data: {
        toolCallId: 'ask_user:0',
        toolName: 'ask_user',
        args: { question: 'What color?', choices: ['red', 'blue'] },
      },
      raw: RAW,
    });
  });

  test('tool-input-delta → null (skipped)', () => {
    const event = {
      type: 'tool-input-delta',
      toolCallId: 'ask_user:0',
      delta: '{',
    };
    const result = mapSSEEventToRawChunk(event, RAW);
    expect(result).toBeNull();
  });

  describe('skipped events return null', () => {
    const skippedTypes = [
      'text-start',
      'text-end',
      'reasoning-start',
      'reasoning-delta',
      'reasoning-end',
      'start-step',
      'finish-step',
      'tool-input-delta',
    ];

    for (const eventType of skippedTypes) {
      test(`${eventType} → null`, () => {
        const result = mapSSEEventToRawChunk({ type: eventType }, RAW);
        expect(result).toBeNull();
      });
    }
  });

  test('unknown event type → null', () => {
    const result = mapSSEEventToRawChunk({ type: 'some-future-event' }, RAW);
    expect(result).toBeNull();
  });

  test('error → prefix error with message', () => {
    const event = { type: 'error', message: 'Something went wrong', code: 'RATE_LIMIT' };
    const rawLine = 'data: {"type":"error","message":"Something went wrong","code":"RATE_LIMIT"}';
    const result = mapSSEEventToRawChunk(event, rawLine);
    expect(result).toEqual({
      prefix: 'error',
      data: { message: 'Something went wrong' },
      raw: rawLine,
    });
  });

  test('error without message falls back to detail field', () => {
    const event = { type: 'error', detail: 'Rate limit exceeded' };
    const result = mapSSEEventToRawChunk(event, RAW);
    expect(result).toEqual({
      prefix: 'error',
      data: { message: 'Rate limit exceeded' },
      raw: RAW,
    });
  });

  test('error without message or detail falls back to error field', () => {
    const event = { type: 'error', error: 'Internal failure' };
    const result = mapSSEEventToRawChunk(event, RAW);
    expect(result).toEqual({
      prefix: 'error',
      data: { message: 'Internal failure' },
      raw: RAW,
    });
  });

  test('error with no message fields falls back to Unknown SSE error', () => {
    const event = { type: 'error' };
    const result = mapSSEEventToRawChunk(event, RAW);
    expect(result).toEqual({
      prefix: 'error',
      data: { message: 'Unknown SSE error' },
      raw: RAW,
    });
  });

  test('both tool-call and tool-input-available map to prefix 9', () => {
    const toolCallEvent = {
      type: 'tool-call',
      toolCallId: 'tc-dedup',
      toolName: 'get_price',
      args: { symbol: 'ETH' },
    };
    const toolInputEvent = {
      type: 'tool-input-available',
      toolCallId: 'tc-dedup',
      toolName: 'get_price',
      input: { symbol: 'ETH' },
      providerMetadata: {},
    };

    const toolCallResult = mapSSEEventToRawChunk(toolCallEvent, RAW);
    const toolInputResult = mapSSEEventToRawChunk(toolInputEvent, RAW);

    // Both should produce prefix '9'
    expect(toolCallResult!.prefix).toBe('9');
    expect(toolInputResult!.prefix).toBe('9');

    // Both should produce the same data shape with args (input mapped to args)
    expect(toolCallResult!.data).toEqual({
      toolCallId: 'tc-dedup',
      toolName: 'get_price',
      args: { symbol: 'ETH' },
    });
    expect(toolInputResult!.data).toEqual({
      toolCallId: 'tc-dedup',
      toolName: 'get_price',
      args: { symbol: 'ETH' },
    });
  });
});

// ============================================================================
// B. Format detection in rawStream — new SSE vs old AI SDK format
// ============================================================================

describe('SSE format auto-detection in rawStream', () => {
  let client: HustleIncognitoClient;

  beforeEach(() => {
    client = new HustleIncognitoClient({ apiKey: 'test-key' });
  });

  // Helper: create a mock fetch response that streams the given lines
  function mockFetchWithLines(lines: string[]) {
    const body = lines.join('\n') + '\n';
    const encoder = new TextEncoder();
    const encoded = encoder.encode(body);

    let read = false;
    const mockReader = {
      read: async () => {
        if (!read) {
          read = true;
          return { done: false, value: encoded };
        }
        return { done: true, value: undefined };
      },
    };

    const mockResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      body: { getReader: () => mockReader },
    };

    const mockFetch = vi.fn().mockResolvedValue(mockResponse);
    // @ts-ignore - Accessing private property for testing
    client.fetchImpl = mockFetch;
  }

  test('old format lines parse correctly', async () => {
    // Mock the rawStream method directly to isolate the format detection
    const mockRawStream = async function* () {
      yield { prefix: '0', data: 'Hello', raw: '0:"Hello"' };
      yield { prefix: 'f', data: { messageId: 'msg-123' }, raw: 'f:{"messageId":"msg-123"}' };
      yield {
        prefix: '2',
        data: [{ type: 'path_info', path: 'PATH_1' }],
        raw: '2:[{"type":"path_info","path":"PATH_1"}]',
      };
      yield {
        prefix: 'e',
        data: { finishReason: 'stop', usage: { prompt_tokens: 10, completion_tokens: 5 } },
        raw: 'e:{"finishReason":"stop"}',
      };
    };

    // @ts-ignore - Mocking private method
    client.rawStream = mockRawStream;

    const chunks: StreamChunk[] = [];
    for await (const chunk of client.chatStream({
      vaultId: 'test-vault',
      messages: [{ role: 'user', content: 'Test' }],
      processChunks: true,
    })) {
      chunks.push(chunk as StreamChunk);
    }

    expect(chunks[0]).toEqual({ type: 'text', value: 'Hello' });
    expect(chunks[1]).toEqual({ type: 'message_id', value: 'msg-123' });
    expect(chunks[2]).toEqual({
      type: 'path_info',
      value: { type: 'path_info', path: 'PATH_1' },
    });
    expect(chunks[3].type).toBe('finish');
  });

  test('new SSE format lines produce correct RawChunks via rawStream', async () => {
    // Simulate new SSE format by mocking rawStream to produce chunks
    // as the real rawStream would after detecting "data: " prefix
    const mockRawStream = async function* () {
      // These are what rawStream would yield after processing new SSE lines
      yield { prefix: 'f', data: { messageId: 'msg-456' }, raw: 'data: {"type":"start","messageId":"msg-456"}' };
      yield { prefix: '0', data: 'Hi there!', raw: 'data: {"type":"text-delta","delta":"Hi there!"}' };
      yield {
        prefix: '2',
        data: [{ type: 'path_info', path: 'PATH_1' }],
        raw: 'data: {"type":"data-custom","data":[{"type":"path_info","path":"PATH_1"}]}',
      };
      yield {
        prefix: 'e',
        data: { finishReason: 'stop', usage: { prompt_tokens: 10, completion_tokens: 5 }, isContinued: undefined },
        raw: 'data: {"type":"finish","finishReason":"stop","usage":{"prompt_tokens":10,"completion_tokens":5}}',
      };
    };

    // @ts-ignore - Mocking private method
    client.rawStream = mockRawStream;

    const chunks: StreamChunk[] = [];
    for await (const chunk of client.chatStream({
      vaultId: 'test-vault',
      messages: [{ role: 'user', content: 'Test' }],
      processChunks: true,
    })) {
      chunks.push(chunk as StreamChunk);
    }

    expect(chunks[0]).toEqual({ type: 'message_id', value: 'msg-456' });
    expect(chunks[1]).toEqual({ type: 'text', value: 'Hi there!' });
    expect(chunks[2]).toEqual({
      type: 'path_info',
      value: { type: 'path_info', path: 'PATH_1' },
    });
    expect(chunks[3].type).toBe('finish');
  });

  test('new SSE format with full fetch mock', async () => {
    // This tests the actual rawStream implementation by mocking fetch
    const sseLines = [
      'data: {"type":"start","messageId":"msg-sse-test"}',
      'data: {"type":"text-start"}',
      'data: {"type":"text-delta","delta":"Hello "}',
      'data: {"type":"text-delta","delta":"from SSE!"}',
      'data: {"type":"text-end"}',
      'data: {"type":"data-custom","data":[{"type":"path_info","path":"PATH_1","tokensIn":100}]}',
      'data: {"type":"finish","finishReason":"stop","usage":{"prompt_tokens":100,"completion_tokens":20,"total_tokens":120}}',
      'data: [DONE]',
    ];

    mockFetchWithLines(sseLines);

    const chunks: RawChunk[] = [];
    for await (const chunk of client.rawStream({
      vaultId: 'test-vault',
      messages: [{ role: 'user', content: 'Test' }],
    })) {
      chunks.push(chunk as RawChunk);
    }

    // Should have: start(f), text-delta(0) x2, data-custom(2), finish(e)
    // text-start, text-end, and [DONE] should be skipped
    expect(chunks).toHaveLength(5);

    expect(chunks[0].prefix).toBe('f');
    expect(chunks[0].data).toEqual({ messageId: 'msg-sse-test' });

    expect(chunks[1].prefix).toBe('0');
    expect(chunks[1].data).toBe('Hello ');

    expect(chunks[2].prefix).toBe('0');
    expect(chunks[2].data).toBe('from SSE!');

    expect(chunks[3].prefix).toBe('2');
    expect(chunks[3].data).toEqual([{ type: 'path_info', path: 'PATH_1', tokensIn: 100 }]);

    expect(chunks[4].prefix).toBe('e');
    expect(chunks[4].data.finishReason).toBe('stop');
  });

  test('old format with full fetch mock', async () => {
    const oldLines = [
      'f:{"messageId":"msg-old-test"}',
      '0:"Hello "',
      '0:"from old format!"',
      '2:[{"type":"path_info","path":"PATH_1","tokensIn":100}]',
      'e:{"finishReason":"stop","usage":{"prompt_tokens":100,"completion_tokens":20,"total_tokens":120}}',
    ];

    mockFetchWithLines(oldLines);

    const chunks: RawChunk[] = [];
    for await (const chunk of client.rawStream({
      vaultId: 'test-vault',
      messages: [{ role: 'user', content: 'Test' }],
    })) {
      chunks.push(chunk as RawChunk);
    }

    expect(chunks).toHaveLength(5);
    expect(chunks[0].prefix).toBe('f');
    expect(chunks[0].data.messageId).toBe('msg-old-test');
    expect(chunks[1].prefix).toBe('0');
    expect(chunks[2].prefix).toBe('0');
    expect(chunks[3].prefix).toBe('2');
    expect(chunks[4].prefix).toBe('e');
  });

  test('empty lines and whitespace are skipped', async () => {
    const lines = [
      '',
      '   ',
      'data: {"type":"text-delta","delta":"Hello"}',
      '',
      'data: {"type":"finish","finishReason":"stop"}',
    ];

    mockFetchWithLines(lines);

    const chunks: RawChunk[] = [];
    for await (const chunk of client.rawStream({
      vaultId: 'test-vault',
      messages: [{ role: 'user', content: 'Test' }],
    })) {
      chunks.push(chunk as RawChunk);
    }

    expect(chunks).toHaveLength(2);
    expect(chunks[0].prefix).toBe('0');
    expect(chunks[1].prefix).toBe('e');
  });

  test('[DONE] is skipped', async () => {
    const lines = [
      'data: {"type":"text-delta","delta":"Hi"}',
      'data: {"type":"finish","finishReason":"stop"}',
      'data: [DONE]',
    ];

    mockFetchWithLines(lines);

    const chunks: RawChunk[] = [];
    for await (const chunk of client.rawStream({
      vaultId: 'test-vault',
      messages: [{ role: 'user', content: 'Test' }],
    })) {
      chunks.push(chunk as RawChunk);
    }

    expect(chunks).toHaveLength(2);
    expect(chunks[0].prefix).toBe('0');
    expect(chunks[1].prefix).toBe('e');
  });

  test('skipped SSE events (boundaries) produce no chunks', async () => {
    const lines = [
      'data: {"type":"start-step","stepId":"step-1"}',
      'data: {"type":"text-start"}',
      'data: {"type":"text-delta","delta":"Hello"}',
      'data: {"type":"text-end"}',
      'data: {"type":"reasoning-start"}',
      'data: {"type":"reasoning-delta","delta":"thinking..."}',
      'data: {"type":"reasoning-end"}',
      'data: {"type":"finish-step","stepId":"step-1"}',
      'data: {"type":"finish","finishReason":"stop"}',
      'data: [DONE]',
    ];

    mockFetchWithLines(lines);

    const chunks: RawChunk[] = [];
    for await (const chunk of client.rawStream({
      vaultId: 'test-vault',
      messages: [{ role: 'user', content: 'Test' }],
    })) {
      chunks.push(chunk as RawChunk);
    }

    // Only text-delta and finish should produce chunks
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual({ prefix: '0', data: 'Hello', raw: expect.any(String) });
    expect(chunks[1].prefix).toBe('e');
  });

  test('lines with \\r\\n endings parse the same as lines with \\n', async () => {
    // Simulate \r\n line endings as some servers (e.g., Windows-based) may send them
    const bodyWithCRLF =
      'data: {"type":"start","messageId":"msg-crlf"}\r\n' +
      'data: {"type":"text-delta","delta":"hello"}\r\n' +
      'data: {"type":"finish","finishReason":"stop","usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\r\n' +
      'data: [DONE]\r\n';
    const encoder = new TextEncoder();
    const encoded = encoder.encode(bodyWithCRLF);

    let read = false;
    const mockReader = {
      read: async () => {
        if (!read) {
          read = true;
          return { done: false, value: encoded };
        }
        return { done: true, value: undefined };
      },
    };

    const mockResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      body: { getReader: () => mockReader },
    };

    const mockFetch = vi.fn().mockResolvedValue(mockResponse);
    // @ts-ignore - Accessing private property for testing
    client.fetchImpl = mockFetch;

    const crlfChunks: RawChunk[] = [];
    for await (const chunk of client.rawStream({
      vaultId: 'test-vault',
      messages: [{ role: 'user', content: 'Test' }],
    })) {
      crlfChunks.push(chunk as RawChunk);
    }

    // Now do the same with plain \n endings
    const bodyWithLF =
      'data: {"type":"start","messageId":"msg-crlf"}\n' +
      'data: {"type":"text-delta","delta":"hello"}\n' +
      'data: {"type":"finish","finishReason":"stop","usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n' +
      'data: [DONE]\n';
    const encodedLF = encoder.encode(bodyWithLF);

    let readLF = false;
    const mockReaderLF = {
      read: async () => {
        if (!readLF) {
          readLF = true;
          return { done: false, value: encodedLF };
        }
        return { done: true, value: undefined };
      },
    };

    const mockResponseLF = {
      ok: true,
      status: 200,
      statusText: 'OK',
      body: { getReader: () => mockReaderLF },
    };

    const mockFetchLF = vi.fn().mockResolvedValue(mockResponseLF);
    // @ts-ignore - Accessing private property for testing
    client.fetchImpl = mockFetchLF;

    const lfChunks: RawChunk[] = [];
    for await (const chunk of client.rawStream({
      vaultId: 'test-vault',
      messages: [{ role: 'user', content: 'Test' }],
    })) {
      lfChunks.push(chunk as RawChunk);
    }

    // Both should produce the same number of chunks
    expect(crlfChunks).toHaveLength(lfChunks.length);

    // Both should have the same prefixes and data
    for (let i = 0; i < crlfChunks.length; i++) {
      expect(crlfChunks[i].prefix).toBe(lfChunks[i].prefix);
      expect(crlfChunks[i].data).toEqual(lfChunks[i].data);
    }

    // Verify actual content: start, text-delta, finish (3 chunks)
    expect(crlfChunks).toHaveLength(3);
    expect(crlfChunks[0].prefix).toBe('f');
    expect(crlfChunks[0].data).toEqual({ messageId: 'msg-crlf' });
    expect(crlfChunks[1].prefix).toBe('0');
    expect(crlfChunks[1].data).toBe('hello');
    expect(crlfChunks[2].prefix).toBe('e');
  });

  test('tool-call and tool-result SSE events map correctly', async () => {
    const lines = [
      'data: {"type":"tool-call","toolCallId":"tc-1","toolName":"get_price","args":{"symbol":"SOL"}}',
      'data: {"type":"tool-result","toolCallId":"tc-1","toolName":"get_price","result":{"price":145.5}}',
      'data: {"type":"finish","finishReason":"tool-calls"}',
    ];

    mockFetchWithLines(lines);

    const chunks: RawChunk[] = [];
    for await (const chunk of client.rawStream({
      vaultId: 'test-vault',
      messages: [{ role: 'user', content: 'Test' }],
    })) {
      chunks.push(chunk as RawChunk);
    }

    expect(chunks).toHaveLength(3);

    expect(chunks[0].prefix).toBe('9');
    expect(chunks[0].data).toEqual({
      toolCallId: 'tc-1',
      toolName: 'get_price',
      args: { symbol: 'SOL' },
    });

    expect(chunks[1].prefix).toBe('a');
    expect(chunks[1].data).toEqual({
      toolCallId: 'tc-1',
      toolName: 'get_price',
      result: { price: 145.5 },
    });

    expect(chunks[2].prefix).toBe('e');
    expect(chunks[2].data.finishReason).toBe('tool-calls');
  });
});

// ============================================================================
// C. Full stream simulation — end-to-end through chatStream → ProcessedResponse
// ============================================================================

describe('Full stream simulation (new SSE format → ProcessedResponse)', () => {
  let client: HustleIncognitoClient;

  beforeEach(() => {
    client = new HustleIncognitoClient({ apiKey: 'test-key' });
  });

  test('new SSE format produces correct ProcessedResponse via chatStream', async () => {
    // Simulate what rawStream would yield from a new SSE format response
    const mockRawStream = async function* () {
      yield { prefix: 'f', data: { messageId: 'msg-sse-full' }, raw: 'data: ...' };
      yield {
        prefix: '2',
        data: [
          {
            type: 'reasoning',
            thinking: 'User is greeting',
            networks: [],
            categories: ['required'],
            confidence: 0.95,
          },
        ],
        raw: 'data: ...',
      };
      yield {
        prefix: '2',
        data: [
          {
            type: 'intent_context',
            intentContext: {
              networks: [],
              categories: ['required'],
              activeIntent: 'greeting',
              turnsSinceUpdate: 0,
              lastConfidence: 0.95,
            },
            confidence: 0.95,
          },
        ],
        raw: 'data: ...',
      };
      yield {
        prefix: '2',
        data: [
          {
            type: 'dev_tools_info',
            qualifiedCategories: ['required'],
            availableTools: ['wallet'],
            toolCount: 1,
          },
        ],
        raw: 'data: ...',
      };
      yield { prefix: '0', data: 'Hello! ', raw: 'data: ...' };
      yield { prefix: '0', data: "How can I help?", raw: 'data: ...' };
      yield {
        prefix: '2',
        data: [
          {
            type: 'path_info',
            path: 'PATH_1',
            tokensIn: 500,
            tokensOut: 50,
            costUsd: 0.001,
          },
        ],
        raw: 'data: ...',
      };
      yield {
        prefix: '2',
        data: [
          {
            type: 'token_usage',
            totalTokens: 550,
            maxToolsReached: false,
            timedOut: false,
          },
        ],
        raw: 'data: ...',
      };
      yield {
        prefix: 'e',
        data: {
          finishReason: 'stop',
          usage: { prompt_tokens: 500, completion_tokens: 50, total_tokens: 550 },
          isContinued: undefined,
        },
        raw: 'data: ...',
      };
    };

    // @ts-ignore - Mocking private method
    client.rawStream = mockRawStream;

    const stream = client.chatStream({
      vaultId: 'test-vault',
      messages: [{ role: 'user', content: 'hello' }],
      processChunks: true,
    });

    const chunks: StreamChunk[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as StreamChunk);
    }

    const response = await stream.response;

    // Verify aggregated response
    expect(response.content).toBe('Hello! How can I help?');
    expect(response.messageId).toBe('msg-sse-full');
    expect(response.usage).toEqual({
      prompt_tokens: 500,
      completion_tokens: 50,
      total_tokens: 550,
    });
    expect(response.pathInfo).toBeDefined();
    expect(response.reasoning).toBeDefined();
    expect(response.reasoning!.thinking).toBe('User is greeting');
    expect(response.intentContext).toBeDefined();
    expect(response.devToolsInfo).toBeDefined();
    expect(response.toolCalls).toHaveLength(0);
    expect(response.toolResults).toHaveLength(0);
  });

  test('old format produces equivalent ProcessedResponse via chatStream', async () => {
    // Same logical response, but via old AI SDK format
    const mockRawStream = async function* () {
      yield { prefix: 'f', data: { messageId: 'msg-old-full' }, raw: 'f:...' };
      yield {
        prefix: '2',
        data: [
          {
            type: 'reasoning',
            thinking: 'User is greeting',
            networks: [],
            categories: ['required'],
            confidence: 0.95,
          },
        ],
        raw: '2:[...]',
      };
      yield {
        prefix: '2',
        data: [
          {
            type: 'intent_context',
            intentContext: {
              networks: [],
              categories: ['required'],
              activeIntent: 'greeting',
              turnsSinceUpdate: 0,
              lastConfidence: 0.95,
            },
            confidence: 0.95,
          },
        ],
        raw: '2:[...]',
      };
      yield {
        prefix: '2',
        data: [
          {
            type: 'dev_tools_info',
            qualifiedCategories: ['required'],
            availableTools: ['wallet'],
            toolCount: 1,
          },
        ],
        raw: '2:[...]',
      };
      yield { prefix: '0', data: 'Hello! ', raw: '0:"Hello! "' };
      yield { prefix: '0', data: "How can I help?", raw: '0:"How can I help?"' };
      yield {
        prefix: '2',
        data: [
          {
            type: 'path_info',
            path: 'PATH_1',
            tokensIn: 500,
            tokensOut: 50,
            costUsd: 0.001,
          },
        ],
        raw: '2:[...]',
      };
      yield {
        prefix: '2',
        data: [
          {
            type: 'token_usage',
            totalTokens: 550,
            maxToolsReached: false,
            timedOut: false,
          },
        ],
        raw: '2:[...]',
      };
      yield {
        prefix: 'e',
        data: {
          finishReason: 'stop',
          usage: { prompt_tokens: 500, completion_tokens: 50, total_tokens: 550 },
        },
        raw: 'e:{...}',
      };
    };

    // @ts-ignore - Mocking private method
    client.rawStream = mockRawStream;

    const stream = client.chatStream({
      vaultId: 'test-vault',
      messages: [{ role: 'user', content: 'hello' }],
      processChunks: true,
    });

    for await (const _ of stream) {
      // consume
    }

    const response = await stream.response;

    // Verify the same shape as new SSE format (minus messageId difference)
    expect(response.content).toBe('Hello! How can I help?');
    expect(response.messageId).toBe('msg-old-full');
    expect(response.usage).toEqual({
      prompt_tokens: 500,
      completion_tokens: 50,
      total_tokens: 550,
    });
    expect(response.pathInfo).toBeDefined();
    expect(response.reasoning).toBeDefined();
    expect(response.intentContext).toBeDefined();
    expect(response.devToolsInfo).toBeDefined();
    expect(response.toolCalls).toHaveLength(0);
    expect(response.toolResults).toHaveLength(0);
  });

  test('new SSE format with tool calls produces correct ProcessedResponse', async () => {
    const mockRawStream = async function* () {
      yield { prefix: 'f', data: { messageId: 'msg-tools' }, raw: 'data: ...' };
      yield { prefix: '0', data: 'Let me check that...', raw: 'data: ...' };
      yield {
        prefix: '9',
        data: { toolCallId: 'tc-1', toolName: 'get_price', args: { symbol: 'SOL' } },
        raw: 'data: ...',
      };
      yield {
        prefix: 'a',
        data: { toolCallId: 'tc-1', toolName: 'get_price', result: { price: 145.5 } },
        raw: 'data: ...',
      };
      yield { prefix: '0', data: 'SOL is $145.50', raw: 'data: ...' };
      yield {
        prefix: 'e',
        data: { finishReason: 'stop', usage: { prompt_tokens: 200, completion_tokens: 40, total_tokens: 240 }, isContinued: undefined },
        raw: 'data: ...',
      };
    };

    // @ts-ignore - Mocking private method
    client.rawStream = mockRawStream;

    const stream = client.chatStream({
      vaultId: 'test-vault',
      messages: [{ role: 'user', content: 'price of SOL' }],
      processChunks: true,
    });

    for await (const _ of stream) {
      // consume
    }

    const response = await stream.response;

    expect(response.content).toContain('Let me check that...');
    expect(response.content).toContain('SOL is $145.50');
    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls[0].toolCallId).toBe('tc-1');
    expect(response.toolCalls[0].toolName).toBe('get_price');
    expect(response.toolResults).toHaveLength(1);
    expect(response.toolResults[0].toolCallId).toBe('tc-1');
  });
});

// ============================================================================
// D. Backward compatibility — verify old format mocks still work exactly
// ============================================================================

describe('Backward compatibility', () => {
  let client: HustleIncognitoClient;

  beforeEach(() => {
    client = new HustleIncognitoClient({ apiKey: 'test-key' });
  });

  test('old format rawStream mock still yields correct RawChunks', async () => {
    // This exact pattern is used throughout client.test.ts
    const mockRawStream = async function* () {
      yield { prefix: '0', data: 'Hello', raw: '0:Hello' };
      yield {
        prefix: '9',
        data: {
          toolCallId: 'tool123',
          toolName: 'test-tool',
          args: { param: 'value' },
        },
        raw: '9:{"toolCallId":"tool123","toolName":"test-tool","args":{"param":"value"}}',
      };
      yield {
        prefix: 'a',
        data: {
          toolCallId: 'tool123',
          result: { success: true },
        },
        raw: 'a:{"toolCallId":"tool123","result":{"success":true}}',
      };
      yield { prefix: 'f', data: { messageId: 'msg123' }, raw: 'f:{"messageId":"msg123"}' };
    };

    // @ts-ignore - Mocking private method
    client.rawStream = mockRawStream;

    const response = (await client.chat(
      [{ role: 'user', content: 'Test' }],
      { vaultId: 'test' }
    )) as ProcessedResponse;

    expect(response.content).toBe('Hello');
    expect(response.messageId).toBe('msg123');
    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls[0].toolCallId).toBe('tool123');
    expect(response.toolResults).toHaveLength(1);
    expect(response.toolResults[0].toolCallId).toBe('tool123');
  });

  test('old format prefix 2 metadata types still parse correctly', async () => {
    const reasoningData = {
      type: 'reasoning',
      thinking: 'User wants info',
      networks: [],
      categories: ['required'],
      confidence: 0.95,
    };
    const intentContextData = {
      type: 'intent_context',
      intentContext: { activeIntent: 'info' },
      confidence: 0.95,
    };
    const devToolsInfoData = {
      type: 'dev_tools_info',
      qualifiedCategories: ['required'],
      availableTools: ['wallet'],
      toolCount: 1,
    };
    const pathInfoData = { type: 'path_info', path: 'PATH_1' };

    const mockRawStream = async function* () {
      yield { prefix: '2', data: [reasoningData], raw: '2:[...]' };
      yield { prefix: '2', data: [intentContextData], raw: '2:[...]' };
      yield { prefix: '2', data: [devToolsInfoData], raw: '2:[...]' };
      yield { prefix: '2', data: [pathInfoData], raw: '2:[...]' };
      yield { prefix: '0', data: 'Response', raw: '0:"Response"' };
      yield { prefix: 'f', data: { messageId: 'msg-meta' }, raw: 'f:{}' };
    };

    // @ts-ignore - Mocking private method
    client.rawStream = mockRawStream;

    const stream = client.chatStream({
      vaultId: 'test-vault',
      messages: [{ role: 'user', content: 'Test' }],
      processChunks: true,
    });

    const chunks: StreamChunk[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as StreamChunk);
    }

    const response = await stream.response;

    expect(chunks[0]).toEqual({ type: 'reasoning', value: reasoningData });
    expect(chunks[1]).toEqual({ type: 'intent_context', value: intentContextData });
    expect(chunks[2]).toEqual({ type: 'dev_tools_info', value: devToolsInfoData });
    expect(chunks[3]).toEqual({ type: 'path_info', value: pathInfoData });

    expect(response.reasoning).toEqual(reasoningData);
    expect(response.intentContext).toEqual(intentContextData);
    expect(response.devToolsInfo).toEqual(devToolsInfoData);
    expect(response.pathInfo).toEqual(pathInfoData);
    expect(response.content).toBe('Response');
  });

  test('old format finish events (e and d prefixes) still work', async () => {
    const mockRawStream = async function* () {
      yield { prefix: '0', data: 'Hello', raw: '0:"Hello"' };
      yield {
        prefix: 'd',
        data: { finishReason: 'stop', usage: { prompt_tokens: 10 } },
        raw: 'd:{}',
      };
    };

    // @ts-ignore - Mocking private method
    client.rawStream = mockRawStream;

    const chunks: StreamChunk[] = [];
    for await (const chunk of client.chatStream({
      vaultId: 'test-vault',
      messages: [{ role: 'user', content: 'Test' }],
      processChunks: true,
    })) {
      chunks.push(chunk as StreamChunk);
    }

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual({ type: 'text', value: 'Hello' });
    expect(chunks[1].type).toBe('finish');
    expect((chunks[1].value as any).reason).toBe('stop');
  });
});
