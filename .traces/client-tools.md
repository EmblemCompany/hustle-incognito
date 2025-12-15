# Client-Side Tools & Plugin Architecture Ideation

## Overview

This document captures ideation around enabling the hustle-incognito SDK to register client-side tools dynamically, allowing SDK consumers to extend the agent's capabilities without requiring changes to Hustle-v2 (the Next.js backend).

## Current State

### How It Works Today
- Hustle-v2 detects SDK requests and sets `isMCP: true`
- When `isMCP: true`, client-side tools are ignored to prevent errors
- Tool categories are selected via `selectedToolCategories` string array
- The v2 backend maintains all tool definitions, schemas, and execution logic
- SDK is purely a consumer/transport layer with no tool registration capability

### Hustle-V2 Client Tools Implementation (Reference)

**Important**: Phase 2 must preserve this existing pattern. The isMCP check happens at the registry level.

#### File Locations

| File | Purpose |
|------|---------|
| `src/lib/tools/registry/client.ts` | Client tool definitions & exports |
| `src/lib/tools/registry/index.ts` | isMCP filtering logic (lines 20-22, 41-43, 62) |
| `src/lib/tools/handler.ts` | Client-side tool execution handlers |
| `src/lib/tools/confetti/index.ts` | Example client tool definition |

#### Client Tools Registry (`registry/client.ts`)
```typescript
export const platformClientFeaturesTools = {
  confetti: confettiTool,
  setSlippageSettings: setSlippageSettingsTool,
  displayRecommendedSolanaTokensToBuy,
  displayRecommendedEVMTokensToBuy,
  displayRecommendedHederaTokensToBuy,
  showTokenChart,
};

export const uiClientTools = [
  "displayRecommendedSolanaTokensToBuy",
  "displayRecommendedEVMTokensToBuy",
  "displayRecommendedHederaTokensToBuy",
  "showTokenChart",
];
```

#### isMCP Filtering (`registry/index.ts`)
```typescript
// Line 20-22 in getTools()
...(isMcpMode ? {} : getSelectedClientSideTools(selectedToolCategories || []))

// Line 41-43 in getAutoTools()
const clientTools = isMcpMode ? {} : getSelectedClientSideTools(qualifiedCategories);

// Line 62 in getToolsByCategories()
const clientTools = isMcpMode ? {} : getSelectedClientSideTools(categories);
```

#### Tool Handler Pattern (`handler.ts`)
```typescript
// Client tools defined with schema only (no execute)
export const confettiTool = createTool({
  description: "Trigger a confetti animation...",
  parameters: confettiParamsSchema,
  // NO execute function - handled client-side
});

// Execution via ToolHandlerRegistry
class ToolHandlerRegistry {
  constructor() {
    this.registerHandler(new ConfettiToolHandler());
    this.registerHandler(new SetSlippageSettingsToolHandler());
    this.registerHandler(new ViewChartToolHandler());
  }
}

// Dispatch function
export async function handleToolCall({ toolCall, ...context }) {
  const handler = toolHandlerRegistry.findHandler(toolCall.toolName);
  if (!handler) return `Tool: ${toolCall.toolName} not found`;
  return handler.handle(toolCall, context);
}
```

#### Key Pattern for Phase 2 Compatibility
1. **Client tools use `createTool()` with schema only** - no `execute` function
2. **Filtering at registry level** - `isMcpMode ? {} : getSelectedClientSideTools(...)`
3. **Execution via handler registry** - `handleToolCall()` dispatches to class-based handlers
4. **Phase 2 SDK client tools must coexist** - don't break platform client tools

### Current Request Flow
```
SDK Client → HustleRequest → v2 API → AI Model
                                ↓
                         Server Tools Execute
                                ↓
                         StreamResponse → SDK
```

## Proposed Architecture: Client-Side Tool Registration

### Core Concept
Enable the SDK to register custom tools that:
1. Are sent to v2 in the request body with name + JSON schema
2. v2 detects them, converts JSON schema to Zod at runtime
3. Registers them as "client-side tools" (no execute body on server)
4. When AI calls the tool, result is streamed back to SDK
5. SDK executes the tool locally and sends result back

### Request Payload Extension
```typescript
interface ClientToolDefinition {
  name: string;
  description: string;
  // JSON Schema format - converted to Zod on server
  parameters: {
    type: 'object';
    properties: Record<string, JSONSchemaProperty>;
    required?: string[];
  };
}

interface HustleRequest {
  // ... existing fields ...

  // NEW: Client-side tool definitions
  clientTools?: ClientToolDefinition[];
}
```

### SDK Tool Registration API
```typescript
// Pattern 1: Direct Registration
client.registerTool({
  name: 'local_file_read',
  description: 'Read a file from the local filesystem',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path to read' }
    },
    required: ['path']
  },
  execute: async (args: { path: string }) => {
    return fs.readFileSync(args.path, 'utf-8');
  }
});

// Pattern 2: Plugin Registration
client.use(fileSystemPlugin);
client.use(mcpPlugin({ servers: ['sqlite', 'github'] }));
```

---

## Plugin Architecture Patterns

### Research Summary
Based on research into plugin systems:

