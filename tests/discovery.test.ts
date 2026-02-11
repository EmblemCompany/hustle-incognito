import { describe, test, expect, vi } from 'vitest';
import { HustleIncognitoClient } from '../src';
import type { DiscoveryManifest, DiscoverableToolSchema, PeerDescriptor, DiscoveryCategorySummary } from '../src/types';

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

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const MOCK_PEER: PeerDescriptor = {
  id: 'hustle-v2-test',
  name: 'Hustle v2',
  protocol: 'hustle',
  version: '2.0.0',
  type: 'defi-agent',
  discoveryUrl: 'https://agenthustle.ai/api/tools/discover',
  executionUrl: 'https://agenthustle.ai/api/chat',
  authMethods: ['apiKey', 'jwt'],
  capabilities: {
    toolCount: 256,
    categories: ['solana', 'ethereum', 'cross-chain-trading'],
  },
};

const MOCK_CATEGORIES: DiscoveryCategorySummary[] = [
  { id: 'solana', name: 'Solana', description: 'Solana DeFi tools', toolCount: 42 },
  { id: 'ethereum', name: 'Ethereum', description: 'Ethereum DeFi tools', toolCount: 38 },
  { id: 'cross-chain-trading', name: 'Cross-Chain Trading', description: 'Multi-chain swaps', toolCount: 12 },
];

const MOCK_TOOLS: DiscoverableToolSchema[] = [
  {
    name: 'swapSolana',
    description: 'Swap tokens on Solana via Jupiter aggregator',
    category: 'solana',
    parameters: {
      type: 'object',
      properties: {
        inputMint: { type: 'string', description: 'Input token mint address' },
        outputMint: { type: 'string', description: 'Output token mint address' },
        amount: { type: 'number', description: 'Amount to swap in base units' },
        slippageBps: { type: 'number', description: 'Slippage tolerance in basis points' },
      },
      required: ['inputMint', 'outputMint', 'amount'],
    },
  },
  {
    name: 'getBalance',
    description: 'Get token balance for a wallet',
    category: 'solana',
    parameters: {
      type: 'object',
      properties: {
        walletAddress: { type: 'string', description: 'Wallet address to check' },
        tokenMint: { type: 'string', description: 'Optional token mint (SOL if omitted)' },
      },
      required: ['walletAddress'],
    },
  },
  {
    name: 'swapEthereum',
    description: 'Swap tokens on Ethereum via 1inch aggregator',
    category: 'ethereum',
    parameters: {
      type: 'object',
      properties: {
        tokenIn: { type: 'string', description: 'Input token address' },
        tokenOut: { type: 'string', description: 'Output token address' },
        amountIn: { type: 'string', description: 'Amount in wei' },
      },
      required: ['tokenIn', 'tokenOut', 'amountIn'],
    },
  },
];

const MOCK_MANIFEST: DiscoveryManifest = {
  peer: MOCK_PEER,
  tools: MOCK_TOOLS,
  categories: MOCK_CATEGORIES,
  timestamp: '2026-02-11T00:00:00.000Z',
};

function createMockFetch(response: unknown, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 502,
    statusText: ok ? 'OK' : 'Bad Gateway',
    json: () => Promise.resolve(response),
  });
}

