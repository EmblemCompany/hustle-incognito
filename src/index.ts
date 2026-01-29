// src/index.ts

// Export the client class
export { HustleIncognitoClient } from './client.js';

// Export plugin manager
export {
  PluginManager,
  type PluginSecurityEvent,
  type PluginSecurityEventType,
  type PluginSecurityEventListener,
} from './plugins.js';

// Export security module
export {
  // Configuration
  configurePluginSecurity,
  getSecurityConfig,
  resetSecurityConfig,
  // Verification
  verifyPluginCode,
  serializePluginCode,
  isTrustedBuiltin,
  TRUSTED_BUILTINS,
  // HMAC signing (development)
  signCodeHmac,
  verifySignatureHmac,
  // Ed25519 signing (production)
  generateEd25519Keypair,
  signCodeEd25519,
  verifySignatureEd25519,
  // Convenience
  signPluginCode,
  // Types
  type SecurityConfig,
  type VerificationResult,
  type SecurePlugin,
} from './security/pluginSecurity.js';

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
  // Plugin types
  HustlePlugin,
  ClientToolDefinition,
  ClientToolOptions,
  ToolExecutor,
  JSONSchemaProperty,
  // Security types
  PluginSecurityConfig,
  // Testing types
  StubbedToolConfig,
} from './types.js';