1. **[Plug and Play Pattern](https://www.adaltas.com/en/2020/08/28/node-js-plugin-architecture/)** - Hook-based system with lifecycle events
2. **[TypeScript Plugin Template](https://github.com/gr2m/javascript-plugin-architecture-with-typescript-definitions)** - Type-safe plugin extensions (from Octokit)
3. **[Plugin Manager Pattern](https://v-checha.medium.com/node-js-advanced-patterns-plugin-manager-44adb72aa6bb)** - Central coordinator with lifecycle management

### Proposed Plugin Interface
```typescript
interface HustlePlugin {
  /** Unique plugin identifier */
  name: string;

  /** Plugin version for compatibility checking */
  version: string;

  /** Tool definitions this plugin provides */
  tools?: ClientToolDefinition[];

  /** Tool executors keyed by tool name */
  executors?: Record<string, ToolExecutor>;

  /** Lifecycle hooks */
  hooks?: {
    /** Called when plugin is registered */
    onRegister?: (client: HustleIncognitoClient) => void | Promise<void>;

    /** Called before each request */
    beforeRequest?: (request: HustleRequest) => HustleRequest | Promise<HustleRequest>;

    /** Called after each response */
    afterResponse?: (response: ProcessedResponse) => void | Promise<void>;

    /** Called when a tool needs execution */
    onToolCall?: (toolCall: ToolCall) => Promise<unknown> | undefined;

    /** Called when plugin is unregistered */
    onUnregister?: () => void | Promise<void>;
  };
}

type ToolExecutor = (args: Record<string, unknown>) => Promise<unknown>;
```

### Plugin Manager Implementation
```typescript
class PluginManager {
  private plugins: Map<string, HustlePlugin> = new Map();
  private toolExecutors: Map<string, ToolExecutor> = new Map();

  async register(plugin: HustlePlugin): Promise<void> {
    // Validate plugin structure
    this.validatePlugin(plugin);

    // Register tools
    if (plugin.tools) {
      for (const tool of plugin.tools) {
        this.tools.set(tool.name, tool);
      }
    }

    // Register executors
    if (plugin.executors) {
      for (const [name, executor] of Object.entries(plugin.executors)) {
        this.toolExecutors.set(name, executor);
      }
    }

    // Call lifecycle hook
    await plugin.hooks?.onRegister?.(this.client);

    this.plugins.set(plugin.name, plugin);
  }

  getClientToolDefinitions(): ClientToolDefinition[] {
    return Array.from(this.tools.values());
  }

  async executeClientTool(toolCall: ToolCall): Promise<unknown> {
    const executor = this.toolExecutors.get(toolCall.toolName!);
    if (!executor) {
      throw new Error(`No executor for tool: ${toolCall.toolName}`);
    }
    return executor(toolCall.args || {});
  }
}
```

---

## Client-Side MCP Integration

### Concept
Allow SDK to connect to local MCP servers and expose their tools to the AI agent.

### MCP Background
The [Model Context Protocol](https://modelcontextprotocol.io/development/roadmap) (MCP) is an open standard for AI/LLM integration:
- Defines client-server architecture for tool discovery and execution
- Supports stdio and HTTP transports
- Tools have schemas similar to JSON Schema
- Recent updates (2025) include OAuth auth and structured outputs
- In December 2025, Anthropic donated MCP to the Agentic AI Foundation (AAIF) under Linux Foundation

### MCP Plugin Implementation
```typescript
interface MCPServerConfig {
  name: string;
  command: string;  // For stdio transport
  args?: string[];
  env?: Record<string, string>;
  // OR
  url?: string;     // For HTTP transport
}

const mcpPlugin = (config: { servers: MCPServerConfig[] }): HustlePlugin => {
  const mcpClients: Map<string, MCPClient> = new Map();
  const toolMap: Map<string, string> = new Map(); // toolName -> serverName

  return {
    name: 'mcp-bridge',
    version: '1.0.0',

    tools: [], // Populated dynamically in onRegister

    hooks: {
      async onRegister(client) {
        // Connect to each MCP server
        for (const serverConfig of config.servers) {
          const mcpClient = new MCPClient(serverConfig);
          await mcpClient.connect();

          // Discover tools from this server
          const serverTools = await mcpClient.listTools();

          for (const tool of serverTools) {
            // Convert MCP schema to our format
            this.tools!.push({
              name: `mcp_${serverConfig.name}_${tool.name}`,
              description: tool.description,
              parameters: tool.inputSchema as any
            });

            toolMap.set(`mcp_${serverConfig.name}_${tool.name}`, serverConfig.name);
          }

          mcpClients.set(serverConfig.name, mcpClient);
        }
      },

      async onToolCall(toolCall) {
        const serverName = toolMap.get(toolCall.toolName!);
        if (!serverName) return undefined;

        const mcpClient = mcpClients.get(serverName)!;
        const originalToolName = toolCall.toolName!.replace(`mcp_${serverName}_`, '');

        return mcpClient.callTool(originalToolName, toolCall.args);
      },

      async onUnregister() {
        for (const client of mcpClients.values()) {
          await client.disconnect();
        }
      }
    }
  };
};
```

### Usage Example
```typescript
const client = new HustleIncognitoClient({ /* ... */ });

// Register MCP plugin with local servers
client.use(mcpPlugin({
  servers: [
    { name: 'sqlite', command: 'mcp-server-sqlite', args: ['--db', './data.db'] },
    { name: 'github', command: 'mcp-server-github' },
    { name: 'filesystem', command: 'mcp-server-fs', args: ['--root', '/home/user'] }
  ]
}));

// Now the AI can use tools from these MCP servers
for await (const chunk of client.chatStream({
  messages: [{ role: 'user', content: 'Query the users table from sqlite' }]
})) {
  // Tool calls to mcp_sqlite_query will be handled by the plugin
}
```

---

## JSON Schema to Zod Conversion

### Server-Side Implementation (Hustle-v2)
The v2 backend needs to convert client-provided JSON schemas to Zod at runtime.

### Recommended Library
**[@dmitryrechkin/json-schema-to-zod](https://github.com/dmitryrechkin/json-schema-to-zod)**
- Purpose-built for runtime/dynamic conversion
- Handles complex schemas (oneOf, anyOf, allOf)
- Serverless-ready (works in edge functions)

```typescript
import { jsonSchemaToZod } from '@dmitryrechkin/json-schema-to-zod';

function registerClientTool(definition: ClientToolDefinition) {
  const zodSchema = jsonSchemaToZod(definition.parameters);

  // Register as client-side tool with no execute body
  tools.register({
    name: definition.name,
    description: definition.description,
    schema: zodSchema,
    isClientSide: true  // Flag to handle differently in execution
  });
}
```

---

## Execution Flow with Client Tools

### AI SDK Pattern (What We're Following)

Based on [Vercel AI SDK's approach](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage):

**Key Insight**: Client-side tools are NOT handled via special events. Instead:
1. Server registers tool schema **without** an `execute` function
2. When AI calls a client-side tool, stream ends with `finishReason: "tool-calls"`
3. The last message contains tool_call(s) but **no** tool_result
4. Client detects this pattern, executes locally via `onToolCall` callback
5. Results sent back as a **new chat turn** (not special endpoint)
6. This creates 2 HTTP requests where server tools would be 1

### Server-Side vs Client-Side Tool Execution

**Server-side tools** (with `execute`):
```
Request → Model calls tool → Server executes → Model continues → ... → finish: "stop"
         └──────────────────── All in one stream ────────────────────┘
```

**Client-side tools** (no `execute`):
```
Turn 1: Request → Model calls client tool → finish: "tool-calls" (stream ends)
Turn 2: Request + tool_result → Model continues → finish: "stop"
```

### Sequence Diagram (Corrected)
```
SDK                     v2 API                    AI Model
 │                        │                          │
 │ Request + clientTools  │                          │
 │───────────────────────>│                          │
 │                        │ Convert JSON→Zod         │
 │                        │ Register (no execute)    │
 │                        │                          │
 │                        │ Chat with tools ────────>│
 │                        │                          │
 │                        │<─── Tool Call (client) ──│
 │                        │                          │
 │<── Stream: tool_call ──│                          │
 │<── finish: tool-calls ─│  (Stream ENDS here)      │
 │                        │                          │
 │ Detect: finish reason  │                          │
 │ + tool_call w/o result │                          │
 │                        │                          │
 │ Execute locally        │                          │
 │ (via plugin/executor)  │                          │
 │                        │                          │
 │ NEW REQUEST ──────────>│                          │
 │ (msgs + tool_result)   │                          │
 │                        │ Continue chat ──────────>│
 │                        │                          │
 │<── Stream: text ───────│<──── Response ──────────│
 │<── finish: stop ───────│                          │
```

### Detection Pattern (No New Events Needed)

The SDK detects client-side tool calls by checking the finish event:

```typescript
// In the finish event handler
if (chunk.type === 'finish') {
  const { reason } = chunk.value;

  // If finish reason is "tool-calls", there are pending client-side tools
  if (reason === 'tool-calls' || reason === 'tool_calls') {
    // Find tool_calls without matching tool_results
    const pendingToolCalls = this.findPendingClientToolCalls();

    if (pendingToolCalls.length > 0) {
      // Execute client-side and auto-continue
      await this.executeAndContinue(pendingToolCalls, options);
    }
  }
}
```

### SDK-Side Handling (AI SDK Pattern)
```typescript
interface ChatStreamOptions extends StreamOptions {
  /** Maximum automatic tool execution rounds (like AI SDK maxSteps) */
  maxToolRounds?: number;

  /** Callback for client-side tool execution */
  onToolCall?: (toolCall: ToolCall) => Promise<unknown>;
}

async *chatStream(options: ChatStreamOptions) {
  let currentMessages = [...options.messages];
  let rounds = 0;
  const maxRounds = options.maxToolRounds ?? 5;

  while (rounds < maxRounds) {
    rounds++;
    let pendingToolCalls: ToolCall[] = [];
    let finishReason: string | null = null;

    // Stream the response
    for await (const chunk of this.rawStream({ ...options, messages: currentMessages })) {
      yield chunk;

      if (chunk.type === 'tool_call') {
        // Check if this is a client-side tool (we have an executor for it)
        if (this.pluginManager.hasExecutor(chunk.value.toolName)) {
          pendingToolCalls.push(chunk.value);
        }
      }

      if (chunk.type === 'finish') {
        finishReason = chunk.value.reason;
      }
    }

    // If no pending client tools, we're done
    if (pendingToolCalls.length === 0 || finishReason === 'stop') {
      break;
    }

    // Execute client-side tools
    const toolResults: ToolResult[] = [];
    for (const toolCall of pendingToolCalls) {
      const result = options.onToolCall
        ? await options.onToolCall(toolCall)
        : await this.pluginManager.executeClientTool(toolCall);

      toolResults.push({
        toolCallId: toolCall.toolCallId!,
        toolName: toolCall.toolName,
        result
      });

      yield { type: 'tool_result', value: toolResults[toolResults.length - 1] };
    }

    // Append tool results to messages for next turn
    currentMessages = [
      ...currentMessages,
      // Assistant message with tool calls
      { role: 'assistant', content: '', toolCalls: pendingToolCalls },
      // Tool results
      ...toolResults.map(tr => ({
        role: 'tool' as const,
        content: JSON.stringify(tr.result),
        toolCallId: tr.toolCallId
      }))
    ];
  }
}
```

### Why This Pattern?

1. **Stateless server**: API route doesn't maintain connection state between requests
2. **AI SDK compatibility**: Follows the same pattern, making migration easier
3. **No special events**: Server code stays simple, close to standard AI SDK
4. **Implicit detection**: SDK detects the pattern rather than relying on explicit signals
5. **Predictable behavior**: Logs show 2 turns for client tools, 1 turn for server tools

---

## Security Considerations

### Tool Validation
- Server MUST validate tool names (alphanumeric + underscore only)
- Server MUST validate schemas are well-formed JSON Schema
- Rate limit tool registrations per request
- Maximum tool count per request (e.g., 10)

### Execution Isolation
- Client tools execute in SDK process, not server
- Consider sandboxing for untrusted tool executors
- Timeout handling for slow tool executions

### Schema Restrictions
```typescript
const ALLOWED_SCHEMA_TYPES = ['string', 'number', 'boolean', 'object', 'array', 'null'];
const MAX_SCHEMA_DEPTH = 5;
const MAX_PROPERTIES = 20;

function validateClientToolSchema(schema: unknown): boolean {
  // Recursively validate schema structure
  // Reject if contains $ref, external references, or exceeds limits
}
```

---

## Example Plugins

### 1. File System Plugin
```typescript
const fileSystemPlugin: HustlePlugin = {
  name: 'filesystem',
  version: '1.0.0',
  tools: [
    {
      name: 'read_file',
      description: 'Read contents of a local file',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute file path' }
        },
        required: ['path']
      }
    },
    {
      name: 'write_file',
      description: 'Write contents to a local file',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' }
        },
        required: ['path', 'content']
      }
    },
    {
      name: 'list_directory',
      description: 'List files in a directory',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' }
        },
        required: ['path']
      }
    }
  ],
  executors: {
    read_file: async ({ path }) => fs.promises.readFile(path as string, 'utf-8'),
    write_file: async ({ path, content }) => {
      await fs.promises.writeFile(path as string, content as string);
      return { success: true };
    },
    list_directory: async ({ path }) => fs.promises.readdir(path as string)
  }
};
```

### 2. Browser Environment Plugin
```typescript
const browserPlugin: HustlePlugin = {
  name: 'browser',
  version: '1.0.0',
  tools: [
    {
      name: 'get_page_info',
      description: 'Get current page URL and title',
      parameters: { type: 'object', properties: {} }
    },
    {
      name: 'get_selection',
      description: 'Get currently selected text on the page',
      parameters: { type: 'object', properties: {} }
    },
    {
      name: 'copy_to_clipboard',
      description: 'Copy text to clipboard',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string' }
        },
        required: ['text']
      }
    }
  ],
  executors: {
    get_page_info: async () => ({
      url: window.location.href,
      title: document.title
    }),
    get_selection: async () => window.getSelection()?.toString() || '',
    copy_to_clipboard: async ({ text }) => {
      await navigator.clipboard.writeText(text as string);
      return { success: true };
    }
  }
};
```

### 3. Database Plugin
```typescript
const sqlitePlugin = (dbPath: string): HustlePlugin => ({
  name: 'sqlite',
  version: '1.0.0',
  tools: [
    {
      name: 'sql_query',
      description: 'Execute a read-only SQL query',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'SQL SELECT query' }
        },
        required: ['query']
      }
    },
    {
      name: 'list_tables',
      description: 'List all tables in the database',
      parameters: { type: 'object', properties: {} }
    }
  ],
  executors: {
    sql_query: async ({ query }) => {
      const db = new Database(dbPath, { readonly: true });
      return db.prepare(query as string).all();
    },
    list_tables: async () => {
      const db = new Database(dbPath, { readonly: true });
      return db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    }
  }
});
```

---

## Implementation Phases

### Phase 1: Core Plugin System ✅ COMPLETE
- [x] Define plugin interface and types
- [x] Implement PluginManager class
- [x] Add `client.use()` registration method
- [x] Wire plugin tool definitions into HustleRequest

#### What Was Implemented

**Types** (`src/types.ts`):
- `JSONSchemaProperty` - JSON Schema property definition
- `ClientToolDefinition` - Tool name, description, and JSON Schema parameters
- `ToolExecutor<T, R>` - Generic async function type for tool execution
- `HustlePlugin` - Plugin interface with name, version, tools, executors, and lifecycle hooks
- `ClientToolOptions` - Options for PluginManager (debug mode)
- Added `clientTools?: ClientToolDefinition[]` to `HustleRequest`

**PluginManager** (`src/plugins.ts`):
- Registration with validation (name, version, tool name format, executor matching)
- Tool name conflicts detection across plugins
- Lifecycle hooks: `onRegister`, `beforeRequest`, `afterResponse`, `onUnregister`
- Tool executor registry and execution
- Debug logging option

**Client Integration** (`src/client.ts`):
- `use(plugin)` - Register plugin, returns `this` for chaining
- `unuse(pluginName)` - Unregister plugin
- `hasPlugin(name)` - Check if plugin is registered
- `getPluginNames()` - Get all registered plugin names
- `getClientToolDefinitions()` - Get all tool definitions from plugins
- `prepareRequestBody()` - Automatically includes `clientTools` when plugins have tools

#### Test Coverage (29 tests)

**PluginManager Unit Tests** (`tests/plugins.test.ts` - 23 tests):

| Category | Test | Description |
|----------|------|-------------|
| Registration | `should register a valid plugin` | Basic plugin with tool and executor |
| | `should call onRegister hook` | Lifecycle hook fires on registration |
| | `should reject plugin without name` | Validation: name required |
| | `should reject plugin without version` | Validation: version required |
| | `should reject duplicate plugin registration` | No duplicate plugin names |
| | `should reject invalid tool names` | Tool names can't start with numbers |
| | `should reject tool names with special characters` | Only alphanumeric + underscore |
| | `should reject executor without matching tool` | Orphan executors rejected |
| | `should reject tool name conflicts across plugins` | No duplicate tool names |
| Unregistration | `should unregister a plugin` | Removes plugin and its tools |
| | `should call onUnregister hook` | Lifecycle hook fires on removal |
| | `should throw when unregistering unknown plugin` | Error on invalid name |
| Tool Definitions | `should return all tool definitions` | Multi-tool plugin returns all |
| | `should return empty array when no plugins` | Graceful empty state |
| Tool Execution | `should execute a tool` | Executor called with args |
| | `should handle toolCall with alternative field names` | Backward compat (id/name/arguments) |
| | `should throw when no executor found` | Error on missing executor |
| | `should check if executor exists` | `hasExecutor()` method |
| Lifecycle Hooks | `should run beforeRequest hooks` | Modifies request before sending |
| | `should run multiple beforeRequest hooks in order` | Chained hook execution |
| | `should run afterResponse hooks` | Called after response |
| Utilities | `should return all plugin names` | `getPluginNames()` method |
| Debug | `should log when debug is enabled` | Debug mode logging |

**Client Integration Tests** (`tests/client.test.ts` - 6 tests):

| Test | Description |
|------|-------------|
| `should register plugin via use()` | Plugin registration through client |
| `should chain multiple use() calls` | Fluent API pattern |
| `should unregister plugin via unuse()` | Plugin removal through client |
| `should include clientTools in request body` | Tools sent to server |
| `should not include clientTools when no plugins` | Clean request without plugins |
| `should check if plugin is registered` | `hasPlugin()` method |

### Phase 2: Server-Side Support (v2) ✅ COMPLETE
- [x] Add `clientTools` field to request validation
- [x] Implement JSON Schema → Zod conversion
- [x] Register client tools WITHOUT execute body (AI SDK pattern)
- [x] Ensure `finishReason: "tool-calls"` is properly forwarded in stream

#### What Was Implemented (Hustle-v2)

**Request Handling** (`src/app/api/chat/route.ts`):
- Extract `sdkClientTools` from request body (only when `isMcpMode: true`)
- Thread through `routeAndRespond()` → `createPathResponse()`

**JSON Schema to Zod Converter** (`src/lib/tools/registry/sdk-client-tools.ts`):
- `jsonSchemaPropertyToZod()` - Converts JSON Schema types to Zod
- `jsonSchemaToZod()` - Converts full object schema with required fields
- `registerSDKClientTools()` - Creates AI SDK tools without execute function
- Handles: string, number, integer, boolean, array, object, enum, null
- Validates tool names (alphanumeric + underscore)

**Tool Registration**:
- SDK client tools merged into `allTools` alongside core/LunarCrush/OpenSea tools
- Logging updated: `"Loaded X core + Y LunarCrush + Z SDK client = N total tools"`

**finishReason Forwarding**:
- AI SDK's `streamText` + `createDataStreamResponse` automatically forwards `finishReason`
- No changes needed - the `e:` prefix stream events include finish data

### Phase 3: SDK Execution Loop ✅ COMPLETE
- [x] Detect `finishReason: "tool-calls"` pattern
- [x] Identify pending tool_calls without tool_results
- [x] Check if SDK has executor for tool (client-side vs server-side)
- [x] Execute via plugin manager / onToolCall callback
- [x] Append results to messages and start new chat turn
- [x] Implement `maxToolRounds` to prevent infinite loops

#### What Was Implemented (hustle-incognito SDK)

**New StreamOptions** (`src/types.ts`):
- `maxToolRounds?: number` - Max execution rounds (default: 5, set to 0 for unlimited)
- `onToolCall?: (toolCall: ToolCall) => Promise<unknown>` - Override for custom execution

**Execution Loop in chatStream** (`src/client.ts`):
- Tracks `pendingClientToolCalls` during streaming
- Detects `finishReason: "tool-calls"` or `"tool_calls"`
- Checks `pluginManager.hasExecutor(toolName)` for each tool call
- Executes client tools via `onToolCall` callback or `pluginManager.executeClientTool()`
- Yields `tool_result` chunks for visibility
- Emits `tool_end` events for each execution
- Formats results as AI SDK message format:
  - Assistant message with `tool_calls` array
  - Tool messages with `tool_call_id` and result content
- Makes new request with updated messages
- Repeats until `finishReason: "stop"` or `maxToolRounds` reached
- Error handling: tool failures return `{ error: "message" }` to model

**Integration Tests** (`tests/integration.test.ts`):
| Test | Description |
|------|-------------|
| `should execute client-side tool and continue conversation` | Full loop with time plugin |
| `should handle onToolCall callback override` | Custom execution via callback |
| `should respect maxToolRounds limit` | Prevents infinite loops |

#### `onToolCall` Callback Use Cases

The `onToolCall` option provides an escape hatch for scenarios where plugin executors alone aren't flexible enough:

```typescript
// 1. UI Integration - Confirmation dialogs before execution
for await (const chunk of client.chatStream({
  messages,
  onToolCall: async (toolCall) => {
    const confirmed = await showConfirmDialog(`Execute ${toolCall.toolName}?`);
    if (!confirmed) return { cancelled: true };
    return defaultExecute(toolCall);
  }
})) { /* ... */ }

// 2. Logging/Analytics - Track tool usage without modifying plugins
onToolCall: async (toolCall) => {
  analytics.track('tool_executed', { name: toolCall.toolName, args: toolCall.args });
  return pluginManager.executeClientTool(toolCall);
}

// 3. Permission Gates - Check user permissions per-tool
onToolCall: async (toolCall) => {
  if (!currentUser.canUse(toolCall.toolName)) {
    return { error: 'Permission denied for this tool' };
  }
  return pluginManager.executeClientTool(toolCall);
}

// 4. Dynamic Dispatch - Route to different executors at runtime
onToolCall: async (toolCall) => {
  if (toolCall.toolName.startsWith('mcp_')) {
    return mcpClient.callTool(toolCall);
  }
  return localPluginExecutor(toolCall);
}

// 5. Progress Indicators - Wrap execution with loading states
onToolCall: async (toolCall) => {
  setLoadingStatus(`Running ${toolCall.toolName}...`);
  try {
    return await pluginManager.executeClientTool(toolCall);
  } finally {
    setLoadingStatus(null);
  }
}
```

### Phase 4: Hustle v2 UI Plugin System (Arbitrary Executors)

**Goal**: Allow client-side tool plugins in the Hustle v2 UI, leveraging the `clientTools` server support from Phase 2. Plugins provide both tool definitions AND executor code stored in browser localStorage.

---

## ⚠️ SECURITY WARNING ⚠️

**This implementation intentionally allows arbitrary code execution from browser storage.**

- Executor code is stored as strings in localStorage and evaluated at runtime
- Any code with access to the browser console can install malicious plugins
- XSS vulnerabilities could lead to plugin injection
- **DO NOT use this in production without implementing signature verification (see Future Security section)**

This is a **temporary development/prototype approach**. The security model will be hardened before production release.

---

#### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser                                                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  localStorage                   useChat / chat request           │
│  ┌────────────────────┐        ┌──────────────────────┐         │
│  │ hustle_plugins     │───────►│ body.clientTools     │         │
│  │ [{ name, tools,    │        │ (tool definitions)   │         │
│  │   executorCode }]  │        └──────────┬───────────┘         │
│  └────────────────────┘                   │                      │
│           │                               ▼                      │
│           │                      Server registers tools          │
│           │                      (no execute - Phase 2)          │
│           │                               │                      │
│           │                               ▼                      │
│           │                      Model calls tool                │
│           │                      finishReason: "tool-calls"      │
│           │                               │                      │
│           ▼                               ▼                      │
│  ┌────────────────────┐        ┌──────────────────────┐         │
│  │ eval(executorCode) │◄───────│ experimental_        │         │
│  │ (arbitrary code)   │        │ onToolCall           │         │
│  └────────────────────┘        └──────────────────────┘         │
│           │                               │                      │
│           └───── execute ─────────────────┘                      │
│                                           │                      │
│                                           ▼                      │
│                                  useChat auto-sends              │
│                                  toolInvocations result          │
└─────────────────────────────────────────────────────────────────┘
```

#### Implementation Plan

##### 1. localStorage Schema

```typescript
// Key: 'hustle_plugins'
// Value: JSON array of installed plugins
interface StoredPlugin {
  id: string;           // Unique plugin ID
  name: string;         // Display name
  version: string;
  installedAt: string;  // ISO timestamp
  tools: Array<{
    name: string;
    description: string;
    parameters: JSONSchema;
    // Executor code as a string - will be evaluated at runtime
    // Function signature: (args: Record<string, unknown>) => Promise<unknown>
    executorCode: string;
  }>;

  // FUTURE: For signature verification
  signature?: string;   // Curator signature of plugin content hash
  sourceUrl?: string;   // CDN URL where plugin was fetched from
}
```

##### 2. Plugin Store Service

```typescript
// src/lib/plugins/plugin-store.ts
const STORAGE_KEY = 'hustle_plugins';

type PluginExecutor = (args: Record<string, unknown>) => Promise<unknown>;

export class PluginStore {
  private plugins: StoredPlugin[] = [];
  private executorCache: Map<string, PluginExecutor> = new Map();

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      this.plugins = stored ? JSON.parse(stored) : [];
      // Rebuild executor cache
      this.rebuildExecutorCache();
    } catch {
      this.plugins = [];
    }
  }

  private save(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.plugins));
  }

  /**
   * ⚠️ SECURITY WARNING: This evaluates arbitrary code from localStorage
   */
  private rebuildExecutorCache(): void {
    this.executorCache.clear();

    for (const plugin of this.plugins) {
      for (const tool of plugin.tools) {
        try {
          // Create async function from code string
          // executorCode should be the function body, e.g.:
          // "const tz = args.timezone || 'UTC'; return { time: new Date().toISOString(), timezone: tz };"
          const executor = new Function(
            'args',
            `return (async () => { ${tool.executorCode} })();`
          ) as PluginExecutor;

          this.executorCache.set(tool.name, executor);
        } catch (error) {
          console.error(`[PluginStore] Failed to compile executor for ${tool.name}:`, error);
        }
      }
    }
  }

  install(plugin: Omit<StoredPlugin, 'installedAt'>): void {
    // Basic validation
    if (!plugin.id || !plugin.name || !plugin.tools?.length) {
      throw new Error('Invalid plugin: missing required fields');
    }

    // Check for tool name conflicts
    for (const tool of plugin.tools) {
      if (this.executorCache.has(tool.name)) {
        throw new Error(`Tool name conflict: ${tool.name} already exists`);
      }
    }

    // Remove existing version if present
    this.plugins = this.plugins.filter(p => p.id !== plugin.id);

    this.plugins.push({
      ...plugin,
      installedAt: new Date().toISOString(),
    });

    this.save();
    this.rebuildExecutorCache();
  }

  uninstall(pluginId: string): void {
    this.plugins = this.plugins.filter(p => p.id !== pluginId);
    this.save();
    this.rebuildExecutorCache();
  }

  getInstalledPlugins(): StoredPlugin[] {
    return [...this.plugins];
  }

  // Returns tool definitions to include in request body (no executor code sent to server)
  getClientToolDefinitions(): ClientToolDefinition[] {
    return this.plugins.flatMap(p =>
      p.tools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      }))
    );
  }

  hasExecutor(toolName: string): boolean {
    return this.executorCache.has(toolName);
  }

  // Execute a tool - returns undefined if no executor found
  async executeClientTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const executor = this.executorCache.get(toolName);
    if (!executor) {
      return undefined;
    }
    return executor(args);
  }
}

