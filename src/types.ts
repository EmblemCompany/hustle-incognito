// src/types.ts

/**
 * Vault information returned from the API.
 */
export interface VaultInfo {
  vaultId: string;
  evmAddress?: string;
  solanaAddress?: string;
  address?: string;
}

/**
 * Token usage statistics from the API response.
 */
export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  // Alternative property names the API might use
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

/**
 * Intent context that persists across conversation turns.
 * Enables follow-up messages to maintain context (e.g., "buy that" knows which network you were on).
 */
export interface IntentContext {
  /** Blockchain networks relevant to the current intent (e.g., ["solana", "ethereum"]) */
  networks: string[];
  /** Tool categories relevant to the current intent (e.g., ["required", "polymarket"]) */
  categories: string[];
  /** Human-readable description of the active intent */
  activeIntent?: string;
  /** Number of conversation turns since the intent was last updated */
  turnsSinceUpdate: number;
  /** Confidence score of the last intent detection (0-1) */
  lastConfidence: number;
}

/**
 * Reasoning information from the LLM about tool/category selection.
 * Explains why certain tool categories were chosen for the request.
 */
export interface ReasoningInfo {
  type: 'reasoning';
  /** The LLM's explanation for its tool selection decision */
  thinking: string;
  /** Blockchain networks identified in the request */
  networks: string[];
  /** Tool categories selected for this request */
  categories: string[];
  /** Human-readable description of the detected intent */
  activeIntent?: string;
  /** Confidence score for this reasoning (0-1) */
  confidence: number;
  /** ISO timestamp when this reasoning was generated */
  timestamp?: string;
}

/**
 * Intent context detection information from the API.
 * Contains the persisted intent context and detection metadata.
 */
export interface IntentContextInfo {
  type: 'intent_context';
  /** The persisted intent context for this conversation */
  intentContext: IntentContext;
  /** Tool categories that qualified based on intent */
  categories: string[];
  /** Confidence score for this detection (0-1) */
  confidence: number;
  /** The reasoning behind this intent detection */
  reasoning?: string;
  /** Whether a sticky fallback category was applied */
  stickyFallbackApplied?: boolean;
  /** ISO timestamp when this was generated */
  timestamp?: string;
}

/**
 * Developer tools information showing which tools were loaded.
 * Instead of loading all 200+ tools, only relevant ones are loaded based on user intent.
 */
export interface DevToolsInfo {
  type: 'dev_tools_info';
  /** Tool categories that qualified for this request */
  qualifiedCategories: string[];
  /** Names of tools that were actually loaded and available */
  availableTools: string[];
  /** Total count of loaded tools */
  toolCount: number;
  /** ISO timestamp when this was generated */
  timestamp?: string;
  /** The reasoning behind tool qualification */
  reasoning?: string;
}

/**
 * Path/token usage information from the streaming response.
 * Provides detailed token consumption and cost tracking.
 */
export interface PathInfo {
  type?: string;
  /** Human-readable message about token usage */
  message?: string;
  /** Path identifier (e.g., "PATH_1") */
  path?: string;
  /** Number of input tokens used */
  tokensIn?: number;
  /** Number of output tokens used */
  tokensOut?: number;
  /** Number of cached tokens used */
  cachedTokens?: number;
  /** Total tokens for this request */
  totalTokens?: number;
  /** Token threshold for summarization */
  threshold?: number;
  /** Whether the token threshold was reached */
  thresholdReached?: boolean;
  /** Number of messages retained after summarization */
  messageRetentionCount?: number;
  /** Estimated cost in USD */
  costUsd?: number;
  /** Number of tools executed */
  toolsExecuted?: number;
  /** Maximum allowed steps */
  maxSteps?: number;
  /** Whether maximum tools limit was reached */
  maxToolsReached?: boolean;
  /** Whether the request timed out */
  timedOut?: boolean;
  /** ISO timestamp */
  timestamp?: string;
  /** Reasoning for path selection */
  reasoning?: string;
  /** Summary of older conversation turns (sent when thresholdReached is true) */
  summary?: string;
  /** Index in original message array where the summary ends */
  summaryEndIndex?: number;
}

