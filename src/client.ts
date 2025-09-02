// src/client.ts
import type {
  ChatMessage,
  ChatOptions,
  HustleIncognitoClientOptions,
  HustleRequest,
  ProcessedResponse,
  RawChunk,
  RawStreamOptions,
  StreamChunk,
  StreamOptions,
  ToolCategory,
} from './types';

// Define SDK version manually until we can properly import from package.json
const SDK_VERSION = '0.1.0';

// Default API endpoints
const API_ENDPOINTS = {
  PRODUCTION: 'https://agenthustle.ai',
};

/**
 * Client for interacting with the Emblem Vault Hustle Incognito Agent API.
 */
export class HustleIncognitoClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly userKey?: string;
  private readonly userSecret?: string;
  private readonly sdkVersion: string = SDK_VERSION;
  private readonly fetchImpl: typeof fetch;
  private readonly debug: boolean;
  private readonly cookie?: string;

  /**
   * Creates an instance of HustleIncognitoClient.
   * @param options - Configuration options for the client.
   */
  constructor(options: HustleIncognitoClientOptions) {
    if (!options.apiKey) {
      throw new Error('API key is required.');
    }
    this.apiKey = options.apiKey;
    this.baseUrl =
      options.hustleApiUrl ||
      (process.env && process.env['HUSTLE_API_URL']) ||
      API_ENDPOINTS.PRODUCTION;
    this.userKey = options.userKey;
    this.userSecret = options.userSecret;
    this.fetchImpl = options.fetch || fetch;
    this.debug = options.debug || false;
    this.cookie = options.cookie || (process.env && process.env['COOKIE']);

    // Debug info
    if (this.debug) {
      console.log(
        `[${new Date().toISOString()}] Emblem Vault Hustle Incognito SDK v${this.sdkVersion}`
      );
      console.log(`[${new Date().toISOString()}] Using API endpoint: ${this.baseUrl}`);
      if (this.cookie) {
        console.log(`[${new Date().toISOString()}] Using cookie from environment`);
      }
    }
  }

  /**
   * Sends a chat message or conversation history to the API and gets a response.
   * Handles non-streaming responses.
   *
   * @param messages - An array of chat messages representing the conversation history.
   * @param options - Optional parameters like vaultId, userApiKey, etc.
   * @param overrideFunc - Optional function to override the API call (useful for testing)
   * @returns A promise resolving to the API response or an API error.
   */
  public async chat(
    messages: ChatMessage[],
    options: ChatOptions = { vaultId: 'unspecified-incognito' },
    overrideFunc: Function | null = null
  ): Promise<ProcessedResponse | RawChunk[]> {
    // Implement override pattern
    if (overrideFunc && typeof overrideFunc === 'function') {
      if (this.debug)
        console.log(`[${new Date().toISOString()}] Using override function for chat method`);
      return await overrideFunc(this.apiKey, { messages, ...options });
    }

    if (this.debug)
      console.log(
        `[${new Date().toISOString()}] Sending chat request with ${messages.length} messages to vault ${options.vaultId}`
      );

    // Default implementation
    if (options.rawResponse) {
      // Return the raw chunks
      if (this.debug)
        console.log(
          `[${new Date().toISOString()}] Raw response mode enabled, returning all chunks`
        );
      const chunks: RawChunk[] = [];
      for await (const chunk of this.rawStream({
        vaultId: options.vaultId,
        messages,
        userApiKey: options.userApiKey,
        externalWalletAddress: options.externalWalletAddress,
        slippageSettings: options.slippageSettings,
        safeMode: options.safeMode,
        selectedToolCategories: options.selectedToolCategories || [],
      })) {
        if (this.debug)
          console.log(`[${new Date().toISOString()}] Raw chunk:`, JSON.stringify(chunk));
        chunks.push(chunk as RawChunk);
      }
      return chunks;
    }

    // Process and collect the response
    let fullText = '';
    let messageId = null;
    let usage = null;
    let pathInfo = null;
    const toolCalls: any[] = [];
    const toolResults: any[] = [];

    for await (const chunk of this.chatStream({
      vaultId: options.vaultId,
      messages,
      userApiKey: options.userApiKey,
      externalWalletAddress: options.externalWalletAddress,
      slippageSettings: options.slippageSettings,
      safeMode: options.safeMode,
      processChunks: true,
      selectedToolCategories: options.selectedToolCategories || []
    })) {
      if ('type' in chunk) {
        switch (chunk.type) {
          case 'text':
            fullText += chunk.value as string;
            break;
          case 'message_id':
            messageId = chunk.value as string;
            break;
          case 'finish':
            if (chunk.value && typeof chunk.value === 'object' && 'usage' in chunk.value) {
              usage = chunk.value.usage;
            }
            break;
          case 'path_info':
            pathInfo = chunk.value;
            break;
          case 'tool_call':
            toolCalls.push(chunk.value);
            break;
          case 'tool_result':
            toolResults.push(chunk.value);
            break;
        }
      }
    }

    return {
      content: fullText,
      messageId,
      usage,
      pathInfo,
      toolCalls,
      toolResults,
    };
  }

  /**
   * Sends a chat message or conversation history and streams the response.
   *
   * @param options - Chat configuration including messages, vaultId, etc.
   * @param overrideFunc - Optional function to override the API call (useful for testing)
   * @returns An async iterable yielding StreamChunk objects or throwing an ApiError.
   */
  public async *chatStream(
    options: StreamOptions,
    overrideFunc: Function | null = null
  ): AsyncIterable<StreamChunk | RawChunk> {
    // Implement override pattern
    if (overrideFunc && typeof overrideFunc === 'function') {
      if (this.debug)
        console.log(`[${new Date().toISOString()}] Using override function for chatStream method`);
      // For custom stream handling, yield generator from override function
      yield* overrideFunc(this.apiKey, options);
      return;
    }

    // If we're not processing chunks, just use rawStream
    if (options.processChunks === false) {
      if (this.debug)
        console.log(`[${new Date().toISOString()}] Process chunks disabled, using raw stream`);
      yield* this.rawStream(options);
      return;
    }

    if (this.debug)
      console.log(`[${new Date().toISOString()}] Processing stream chunks into structured data`);

    // Otherwise, process chunks into structured data
    for await (const chunk of this.rawStream(options)) {
      if (this.debug)
        console.log(`[${new Date().toISOString()}] Processing chunk:`, JSON.stringify(chunk));

      switch (chunk.prefix) {
        case '0': // Text chunk
          yield { type: 'text', value: chunk.data };
          break;

        case '9': // Tool call
          if (this.debug)
            console.log(
              `[${new Date().toISOString()}] Found tool call:`,
              JSON.stringify(chunk.data)
            );
          yield { type: 'tool_call', value: chunk.data };
          break;

        case 'a': // Tool result
          if (this.debug)
            console.log(
              `[${new Date().toISOString()}] Found tool result:`,
              JSON.stringify(chunk.data)
            );
          yield { type: 'tool_result', value: chunk.data };
          break;

        case 'f': // Message ID
          if (chunk.data && typeof chunk.data === 'object' && 'messageId' in chunk.data) {
            yield { type: 'message_id', value: chunk.data.messageId };
          }
          break;

        case 'e': // Completion event
        case 'd': // Final data
          yield {
            type: 'finish',
            value: {
              reason: chunk.data?.finishReason || 'stop',
              usage: chunk.data?.usage,
            },
          };
          break;

        case '2': // Path info
          try {
            if (Array.isArray(chunk.data) && chunk.data.length > 0) {
              yield { type: 'path_info', value: chunk.data[0] };
            } else {
              yield { type: 'path_info', value: chunk.data };
            }
          } catch (error) {
            if (this.debug)
              console.error(`[${new Date().toISOString()}] Error processing path info:`, error);
          }
          break;

        default:
          // Unknown chunk type, just pass it through
          yield { type: 'unknown', value: chunk };
      }
    }
  }

  /**
   * Low-level function that provides direct access to the raw stream chunks.
   * This is a passthrough mode where processing is left to the consumer.
   *
   * @param options - Chat configuration including messages, vaultId, etc.
   * @param overrideFunc - Optional function to override the API call (useful for testing)
   * @returns An async iterable of raw chunks from the API
   */
  public async *rawStream(
    options: RawStreamOptions,
    overrideFunc: Function | null = null
  ): AsyncIterable<RawChunk> {
    // Implement override pattern
    if (overrideFunc && typeof overrideFunc === 'function') {
      if (this.debug)
        console.log(`[${new Date().toISOString()}] Using override function for rawStream method`);
      // For custom stream handling, yield generator from override function
      yield* overrideFunc(this.apiKey, options);
      return;
    }

    const requestBody = this.prepareRequestBody(options);
    if (this.debug) {
      console.log(
        `[${new Date().toISOString()}] Prepared request body:`,
        JSON.stringify(requestBody)
      );
      console.log(`[${new Date().toISOString()}] Sending request to ${this.baseUrl}/api/chat`);
    }

    try {
      const response = await this.createRequest(requestBody);
      if (this.debug)
        console.log(
          `[${new Date().toISOString()}] Response status: ${response.status} ${response.statusText}`
        );

      const reader = response.body?.getReader();
      if (!reader) throw new Error('Stream reader not available');

      if (this.debug) console.log(`[${new Date().toISOString()}] Starting to read stream`);

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          if (this.debug) console.log(`[${new Date().toISOString()}] Stream complete`);
          break;
        }

        const text = new TextDecoder().decode(value);
        if (this.debug) console.log(`[${new Date().toISOString()}] Raw stream data:`, text);

        const lines = text.split('\n');

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const prefix = line.charAt(0);
            const data = line.substring(2);

            // Parse JSON if it's valid JSON, otherwise leave as string
            let parsedData;
            try {
              parsedData = JSON.parse(data);
              if (this.debug)
                console.log(
                  `[${new Date().toISOString()}] Parsed JSON data for prefix ${prefix}:`,
                  JSON.stringify(parsedData)
                );
            } catch (e) {
              parsedData = data;
              if (this.debug)
                console.log(
                  `[${new Date().toISOString()}] Non-JSON data for prefix ${prefix}:`,
                  data
                );
            }

            yield { prefix, data: parsedData, raw: line };
          } catch (error) {
            if (this.debug)
              console.error(`[${new Date().toISOString()}] Error parsing stream chunk:`, error);
            yield { prefix: 'error', data: line, raw: line };
          }
        }
      }
    } catch (error) {
      if (this.debug) console.error(`[${new Date().toISOString()}] Error in rawStream:`, error);
      yield { prefix: 'error', data: String(error), raw: String(error) };
      throw error;
    }
  }

  public async getTools(): Promise<ToolCategory[]> {
    // GET /api/tools/categories
    const response = await this.fetchImpl(`${this.baseUrl}/api/tools/categories`, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      if (this.debug)
        console.error(
          `[${new Date().toISOString()}] HTTP error: ${response.status} ${response.statusText}`
        );
      throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
    }

    const parsedResponse = await response.json();
    return parsedResponse.data;
  }

  /**
   * Prepares the request body for a chat request
   * @private
   */
  private prepareRequestBody(options: {
    vaultId: string;
    messages: ChatMessage[];
    userApiKey?: string;
    externalWalletAddress?: string;
    slippageSettings?: Record<string, number>;
    safeMode?: boolean;
    currentPath?: string | null;
    selectedToolCategories?: string[];
  }): HustleRequest {
    const apiKey = options.userApiKey || this.apiKey;
    if (!apiKey) {
      throw new Error('API key is required');
    }

    return {
      id: `chat-${options.vaultId}`,
      messages: options.messages,
      apiKey,
      vaultId: options.vaultId,
      externalWalletAddress: options.externalWalletAddress || '',
      slippageSettings: options.slippageSettings || {
        lpSlippage: 5,
        swapSlippage: 5,
        pumpSlippage: 5,
      },
      safeMode: options.safeMode !== false,
      currentPath: options.currentPath || null,
      attachments: [],
      selectedToolCategories: options.selectedToolCategories || [],
    };
  }

  /**
   * Creates a fetch request to the chat API
   * @private
   */
  private async createRequest(requestBody: HustleRequest): Promise<Response> {
    if (this.debug) {
      console.log(`[${new Date().toISOString()}] Making POST request to ${this.baseUrl}/api/chat`);
      console.log(
        `[${new Date().toISOString()}] Request headers:`,
        JSON.stringify(this.getHeaders())
      );
    }

    const response = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      if (this.debug)
        console.error(
          `[${new Date().toISOString()}] HTTP error: ${response.status} ${response.statusText}`
        );
      throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
    }

    return response;
  }

  /**
   * Constructs the necessary headers for API requests.
   * @private
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': `HustleIncognito-SDK/${this.sdkVersion}`,
    };

    // Note: API key goes in the request body for this API, not in headers
    headers['x-mcp-mode'] = 'true';
    if (this.userKey) {
      headers['X-User-Key'] = this.userKey;
      if (this.userSecret) {
        headers['X-User-Secret'] = this.userSecret;
      }
    }

    // Add cookie if available
    if (this.cookie) {
      headers['Cookie'] = this.cookie;
    }

    return headers;
  }
}