// Singleton instance
export const pluginStore = new PluginStore();
```

##### 3. Integration with useChat

```typescript
// In chat component or hook wrapper
import { pluginStore } from '@/lib/plugins/plugin-store';

// When building request body, include plugin tools
const clientTools = pluginStore.getClientToolDefinitions();

// In useChat config - experimental_onToolCall
experimental_onToolCall: async ({ toolCall }) => {
  // Check if this is a plugin tool
  if (pluginStore.hasExecutor(toolCall.toolName)) {
    return pluginStore.executeClientTool(toolCall.toolName, toolCall.args);
  }

  // Fall through to existing handlers (confetti, viewChart, etc.)
  return handleToolCall({ toolCall, ...context });
}
```

##### 4. Console Installation Snippet (Dev/Testing)

```javascript
// Paste this in browser console to install a plugin
(function() {
  const STORAGE_KEY = 'hustle_plugins';
  const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');

  const newPlugin = {
    id: 'dev-time-plugin',
    name: 'Time Plugin',
    version: '1.0.0',
    tools: [{
      name: 'get_current_time',
      description: 'Get the current date and time in a specified timezone',
      parameters: {
        type: 'object',
        properties: {
          timezone: {
            type: 'string',
            description: 'Timezone (e.g., UTC, America/New_York). Defaults to UTC.'
          }
        }
      },
      // Executor code - function body that receives `args` parameter
      executorCode: `
        const tz = args.timezone || 'UTC';
        const now = new Date();
        return {
          time: now.toISOString(),
          formatted: now.toLocaleString('en-US', { timeZone: tz }),
          timezone: tz
        };
      `
    }]
  };

  // Remove if already exists, then add
  const filtered = existing.filter(p => p.id !== newPlugin.id);
  filtered.push({ ...newPlugin, installedAt: new Date().toISOString() });

  localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  console.log('✅ Plugin installed! Reload the page to activate.');
  console.log('Installed plugins:', filtered.map(p => p.name));
})();
```

##### 5. Console Uninstall Snippet

```javascript
// Paste to remove a plugin
(function() {
  const STORAGE_KEY = 'hustle_plugins';
  const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  const pluginId = 'dev-time-plugin'; // Change this

  const filtered = existing.filter(p => p.id !== pluginId);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  console.log('✅ Plugin removed! Reload the page.');
})();
```

##### 6. List Installed Plugins

```javascript
// Paste to see installed plugins
(function() {
  const STORAGE_KEY = 'hustle_plugins';
  const plugins = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  console.table(plugins.map(p => ({
    id: p.id,
    name: p.name,
    version: p.version,
    tools: p.tools.map(t => t.name).join(', '),
    installedAt: p.installedAt
  })));
})();
```

#### Tasks

- [ ] Create `src/lib/plugins/plugin-store.ts` for localStorage management with eval
- [ ] Integrate `clientTools` into chat request body
- [ ] Add plugin tool execution to `experimental_onToolCall`
- [ ] Test with console installation snippet
- [ ] (Future) Build UI for plugin management
- [ ] (Future) Implement signature verification

---

#### Future Security: Signature-Based Verification

When ready for production, implement curator signature verification:

##### Signature Flow

```
┌──────────────────┐      ┌──────────────────┐      ┌──────────────────┐
│  Plugin Author   │      │  Curator Service │      │  Hustle v2 UI    │
│                  │      │  (our backend)   │      │                  │
└────────┬─────────┘      └────────┬─────────┘      └────────┬─────────┘
         │                         │                         │
         │  Submit plugin          │                         │
         │────────────────────────►│                         │
         │                         │                         │
         │                         │  Review & audit code    │
         │                         │  ────────────────────   │
         │                         │                         │
         │                         │  Sign content hash      │
         │                         │  with curator key       │
         │                         │  ────────────────────   │
         │                         │                         │
         │  Return signed plugin   │                         │
         │◄────────────────────────│                         │
         │                         │                         │
         │  Host on CDN            │                         │
         │  ──────────────────     │                         │
         │                         │                         │
         │                         │      Install plugin     │
         │                         │◄────────────────────────│
         │                         │                         │
         │                         │  Verify signature       │
         │                         │  against public key     │
         │                         │  ────────────────────   │
         │                         │                         │
         │                         │  Allow/reject execution │
         │                         │────────────────────────►│
