// src/client.ts
import type {
  Attachment,
  ChatMessage,
  ChatOptions,
  EmblemAuthProvider,
  HustleEvent,
  HustleEventListener,
  HustleEventType,
  HustleIncognitoClientOptions,
  HustleRequest,
  Model,
  ProcessedResponse,
  RawChunk,
  RawStreamOptions,
  StreamChunk,
  StreamEndEvent,
  StreamOptions,
  StreamStartEvent,
  StreamWithResponse,
  SummarizationState,
  ToolCategory,
  ToolEndEvent,
  ToolStartEvent,
} from './types';

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

// Injected at build time by rollup-plugin-replace from package.json version
declare const __SDK_VERSION__: string;
const SDK_VERSION = __SDK_VERSION__;

// Default API endpoints
const API_ENDPOINTS = {
  PRODUCTION: 'https://agenthustle.ai',
};

/**
 * Resolves the JWT token from various auth provider options.
 * Priority: getJwt() > jwt > sdk.getSession().authToken
 */
async function resolveJwt(auth: EmblemAuthProvider): Promise<string | null> {
  // Try getJwt function first
  if (typeof auth.getJwt === 'function') {
    const jwt = await auth.getJwt();
    if (jwt) return jwt;
  }

  // Try static jwt
  if (auth.jwt) {
    return auth.jwt;
  }

  // Try SDK session
  if (auth.sdk?.getSession) {
    const session = auth.sdk.getSession();
    if (session?.authToken) {
      return session.authToken;
    }
  }

  return null;
}

/**
 * Accumulates stream chunks into a ProcessedResponse.
 * Used internally to provide consistent response aggregation across streaming and non-streaming modes.
 */
class StreamProcessor {
  private content = '';
  private messageId: string | null = null;
  private usage: any | null = null;
  private pathInfo: any | null = null;
  private toolCalls: any[] = [];
  private toolResults: any[] = [];
  private reasoning: any | null = null;
  private intentContext: any | null = null;
  private devToolsInfo: any | null = null;

  /**
   * Process a single StreamChunk and accumulate its data.
   */
  processChunk(chunk: StreamChunk | RawChunk): void {
    if ('type' in chunk) {
      switch (chunk.type) {
        case 'text':
          this.content += chunk.value as string;
          break;
        case 'message_id':
          this.messageId = chunk.value as string;
          break;
        case 'finish':
          if (chunk.value && typeof chunk.value === 'object' && 'usage' in chunk.value) {
            this.usage = chunk.value.usage;
          }
          break;
        case 'path_info':
          this.pathInfo = chunk.value;
          break;
        case 'tool_call':
          // Add backward-compatible aliases
          this.toolCalls.push({
            ...chunk.value,
            id: chunk.value.toolCallId,
            name: chunk.value.toolName,
            arguments: chunk.value.args,
          });
          break;
        case 'tool_result':
          // Add backward-compatible aliases
          this.toolResults.push({
            ...chunk.value,
            id: chunk.value.toolCallId,
            name: chunk.value.toolName,
          });
          break;
        case 'reasoning':
          this.reasoning = chunk.value;
          break;
        case 'intent_context':
          this.intentContext = chunk.value;
          break;
        case 'dev_tools_info':
          this.devToolsInfo = chunk.value;
          break;
      }
    }
  }

  /**
   * Get the aggregated ProcessedResponse.
   */
  getResponse(): ProcessedResponse {
    return {
      content: this.content,
      messageId: this.messageId,
      usage: this.usage,
      pathInfo: this.pathInfo,
      toolCalls: this.toolCalls,
      toolResults: this.toolResults,
      reasoning: this.reasoning,
      intentContext: this.intentContext,
      devToolsInfo: this.devToolsInfo,
    };
  }
}

/**
 * Client for interacting with the Emblem Vault Hustle Incognito Agent API.
 */
