// src/plugins.ts
import type {
  ClientToolDefinition,
  HustlePlugin,
  HustleRequest,
  ProcessedResponse,
  ToolCall,
  ToolExecutor,
  PluginSecurityConfig,
} from './types';
import {
  verifyPluginCode,
  serializePluginCode,
  type SecurityConfig,
  type VerificationResult,
} from './security/pluginSecurity';

/**
 * Validates a tool name follows allowed pattern.
 * Must be alphanumeric with underscores, 1-64 chars.
 */
function isValidToolName(name: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(name);
}

/**
 * Validates a plugin has required fields and valid structure.
 */
function validatePlugin(plugin: HustlePlugin): void {
  if (!plugin.name || typeof plugin.name !== 'string') {
    throw new Error('Plugin must have a name');
  }

  if (!plugin.version || typeof plugin.version !== 'string') {
    throw new Error(`Plugin "${plugin.name}" must have a version`);
  }

  // Validate tool names
  if (plugin.tools) {
    for (const tool of plugin.tools) {
      if (!isValidToolName(tool.name)) {
        throw new Error(
          `Plugin "${plugin.name}": Invalid tool name "${tool.name}". ` +
            'Must start with a letter and contain only alphanumeric characters and underscores (max 64 chars).'
        );
      }

      if (!tool.description || typeof tool.description !== 'string') {
        throw new Error(`Plugin "${plugin.name}": Tool "${tool.name}" must have a description`);
      }

      if (!tool.parameters || tool.parameters.type !== 'object') {
        throw new Error(
          `Plugin "${plugin.name}": Tool "${tool.name}" parameters must be an object schema`
        );
      }
    }
  }

  // Validate executors reference valid tools
  if (plugin.executors && plugin.tools) {
    const toolNames = new Set(plugin.tools.map(t => t.name));
    for (const executorName of Object.keys(plugin.executors)) {
      if (!toolNames.has(executorName)) {
        throw new Error(
          `Plugin "${plugin.name}": Executor "${executorName}" has no matching tool definition`
        );
      }
    }
  }
}

/**
 * Event types emitted by PluginManager for security operations
 */
export type PluginSecurityEventType =
  | 'plugin_verification_success'
  | 'plugin_verification_failed'
  | 'plugin_verification_skipped';

export interface PluginSecurityEvent {
  type: PluginSecurityEventType;
  pluginName: string;
  result: VerificationResult;
  timestamp: number;
}

export type PluginSecurityEventListener = (event: PluginSecurityEvent) => void;

/**
 * Manages plugins and their lifecycle for HustleIncognitoClient.
 *
 * Responsibilities:
 * - Register/unregister plugins
 * - Collect tool definitions from all plugins
 * - Execute client-side tools via plugin executors
 * - Run lifecycle hooks (beforeRequest, afterResponse)
 * - Verify plugin signatures before registration (security)
 */
export class PluginManager {
  private plugins: Map<string, HustlePlugin> = new Map();
  private toolDefinitions: Map<string, ClientToolDefinition> = new Map();
  private toolExecutors: Map<string, ToolExecutor> = new Map();
  private toolToPlugin: Map<string, string> = new Map(); // toolName -> pluginName
  private debug: boolean;
  private securityConfig: SecurityConfig;
  private securityListeners: Set<PluginSecurityEventListener> = new Set();

  constructor(options: { debug?: boolean; security?: PluginSecurityConfig } = {}) {
    this.debug = options.debug ?? false;
    // Convert PluginSecurityConfig to internal SecurityConfig format
    // NOTE: skipVerification defaults to TRUE for backwards compatibility.
    // To enable security verification, set skipVerification: false explicitly.
    this.securityConfig = {
      skipVerification: options.security?.skipVerification ?? true, // Default: skip for backwards compat
      allowTrustedBuiltins: options.security?.allowTrustedBuiltins ?? true,
      trustedBuiltins: options.security?.trustedBuiltins,
      customVerifier: options.security?.customVerifier,
      algorithm: options.security?.algorithm ?? 'hmac',
      publicKey: options.security?.publicKey,
      emitEvents: true,
    };
  }