```

##### Signed Plugin Schema

```typescript
interface SignedPlugin extends StoredPlugin {
  // Content hash (SHA-256 of canonical JSON of tools array)
  contentHash: string;

  // Curator signature of contentHash
  signature: string;

  // CDN URL where verified plugin is hosted
  sourceUrl: string;

  // Curator ID who signed (for key lookup)
  curatorId: string;
}
```

##### Verification in Plugin Store

```typescript
// Future: Add to PluginStore
private async verifySignature(plugin: SignedPlugin): Promise<boolean> {
  if (!plugin.signature || !plugin.contentHash) {
    // Unsigned plugins - reject in production mode
    if (process.env.NODE_ENV === 'production') {
      console.warn('[PluginStore] Unsigned plugin rejected in production');
      return false;
    }
    // Allow in development
    return true;
  }

  // Fetch curator's public key
  const publicKey = await this.fetchCuratorPublicKey(plugin.curatorId);

  // Verify signature
  const isValid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    publicKey,
    base64ToBuffer(plugin.signature),
    new TextEncoder().encode(plugin.contentHash)
  );

  if (!isValid) {
    console.error('[PluginStore] Invalid signature for plugin:', plugin.id);
    return false;
  }

  // Verify contentHash matches actual content
  const actualHash = await this.computeContentHash(plugin.tools);
  if (actualHash !== plugin.contentHash) {
    console.error('[PluginStore] Content hash mismatch for plugin:', plugin.id);
    return false;
  }

  return true;
}
```

##### Curator Signing Service (Backend)

```typescript
// POST /api/plugins/sign
// Only accessible to authorized curators
async function signPlugin(plugin: StoredPlugin): Promise<SignedPlugin> {
  // 1. Audit the executor code (manual review + automated checks)
  await auditPluginCode(plugin);

  // 2. Compute content hash
  const contentHash = computeContentHash(plugin.tools);

  // 3. Sign with curator's private key
  const signature = await sign(curatorPrivateKey, contentHash);

  // 4. Host on CDN
  const sourceUrl = await uploadToCDN(plugin);

  return {
    ...plugin,
    contentHash,
    signature,
    sourceUrl,
    curatorId: currentCurator.id,
  };
}
```

This approach allows:
1. **Development**: Arbitrary code execution for rapid iteration
2. **Production**: Only curator-signed plugins can execute
3. **Transparency**: Users can see if a plugin is verified
4. **Flexibility**: Multiple curators can sign plugins

### Phase 5: MCP Bridge Plugin (SDK)
- [ ] Implement MCP client wrapper
- [ ] Create mcpPlugin factory
- [ ] Test with popular MCP servers
- [ ] Handle connection lifecycle

### Phase 5: Polish & Documentation
- [ ] Security hardening
- [ ] Error handling improvements
- [ ] Plugin development guide
- [ ] Example plugins library

---

## Answered Questions

1. **Bi-directional Communication**: ~~Should tool result submission use a separate endpoint or be part of the stream?~~

   **Answer**: Follow AI SDK model - tool results are sent as a **new chat turn** (new HTTP request with messages + tool_result). No special endpoint needed. The server is stateless; each request contains full conversation context.

2. **Tool Persistence**: ~~Should registered tools persist across requests, or be re-sent each time?~~

   **Answer**: Re-sent each time. API route is stateless - no in-memory connection state. `clientTools` array is included in every request where those tools should be available.

---

## Open Questions (Deferred)

3. **Tool Conflicts**: How to handle if client tool name conflicts with server tool?
   - Options: prefix client tools, server priority, error on conflict
   - Defer until we see real usage patterns

4. **Async Tool Execution**: Support for tools that take a long time (progress updates)?
   - Could yield intermediate events during execution
   - Defer - most tools should be fast

5. **Tool Dependencies**: Should plugins be able to depend on other plugins?
   - Adds complexity, may not be needed
   - Defer until requested

6. **Version Compatibility**: How to handle SDK/server version mismatches for client tools feature?
   - Server should gracefully ignore unknown fields
   - Defer - solve when we have versioning needs

---

## References

### AI SDK (Primary Pattern Reference)
- [AI SDK: Chatbot Tool Usage](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage) - Client vs server-side tool handling
- [AI SDK: Tool Calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling) - Core tool concepts
- [AI SDK: streamText Reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text) - finishReason values
- [AI SDK 5 Announcement](https://vercel.com/blog/ai-sdk-5) - Latest improvements to tool handling
- [GitHub Discussion: Client-side tools](https://github.com/vercel/ai/discussions/1521) - Community patterns

### MCP (Model Context Protocol)
- [Model Context Protocol Documentation](https://modelcontextprotocol.io/)
- [MCP Roadmap](https://modelcontextprotocol.io/development/roadmap)

### Schema Conversion
- [json-schema-to-zod (Runtime)](https://github.com/dmitryrechkin/json-schema-to-zod)

### Plugin Architecture
- [TypeScript Plugin Architecture Template](https://github.com/gr2m/javascript-plugin-architecture-with-typescript-definitions)
- [Plugin Manager Pattern](https://v-checha.medium.com/node-js-advanced-patterns-plugin-manager-44adb72aa6bb)
- [Designing JavaScript Plugin Systems](https://css-tricks.com/designing-a-javascript-plugin-system/)
- [Plug and Play Library](https://www.adaltas.com/en/2020/08/28/node-js-plugin-architecture/)