export class HustleIncognitoClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly vaultId?: string;
  private readonly userKey?: string;
  private readonly userSecret?: string;
  private readonly sdkVersion: string = SDK_VERSION;
  private readonly fetchImpl: FetchLike;
  private readonly debug: boolean;
  private readonly cookie?: string;
  private readonly authProvider: EmblemAuthProvider;
  private eventListeners: Map<HustleEventType, Set<HustleEventListener>> = new Map();
  private summarizationState: SummarizationState = { thresholdReached: false };

  /**
   * Creates an instance of HustleIncognitoClient.
   * @param options - Configuration options for the client.
   */
  constructor(options: HustleIncognitoClientOptions) {
    // Store auth provider options for JWT resolution
    this.authProvider = {
      jwt: options.jwt,
      getJwt: options.getJwt,
      getAuthHeaders: options.getAuthHeaders,
      sdk: options.sdk,
    };

    // Validate that at least one auth method is provided
    const hasApiKey = !!options.apiKey;
    const hasJwtAuth = !!(options.jwt || options.getJwt || options.sdk || options.getAuthHeaders);

    if (!hasApiKey && !hasJwtAuth) {
      throw new Error(
        'Authentication required: provide apiKey, jwt, getJwt(), sdk, or getAuthHeaders()'
      );
    }

    this.apiKey = options.apiKey;
    // Browser-safe environment variable access
    const getEnv = (key: string): string | undefined => {
      if (typeof process !== 'undefined' && process.env) {
        return process.env[key];
      }
      return undefined;
    };
    this.vaultId = options.vaultId || getEnv('VAULT_ID');
    this.baseUrl =
      options.hustleApiUrl ||
      getEnv('HUSTLE_API_URL') ||
      API_ENDPOINTS.PRODUCTION;
    this.userKey = options.userKey;
    this.userSecret = options.userSecret;
    const defaultFetch: FetchLike = options.fetch
      ? (options.fetch as FetchLike)
      : typeof window !== 'undefined'
        ? (window.fetch.bind(window) as FetchLike)
        : (fetch as FetchLike);
    this.fetchImpl = defaultFetch;
    this.debug = options.debug || false;
    this.cookie = options.cookie || getEnv('COOKIE');

    // Debug info
    if (this.debug) {
      console.log(
        `[${new Date().toISOString()}] Emblem Vault Hustle Incognito SDK v${this.sdkVersion}`
      );
      console.log(`[${new Date().toISOString()}] Using API endpoint: ${this.baseUrl}`);
      console.log(
        `[${new Date().toISOString()}] Auth mode: ${hasApiKey ? 'API Key' : 'JWT/SDK'}`
      );
      if (this.cookie) {
        console.log(`[${new Date().toISOString()}] Using cookie from environment`);
      }
    }
  }

  /**
   * Resolves the vaultId from various sources.
   * Priority:
   * 1. SDK session user.vaultId (when using SDK auth - vaultId tied to JWT)
   * 2. SDK getVaultInfo() (when using SDK auth - vaultId tied to JWT)
   * 3. Explicitly provided vaultId (required for API key auth, optional fallback for raw JWT)
   * @private
   */
  private async resolveVaultId(providedVaultId?: string): Promise<string> {
    // When using SDK auth, vaultId is determined by the authenticated session
    if (this.authProvider.sdk) {
      // Try to get from SDK session user.vaultId
      if (this.authProvider.sdk.getSession) {
        const session = this.authProvider.sdk.getSession();
        if (session?.user?.vaultId) {
          if (providedVaultId && providedVaultId !== session.user.vaultId && this.debug) {
            console.log(
              `[${new Date().toISOString()}] Ignoring provided vaultId (${providedVaultId}) - using session vaultId: ${session.user.vaultId}`
            );
          }
          if (this.debug) {
            console.log(
              `[${new Date().toISOString()}] Using vaultId from SDK session: ${session.user.vaultId}`
            );
          }
          return session.user.vaultId;
        }
      }

      // Try SDK's getVaultInfo method if available
      if (this.authProvider.sdk.getVaultInfo) {
        const vaultInfo = await this.authProvider.sdk.getVaultInfo();
        if (vaultInfo?.vaultId) {
          if (providedVaultId && providedVaultId !== vaultInfo.vaultId && this.debug) {
            console.log(
              `[${new Date().toISOString()}] Ignoring provided vaultId (${providedVaultId}) - using vaultInfo vaultId: ${vaultInfo.vaultId}`
            );
          }
          if (this.debug) {
            console.log(
              `[${new Date().toISOString()}] Using vaultId from SDK getVaultInfo: ${vaultInfo.vaultId}`
            );
          }
          return vaultInfo.vaultId;
        }
      }
    }

    // For raw JWT/getJwt/getAuthHeaders or API key auth - use provided vaultId
    if (providedVaultId) {
      return providedVaultId;
    }

    throw new Error('vaultId is required. Provide it explicitly or use SDK auth with a valid session.');
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
    options: ChatOptions = {},
    overrideFunc: Function | null = null
  ): Promise<ProcessedResponse | RawChunk[]> {
    // Resolve vaultId (from options, SDK session, or SDK getVaultInfo)
    const vaultId = await this.resolveVaultId(options.vaultId);

    // Implement override pattern
    if (overrideFunc && typeof overrideFunc === 'function') {
      if (this.debug)
        console.log(`[${new Date().toISOString()}] Using override function for chat method`);
      return await overrideFunc(this.apiKey, { messages, ...options, vaultId });
    }

    if (this.debug)
      console.log(
        `[${new Date().toISOString()}] Sending chat request with ${messages.length} messages to vault ${vaultId}`
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
        vaultId,
        messages,
        model: options.model,
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

    // Use chatStream and get the aggregated response via StreamWithResponse.response
    const stream = this.chatStream({
      vaultId,
      messages,
      model: options.model,
      userApiKey: options.userApiKey,
      externalWalletAddress: options.externalWalletAddress,
      slippageSettings: options.slippageSettings,
      safeMode: options.safeMode,
      processChunks: true,
      selectedToolCategories: options.selectedToolCategories || [],
      attachments: options.attachments || [],
    });

    // Consume the stream to trigger processing (response promise resolves when stream completes)
    for await (const _ of stream) {
      // Chunks are processed internally by StreamProcessor
    }

    return stream.response;
  }

  /**
   * Sends a chat message or conversation history and streams the response.
   * Returns a StreamWithResponse that can be iterated for chunks and also provides
   * access to the aggregated ProcessedResponse after streaming completes.
   *
   * @param options - Chat configuration including messages, vaultId, etc.
   * @param overrideFunc - Optional function to override the API call (useful for testing)
   * @returns A StreamWithResponse that yields StreamChunk objects and provides aggregated response.
   *
   * @example
   * // Existing usage still works (non-breaking)
   * for await (const chunk of client.chatStream(options)) {
   *   console.log(chunk);
   * }
   *
   * @example
   * // New: Access aggregated response after streaming
   * const stream = client.chatStream(options);
   * for await (const chunk of stream) {
   *   displayChunk(chunk);
   * }
   * const processed = await stream.response;
   * console.log(processed.toolCalls, processed.pathInfo);
   */
  public chatStream(
    options: StreamOptions,
    overrideFunc: Function | null = null
  ): StreamWithResponse {
    const processor = new StreamProcessor();
    let responseResolve: (value: ProcessedResponse) => void;
    let responseReject: (reason: any) => void;
    const responsePromise = new Promise<ProcessedResponse>((resolve, reject) => {
      responseResolve = resolve;
      responseReject = reject;
    });

    // Create the generator that yields chunks while accumulating them
    const self = this;
    const generator = (async function* () {
      try {
        self.emit({ type: 'stream_start' });
        for await (const chunk of self._chatStreamGenerator(options, overrideFunc)) {
          processor.processChunk(chunk);

          // Emit events for tool activity
          if ('type' in chunk) {
            if (chunk.type === 'tool_call' && chunk.value) {
              self.emit({
                type: 'tool_start',
                toolCallId: chunk.value.toolCallId || '',
                toolName: chunk.value.toolName || '',
                args: chunk.value.args,
              });
            } else if (chunk.type === 'tool_result' && chunk.value) {
              self.emit({
                type: 'tool_end',
                toolCallId: chunk.value.toolCallId || '',
                toolName: chunk.value.toolName,
                result: chunk.value.result,
              });
            }
          }

          yield chunk;
        }
        const response = processor.getResponse();

        // Update summarization state from pathInfo
        if (response.pathInfo) {
          self.updateSummarizationState(response.pathInfo);
        }

        self.emit({ type: 'stream_end', response });
        responseResolve!(response);
      } catch (error) {
        responseReject!(error);
        throw error;
      }
    })();

    // Return object that implements StreamWithResponse
    return {
      [Symbol.asyncIterator]() {
        return generator;
      },
      response: responsePromise,
    };
  }

  /**
   * Internal generator that yields processed stream chunks.
   * @private
   */
  private async *_chatStreamGenerator(
    options: StreamOptions,
    overrideFunc: Function | null = null
  ): AsyncIterable<StreamChunk | RawChunk> {
    // Resolve vaultId (from options, SDK session, or SDK getVaultInfo)
    const vaultId = await this.resolveVaultId(options.vaultId);
    const resolvedOptions = { ...options, vaultId };

    // Implement override pattern
    if (overrideFunc && typeof overrideFunc === 'function') {
      if (this.debug)
        console.log(`[${new Date().toISOString()}] Using override function for chatStream method`);
      // For custom stream handling, yield generator from override function
      yield* overrideFunc(this.apiKey, resolvedOptions);
      return;
    }

    // If we're not processing chunks, just use rawStream
    if (options.processChunks === false) {
      if (this.debug)
        console.log(`[${new Date().toISOString()}] Process chunks disabled, using raw stream`);
      yield* this.rawStream(resolvedOptions);
      return;
    }

    if (this.debug)
      console.log(`[${new Date().toISOString()}] Processing stream chunks into structured data`);

    // Otherwise, process chunks into structured data
    for await (const chunk of this.rawStream(resolvedOptions)) {
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

        case '2': // Metadata chunks (path_info, reasoning, intent_context, dev_tools_info, token_usage)
          try {
            const data = Array.isArray(chunk.data) && chunk.data.length > 0 ? chunk.data[0] : chunk.data;
            const innerType = data?.type;

            switch (innerType) {
              case 'path_info':
                yield { type: 'path_info', value: data };
                break;
              case 'token_usage':
                // token_usage contains summarization fields (thresholdReached, summary, etc.)
                // Yield as path_info so StreamProcessor stores it for summarization handling
                yield { type: 'path_info', value: data };
                break;
              case 'reasoning':
                yield { type: 'reasoning', value: data };
                break;
              case 'intent_context':
                yield { type: 'intent_context', value: data };
                break;
              case 'dev_tools_info':
                yield { type: 'dev_tools_info', value: data };
                break;
              default:
                // Fallback to path_info for backwards compatibility
                yield { type: 'path_info', value: data };
            }
          } catch (error) {
            if (this.debug)
              console.error(`[${new Date().toISOString()}] Error processing prefix 2 data:`, error);
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
    // Resolve vaultId (from options, SDK session, or SDK getVaultInfo)
    const vaultId = await this.resolveVaultId(options.vaultId);
    const resolvedOptions = { ...options, vaultId };

    // Implement override pattern
    if (overrideFunc && typeof overrideFunc === 'function') {
      if (this.debug)
        console.log(`[${new Date().toISOString()}] Using override function for rawStream method`);
      // For custom stream handling, yield generator from override function
      yield* overrideFunc(this.apiKey, resolvedOptions);
      return;
    }

    const requestBody = this.prepareRequestBody(resolvedOptions);
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

      // Buffer for incomplete lines that span chunk boundaries
      let lineBuffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          if (this.debug) console.log(`[${new Date().toISOString()}] Stream complete`);
          // Process any remaining buffered line
          if (lineBuffer.trim()) {
            if (this.debug)
              console.log(`[${new Date().toISOString()}] Processing final buffered line`);
            const prefix = lineBuffer.charAt(0);
            const data = lineBuffer.substring(2);
            let parsedData;
            try {
              parsedData = JSON.parse(data);
              if (
                typeof parsedData === 'string' &&
                (parsedData.startsWith('{') || parsedData.startsWith('['))
              ) {
                try {
                  parsedData = JSON.parse(parsedData);
                } catch (e) {
                  /* keep single-decoded version */
                }
              }
            } catch (e) {
              parsedData = data;
            }
            yield { prefix, data: parsedData, raw: lineBuffer };
          }
          break;
        }

        const text = new TextDecoder().decode(value);
        if (this.debug) console.log(`[${new Date().toISOString()}] Raw stream data:`, text);

        // Prepend any buffered content from previous chunk
        const fullText = lineBuffer + text;
        const lines = fullText.split('\n');

        // The last element might be incomplete if it doesn't end with \n
        // Save it for the next iteration
        lineBuffer = text.endsWith('\n') ? '' : lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const prefix = line.charAt(0);
            const data = line.substring(2);

            // Parse JSON if it's valid JSON, otherwise leave as string
            // Also handle double-encoded JSON (JSON string within JSON)
            let parsedData;
            try {
              parsedData = JSON.parse(data);

              // Check if the result is still a JSON string (double-encoded)
              // This happens when the server sends tool results as stringified JSON
              if (
                typeof parsedData === 'string' &&
                (parsedData.startsWith('{') || parsedData.startsWith('['))
              ) {
                try {
                  const doubleDecoded = JSON.parse(parsedData);
                  parsedData = doubleDecoded;
                  if (this.debug)
                    console.log(
                      `[${new Date().toISOString()}] Double-decoded JSON data for prefix ${prefix}`
                    );
                } catch (e) {
                  // If it fails to parse again, keep the single-decoded version
                  if (this.debug)
                    console.log(
                      `[${new Date().toISOString()}] Single-decoded JSON data for prefix ${prefix}`
                    );
                }
              }

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
      headers: await this.getHeaders(),
      mode: 'cors',
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch tools: ${response.status} ${response.statusText}`);
    }

    const parsedResponse = await response.json();
    return parsedResponse.data;
  }

  /**
   * Fetches available models from the API.
   * Returns the list of models from OpenRouter with pricing and capability info.
   *
   * @returns A promise resolving to an array of Model objects
   */
  public async getModels(): Promise<Model[]> {
    // GET /api/models
    const headers = await this.getHeaders();

    // For API key auth, we need x-api-key and x-vault-id headers
    if (this.apiKey && this.vaultId) {
      headers['x-api-key'] = this.apiKey;
      headers['x-vault-id'] = this.vaultId;
    }

    const response = await this.fetchImpl(`${this.baseUrl}/api/models`, {
      method: 'GET',
      headers,
      mode: 'cors',
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
    }

    const parsedResponse = await response.json();
    return parsedResponse.data;
  }

  /**
   * Uploads a file to the server and returns the attachment info.
   * Browser-safe: accepts `File`/`Blob` in the browser and
   * file path strings in Node.js. Avoids importing Node modules
   * in browser bundles.
   *
   * @param file - A File/Blob (browser) or a filesystem path (Node)
   * @param fileName - Optional custom filename
   * @returns A promise resolving to the Attachment object
   */
  public async uploadFile(file: string | Blob | File, fileName?: string): Promise<Attachment> {
    const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';

    const supportedImageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const extToMime: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
    };

    let actualFileName = fileName || 'uploaded-image';
    let contentType: string | undefined;
    let blobForUpload: Blob | null = null;

    if (isBrowser) {
      // In the browser we require a File or Blob
      if (typeof file === 'string') {
        throw new Error(
          'In the browser, uploadFile expects a File or Blob. Paths are not supported.'
        );
      }

      const input = file as Blob; // File extends Blob

      // Derive filename and content type
      if (typeof File !== 'undefined' && input instanceof File) {
        actualFileName = fileName || input.name || actualFileName;
        contentType = input.type || undefined;
      } else {
        actualFileName = fileName || actualFileName;
        contentType = (input as Blob).type || undefined;
      }

      // If the Blob/File lacks a type, try extension-based detection
      if (!contentType) {
        const extMatch = /\.[^.]+$/.exec(actualFileName || '');
        const ext = extMatch ? extMatch[0].toLowerCase() : '';
        if (ext in extToMime) contentType = extToMime[ext];
      }

      if (!contentType || !supportedImageTypes.includes(contentType)) {
        throw new Error(
          `Unsupported file type: ${contentType || 'unknown'}. Supported types: JPEG, PNG, GIF, WebP`
        );
      }

      // Enforce size limit using Blob/File size
      if ((input as Blob).size > 5 * 1024 * 1024) {
        throw new Error('File size should be less than 5MB');
      }

      blobForUpload = input;
    } else {
      // Node.js environment
      if (typeof file === 'string') {
        const filePath = file;

        // Dynamic imports for Node.js modules
        const fs = await import('fs');
        const path = await import('path');

        if (!fs.existsSync(filePath)) {
          throw new Error(`File not found: ${filePath}`);
        }

        const fileBuffer: Uint8Array = fs.readFileSync(filePath);
        actualFileName = fileName || path.basename(filePath);

        // Determine content type by extension first
        const ext = path.extname(filePath).toLowerCase();
        contentType = extToMime[ext];

        // If extension is missing or unrecognized, try detecting from content
        if (!contentType) {
          try {
            const ft = await import('file-type');
            const detected = await ft.fileTypeFromBuffer(fileBuffer);
            if (detected?.mime) {
              contentType = detected.mime;
            }
          } catch {
            // ignore detection errors and fall through
          }
        }

        if (!contentType || !supportedImageTypes.includes(contentType)) {
          throw new Error(
            `Unsupported file type: ${contentType || ext || 'unknown'}. Supported types: JPEG, PNG, GIF, WebP`
          );
        }

        // Size check (5MB)
        if ((fileBuffer as Uint8Array).length > 5 * 1024 * 1024) {
          throw new Error('File size should be less than 5MB');
        }

        const uint8Array = new Uint8Array(fileBuffer);
        blobForUpload = new Blob([uint8Array], { type: contentType });
      } else {
        // Blob/File passed in Node environment
        const input = file as Blob; // File extends Blob

        if (typeof File !== 'undefined' && (file as any) instanceof File) {
          actualFileName = fileName || (file as File).name || actualFileName;
          contentType = (file as File).type || undefined;
        } else {
          actualFileName = fileName || actualFileName;
          contentType = input.type || undefined;
        }

        if (!contentType) {
          const extMatch = /\.[^.]+$/.exec(actualFileName || '');
          const ext = extMatch ? extMatch[0].toLowerCase() : '';
          if (ext in extToMime) contentType = extToMime[ext];
        }

        if (!contentType || !supportedImageTypes.includes(contentType)) {
          throw new Error(
            `Unsupported file type: ${contentType || 'unknown'}. Supported types: JPEG, PNG, GIF, WebP`
          );
        }

        if (input.size > 5 * 1024 * 1024) {
          throw new Error('File size should be less than 5MB');
        }

        blobForUpload = input;
      }
    }

    // Prepare FormData. Ensure a filename is provided when appending.
    const formData = new FormData();
    if (typeof File !== 'undefined') {
      // If we already have a File with a name, reuse it, otherwise wrap Blob in a File
      const fileIsFile = !isBrowser
        ? typeof File !== 'undefined' && blobForUpload && (blobForUpload as any) instanceof File
        : blobForUpload instanceof File;

      if (fileIsFile) {
        formData.append('file', blobForUpload as File, actualFileName);
      } else {
        // Wrap Blob with a filename for best compatibility
        const wrapped = new File([blobForUpload as Blob], actualFileName, {
          type: contentType,
        });
        formData.append('file', wrapped, actualFileName);
      }
    } else {
      // Older Node runtimes: append Blob directly
      formData.append('file', blobForUpload as Blob, actualFileName);
    }

    if (this.debug) {
      console.log(
        `[${new Date().toISOString()}] Uploading file: ${actualFileName} (${contentType})`
      );
    }

    const headers = await this.getHeaders();
    // Remove Content-Type header to let the browser/undici set it with boundary for FormData
    delete headers['Content-Type'];

    const response = await this.fetchImpl(`${this.baseUrl}/api/files/upload`, {
      method: 'POST',
      headers,
      body: formData,
      mode: 'cors',
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Upload failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const uploadResult = await response.json();

    if (this.debug) {
      console.log(`[${new Date().toISOString()}] Upload successful:`, uploadResult);
    }

    return {
      name: actualFileName,
      contentType: contentType || 'application/octet-stream',
      url: uploadResult.url,
    };
  }

  /**
   * Prepares the request body for a chat request
   * @private
   */
  private prepareRequestBody(options: {
    vaultId: string;
    messages: ChatMessage[];
    model?: string;
    overrideSystemPrompt?: boolean;
    userApiKey?: string;
    externalWalletAddress?: string;
    slippageSettings?: Record<string, number>;
    safeMode?: boolean;
    currentPath?: string | null;
    selectedToolCategories?: string[];
    attachments?: Attachment[];
    trimIndex?: number;
    summary?: string;
    summaryEndIndex?: number;
  }): HustleRequest {
    // apiKey is optional when using JWT authentication (via Authorization header)
    const apiKey = options.userApiKey || this.apiKey;

    // Transform attachments to match real Hustle app format
    const transformedMessages = [...options.messages];

    if (options.attachments && options.attachments.length > 0) {
      // Transform the last user message to include experimental_attachments and parts
      const lastUserMessageIndex = transformedMessages.findLastIndex(msg => msg.role === 'user');
      if (lastUserMessageIndex !== -1 && transformedMessages[lastUserMessageIndex]) {
        const lastUserMessage = transformedMessages[lastUserMessageIndex];

        // Create experimental_attachments array in the same format as the main app
        const experimental_attachments = options.attachments.map(attachment => ({
          contentType: attachment.contentType || 'image/png',
          name: attachment.name || 'uploaded-image',
          url: attachment.url || '',
        }));

        // Create parts array with just the text content (no image parts)
        const parts: import('./types').MessagePart[] = [
          { type: 'text' as const, text: lastUserMessage.content || '' },
        ];

        // Update the message with experimental_attachments and parts
        transformedMessages[lastUserMessageIndex] = {
          ...lastUserMessage,
          content: lastUserMessage.content || '',
          experimental_attachments: experimental_attachments,
          parts: parts,
        };
      }
    }

    // Determine summarization fields to send
    // Priority: explicit options > stored state > calculate if needed
    // This matches Hustle-v2 behavior: calculate trimIndex once per threshold event, then reuse
    let trimIndex: number | undefined = options.trimIndex ?? this.summarizationState.trimIndex;
    const summary = options.summary ?? this.summarizationState.summary;
    const summaryEndIndex = options.summaryEndIndex ?? this.summarizationState.summaryEndIndex;

    // If no trimIndex yet but threshold was reached, calculate and STORE it
    // This ensures we send the same trimIndex until the next threshold event
    if (trimIndex === undefined && this.summarizationState.thresholdReached) {
      const retentionCount = this.summarizationState.messageRetentionCount ?? 1;
      trimIndex = this.calculateTrimIndex(transformedMessages, retentionCount);
      // Store it so subsequent requests use the same value
      this.summarizationState.trimIndex = trimIndex;
      if (this.debug) {
        console.log(
          `[${new Date().toISOString()}] Calculated and stored trimIndex: ${trimIndex}`
        );
      }
    }

    if (this.debug && (trimIndex || summary || summaryEndIndex)) {
      console.log(
        `[${new Date().toISOString()}] Sending summarization fields: trimIndex=${trimIndex}, summaryEndIndex=${summaryEndIndex}, hasSummary=${!!summary}`
      );
    }

    return {
      id: `chat-${options.vaultId}`,
      messages: transformedMessages,
      apiKey,
      vaultId: options.vaultId,
      model: options.model,
      overrideSystemPrompt: options.overrideSystemPrompt,
      externalWalletAddress: options.externalWalletAddress || '',
      slippageSettings: options.slippageSettings || {
        lpSlippage: 5,
        swapSlippage: 5,
        pumpSlippage: 5,
      },
      safeMode: options.safeMode !== false,
      currentPath: options.currentPath || null,
      attachments: options.attachments || [],
      selectedToolCategories: options.selectedToolCategories || [],
      trimIndex,
      summary,
      summaryEndIndex,
    };
  }

  /**
   * Creates a fetch request to the chat API
   * @private
   */
  private async createRequest(requestBody: HustleRequest): Promise<Response> {
    const headers = await this.getHeaders();

    if (this.debug) {
      console.log(`[${new Date().toISOString()}] Making POST request to ${this.baseUrl}/api/chat`);
      console.log(`[${new Date().toISOString()}] Request headers:`, JSON.stringify(headers));
    }

    const response = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      mode: 'cors',
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
   * Resolves authentication headers for a request.
   * Called fresh on each request to support JWT refresh from SDK.
   * @private
   */
  private async resolveAuthHeaders(): Promise<Record<string, string>> {
    // Try getAuthHeaders first (highest priority)
    if (typeof this.authProvider.getAuthHeaders === 'function') {
      const customHeaders = await this.authProvider.getAuthHeaders();
      if (customHeaders && typeof customHeaders === 'object') {
        return customHeaders;
      }
    }

    // Try JWT auth (from sdk, getJwt, or static jwt)
    const jwt = await resolveJwt(this.authProvider);
    if (jwt) {
      return { Authorization: `Bearer ${jwt}` };
    }

    // Fall back to API key (handled in request body, not headers)
    return {};
  }

  /**
   * Constructs the necessary headers for API requests.
   * @private
   */
  private async getHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': `HustleIncognito-SDK/${this.sdkVersion}`,
    };

    // Add auth headers (JWT Bearer token if using SDK/JWT auth)
    const authHeaders = await this.resolveAuthHeaders();
    Object.assign(headers, authHeaders);

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

  /**
   * Subscribe to SDK events.
   * @param event - The event type to listen for
   * @param listener - The callback function to invoke when the event occurs
   * @returns A function to unsubscribe the listener
   */
  on<T extends HustleEventType>(
    event: T,
    listener: HustleEventListener<
      T extends 'tool_start'
        ? ToolStartEvent
        : T extends 'tool_end'
          ? ToolEndEvent
          : T extends 'stream_start'
            ? StreamStartEvent
            : StreamEndEvent
    >
  ): () => void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(listener as HustleEventListener);
    return () => this.off(event, listener as HustleEventListener);
  }

  /**
   * Unsubscribe from SDK events.
   * @param event - The event type to stop listening for
   * @param listener - The callback function to remove
   */
  off(event: HustleEventType, listener: HustleEventListener): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.delete(listener);
    }
  }

  /**
   * Emit an event to all registered listeners.
   * @private
   */
  private emit(event: HustleEvent): void {
    const listeners = this.eventListeners.get(event.type);
    if (listeners) {
      listeners.forEach((listener) => {
        try {
          listener(event);
        } catch (err) {
          if (this.debug) {
            console.error(`[${new Date().toISOString()}] Event listener error:`, err);
          }
        }
      });
    }
  }

  /**
   * Get the current summarization state.
   * Useful for debugging or custom handling of summarization.
   */
  getSummarizationState(): SummarizationState {
    return { ...this.summarizationState };
  }

  /**
   * Clear the summarization state.
   * Call this when starting a new conversation to reset summarization tracking.
   */
  clearSummarizationState(): void {
    this.summarizationState = { thresholdReached: false };
    if (this.debug) {
      console.log(`[${new Date().toISOString()}] Summarization state cleared`);
    }
  }

  /**
   * Update summarization state from response pathInfo.
   * Called internally when processing stream responses.
   *
   * Flow:
   * 1. Server sends thresholdReached=true with messageRetentionCount
   * 2. Client sends trimIndex on next request
   * 3. Server generates summary and sends it back with summaryEndIndex
   * 4. Client stores and continues sending trimIndex, summary, summaryEndIndex
   *
   * @private
   */
  private updateSummarizationState(pathInfo: {
    thresholdReached?: boolean;
    messageRetentionCount?: number;
    summary?: string;
    summaryEndIndex?: number;
  }): void {
    // When threshold is reached, store messageRetentionCount and clear trimIndex
    // so it gets recalculated on the next request with current messages
    if (pathInfo.thresholdReached && pathInfo.messageRetentionCount !== undefined) {
      this.summarizationState.thresholdReached = true;
      this.summarizationState.messageRetentionCount = pathInfo.messageRetentionCount;
      // Clear trimIndex so it gets recalculated with the new messages on next request
      // This matches Hustle-v2 behavior: calculate once per threshold event
      this.summarizationState.trimIndex = undefined;
      if (this.debug) {
        console.log(
          `[${new Date().toISOString()}] Summarization threshold reached. Retention count: ${pathInfo.messageRetentionCount}. trimIndex cleared for recalculation.`
        );
      }
    }

    // Always update summary and summaryEndIndex when provided by server
    // (These come back after we send trimIndex and server generates the summary)
    if (pathInfo.summary !== undefined) {
      this.summarizationState.summary = pathInfo.summary;
      if (this.debug) {
        console.log(
          `[${new Date().toISOString()}] Received conversation summary from server`
        );
      }
    }

    if (pathInfo.summaryEndIndex !== undefined) {
      this.summarizationState.summaryEndIndex = pathInfo.summaryEndIndex;
      if (this.debug) {
        console.log(
          `[${new Date().toISOString()}] Summary end index updated to: ${pathInfo.summaryEndIndex}`
        );
      }
    }
  }

  /**
   * Calculates the trim index for a set of messages.
   * Keeps the last N user messages and their responses.
   *
   * @param messages - The message array to calculate trim index for
   * @param keepLastUserMessages - Number of user messages to keep (default 1)
   * @returns The index at which to trim messages
   * @private
   */
  private calculateTrimIndex(
    messages: ChatMessage[],
    keepLastUserMessages: number = 1
  ): number {
    // Filter out system messages for counting
    const nonSystemMessages = messages.filter(msg => msg.role !== 'system');
    const userIndices = nonSystemMessages
      .map((msg, idx) => msg.role === 'user' ? idx : -1)
      .filter(idx => idx !== -1);

    // Keep last N user messages and all messages after them
    const keepFromIndex = userIndices.length > keepLastUserMessages
      ? userIndices[userIndices.length - keepLastUserMessages]
      : 0;

    // Find the actual index in the full messages array
    let systemCount = 0;
    let nonSystemCount = 0;
    let calculatedTrimIndex = 0;

    for (let i = 0; i < messages.length; i++) {
      if (messages[i].role === 'system') {
        systemCount++;
      } else {
        if (nonSystemCount === keepFromIndex) {
          calculatedTrimIndex = i;
          break;
        }
        nonSystemCount++;
      }
    }

    if (this.debug) {
      console.log(
        `[${new Date().toISOString()}] Calculated trimIndex: ${calculatedTrimIndex} ` +
        `(keeping last ${keepLastUserMessages} user messages from ${messages.length} total)`
      );
    }

    return calculatedTrimIndex;
  }
}
