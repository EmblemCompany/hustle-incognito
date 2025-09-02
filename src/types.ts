// src/types.ts

/**
 * Configuration options for the HustleIncognitoClient.
 */
export interface HustleIncognitoClientOptions {
  /** The base URL of the Agent Hustle API. Defaults to production API URL. */
  hustleApiUrl?: string;
  /** The API key for authenticating requests. */
  apiKey: string;
  /** Optional user key for user-specific context or authentication. */
  userKey?: string;
  /** Optional user secret associated with the user key. */
  userSecret?: string;
  /** Optional fetch implementation for environments without native fetch. */
  fetch?: typeof fetch;
  /** Enable debug logging. */
  debug?: boolean;
  /** Optional cookie for authentication with Vercel. */
  cookie?: string;
}

export interface ChatOptions {
  vaultId: string;
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
}

/**
 * Options for streaming API requests.
 */
export interface StreamOptions {
  /** Required vault ID for the context */
  vaultId: string;
  /** Messages to send to the AI */
  messages: ChatMessage[];
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
}

export interface RawStreamOptions {
  vaultId: string;
  messages: ChatMessage[];
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
}



/**
 * The request payload sent to the Agent Hustle API.
 */
export interface HustleRequest {
  /** Unique ID for the chat session */
  id: string;
  /** API key for authentication */
  apiKey: string;
  /** Messages to send to the AI */
  messages: ChatMessage[];
  /** Vault ID for context */
  vaultId: string;
  /** Optional wallet address for blockchain operations */
  externalWalletAddress?: string;
  /** Slippage settings for operations */
  slippageSettings?: Record<string, number>;
  /** Safety mode toggle */
  safeMode?: boolean;
  /** Current path info */
  currentPath?: string | null;
  /** Optional attachments for the conversation */
  attachments?: any[];
  /**
   * ids of tool categories to use
   * eg: ['solana-token-ecosystem', 'standard-tools']
   * @see {ToolCategory}
   */
  selectedToolCategories?: string[];
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
  /** The content of the response */
  content: string;
  /** The message ID if provided */
  messageId: string | null;
  /** Token usage information */
  usage: any | null;
  /** Path information */
  pathInfo: any | null;
  /** Tool calls made during the conversation */
  toolCalls: any[];
  /** Results from tool calls */
  toolResults: any[];
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
  /** The name of the tool to call. */
  name: string;
  /** The arguments to pass to the tool. */
  arguments: Record<string, unknown>;
  /** Optional ID for the tool call. */
  id?: string;
}

/**
 * The result of a tool execution.
 */
export interface ToolResult {
  /** The ID of the tool call. */
  toolCallId: string;
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
  type: "analyst" | "trader";
  /** Whether this tool category requires a premium subscription */
  premium?: boolean;
}