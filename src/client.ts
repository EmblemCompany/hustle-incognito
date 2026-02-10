// src/client.ts
import type {
  Attachment,
  AutoRetryEvent,
  ChatMessage,
  ChatOptions,
  ClientToolDefinition,
  EmblemAuthProvider,
  HeadlessAuthOptions,
  HustleEvent,
  HustleEventListener,
  HustleEventType,
  HustleIncognitoClientOptions,
  HustlePlugin,
  HustleRequest,
  IntentContext,
  MaxToolsReachedEvent,
  MissingToolEvent,
  Model,
  PaygConfigureOptions,
  PaygConfigureResult,
  PaygStatus,
  ProcessedResponse,
  RawChunk,
  RawStreamOptions,
  StreamChunk,
  StreamEndEvent,
  StreamOptions,
  StreamStartEvent,
  StreamWithResponse,
  StubbedToolConfig,
  SummarizationState,
  TimeoutEvent,
  ToolCategory,
  ToolEndEvent,
  ToolStartEvent,
  ToolValidationErrorEvent,
} from './types';
import { PluginManager } from './plugins';

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * Maps a new SSE-format event to an old-style RawChunk.
 * Returns null for events that should be skipped (boundary markers, streaming reasoning, etc.)
 * @internal Exported for testing only.
 */