/**
 * Authentication provider interface compatible with EmblemAuthSDK.
 * Supports multiple authentication methods with priority:
 * 1. getAuthHeaders() - Custom auth headers (highest priority)
 * 2. apiKey - Traditional x-api-key header
 * 3. jwt / getJwt() / sdk - Bearer token authentication
 */
export type EmblemAuthProvider = {
  /** Static JWT token for authentication */
  jwt?: string;
  /** Dynamic JWT getter function */
  getJwt?: () => Promise<string | null | undefined> | string | null | undefined;
  /** Custom auth headers getter */
  getAuthHeaders?: () => Promise<Record<string, string>> | Record<string, string>;
  /**
   * EmblemAuthSDK instance or compatible object with getSession() method.
   * The session should have an authToken property.
   */
  sdk?: {
    getSession: () =>
      | { authToken?: string | null | undefined; user?: { vaultId?: string } }
      | null
      | undefined;
    getVaultApiKey?: () => Promise<string>;
    getVaultInfo?: () => Promise<VaultInfo>;
  };
};

/**
 * An attachment that can be sent along with a message.
 */
export interface Attachment {
  /**
   * The name of the attachment, usually the file name.
   */
  name?: string;
  /**
   * A string indicating the media type.
   * By default, it's extracted from the pathname's extension.
   */
  contentType?: string;
  /**
   * The URL of the attachment. It can either be a URL to a hosted file or a Data URL.
   */
  url: string;
}

/**
 * Configuration options for the HustleIncognitoClient.
 *
 * Authentication can be provided via:
 * - apiKey: Traditional API key (simplest, for server-side use)
 * - sdk: EmblemAuthSDK instance - uses JWT from session with auto-refresh (recommended for browser apps)
 * - jwt: Static JWT token
 * - getJwt: Dynamic JWT getter function
 *
 * At least one authentication method must be provided.
 * When using SDK auth, the JWT is fetched fresh on each request to handle session refresh.
 */
export interface HustleIncognitoClientOptions extends EmblemAuthProvider {
  /** The base URL of the Agent Hustle API. Defaults to production API URL. */
  hustleApiUrl?: string;
  /** The API key for authenticating requests. */
  apiKey?: string;
  /** The vault ID for API key authentication. Can also be set via VAULT_ID env var. */
  vaultId?: string;
  /** Optional user key for user-specific context or authentication. */
  userKey?: string;
  /** Optional user secret associated with the user key. */
  userSecret?: string;
  /** Optional fetch implementation for environments without native fetch. */
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  /** Enable debug logging. */
  debug?: boolean;
  /** Optional cookie for authentication with Vercel. */
  cookie?: string;
}

export interface ChatOptions {
  /** Vault ID for context. Required when using API key auth, optional with JWT/SDK auth (will be auto-fetched). */
  vaultId?: string;
  /** Model ID to use (e.g., 'anthropic/claude-sonnet-4'). Only valid when isMCP is true. */
  model?: string;
  /** Override the server-provided system prompt. When true, only user-provided system prompts are used. */
  overrideSystemPrompt?: boolean;
  userApiKey?: string;
  externalWalletAddress?: string;
  slippageSettings?: Record<string, number>;
  safeMode?: boolean;
  rawResponse?: boolean;
  /**
   * ids of tool categories to use
   * eg: ['solana-token-ecosystem', 'standard-tools']
   * @see {ToolCategory}
   */
  selectedToolCategories?: string[];
  /** Optional attachments for the conversation */
  attachments?: Attachment[];
  /** Index to trim messages at for context management */
  trimIndex?: number;
  /** Existing summary from previous response to pass back */
  summary?: string;
  /** Index where the previous summary ends */
  summaryEndIndex?: number;
}

