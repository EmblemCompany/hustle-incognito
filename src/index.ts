// src/index.ts

// Export the client class
export { HustleIncognitoClient } from './client.js';

// Export types
export {
  EmblemAuthProvider,
  HustleIncognitoClientOptions,
  ChatMessage,
  StreamChunk,
  StreamWithResponse,
  HustleRequest,
  StreamOptions,
  ProcessedResponse,
  RawChunk,
  VaultInfo,
  Model,
  // New metadata types
  TokenUsage,
  IntentContext,
  ReasoningInfo,
  IntentContextInfo,
  DevToolsInfo,
  PathInfo,
  ToolCall,
  ToolResult,
  // Event types
  HustleEventType,
  HustleEvent,
  HustleEventListener,
  ToolStartEvent,
  ToolEndEvent,
  StreamStartEvent,
  StreamEndEvent,
  // Summarization
  SummarizationState,
} from './types.js';