function createClient(
  opts: ConstructorParameters<typeof HustleIncognitoClient>[0] = { apiKey: 'test-key' },
  mockFetch?: ReturnType<typeof vi.fn>,
) {
  const client = new HustleIncognitoClient(opts);
  if (mockFetch) {
    // @ts-ignore - Accessing private property for testing
    client.fetchImpl = mockFetch;
  }
  return client;
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

describe('discoverTools', () => {
  describe('request formation', () => {
    test('should call /api/tools/discover endpoint', async () => {
      const mockFetch = createMockFetch(MOCK_MANIFEST);
      const client = createClient({ apiKey: 'test-key' }, mockFetch);

      await client.discoverTools();

      expect(mockFetch).toHaveBeenCalledOnce();
      expect(mockFetch).toHaveBeenCalledWith(
        'https://agenthustle.ai/api/tools/discover',
        expect.objectContaining({
          method: 'GET',
          mode: 'cors',
        }),
      );
    });

    test('should use custom base URL', async () => {
      const mockFetch = createMockFetch(MOCK_MANIFEST);
      const client = createClient(
        { apiKey: 'test-key', hustleApiUrl: 'https://dev.agenthustle.ai' },
        mockFetch,
      );

      await client.discoverTools();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://dev.agenthustle.ai/api/tools/discover',
        expect.anything(),
      );
    });

    test('should append category filter as query parameter', async () => {
      const mockFetch = createMockFetch(MOCK_MANIFEST);
      const client = createClient({ apiKey: 'test-key' }, mockFetch);

      await client.discoverTools({ categories: ['solana'] });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://agenthustle.ai/api/tools/discover?categories=solana',
        expect.anything(),
      );
    });

    test('should join multiple categories with commas', async () => {
      const mockFetch = createMockFetch(MOCK_MANIFEST);
      const client = createClient({ apiKey: 'test-key' }, mockFetch);

      await client.discoverTools({ categories: ['solana', 'ethereum', 'cross-chain-trading'] });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://agenthustle.ai/api/tools/discover?categories=solana,ethereum,cross-chain-trading',
        expect.anything(),
      );
    });

    test('should not append query param when categories is empty array', async () => {
      const mockFetch = createMockFetch(MOCK_MANIFEST);
      const client = createClient({ apiKey: 'test-key' }, mockFetch);

      await client.discoverTools({ categories: [] });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://agenthustle.ai/api/tools/discover',
        expect.anything(),
      );
    });

    test('should not append query param when options is undefined', async () => {
      const mockFetch = createMockFetch(MOCK_MANIFEST);
      const client = createClient({ apiKey: 'test-key' }, mockFetch);

      await client.discoverTools();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://agenthustle.ai/api/tools/discover',
        expect.anything(),
      );
    });
  });

  describe('authentication', () => {
    test('should send API key and vault ID in headers', async () => {
      const mockFetch = createMockFetch(MOCK_MANIFEST);
      const client = createClient({ apiKey: 'my-api-key', vaultId: 'my-vault' }, mockFetch);

      await client.discoverTools();

      const callHeaders = mockFetch.mock.calls[0][1].headers;
      expect(callHeaders['x-api-key']).toBe('my-api-key');
      expect(callHeaders['x-vault-id']).toBe('my-vault');
    });

    test('should send JWT in Authorization header', async () => {
      const mockFetch = createMockFetch(MOCK_MANIFEST);
      const client = createClient({ jwt: 'test-jwt-token' }, mockFetch);

      await client.discoverTools();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-jwt-token',
          }),
        }),
      );
    });

    test('should send SDK session token in Authorization header', async () => {
      const mockSdk = {
        getSession: () => ({ authToken: 'sdk-session-token-123' }),
      };
      const mockFetch = createMockFetch(MOCK_MANIFEST);
      const client = createClient({ sdk: mockSdk }, mockFetch);

      await client.discoverTools();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer sdk-session-token-123',
          }),
        }),
      );
    });

    test('should call getJwt for fresh token on each request', async () => {
      let callCount = 0;
      const getJwt = vi.fn().mockImplementation(() => {
        callCount++;
        return `token-${callCount}`;
      });

      const mockFetch = createMockFetch(MOCK_MANIFEST);
      const client = createClient({ getJwt }, mockFetch);

      await client.discoverTools();

      expect(getJwt).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer token-1',
          }),
        }),
      );
    });
  });

  describe('response parsing', () => {
    test('should return the full DiscoveryManifest', async () => {
      const mockFetch = createMockFetch(MOCK_MANIFEST);
      const client = createClient({ apiKey: 'test-key' }, mockFetch);

      const manifest = await client.discoverTools();

      expect(manifest).toEqual(MOCK_MANIFEST);
    });

    test('should return peer descriptor', async () => {
      const mockFetch = createMockFetch(MOCK_MANIFEST);
      const client = createClient({ apiKey: 'test-key' }, mockFetch);

      const manifest = await client.discoverTools();

      expect(manifest.peer).toBeDefined();
      expect(manifest.peer.id).toBe('hustle-v2-test');
      expect(manifest.peer.name).toBe('Hustle v2');
      expect(manifest.peer.capabilities.toolCount).toBe(256);
    });

    test('should return tools array with schemas', async () => {
      const mockFetch = createMockFetch(MOCK_MANIFEST);
      const client = createClient({ apiKey: 'test-key' }, mockFetch);

      const manifest = await client.discoverTools();

      expect(manifest.tools).toHaveLength(3);
      expect(manifest.tools[0].name).toBe('swapSolana');
      expect(manifest.tools[0].parameters.properties).toHaveProperty('inputMint');
      expect(manifest.tools[0].parameters.required).toContain('inputMint');
    });

    test('should return category summaries', async () => {
      const mockFetch = createMockFetch(MOCK_MANIFEST);
      const client = createClient({ apiKey: 'test-key' }, mockFetch);

      const manifest = await client.discoverTools();

      expect(manifest.categories).toHaveLength(3);
      expect(manifest.categories.map((c) => c.id)).toEqual([
        'solana',
        'ethereum',
        'cross-chain-trading',
      ]);
    });

    test('should return timestamp', async () => {
      const mockFetch = createMockFetch(MOCK_MANIFEST);
      const client = createClient({ apiKey: 'test-key' }, mockFetch);

      const manifest = await client.discoverTools();

      expect(manifest.timestamp).toBe('2026-02-11T00:00:00.000Z');
    });

    test('should handle manifest with empty tools (unauthenticated tier)', async () => {
      const emptyManifest: DiscoveryManifest = {
        ...MOCK_MANIFEST,
        tools: [],
        peer: { ...MOCK_PEER, capabilities: { toolCount: 0, categories: [] } },
      };
      const mockFetch = createMockFetch(emptyManifest);
      const client = createClient({ apiKey: 'test-key' }, mockFetch);

      const manifest = await client.discoverTools();

      expect(manifest.tools).toHaveLength(0);
      expect(manifest.peer.capabilities.toolCount).toBe(0);
    });

    test('should handle tools with empty parameter properties (names-only tier)', async () => {
      const namesOnlyTools: DiscoverableToolSchema[] = [
        {
          name: 'swapSolana',
          description: 'Swap tokens on Solana',
          category: 'solana',
          parameters: { type: 'object', properties: {} },
        },
      ];
      const namesOnlyManifest: DiscoveryManifest = {
        ...MOCK_MANIFEST,
        tools: namesOnlyTools,
      };
      const mockFetch = createMockFetch(namesOnlyManifest);
      const client = createClient({ apiKey: 'test-key' }, mockFetch);

      const manifest = await client.discoverTools();

      expect(manifest.tools).toHaveLength(1);
      expect(manifest.tools[0].name).toBe('swapSolana');
      expect(Object.keys(manifest.tools[0].parameters.properties)).toHaveLength(0);
    });
  });

  describe('error handling', () => {
    test('should throw on non-OK response', async () => {
      const mockFetch = createMockFetch(null, false);
      const client = createClient({ apiKey: 'test-key' }, mockFetch);

      await expect(client.discoverTools()).rejects.toThrow(
        'Failed to discover tools: 502 Bad Gateway',
      );
    });

    test('should throw on 401 unauthorized', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: () => Promise.resolve({ error: 'Invalid API key' }),
      });
      const client = createClient({ apiKey: 'bad-key' }, mockFetch);

      await expect(client.discoverTools()).rejects.toThrow(
        'Failed to discover tools: 401 Unauthorized',
      );
    });

    test('should throw on 404 not found', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: () => Promise.resolve({}),
      });
      const client = createClient({ apiKey: 'test-key' }, mockFetch);

      await expect(client.discoverTools()).rejects.toThrow(
        'Failed to discover tools: 404 Not Found',
      );
    });

    test('should throw on network error', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
      const client = createClient({ apiKey: 'test-key' }, mockFetch);

      await expect(client.discoverTools()).rejects.toThrow('Network error');
    });

    test('should throw on JSON parse error', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.reject(new SyntaxError('Unexpected token')),
      });
      const client = createClient({ apiKey: 'test-key' }, mockFetch);

      await expect(client.discoverTools()).rejects.toThrow('Unexpected token');
    });
  });
});