/**
 * Options for streaming API requests.
 */
export interface StreamOptions {
  /** Vault ID for context. Required when using API key auth, optional with JWT/SDK auth (will be auto-fetched). */
  vaultId?: string;
  /** Messages to send to the AI */
  messages: ChatMessage[];
  /** Model ID to use (e.g., 'anthropic/claude-sonnet-4'). Only valid when isMCP is true. */
  model?: string;
  /** Override the server-provided system prompt. When true, only user-provided system prompts are used. */
  overrideSystemPrompt?: boolean;
  /** Optional user-specific API key */
  userApiKey?: string;
  /** Optional wallet address for blockchain operations */
  externalWalletAddress?: string;
  /** Optional slippage settings for operations */
  slippageSettings?: Record<string, number>;
  /** Optional safety mode toggle */
  safeMode?: boolean;
  /** Optional current path info */
  currentPath?: string | null;
  /** Whether to process stream chunks into structured data */
  processChunks?: boolean;
  /**
   * ids of tool categories to use
   * eg: ['solana-token-ecosystem', 'standard-tools']
   * @see {ToolCategory}
   */
  selectedToolCategories?: string[];
  /** Optional attachments for the conversation */
  attachments?: Attachment[];
  /** Index to trim messages at for context management */
  trimIndex?: number;
  /** Existing summary from previous response to pass back */
  summary?: string;
  /** Index where the previous summary ends */
  summaryEndIndex?: number;
  /**
   * Maximum number of automatic tool execution rounds.
   * When the server returns finishReason: "tool-calls" for client-side tools,
   * the SDK will execute them and send results back as a new turn.
   * Set to 0 to disable auto-execution (manual handling required).
   * @default 5
   */
  maxToolRounds?: number;
  /**
   * Optional callback for custom tool execution.
   * If provided, this is called instead of the plugin manager's executor.
   * Useful for custom handling or logging.
   */
  onToolCall?: (toolCall: ToolCall) => Promise<unknown>;
}

export interface RawStreamOptions {
  /** Vault ID for context. Required when using API key auth, optional with JWT/SDK auth (will be auto-fetched). */
  vaultId?: string;
  messages: ChatMessage[];
  /** Model ID to use (e.g., 'anthropic/claude-sonnet-4'). Only valid when isMCP is true. */
  model?: string;
  /** Override the server-provided system prompt. When true, only user-provided system prompts are used. */
  overrideSystemPrompt?: boolean;
  userApiKey?: string;
  externalWalletAddress?: string;
  slippageSettings?: Record<string, number>;
  safeMode?: boolean;
  currentPath?: string | null;
  /**
   * ids of tool categories to use
   * eg: ['solana-token-ecosystem', 'standard-tools']
   * @see {ToolCategory}
   */
  selectedToolCategories?: string[];
  /** Optional attachments for the conversation */
  attachments?: Attachment[];
  /** Index to trim messages at for context management */
  trimIndex?: number;
  /** Existing summary from previous response to pass back */
  summary?: string;
  /** Index where the previous summary ends */
  summaryEndIndex?: number;
}

/**
 * The request payload sent to the Agent Hustle API.
 */
export interface HustleRequest {
  /** Unique ID for the chat session */
  id: string;
  /** API key for authentication (optional when using JWT auth) */
  apiKey?: string;
  /** Messages to send to the AI */
  messages: ChatMessage[];
  /** Vault ID for context */
  vaultId: string;
  /** Model ID to use (e.g., 'anthropic/claude-sonnet-4'). Only used when isMCP is true. */
  model?: string;
  /** Override the server-provided system prompt. When true, only user-provided system prompts are used. */
  overrideSystemPrompt?: boolean;
  /** Optional wallet address for blockchain operations */
  externalWalletAddress?: string;
  /** Slippage settings for operations */
  slippageSettings?: Record<string, number>;
  /** Safety mode toggle */
  safeMode?: boolean;
  /** Current path info */
  currentPath?: string | null;
  /** Optional attachments for the conversation */
  attachments?: Attachment[];
  /**
   * ids of tool categories to use
   * eg: ['solana-token-ecosystem', 'standard-tools']
   * @see {ToolCategory}
   */
  selectedToolCategories?: string[];
  /**
   * Client-side tool definitions to register with the server.
   * Server will register these without execute functions.
   * @see {ClientToolDefinition}
   */
  clientTools?: ClientToolDefinition[];
  /** Index to trim messages at for context management */
  trimIndex?: number;
  /** Existing summary from previous response to pass back */
  summary?: string;
  /** Index where the previous summary ends */
  summaryEndIndex?: number;
}