  /**
   * Subscribe to security events
   */
  onSecurityEvent(listener: PluginSecurityEventListener): () => void {
    this.securityListeners.add(listener);
    return () => this.securityListeners.delete(listener);
  }

  /**
   * Emit a security event to all listeners
   */
  private emitSecurityEvent(
    type: PluginSecurityEventType,
    pluginName: string,
    result: VerificationResult
  ): void {
    const event: PluginSecurityEvent = {
      type,
      pluginName,
      result,
      timestamp: Date.now(),
    };
    for (const listener of this.securityListeners) {
      try {
        listener(event);
      } catch (err) {
        if (this.debug) {
          console.error('[PluginManager] Security event listener error:', err);
        }
      }
    }
  }

  /**
   * Update security configuration
   */
  setSecurityConfig(config: Partial<PluginSecurityConfig>): void {
    this.securityConfig = {
      ...this.securityConfig,
      skipVerification: config.skipVerification ?? this.securityConfig.skipVerification,
      allowTrustedBuiltins: config.allowTrustedBuiltins ?? this.securityConfig.allowTrustedBuiltins,
      trustedBuiltins: config.trustedBuiltins ?? this.securityConfig.trustedBuiltins,
      customVerifier: config.customVerifier ?? this.securityConfig.customVerifier,
      algorithm: config.algorithm ?? this.securityConfig.algorithm,
      publicKey: config.publicKey ?? this.securityConfig.publicKey,
    };
  }

  /**
   * Get current security configuration
   */
  getSecurityConfig(): SecurityConfig {
    return { ...this.securityConfig };
  }

