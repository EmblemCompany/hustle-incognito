import { describe, test, expect, vi, beforeEach } from 'vitest';
import { HustleIncognitoClient } from '../src';
import type {
  MaxToolsReachedEvent,
  TimeoutEvent,
  AutoRetryEvent,
  ToolValidationErrorEvent,
  MissingToolEvent,
} from '../src/types';

// Mock Node.js modules
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

describe('Stream Events', () => {
  let client: HustleIncognitoClient;

  beforeEach(() => {
    client = new HustleIncognitoClient({ apiKey: 'test-key' });
  });

  describe('max_tools_reached event', () => {
    test('should emit max_tools_reached when token_usage has maxToolsReached=true', async () => {
      const mockRawStream = async function* () {
        yield { prefix: '0', data: 'Hello', raw: '0:Hello' };
        yield {
          prefix: '2',
          data: [
            {
              type: 'token_usage',
              maxToolsReached: true,
              timedOut: false,
              toolsExecuted: 7,
              maxSteps: 7,
              timestamp: '2024-01-01T00:00:00Z',
            },
          ],
          raw: '2:[...]',
        };
        yield {
          prefix: 'e',
          data: { finishReason: 'stop' },
          raw: 'e:{"finishReason":"stop"}',
        };
      };

      // @ts-ignore - Mocking private method
      client.rawStream = mockRawStream;

      const events: MaxToolsReachedEvent[] = [];
      client.on('max_tools_reached', (event) => {
        events.push(event);
      });

      for await (const _chunk of client.chatStream({
        vaultId: 'test-vault',
        messages: [{ role: 'user', content: 'Test' }],
      })) {
        // consume stream
      }

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('max_tools_reached');
      expect(events[0].toolsExecuted).toBe(7);
      expect(events[0].maxSteps).toBe(7);
    });

    test('should NOT emit max_tools_reached when timedOut=true', async () => {
      const mockRawStream = async function* () {
        yield { prefix: '0', data: 'Hello', raw: '0:Hello' };
        yield {
          prefix: '2',
          data: [
            {
              type: 'token_usage',
              maxToolsReached: true,
              timedOut: true, // Should prevent emission
              toolsExecuted: 7,
              maxSteps: 7,
            },
          ],
          raw: '2:[...]',
        };
        yield {
          prefix: 'e',
          data: { finishReason: 'stop' },
          raw: 'e:{"finishReason":"stop"}',
        };
      };

      // @ts-ignore - Mocking private method
      client.rawStream = mockRawStream;

      const events: MaxToolsReachedEvent[] = [];
      client.on('max_tools_reached', (event) => {
        events.push(event);
      });

      for await (const _chunk of client.chatStream({
        vaultId: 'test-vault',
        messages: [{ role: 'user', content: 'Test' }],
      })) {
        // consume stream
      }

      expect(events).toHaveLength(0);
    });

    test('should NOT emit max_tools_reached when maxToolsReached=false', async () => {
      const mockRawStream = async function* () {
        yield { prefix: '0', data: 'Hello', raw: '0:Hello' };
        yield {
          prefix: '2',
          data: [
            {
              type: 'token_usage',
              maxToolsReached: false,
              timedOut: false,
              toolsExecuted: 3,
              maxSteps: 7,
            },
          ],
          raw: '2:[...]',
        };
        yield {
          prefix: 'e',
          data: { finishReason: 'stop' },
          raw: 'e:{"finishReason":"stop"}',
        };
      };

      // @ts-ignore - Mocking private method
      client.rawStream = mockRawStream;

      const events: MaxToolsReachedEvent[] = [];
      client.on('max_tools_reached', (event) => {
        events.push(event);
      });

      for await (const _chunk of client.chatStream({
        vaultId: 'test-vault',
        messages: [{ role: 'user', content: 'Test' }],
      })) {
        // consume stream
      }

      expect(events).toHaveLength(0);
    });
  });

  describe('timeout event', () => {
    test('should emit timeout when timeout_occurred data is received', async () => {
      const mockRawStream = async function* () {
        yield { prefix: '0', data: 'Partial response...', raw: '0:Partial response...' };
        yield {
          prefix: '2',
          data: [
            {
              type: 'timeout_occurred',
              message: 'Request timed out after 180000ms',
              timestamp: '2024-01-01T00:00:00Z',
            },
          ],
          raw: '2:[...]',
        };
        yield {
          prefix: 'e',
          data: { finishReason: 'stop' },
          raw: 'e:{"finishReason":"stop"}',
        };
      };

      // @ts-ignore - Mocking private method
      client.rawStream = mockRawStream;

      const events: TimeoutEvent[] = [];
      client.on('timeout', (event) => {
        events.push(event);
      });

      for await (const _chunk of client.chatStream({
        vaultId: 'test-vault',
        messages: [{ role: 'user', content: 'Test' }],
      })) {
        // consume stream
      }

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('timeout');
      expect(events[0].message).toBe('Request timed out after 180000ms');
      expect(events[0].timestamp).toBe('2024-01-01T00:00:00Z');
    });

    test('should emit timeout when abort_timeout error occurs', async () => {
      const mockRawStream = async function* () {
        yield { prefix: '0', data: 'Partial response...', raw: '0:Partial response...' };
        throw new Error('abort_timeout');
      };

      // @ts-ignore - Mocking private method
      client.rawStream = mockRawStream;

      const events: TimeoutEvent[] = [];
      client.on('timeout', (event) => {
        events.push(event);
      });

      const stream = client.chatStream({
        vaultId: 'test-vault',
        messages: [{ role: 'user', content: 'Test' }],
      });

      // Consume the stream and handle errors
      await expect(async () => {
        for await (const _chunk of stream) {
          // consume stream
        }
      }).rejects.toThrow('abort_timeout');

      // Also consume the response promise to prevent unhandled rejection
      await expect(stream.response).rejects.toThrow('abort_timeout');

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('timeout');
      expect(events[0].message).toBe('Request timed out');
    });
  });

  describe('auto_retry event', () => {
    test('should emit auto_retry when auto_retry data is received', async () => {
      const mockRawStream = async function* () {
        yield { prefix: '0', data: 'Hello', raw: '0:Hello' };
        yield {
          prefix: '2',
          data: [
            {
              type: 'auto_retry',
              retryCount: 1,
              toolName: 'some_tool',
              addedCategory: 'defi',
              message: 'Automatically loaded defi tools and retrying...',
              timestamp: '2024-01-01T00:00:00Z',
            },
          ],
          raw: '2:[...]',
        };
        yield {
          prefix: 'e',
          data: { finishReason: 'stop' },
          raw: 'e:{"finishReason":"stop"}',
        };
      };

      // @ts-ignore - Mocking private method
      client.rawStream = mockRawStream;

      const events: AutoRetryEvent[] = [];
      client.on('auto_retry', (event) => {
        events.push(event);
      });

      for await (const _chunk of client.chatStream({
        vaultId: 'test-vault',
        messages: [{ role: 'user', content: 'Test' }],
      })) {
        // consume stream
      }

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('auto_retry');
      expect(events[0].retryCount).toBe(1);
      expect(events[0].toolName).toBe('some_tool');
      expect(events[0].addedCategory).toBe('defi');
      expect(events[0].message).toBe('Automatically loaded defi tools and retrying...');
    });
  });

  describe('tool_validation_error event', () => {
    test('should emit tool_validation_error when tool_validation_error data is received', async () => {
      const mockRawStream = async function* () {
        yield { prefix: '0', data: 'Hello', raw: '0:Hello' };
        yield {
          prefix: '2',
          data: [
            {
              type: 'tool_validation_error',
              toolName: 'swap_tokens',
              message: 'Something went wrong when using swap_tokens. The AI will try an alternative approach.',
              timestamp: '2024-01-01T00:00:00Z',
            },
          ],
          raw: '2:[...]',
        };
        yield {
          prefix: 'e',
          data: { finishReason: 'stop' },
          raw: 'e:{"finishReason":"stop"}',
        };
      };

      // @ts-ignore - Mocking private method
      client.rawStream = mockRawStream;

      const events: ToolValidationErrorEvent[] = [];
      client.on('tool_validation_error', (event) => {
        events.push(event);
      });

      for await (const _chunk of client.chatStream({
        vaultId: 'test-vault',
        messages: [{ role: 'user', content: 'Test' }],
      })) {
        // consume stream
      }

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('tool_validation_error');
      expect(events[0].toolName).toBe('swap_tokens');
      expect(events[0].message).toContain('swap_tokens');
    });
  });

  describe('missing_tool event', () => {
    test('should emit missing_tool when missing_tool data is received', async () => {
      const mockRawStream = async function* () {
        yield { prefix: '0', data: 'Hello', raw: '0:Hello' };
        yield {
          prefix: '2',
          data: [
            {
              type: 'missing_tool',
              toolName: 'unknown_tool',
              categoryId: 'trading',
              message: 'Tool unknown_tool is not available',
              timestamp: '2024-01-01T00:00:00Z',
            },
          ],
          raw: '2:[...]',
        };
        yield {
          prefix: 'e',
          data: { finishReason: 'stop' },
          raw: 'e:{"finishReason":"stop"}',
        };
      };

      // @ts-ignore - Mocking private method
      client.rawStream = mockRawStream;

      const events: MissingToolEvent[] = [];
      client.on('missing_tool', (event) => {
        events.push(event);
      });

      for await (const _chunk of client.chatStream({
        vaultId: 'test-vault',
        messages: [{ role: 'user', content: 'Test' }],
      })) {
        // consume stream
      }

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('missing_tool');
      expect(events[0].toolName).toBe('unknown_tool');
      expect(events[0].categoryId).toBe('trading');
      expect(events[0].message).toContain('unknown_tool');
    });
  });

  describe('chunk types', () => {
    test('should yield new chunk types from stream', async () => {
      const mockRawStream = async function* () {
        yield {
          prefix: '2',
          data: [
            {
              type: 'token_usage',
              maxToolsReached: true,
              timedOut: false,
              toolsExecuted: 7,
              maxSteps: 7,
            },
          ],
          raw: '2:[...]',
        };
        yield {
          prefix: '2',
          data: [
            {
              type: 'timeout_occurred',
              message: 'Timed out',
              timestamp: '2024-01-01T00:00:00Z',
            },
          ],
          raw: '2:[...]',
        };
        yield {
          prefix: '2',
          data: [
            {
              type: 'auto_retry',
              retryCount: 1,
              toolName: 'test',
              message: 'Retrying',
            },
          ],
          raw: '2:[...]',
        };
        yield {
          prefix: '2',
          data: [
            {
              type: 'tool_validation_error',
              toolName: 'test',
              message: 'Validation failed',
            },
          ],
          raw: '2:[...]',
        };
        yield {
          prefix: '2',
          data: [
            {
              type: 'missing_tool',
              toolName: 'test',
              message: 'Not found',
            },
          ],
          raw: '2:[...]',
        };
        yield {
          prefix: 'e',
          data: { finishReason: 'stop' },
          raw: 'e:{"finishReason":"stop"}',
        };
      };

      // @ts-ignore - Mocking private method
      client.rawStream = mockRawStream;

      const chunks: Array<{ type: string }> = [];
      for await (const chunk of client.chatStream({
        vaultId: 'test-vault',
        messages: [{ role: 'user', content: 'Test' }],
      })) {
        if ('type' in chunk) {
          chunks.push({ type: chunk.type });
        }
      }

      // Should include: path_info (from token_usage), max_tools_reached, timeout_occurred, auto_retry, tool_validation_error, missing_tool, finish
      const types = chunks.map((c) => c.type);
      expect(types).toContain('path_info'); // token_usage yields path_info
      expect(types).toContain('max_tools_reached');
      expect(types).toContain('timeout_occurred');
      expect(types).toContain('auto_retry');
      expect(types).toContain('tool_validation_error');
      expect(types).toContain('missing_tool');
      expect(types).toContain('finish');
    });
  });

  describe('event unsubscription', () => {
    test('should allow unsubscribing from events', async () => {
      const mockRawStream = async function* () {
        yield {
          prefix: '2',
          data: [
            {
              type: 'token_usage',
              maxToolsReached: true,
              timedOut: false,
              toolsExecuted: 7,
              maxSteps: 7,
            },
          ],
          raw: '2:[...]',
        };
        yield {
          prefix: 'e',
          data: { finishReason: 'stop' },
          raw: 'e:{"finishReason":"stop"}',
        };
      };

      // @ts-ignore - Mocking private method
      client.rawStream = mockRawStream;

      const events: MaxToolsReachedEvent[] = [];
      const unsubscribe = client.on('max_tools_reached', (event) => {
        events.push(event);
      });

      // Unsubscribe before streaming
      unsubscribe();

      for await (const _chunk of client.chatStream({
        vaultId: 'test-vault',
        messages: [{ role: 'user', content: 'Test' }],
      })) {
        // consume stream
      }

      // Should not have received any events
      expect(events).toHaveLength(0);
    });
  });
});