/**
 * A raw stream chunk from the API before processing.
 */
export interface RawChunk {
  /** The prefix character identifying the chunk type */
  prefix: string;
  /** The data content of the chunk */
  data: any;
  /** The raw line from the stream */
  raw: string;
}

/**
 * A processed response object assembled from stream chunks.
 */
export interface ProcessedResponse {
  /** The text content of the response */
  content: string;
  /** The unique message ID if provided */
  messageId: string | null;
  /** Token usage statistics */
  usage: TokenUsage | null;
  /** Path/token usage information with cost tracking */
  pathInfo: PathInfo | null;
  /** Tool calls made during the conversation */
  toolCalls: ToolCall[];
  /** Results from tool executions */
  toolResults: ToolResult[];
  /** LLM reasoning about tool/category selection */
  reasoning: ReasoningInfo | null;
  /** Persisted intent context for follow-up messages */
  intentContext: IntentContextInfo | null;
  /** Information about which tools were loaded for this request */
  devToolsInfo: DevToolsInfo | null;
}

/**
 * A message to be sent to or received from the API.
 */
export interface ChatMessage {
  /** The role of the message sender. */
  role: 'user' | 'assistant' | 'system' | 'tool';
  /** The content of the message. */
  content: string;
  /** Optional name to identify the sender. */
  name?: string;
  /** Optional parts for structured content. */
  parts?: MessagePart[];
  /** Optional experimental attachments for the message. */
  experimental_attachments?: Array<{
    contentType: string;
    name: string;
    url: string;
  }>;
}

/**
 * A part of a structured message.
 */
export interface MessagePart {
  /** The type of message part. */
  type: 'text' | 'image' | 'file';
  /** The text content if type is 'text'. */
  text?: string;
  /** The file URL if type is 'image' or 'file'. */
  url?: string;
  /** The attachment ID if type is 'image' (for experimental_attachments). */
  id?: string;
}

/**
 * A request to the chat API.
 */
export interface ChatRequest {
  /** The messages to be sent. */
  messages: ChatMessage[];
  /** Whether to stream the response. */
  stream: boolean;
  /** Optional session ID for continuity. */
  session_id?: string;
  /** Optional metadata. */
  metadata?: Record<string, unknown>;
}

/**
 * A response from the chat API.
 */