  /**
   * Register a plugin with the manager.
   * Validates the plugin, verifies its signature, and calls its onRegister hook.
   *
   * @throws Error if plugin validation fails
   * @throws Error if plugin is already registered
   * @throws Error if tool name conflicts with existing plugin
   * @throws Error if signature verification fails (when security is enabled)
   */
  async register(plugin: HustlePlugin): Promise<void> {
    // Validate plugin structure
    validatePlugin(plugin);

    // Check for duplicate plugin
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already registered`);
    }

    // =========================================================================
    // Security: Verify plugin signature before registration
    // =========================================================================
    const serializedCode = serializePluginCode(plugin);
    const verificationResult = await verifyPluginCode(
      plugin.name,
      serializedCode,
      plugin.signature,
      this.securityConfig
    );

    if (this.debug) {
      console.log(
        `[PluginManager] Security verification for "${plugin.name}": ${verificationResult.reason}`
      );
    }

    // Emit security event
    if (verificationResult.verified) {
      if (verificationResult.reason === 'skip_verification') {
        this.emitSecurityEvent('plugin_verification_skipped', plugin.name, verificationResult);
      } else {
        this.emitSecurityEvent('plugin_verification_success', plugin.name, verificationResult);
      }
    } else {
      this.emitSecurityEvent('plugin_verification_failed', plugin.name, verificationResult);
      throw new Error(
        `Plugin "${plugin.name}" failed security verification: ${verificationResult.error || verificationResult.reason}`
      );
    }
    // =========================================================================

    // Check for tool name conflicts
    if (plugin.tools) {
      for (const tool of plugin.tools) {
        const existingPlugin = this.toolToPlugin.get(tool.name);
        if (existingPlugin) {
          throw new Error(
            `Plugin "${plugin.name}": Tool "${tool.name}" conflicts with tool from plugin "${existingPlugin}"`
          );
        }
      }
    }

    // Register tools
    if (plugin.tools) {
      for (const tool of plugin.tools) {
        this.toolDefinitions.set(tool.name, tool);
        this.toolToPlugin.set(tool.name, plugin.name);
      }
    }

    // Register executors
    if (plugin.executors) {
      for (const [name, executor] of Object.entries(plugin.executors)) {
        this.toolExecutors.set(name, executor);
      }
    }

    // Store plugin
    this.plugins.set(plugin.name, plugin);

    // Call onRegister hook
    if (plugin.hooks?.onRegister) {
      await plugin.hooks.onRegister();
    }

    if (this.debug) {
      console.log(`[PluginManager] Registered plugin: ${plugin.name}@${plugin.version}`);
      if (plugin.tools?.length) {
        console.log(`  Tools: ${plugin.tools.map(t => t.name).join(', ')}`);
      }
    }
  }

  /**
   * Unregister a plugin by name.
   * Calls its onUnregister hook and removes all its tools.
   */
  async unregister(pluginName: string): Promise<void> {
    const plugin = this.plugins.get(pluginName);
    if (!plugin) {
      throw new Error(`Plugin "${pluginName}" is not registered`);
    }

    // Call onUnregister hook
    if (plugin.hooks?.onUnregister) {
      await plugin.hooks.onUnregister();
    }

    // Remove tools
    if (plugin.tools) {
      for (const tool of plugin.tools) {
        this.toolDefinitions.delete(tool.name);
        this.toolExecutors.delete(tool.name);
        this.toolToPlugin.delete(tool.name);
      }
    }

    // Remove plugin
    this.plugins.delete(pluginName);

    if (this.debug) {
      console.log(`[PluginManager] Unregistered plugin: ${pluginName}`);
    }
  }

  /**
   * Check if a plugin is registered.
   */
  hasPlugin(pluginName: string): boolean {
    return this.plugins.has(pluginName);
  }

  /**
   * Get all registered plugin names.
   */
  getPluginNames(): string[] {
    return Array.from(this.plugins.keys());
  }

  /**
   * Get all client tool definitions from all plugins.
   * These are sent to the server with each request.
   */
  getClientToolDefinitions(): ClientToolDefinition[] {
    return Array.from(this.toolDefinitions.values());
  }

  /**
   * Check if we have an executor for a given tool name.
   * Used to determine if a tool_call is client-side.
   */
  hasExecutor(toolName: string): boolean {
    return this.toolExecutors.has(toolName);
  }

  /**
   * Execute a client-side tool by name.
   * Throws if no executor is found.
   */
  async executeClientTool(toolCall: ToolCall): Promise<unknown> {
    const toolName = toolCall.toolName ?? toolCall.name;
    if (!toolName) {
      throw new Error('Tool call missing toolName');
    }

    const executor = this.toolExecutors.get(toolName);
    if (!executor) {
      throw new Error(`No executor found for tool: ${toolName}`);
    }

    const args = toolCall.args ?? toolCall.arguments ?? {};

    if (this.debug) {
      console.log(`[PluginManager] Executing tool: ${toolName}`, args);
    }

    const result = await executor(args);

    if (this.debug) {
      console.log(`[PluginManager] Tool result:`, result);
    }

    return result;
  }

  /**
   * Run beforeRequest hooks from all plugins.
   * Plugins can modify the request.
   */
  async runBeforeRequest(request: HustleRequest): Promise<HustleRequest> {
    let currentRequest = request;

    for (const plugin of this.plugins.values()) {
      if (plugin.hooks?.beforeRequest) {
        currentRequest = await plugin.hooks.beforeRequest(currentRequest);
      }
    }

    return currentRequest;
  }

  /**
   * Run afterResponse hooks from all plugins.
   */
  async runAfterResponse(response: ProcessedResponse): Promise<void> {
    for (const plugin of this.plugins.values()) {
      if (plugin.hooks?.afterResponse) {
        await plugin.hooks.afterResponse(response);
      }
    }
  }

  /**
   * Get count of registered plugins.
   */
  get pluginCount(): number {
    return this.plugins.size;
  }

  /**
   * Get count of registered tools.
   */
  get toolCount(): number {
    return this.toolDefinitions.size;
  }
}