export function mapSSEEventToRawChunk(event: any, rawLine: string): RawChunk | null {
  switch (event.type) {
    case 'text-delta':
      return { prefix: '0', data: event.delta, raw: rawLine };
    case 'start':
      return { prefix: 'f', data: { messageId: event.messageId }, raw: rawLine };
    case 'data-custom':
      // data-custom wraps the same inner payloads as old prefix 2 (path_info, reasoning, etc.)
      return { prefix: '2', data: event.data, raw: rawLine };
    case 'finish':
      return {
        prefix: 'e',
        data: {
          finishReason: event.finishReason,
          usage: event.usage,
          isContinued: event.isContinued,
        },
        raw: rawLine,
      };
    case 'tool-call':
      return {
        prefix: '9',
        data: { toolCallId: event.toolCallId, toolName: event.toolName, args: event.args },
        raw: rawLine,
      };
    case 'tool-result':
      return {
        prefix: 'a',
        data: { toolCallId: event.toolCallId, toolName: event.toolName, result: event.result },
        raw: rawLine,
      };
    case 'tool-input-available':
      return {
        prefix: '9',
        data: { toolCallId: event.toolCallId, toolName: event.toolName, args: event.input },
        raw: rawLine,
      };
    case 'error':
      return {
        prefix: 'error',
        data: { message: event.message || event.detail || event.error || 'Unknown SSE error' },
        raw: rawLine,
      };
    // Boundary markers, streaming reasoning, and streaming tool input — skip silently
    case 'text-start':
    case 'text-end':
    case 'reasoning-start':
    case 'reasoning-delta':
    case 'reasoning-end':
    case 'start-step':
    case 'finish-step':
    case 'tool-input-delta':
      return null;
    default:
      return null;
  }
}

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
   * Note: Newline separators after tool activity are handled in the streaming code,
   * so StreamProcessor just accumulates the text as-is.
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
  private readonly pluginManager: PluginManager;

  /**
   * Create a client using headless password authentication.
   * Ideal for CLI tools, servers, and AI agents that don't have browser access.
   *
   * Requires `@emblemvault/auth-sdk` to be installed as a peer dependency.
   *
   * @param options - Headless authentication options
   * @returns Promise resolving to an authenticated HustleIncognitoClient instance
   *
   * @example
   * ```typescript
   * // Basic usage with password
   * const client = await HustleIncognitoClient.createWithPassword({
   *   password: process.env.AGENT_PASSWORD!, // min 16 chars
   *   appId: 'your-app.example.com',
   * });
   *
   * // With custom API URLs
   * const client = await HustleIncognitoClient.createWithPassword({
   *   password: 'my-super-secret-agent-key-12345',
   *   appId: 'dev.agenthustle.ai',
   *   authApiUrl: 'https://dev-api.emblemvault.ai',
   *   hustleApiUrl: 'https://dev.agenthustle.ai',
   *   debug: true,
   * });
   *
   * // Use the client as normal
   * for await (const chunk of client.streamChat({
   *   messages: [{ role: 'user', content: 'Hello!' }],
   * })) {
   *   process.stdout.write(chunk.value);
   * }
   * ```
   */
  static async createWithPassword(options: HeadlessAuthOptions): Promise<HustleIncognitoClient> {
    // Validate password length
    if (!options.password || options.password.length < 16) {
      throw new Error('Password must be at least 16 characters for headless authentication');
    }

    if (!options.appId) {
      throw new Error('appId is required for headless authentication');
    }

    // Dynamic import to keep auth-sdk as an optional peer dependency
    let EmblemAuthSDK: any;
    try {
      const authSdkModule = await import('@emblemvault/auth-sdk');
      EmblemAuthSDK = authSdkModule.EmblemAuthSDK;
    } catch (error) {
      throw new Error(
        'Failed to import @emblemvault/auth-sdk. Please install it: npm install @emblemvault/auth-sdk'
      );
    }

    const authApiUrl = options.authApiUrl || 'https://api.emblemvault.ai';

    if (options.debug) {
      console.log(`[${new Date().toISOString()}] Creating headless auth client...`);
      console.log(`[${new Date().toISOString()}] Auth API: ${authApiUrl}`);
      console.log(`[${new Date().toISOString()}] App ID: ${options.appId}`);
    }

    // Create auth SDK instance
    const sdk = new EmblemAuthSDK({
      appId: options.appId,
      apiUrl: authApiUrl,
      persistSession: false, // No localStorage in Node.js
    });

    // Authenticate with password
    const session = await sdk.authenticatePassword({ password: options.password });

    if (!session) {
      throw new Error('Password authentication failed - no session returned');
    }

    if (options.debug) {
      console.log(`[${new Date().toISOString()}] Authentication successful`);
      console.log(`[${new Date().toISOString()}] Vault ID: ${session.user?.vaultId}`);
    }

    // Create and return the client with the authenticated SDK
    return new HustleIncognitoClient({
      sdk,
      hustleApiUrl: options.hustleApiUrl,
      debug: options.debug,
      fetch: options.fetch,
      security: options.security,
    });
  }

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
    this.baseUrl = options.hustleApiUrl || getEnv('HUSTLE_API_URL') || API_ENDPOINTS.PRODUCTION;
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
      console.log(`[${new Date().toISOString()}] Auth mode: ${hasApiKey ? 'API Key' : 'JWT/SDK'}`);
      if (this.cookie) {
        console.log(`[${new Date().toISOString()}] Using cookie from environment`);
      }
    }

    // Initialize plugin manager with security configuration
    this.pluginManager = new PluginManager({
      debug: this.debug,
      security: options.security,
    });
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

    throw new Error(
      'vaultId is required. Provide it explicitly or use SDK auth with a valid session.'
    );
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
        intentContext: options.intentContext,
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
      intentContext: options.intentContext,
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
   * When plugins with client-side tools are registered and the server returns
   * finishReason: "tool-calls", the SDK will automatically:
   * 1. Execute client-side tools via plugin executors
   * 2. Send tool results back as a new chat turn
   * 3. Continue until completion or maxToolRounds is reached
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

    // Bind methods to preserve 'this' context inside the generator
    const emit = this.emit.bind(this);
    const chatStreamGenerator = this._chatStreamGenerator.bind(this);
    const updateSummarizationState = this.updateSummarizationState.bind(this);
    const pluginManager = this.pluginManager;
    const debug = this.debug;

    // Configuration for tool execution loop
    const maxToolRounds = options.maxToolRounds ?? 5;
    const onToolCall = options.onToolCall;

    const generator = (async function* () {
      try {
        emit({ type: 'stream_start' });

        // Track messages across rounds for tool execution loop
        let currentMessages = [...options.messages];
        let round = 0;

        // Track max_tools_reached across all rounds - only emit once at the end
        let maxToolsReachedData: { toolsExecuted: number; maxSteps: number } | null = null;

        while (round < maxToolRounds || maxToolRounds === 0) {
          round++;
          if (debug && round > 1) {
            console.log(`[${new Date().toISOString()}] Client tool execution round ${round}`);
          }

          // Track pending client-side tool calls for this round
          const pendingClientToolCalls: Array<{
            toolCallId: string;
            toolName: string;
            args: Record<string, unknown>;
          }> = [];
          let finishReason: string | null = null;

          // Stream the response for this round
          const roundOptions = { ...options, messages: currentMessages };
          for await (const chunk of chatStreamGenerator(roundOptions, overrideFunc)) {
            processor.processChunk(chunk);

            // Emit events for tool activity
            if ('type' in chunk) {
              if (chunk.type === 'tool_call' && chunk.value) {
                const toolCall = chunk.value as {
                  toolCallId?: string;
                  toolName?: string;
                  args?: Record<string, unknown>;
                };

                emit({
                  type: 'tool_start',
                  toolCallId: toolCall.toolCallId || '',
                  toolName: toolCall.toolName || '',
                  args: toolCall.args,
                });

                // Check if this is a client-side tool (we have an executor)
                if (toolCall.toolName && pluginManager.hasExecutor(toolCall.toolName)) {
                  // Deduplicate by toolCallId to prevent duplicate execution
                  // (server may send both 'tool-call' and 'tool-input-available' for the same call)
                  const alreadyExists = pendingClientToolCalls.some(
                    tc => tc.toolCallId === (toolCall.toolCallId || '')
                  );
                  if (!alreadyExists) {
                    pendingClientToolCalls.push({
                      toolCallId: toolCall.toolCallId || '',
                      toolName: toolCall.toolName,
                      args: toolCall.args || {},
                    });
                  }
                }
              } else if (chunk.type === 'tool_result' && chunk.value) {
                emit({
                  type: 'tool_end',
                  toolCallId: chunk.value.toolCallId || '',
                  toolName: chunk.value.toolName,
                  result: chunk.value.result,
                });
              } else if (chunk.type === 'finish' && chunk.value) {
                finishReason = (chunk.value as { reason?: string }).reason || 'stop';
              } else if (chunk.type === 'max_tools_reached' && chunk.value) {
                // Defer max_tools_reached event until after all rounds complete
                // This prevents emitting multiple times during multi-round tool execution
                const data = chunk.value as { toolsExecuted?: number; maxSteps?: number };
                if (!maxToolsReachedData) {
                  // Store the first occurrence (accumulate toolsExecuted across rounds)
                  maxToolsReachedData = {
                    toolsExecuted: data.toolsExecuted ?? 0,
                    maxSteps: data.maxSteps ?? 0,
                  };
                } else {
                  // Accumulate tools executed from subsequent rounds
                  maxToolsReachedData.toolsExecuted += data.toolsExecuted ?? 0;
                }
              } else if (chunk.type === 'timeout_occurred' && chunk.value) {
                const data = chunk.value as { message?: string; timestamp?: string };
                emit({
                  type: 'timeout',
                  message: data.message ?? 'Request timed out',
                  timestamp: data.timestamp ?? new Date().toISOString(),
                });
              } else if (chunk.type === 'auto_retry' && chunk.value) {
                const data = chunk.value as {
                  retryCount?: number;
                  toolName?: string;
                  addedCategory?: string;
                  message?: string;
                };
                emit({
                  type: 'auto_retry',
                  retryCount: data.retryCount ?? 0,
                  toolName: data.toolName ?? '',
                  addedCategory: data.addedCategory,
                  message: data.message ?? 'Retrying tool call',
                });
              } else if (chunk.type === 'tool_validation_error' && chunk.value) {
                const data = chunk.value as { toolName?: string; message?: string };
                emit({
                  type: 'tool_validation_error',
                  toolName: data.toolName ?? '',
                  message: data.message ?? 'Tool validation failed',
                });
              } else if (chunk.type === 'missing_tool' && chunk.value) {
                const data = chunk.value as {
                  toolName?: string;
                  categoryId?: string;
                  message?: string;
                };
                emit({
                  type: 'missing_tool',
                  toolName: data.toolName ?? '',
                  categoryId: data.categoryId,
                  message: data.message ?? 'Tool not found',
                });
              }
            }

            yield chunk;
          }

          // Check if we should execute client-side tools
          const shouldExecuteClientTools =
            pendingClientToolCalls.length > 0 &&
            (finishReason === 'tool-calls' || finishReason === 'tool_calls');

          if (!shouldExecuteClientTools) {
            // No more client tools to execute, we're done
            break;
          }

          if (debug) {
            console.log(
              `[${new Date().toISOString()}] Executing ${pendingClientToolCalls.length} client-side tools`
            );
          }

          // Execute client-side tools and collect results
          const toolResults: Array<{
            toolCallId: string;
            toolName: string;
            result: unknown;
          }> = [];

          for (const toolCall of pendingClientToolCalls) {
            try {
              // Execute via callback or plugin manager
              const result = onToolCall
                ? await onToolCall({
                    toolCallId: toolCall.toolCallId,
                    toolName: toolCall.toolName,
                    args: toolCall.args,
                  })
                : await pluginManager.executeClientTool({
                    toolCallId: toolCall.toolCallId,
                    toolName: toolCall.toolName,
                    args: toolCall.args,
                  });

              toolResults.push({
                toolCallId: toolCall.toolCallId,
                toolName: toolCall.toolName,
                result,
              });

              // Yield tool_result chunk for visibility
              const toolResultChunk = {
                type: 'tool_result' as const,
                value: {
                  toolCallId: toolCall.toolCallId,
                  toolName: toolCall.toolName,
                  result,
                  // Add backward-compatible aliases
                  id: toolCall.toolCallId,
                  name: toolCall.toolName,
                },
              };
              processor.processChunk(toolResultChunk);
              yield toolResultChunk;

              // Emit tool_end event
              emit({
                type: 'tool_end',
                toolCallId: toolCall.toolCallId,
                toolName: toolCall.toolName,
                result,
              });

              if (debug) {
                console.log(
                  `[${new Date().toISOString()}] Client tool ${toolCall.toolName} executed successfully`
                );
              }
            } catch (error) {
              if (debug) {
                console.error(
                  `[${new Date().toISOString()}] Client tool ${toolCall.toolName} failed:`,
                  error
                );
              }
              // Still add the error result so the model knows what happened
              const errorResult = {
                error: error instanceof Error ? error.message : String(error),
              };
              toolResults.push({
                toolCallId: toolCall.toolCallId,
                toolName: toolCall.toolName,
                result: errorResult,
              });

              const errorChunk = {
                type: 'tool_result' as const,
                value: {
                  toolCallId: toolCall.toolCallId,
                  toolName: toolCall.toolName,
                  result: errorResult,
                  id: toolCall.toolCallId,
                  name: toolCall.toolName,
                },
              };
              processor.processChunk(errorChunk);
              yield errorChunk;
            }
          }

          // Append tool results to messages for next round
          // Build parts array with tool invocations in AI SDK v6 UIMessage format
          const toolParts = toolResults.map((tr) => ({
            type: 'tool-invocation' as const,
            toolCallId: tr.toolCallId,
            toolName: tr.toolName,
            state: 'output-available' as const,
            input: pendingClientToolCalls.find(tc => tc.toolCallId === tr.toolCallId)?.args || {},
            output: tr.result,
          }));

          currentMessages = [
            ...currentMessages,
            // Assistant message with parts (AI SDK v6 UIMessage format)
            {
              role: 'assistant' as const,
              content: '',
              parts: [
                { type: 'text' as const, text: '' },
                ...toolParts,
              ],
            },
          ];

          if (debug) {
            console.log(
              `[${new Date().toISOString()}] Sending tool results in new turn (${toolResults.length} results)`
            );
          }

          // Continue to next round (loop will make new request with updated messages)
        }

        // Emit max_tools_reached event ONCE after all rounds complete
        // This prevents the React component from seeing multiple events during multi-round tool execution
        if (maxToolsReachedData) {
          emit({
            type: 'max_tools_reached',
            toolsExecuted: maxToolsReachedData.toolsExecuted,
            maxSteps: maxToolsReachedData.maxSteps,
          });
        }

        const response = processor.getResponse();

        // Run afterResponse hooks from all plugins
        await pluginManager.runAfterResponse(response);

        // Update summarization state from pathInfo
        if (response.pathInfo) {
          updateSummarizationState(response.pathInfo);
        }

        emit({ type: 'stream_end', response });
        responseResolve!(response);
      } catch (error) {
        // Check for timeout abort and emit timeout event
        if (error instanceof Error && error.message === 'abort_timeout') {
          emit({
            type: 'timeout',
            message: 'Request timed out',
            timestamp: new Date().toISOString(),
          });
        }
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
    // Track tool activity to add newline separators between text chunks
    let hadToolActivity = false;
    let hasYieldedText = false;
    let charsSinceToolActivity = 0;
    let inPostToolMode = false; // Track if we're still in "short response after tool" mode

    for await (const chunk of this.rawStream(resolvedOptions)) {
      if (this.debug)
        console.log(`[${new Date().toISOString()}] Processing chunk:`, JSON.stringify(chunk));

      switch (chunk.prefix) {
        case '0': // Text chunk
          const textData = chunk.data as string;
          const startsWithCapital = /^[A-Z]/.test(textData);

          // Add newline if:
          // 1. We had tool activity and already yielded text (standard case)
          // 2. OR we're in post-tool mode with short text so far, and this looks like a new sentence
          const shouldAddNewline =
            (hadToolActivity && hasYieldedText) ||
            (inPostToolMode && charsSinceToolActivity < 20 && startsWithCapital);

          if (shouldAddNewline) {
            yield { type: 'text', value: '\n' + textData };
            inPostToolMode = false;
          } else {
            yield { type: 'text', value: textData };
          }

          hasYieldedText = true;
          charsSinceToolActivity += textData.length;
          // Exit post-tool mode if we've accumulated enough text
          if (charsSinceToolActivity >= 20) {
            inPostToolMode = false;
          }
          hadToolActivity = false;
          break;

        case '9': // Tool call
          if (this.debug)
            console.log(
              `[${new Date().toISOString()}] Found tool call:`,
              JSON.stringify(chunk.data)
            );
          yield { type: 'tool_call', value: chunk.data };
          hadToolActivity = true;
          inPostToolMode = true;
          charsSinceToolActivity = 0;
          break;

        case 'a': // Tool result
          if (this.debug)
            console.log(
              `[${new Date().toISOString()}] Found tool result:`,
              JSON.stringify(chunk.data)
            );
          yield { type: 'tool_result', value: chunk.data };
          hadToolActivity = true;
          inPostToolMode = true;
          charsSinceToolActivity = 0;
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

        case '2': // Metadata chunks (path_info, reasoning, intent_context, dev_tools_info, token_usage, events)
          try {
            const data =
              Array.isArray(chunk.data) && chunk.data.length > 0 ? chunk.data[0] : chunk.data;
            const innerType = data?.type;

            switch (innerType) {
              case 'path_info':
                yield { type: 'path_info', value: data };
                break;
              case 'token_usage':
                // token_usage contains summarization fields (thresholdReached, summary, etc.)
                // Yield as path_info so StreamProcessor stores it for summarization handling
                yield { type: 'path_info', value: data };
                // Also check for max tools reached condition
                if (data.maxToolsReached === true && !data.timedOut) {
                  yield { type: 'max_tools_reached', value: data };
                }
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
              case 'timeout_occurred':
                yield { type: 'timeout_occurred', value: data };
                break;
              case 'auto_retry':
                yield { type: 'auto_retry', value: data };
                break;
              case 'tool_validation_error':
                yield { type: 'tool_validation_error', value: data };
                break;
              case 'missing_tool':
                yield { type: 'missing_tool', value: data };
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

        case 'error':
          yield { type: 'error', value: chunk.data };
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

    let requestBody = this.prepareRequestBody(resolvedOptions);

    // Run beforeRequest hooks from all plugins (can modify the request)
    requestBody = await this.pluginManager.runBeforeRequest(requestBody);

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
      const decoder = new TextDecoder('utf-8');

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          if (this.debug) console.log(`[${new Date().toISOString()}] Stream complete`);
          // Process any remaining buffered line
          lineBuffer = lineBuffer.replace(/\r/g, '');
          if (lineBuffer.trim()) {
            if (this.debug)
              console.log(`[${new Date().toISOString()}] Processing final buffered line`);

            // Check for new SSE format in final buffer
            if (lineBuffer.startsWith('data: ')) {
              const payload = lineBuffer.substring(6);
              if (payload !== '[DONE]') {
                try {
                  const parsed = JSON.parse(payload);
                  const mapped = mapSSEEventToRawChunk(parsed, lineBuffer);
                  if (mapped) yield mapped;
                } catch (e) {
                  if (this.debug)
                    console.error(
                      `[${new Date().toISOString()}] Error parsing final SSE buffer:`,
                      e
                    );
                }
              }
            } else {
              // Old format
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
          }
          break;
        }

        const text = decoder.decode(value, { stream: true });
        if (this.debug) console.log(`[${new Date().toISOString()}] Raw stream data:`, text);

        // Prepend any buffered content from previous chunk
        const fullText = lineBuffer + text;
        const lines = fullText.split(/\r?\n/);

        // The last element might be incomplete if it doesn't end with \n
        // Save it for the next iteration
        lineBuffer = (text.endsWith('\n') || text.endsWith('\r\n')) ? '' : lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            // === NEW SSE FORMAT DETECTION ===
            // Lines starting with "data: " come from the new standard SSE format
            if (line.startsWith('data: ')) {
              const payload = line.substring(6); // strip "data: " prefix
              if (payload === '[DONE]') continue; // terminal marker

              try {
                const parsed = JSON.parse(payload);
                if (this.debug)
                  console.log(
                    `[${new Date().toISOString()}] SSE event type=${parsed.type}:`,
                    JSON.stringify(parsed)
                  );

                const mapped = mapSSEEventToRawChunk(parsed, line);
                if (mapped) {
                  yield mapped;
                } else if (this.debug) {
                  console.log(
                    `[${new Date().toISOString()}] Skipped SSE event type: ${parsed.type}`
                  );
                }
              } catch (e) {
                if (this.debug)
                  console.error(`[${new Date().toISOString()}] Error parsing SSE JSON payload:`, e);
                yield { prefix: 'error', data: payload, raw: line };
              }
              continue;
            }

            // === OLD AI SDK FORMAT (unchanged) ===
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
   * Get the current pay-as-you-go billing status.
   * Returns enabled state, payment token, debt balance, and available tokens.
   *
   * @returns A promise resolving to the PAYG status
   *
   * @example
   * ```typescript
   * const status = await client.getPaygStatus();
   * console.log(status.enabled, status.total_debt_usd);
   * ```
   */
  public async getPaygStatus(): Promise<PaygStatus> {
    const headers = await this.getHeaders();

    if (this.apiKey && this.vaultId) {
      headers['x-api-key'] = this.apiKey;
      headers['x-vault-id'] = this.vaultId;
    }

    const response = await this.fetchImpl(`${this.baseUrl}/api/payg`, {
      method: 'GET',
      headers,
      mode: 'cors',
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch PAYG status: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Configure pay-as-you-go billing — enable/disable, set mode, or change payment token.
   * All fields are optional; only the provided fields are updated.
   *
   * @param options - Configuration options
   * @returns A promise resolving to the updated configuration
   *
   * @example
   * ```typescript
   * // Enable PAYG with SOL payments
   * await client.configurePayg({ enabled: true, payment_token: 'SOL' });
   *
   * // Switch to debt accumulation mode
   * await client.configurePayg({ mode: 'debt_accumulation' });
   *
   * // Disable PAYG
   * await client.configurePayg({ enabled: false });
   * ```
   */
  public async configurePayg(options: PaygConfigureOptions): Promise<PaygConfigureResult> {
    const headers = await this.getHeaders();

    if (this.apiKey && this.vaultId) {
      headers['x-api-key'] = this.apiKey;
      headers['x-vault-id'] = this.vaultId;
    }

    const response = await this.fetchImpl(`${this.baseUrl}/api/payg`, {
      method: 'POST',
      headers,
      mode: 'cors',
      body: JSON.stringify(options),
    });

    if (!response.ok) {
      throw new Error(`Failed to configure PAYG: ${response.status} ${response.statusText}`);
    }

    return response.json();
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
    exactToolNames?: string[];
    ignoreOtherTools?: boolean;
    excludedTools?: string[];
    attachments?: Attachment[];
    trimIndex?: number;
    summary?: string;
    summaryEndIndex?: number;
    intentContext?: IntentContext;
    stubbedTools?: Record<string, StubbedToolConfig>;
    skipSessionMemory?: boolean;
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
        console.log(`[${new Date().toISOString()}] Calculated and stored trimIndex: ${trimIndex}`);
      }
    }

    if (this.debug && (trimIndex || summary || summaryEndIndex)) {
      console.log(
        `[${new Date().toISOString()}] Sending summarization fields: trimIndex=${trimIndex}, summaryEndIndex=${summaryEndIndex}, hasSummary=${!!summary}`
      );
    }

    // Get client tools from registered plugins
    const clientTools = this.pluginManager.getClientToolDefinitions();

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
      // Tool filtering options
      exactToolNames: options.exactToolNames,
      ignoreOtherTools: options.ignoreOtherTools,
      excludedTools: options.excludedTools,
      // Include client-side tool definitions from plugins
      clientTools: clientTools.length > 0 ? clientTools : undefined,
      trimIndex,
      summary,
      summaryEndIndex,
      // Pass intent context for auto-tools mode context persistence
      intentContext: options.intentContext,
      // Pass stubbed tools for testing (only in MCP mode)
      stubbedTools: options.stubbedTools,
      // Pass skipSessionMemory for isolated testing (only in MCP mode)
      skipSessionMemory: options.skipSessionMemory,
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
            : T extends 'stream_end'
              ? StreamEndEvent
              : T extends 'max_tools_reached'
                ? MaxToolsReachedEvent
                : T extends 'timeout'
                  ? TimeoutEvent
                  : T extends 'auto_retry'
                    ? AutoRetryEvent
                    : T extends 'tool_validation_error'
                      ? ToolValidationErrorEvent
                      : MissingToolEvent
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

  // ==========================================================================
  // Plugin System
  // ==========================================================================

  /**
   * Register a plugin to extend the client with client-side tools.
   *
   * Plugins can provide:
   * - Tool definitions (sent to server on each request)
   * - Tool executors (run client-side when server calls the tool)
   * - Lifecycle hooks (beforeRequest, afterResponse)
   *
   * @param plugin - The plugin to register
   * @returns The client instance for chaining
   *
   * @example
   * ```typescript
   * client.use({
   *   name: 'time-plugin',
   *   version: '1.0.0',
   *   tools: [{
   *     name: 'get_time',
   *     description: 'Get the current time',
   *     parameters: { type: 'object', properties: {} }
   *   }],
   *   executors: {
   *     get_time: async () => new Date().toISOString()
   *   }
   * });
   * ```
   */
  async use(plugin: HustlePlugin): Promise<this> {
    await this.pluginManager.register(plugin);
    return this;
  }

  /**
   * Unregister a plugin by name.
   *
   * @param pluginName - The name of the plugin to unregister
   * @returns The client instance for chaining
   */
  async unuse(pluginName: string): Promise<this> {
    await this.pluginManager.unregister(pluginName);
    return this;
  }

  /**
   * Check if a plugin is registered.
   *
   * @param pluginName - The name of the plugin to check
   * @returns True if the plugin is registered
   */
  hasPlugin(pluginName: string): boolean {
    return this.pluginManager.hasPlugin(pluginName);
  }

  /**
   * Get all registered plugin names.
   *
   * @returns Array of registered plugin names
   */
  getPluginNames(): string[] {
    return this.pluginManager.getPluginNames();
  }

  /**
   * Get all client tool definitions from registered plugins.
   * These are automatically included in chat requests.
   *
   * @returns Array of client tool definitions
   */
  getClientToolDefinitions(): ClientToolDefinition[] {
    return this.pluginManager.getClientToolDefinitions();
  }

  /**
   * Emit an event to all registered listeners.
   * @private
   */
  private emit(event: HustleEvent): void {
    const listeners = this.eventListeners.get(event.type);
    if (listeners) {
      listeners.forEach(listener => {
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
        console.log(`[${new Date().toISOString()}] Received conversation summary from server`);
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
  private calculateTrimIndex(messages: ChatMessage[], keepLastUserMessages: number = 1): number {
    // Filter out system messages for counting
    const nonSystemMessages = messages.filter(msg => msg.role !== 'system');
    const userIndices = nonSystemMessages
      .map((msg, idx) => (msg.role === 'user' ? idx : -1))
      .filter(idx => idx !== -1);

    // Keep last N user messages and all messages after them
    const keepFromIndex =
      userIndices.length > keepLastUserMessages
        ? userIndices[userIndices.length - keepLastUserMessages]
        : 0;

    // Find the actual index in the full messages array
    let nonSystemCount = 0;
    let calculatedTrimIndex = 0;

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      if (message && message.role !== 'system') {
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