export interface ChatResponse {
  /** The content of the response. */
  content: string;
  /** Optional session ID. */
  session_id?: string;
  /** Optional metadata about the response. */
  metadata?: Record<string, unknown>;
  /** Optional token usage statistics. */
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * A tool call sent from the agent to the client.
 */
export interface ToolCall {
  /** Unique ID for this tool call */
  toolCallId?: string;
  /** @deprecated Use toolCallId instead */
  id?: string;
  /** The name of the tool being called */
  toolName?: string;
  /** @deprecated Use toolName instead */
  name?: string;
  /** Arguments passed to the tool */
  args?: Record<string, unknown>;
  /** @deprecated Use args instead */
  arguments?: Record<string, unknown>;
}

/**
 * The result of a tool execution.
 */
export interface ToolResult {
  /** The ID of the tool call. */
  toolCallId: string;
  /** @deprecated Use toolCallId instead */
  id?: string;
  /** The name of the tool that was called. */
  toolName?: string;
  /** @deprecated Use toolName instead */
  name?: string;
  /** The result of the tool execution. */
  result: unknown;
}

/**
 * A chunk from the streaming API.
 */
export interface StreamChunk {
  /** The type of chunk. */
  type:
    | 'text'
    | 'tool_call'
    | 'tool_call_delta'
    | 'tool_result'
    | 'message_id'
    | 'path_info'
    | 'reasoning'
    | 'intent_context'
    | 'dev_tools_info'
    | 'error'
    | 'finish'
    | 'unknown';
  /** The value of the chunk. */
  value:
    | string
    | ToolCall
    | Partial<ToolCall>
    | ToolResult
    | {
        reason: string;
        usage?: {
          prompt_tokens: number;
          completion_tokens: number;
          total_tokens: number;
        };
      }
    | any; // For other types like path_info, message_id, etc.
}

/**
 * A streaming response that provides both real-time chunks and aggregated ProcessedResponse.
 * Implements AsyncIterable so existing for-await loops continue to work (non-breaking).
 *
 * @example
 * // Existing usage still works
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
export interface StreamWithResponse extends AsyncIterable<StreamChunk | RawChunk> {
  /**
   * Promise that resolves to the aggregated ProcessedResponse after streaming completes.
   * Contains all accumulated data: content, toolCalls, toolResults, pathInfo, usage, messageId.
   */
  response: Promise<ProcessedResponse>;
}

/**
 * Represents an error response from the API.
 */
export interface ApiError {
  /** The error message. */
  message: string;
  /** Optional details about the error. */
  details?: unknown;
}

export interface ToolCategory {
  /** Unique identifier for the tool category */
  id: string;
  /** Human-readable name of the tool category */
  title: string;
  /** Detailed description of what this tool category provides */
  description: string;
  /** Example use cases or queries that would trigger this tool category */
  examples: string[];
  /** UI color theme for this category */
  color: string;
  /** Whether this is primarily an analyst or trader focused tool */
  type: 'analyst' | 'trader';
  /** Whether this tool category requires a premium subscription */
  premium?: boolean;
}

/**
 * Model pricing information from OpenRouter.
 */
export interface ModelPricing {
  /** Price per prompt token (as string for precision) */
  prompt: string;
  /** Price per completion token (as string for precision) */
  completion: string;
  /** Optional price per image */
  image?: string;
  /** Optional price per request */
  request?: string;
}

/**
 * Model information from the /api/models endpoint.
 * Based on OpenRouter's model format.
 */
export interface Model {
  /** Unique model identifier (e.g., "anthropic/claude-sonnet-4") */
  id: string;
  /** Human-readable model name */
  name: string;
  /** Maximum context length in tokens */
  context_length: number;
  /** Pricing information */
  pricing: ModelPricing;
  /** Model architecture details */
  architecture?: {
    modality?: string;
    tokenizer?: string;
    instruct_type?: string;
  };
  /** Top provider information */
  top_provider?: {
    context_length?: number;
    max_completion_tokens?: number;
    is_moderated?: boolean;
  };
  /** Per-request token limits */
  per_request_limits?: {
    prompt_tokens?: string;
    completion_tokens?: string;
  } | null;
}

/**
 * Event types emitted by the HustleIncognitoClient.
 */
export type HustleEventType = 'tool_start' | 'tool_end' | 'stream_start' | 'stream_end';

/**
 * Event data for tool_start event.
 */
export interface ToolStartEvent {
  type: 'tool_start';
  toolCallId: string;
  toolName: string;
  args?: Record<string, unknown>;
}

/**
 * Event data for tool_end event.
 */
export interface ToolEndEvent {
  type: 'tool_end';
  toolCallId: string;
  toolName?: string;
  result: unknown;
}

/**
 * Event data for stream_start event.
 */
export interface StreamStartEvent {
  type: 'stream_start';
}

/**
 * Event data for stream_end event.
 */
