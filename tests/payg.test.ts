import { describe, test, expect, vi } from 'vitest';
import { HustleIncognitoClient } from '../src';
import type { PaygStatus } from '../src/types';

const MOCK_PAYG_STATUS: PaygStatus = {
  enabled: true,
  mode: 'pay_per_request',
  payment_token: 'SOL',
  payment_chain: 'solana',
  is_blocked: false,
  total_debt_usd: 1.25,
  total_paid_usd: 10.5,
  debt_ceiling_usd: 50,
  pending_charges: 2,
  available_tokens: ['SOL', 'SOL_USDC', 'HUSTLE', 'ETH', 'ETH_USDC', 'BASE_ETH', 'BASE_USDC'],
};

const MOCK_CONFIGURE_RESULT = {
  success: true,
  config: {
    enabled: true,
    mode: 'debt_accumulation',
    payment_token: 'ETH_USDC',
    payment_chain: 'ethereum',
  },
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
  opts: ConstructorParameters<typeof HustleIncognitoClient>[0],
  mockFetch: ReturnType<typeof vi.fn>
) {
  const client = new HustleIncognitoClient(opts);
  // @ts-ignore - Overriding private property for testing
  client.fetchImpl = mockFetch;
  return client;
}

describe('PAYG Billing', () => {
  // ── getPaygStatus ────────────────────────────────────────────

  describe('getPaygStatus', () => {
    test('should GET /api/payg and return status', async () => {
      const mockFetch = createMockFetch(MOCK_PAYG_STATUS);
      const client = createClient({ apiKey: 'test-key', vaultId: 'vault-1' }, mockFetch);

      const status = await client.getPaygStatus();

      expect(status).toEqual(MOCK_PAYG_STATUS);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://agenthustle.ai/api/payg',
        expect.objectContaining({
          method: 'GET',
          mode: 'cors',
        })
      );
    });

    test('should send JWT in Authorization header when using jwt auth', async () => {
      const mockFetch = createMockFetch(MOCK_PAYG_STATUS);
      const client = createClient({ jwt: 'my-jwt-token' }, mockFetch);

      await client.getPaygStatus();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer my-jwt-token',
          }),
        })
      );
    });

    test('should send JWT from SDK session', async () => {
      const mockSdk = {
        getSession: () => ({ authToken: 'sdk-token-abc' }),
      };
      const mockFetch = createMockFetch(MOCK_PAYG_STATUS);
      const client = createClient({ sdk: mockSdk }, mockFetch);

      await client.getPaygStatus();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer sdk-token-abc',
          }),
        })
      );
    });

    test('should send JWT from getJwt function', async () => {
      const getJwt = vi.fn().mockReturnValue('dynamic-jwt-token');
      const mockFetch = createMockFetch(MOCK_PAYG_STATUS);
      const client = createClient({ getJwt }, mockFetch);

      await client.getPaygStatus();

      expect(getJwt).toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer dynamic-jwt-token',
          }),
        })
      );
    });

    test('should send x-api-key and x-vault-id headers for apiKey auth', async () => {
      const mockFetch = createMockFetch(MOCK_PAYG_STATUS);
      const client = createClient({ apiKey: 'key-123', vaultId: 'vault-456' }, mockFetch);

      await client.getPaygStatus();

      const callHeaders = mockFetch.mock.calls[0][1].headers;
      expect(callHeaders['x-api-key']).toBe('key-123');
      expect(callHeaders['x-vault-id']).toBe('vault-456');
    });

    test('should not send x-api-key headers when only jwt is provided', async () => {
      const mockFetch = createMockFetch(MOCK_PAYG_STATUS);
      const client = createClient({ jwt: 'jwt-only' }, mockFetch);

      await client.getPaygStatus();

      const callHeaders = mockFetch.mock.calls[0][1].headers;
      expect(callHeaders['x-api-key']).toBeUndefined();
      expect(callHeaders['x-vault-id']).toBeUndefined();
    });

    test('should use custom base URL', async () => {
      const mockFetch = createMockFetch(MOCK_PAYG_STATUS);
      const client = createClient(
        { apiKey: 'k', hustleApiUrl: 'https://dev.agenthustle.ai' },
        mockFetch
      );

      await client.getPaygStatus();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://dev.agenthustle.ai/api/payg',
        expect.anything()
      );
    });

    test('should throw on non-ok response', async () => {
      const mockFetch = createMockFetch({ error: 'Unauthorized' }, false);
      const client = createClient({ apiKey: 'bad-key' }, mockFetch);

      await expect(client.getPaygStatus()).rejects.toThrow('Failed to fetch PAYG status');
    });
  });

  // ── configurePayg ────────────────────────────────────────────

  describe('configurePayg', () => {
    test('should POST /api/payg with options in body', async () => {
      const mockFetch = createMockFetch(MOCK_CONFIGURE_RESULT);
      const client = createClient({ apiKey: 'test-key', vaultId: 'vault-1' }, mockFetch);

      const result = await client.configurePayg({
        enabled: true,
        mode: 'debt_accumulation',
        payment_token: 'ETH_USDC',
      });

      expect(result).toEqual(MOCK_CONFIGURE_RESULT);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://agenthustle.ai/api/payg',
        expect.objectContaining({
          method: 'POST',
          mode: 'cors',
          body: JSON.stringify({
            enabled: true,
            mode: 'debt_accumulation',
            payment_token: 'ETH_USDC',
          }),
        })
      );
    });

    test('should send only the fields provided', async () => {
      const mockFetch = createMockFetch(MOCK_CONFIGURE_RESULT);
      const client = createClient({ apiKey: 'k', vaultId: 'v' }, mockFetch);

      await client.configurePayg({ enabled: false });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body).toEqual({ enabled: false });
      expect(body.mode).toBeUndefined();
      expect(body.payment_token).toBeUndefined();
    });

    test('should send JWT in Authorization header', async () => {
      const mockFetch = createMockFetch(MOCK_CONFIGURE_RESULT);
      const client = createClient({ jwt: 'config-jwt' }, mockFetch);

      await client.configurePayg({ enabled: true });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer config-jwt',
          }),
        })
      );
    });

    test('should send x-api-key and x-vault-id for apiKey auth', async () => {
      const mockFetch = createMockFetch(MOCK_CONFIGURE_RESULT);
      const client = createClient({ apiKey: 'ak', vaultId: 'vid' }, mockFetch);

      await client.configurePayg({ payment_token: 'SOL' });

      const callHeaders = mockFetch.mock.calls[0][1].headers;
      expect(callHeaders['x-api-key']).toBe('ak');
      expect(callHeaders['x-vault-id']).toBe('vid');
    });

    test('should set Content-Type to application/json', async () => {
      const mockFetch = createMockFetch(MOCK_CONFIGURE_RESULT);
      const client = createClient({ jwt: 'j' }, mockFetch);

      await client.configurePayg({ enabled: true });

      const callHeaders = mockFetch.mock.calls[0][1].headers;
      expect(callHeaders['Content-Type']).toBe('application/json');
    });

    test('should use custom base URL', async () => {
      const mockFetch = createMockFetch(MOCK_CONFIGURE_RESULT);
      const client = createClient(
        { apiKey: 'k', hustleApiUrl: 'https://staging.agenthustle.ai' },
        mockFetch
      );

      await client.configurePayg({ enabled: true });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://staging.agenthustle.ai/api/payg',
        expect.anything()
      );
    });

    test('should throw on non-ok response', async () => {
      const mockFetch = createMockFetch({ error: 'Bad Request' }, false);
      const client = createClient({ apiKey: 'k' }, mockFetch);

      await expect(
        client.configurePayg({ enabled: true })
      ).rejects.toThrow('Failed to configure PAYG');
    });
  });

  // ── Auth priority ────────────────────────────────────────────

  describe('auth priority', () => {
    test('should prefer getAuthHeaders over jwt for getPaygStatus', async () => {
      const mockFetch = createMockFetch(MOCK_PAYG_STATUS);
      const client = createClient(
        {
          jwt: 'should-not-use',
          getAuthHeaders: () => ({ Authorization: 'Bearer custom-wins' }),
        },
        mockFetch
      );

      await client.getPaygStatus();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer custom-wins',
          }),
        })
      );
    });

    test('should prefer getAuthHeaders over jwt for configurePayg', async () => {
      const mockFetch = createMockFetch(MOCK_CONFIGURE_RESULT);
      const client = createClient(
        {
          jwt: 'should-not-use',
          getAuthHeaders: () => ({ Authorization: 'Bearer custom-wins' }),
        },
        mockFetch
      );

      await client.configurePayg({ enabled: true });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer custom-wins',
          }),
        })
      );
    });

    test('should call getJwt fresh on each PAYG request', async () => {
      let callCount = 0;
      const getJwt = vi.fn().mockImplementation(() => {
        callCount++;
        return `fresh-token-${callCount}`;
      });
      const mockFetch = createMockFetch(MOCK_PAYG_STATUS);
      const client = createClient({ getJwt }, mockFetch);

      await client.getPaygStatus();
      expect(mockFetch).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer fresh-token-1',
          }),
        })
      );

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve(MOCK_CONFIGURE_RESULT),
      });

      await client.configurePayg({ enabled: true });
      expect(mockFetch).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer fresh-token-2',
          }),
        })
      );

      expect(getJwt).toHaveBeenCalledTimes(2);
    });
  });
});