export interface StreamEndEvent {
  type: 'stream_end';
  response: ProcessedResponse;
}

/**
 * Union type for all event data.
 */
export type HustleEvent = ToolStartEvent | ToolEndEvent | StreamStartEvent | StreamEndEvent;

/**
 * Event listener callback type.
 */
export type HustleEventListener<T extends HustleEvent = HustleEvent> = (event: T) => void;

/**
 * Internal state for conversation summarization.
 * Tracks when the server indicates threshold is reached and stores summary data
 * to automatically send back on subsequent requests.
 */
export interface SummarizationState {
  /** Whether the token threshold was reached and summarization is needed */
  thresholdReached: boolean;
  /** Number of user messages to retain (from server) - used to calculate trimIndex */
  messageRetentionCount?: number;
  /** The calculated index at which to trim messages (calculated from messageRetentionCount) */
  trimIndex?: number;
  /** Summary text from the server to send back */
  summary?: string;
  /** Index where the summary ends in the message array */
  summaryEndIndex?: number;
}

// =============================================================================
// Plugin System Types
// =============================================================================

/**
 * JSON Schema property definition for client tool parameters.
 */
export interface JSONSchemaProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null';
  description?: string;
  enum?: (string | number | boolean)[];
  items?: JSONSchemaProperty;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
  default?: unknown;
}

/**
 * Client-side tool definition sent to the server.
 * Server registers these with schema only (no execute function).
 */
export interface ClientToolDefinition {
  /** Unique tool name (alphanumeric + underscore) */
  name: string;
  /** Description shown to the AI model */
  description: string;
  /** JSON Schema for tool parameters */
  parameters: {
    type: 'object';
    properties: Record<string, JSONSchemaProperty>;
    required?: string[];
  };
}

/**
 * Function that executes a client-side tool.
 */
export type ToolExecutor<T = Record<string, unknown>, R = unknown> = (args: T) => R | Promise<R>;

/**
 * Plugin interface for extending HustleIncognitoClient with client-side tools.
 *
 * @example
 * ```typescript
 * const myPlugin: HustlePlugin = {
 *   name: 'my-plugin',
 *   version: '1.0.0',
 *   tools: [{
 *     name: 'get_time',
 *     description: 'Get current time',
 *     parameters: { type: 'object', properties: {} }
 *   }],
 *   executors: {
 *     get_time: async () => new Date().toISOString()
 *   }
 * };
 *
 * client.use(myPlugin);
 * ```
 */
export interface HustlePlugin {
  /** Unique plugin identifier */
  name: string;

  /** Plugin version (semver recommended) */
  version: string;

  /** Tool definitions this plugin provides */
  tools?: ClientToolDefinition[];

  /** Tool executors keyed by tool name */
  executors?: Record<string, ToolExecutor>;

  /** Lifecycle hooks */
  hooks?: {
    /**
     * Called when plugin is registered via client.use().
     * Use for initialization, validation, or setup.
     */
    onRegister?: () => void | Promise<void>;

    /**
     * Called before each chat request.
     * Can modify the request (e.g., add context, filter messages).
     */
    beforeRequest?: (request: HustleRequest) => HustleRequest | Promise<HustleRequest>;

    /**
     * Called after receiving a complete response.
     * Use for logging, analytics, or side effects.
     */
    afterResponse?: (response: ProcessedResponse) => void | Promise<void>;

    /**
     * Called when plugin is unregistered.
     * Use for cleanup.
     */
    onUnregister?: () => void | Promise<void>;
  };
}

/**
 * Options for client-side tool handling during chat.
 */
export interface ClientToolOptions {
  /**
   * Maximum automatic tool execution rounds.
   * Prevents infinite loops when tools keep calling each other.
   * @default 5
   */
  maxToolRounds?: number;

  /**
   * Custom callback for executing client-side tools.
   * If provided, takes precedence over plugin executors.
   */
  onToolCall?: (toolCall: ToolCall) => Promise<unknown>;
}
