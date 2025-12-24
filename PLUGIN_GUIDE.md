# Plugin Building Guide

This guide covers everything you need to know to build plugins for the Hustle Incognito SDK.

## Table of Contents

- [Overview](#overview)
- [Plugin Structure](#plugin-structure)
- [Tools and Executors](#tools-and-executors)
- [Lifecycle Hooks](#lifecycle-hooks)
  - [onRegister](#onregister)
  - [beforeRequest](#beforerequest)
  - [afterResponse](#afterresponse)
  - [onUnregister](#onunregister)
- [Complete Examples](#complete-examples)
- [Best Practices](#best-practices)
- [TypeScript Types](#typescript-types)

---

## Overview

Plugins extend the AI agent with **client-side tools** that execute in your application (browser or Node.js), not on the server. This enables:

- Browser-specific functionality (DOM access, localStorage, clipboard)
- User-specific context injection (timezone, preferences, location)
- Custom integrations (analytics, notifications, third-party APIs)
- Request/response interception for logging, modification, or validation

## Plugin Structure

A plugin implements the `HustlePlugin` interface:

```typescript
interface HustlePlugin {
  name: string;           // Unique identifier (required)
  version: string;        // Semantic version (required)
  tools?: ClientToolDefinition[];    // Tool schemas for AI
  executors?: Record<string, ToolExecutor>;  // Tool implementations
  hooks?: {
    onRegister?: () => void | Promise<void>;
    beforeRequest?: (request: HustleRequest) => HustleRequest | Promise<HustleRequest>;
    afterResponse?: (response: ProcessedResponse) => void | Promise<void>;
    onUnregister?: () => void | Promise<void>;
  };
}
```

### Minimal Plugin

```typescript
const minimalPlugin: HustlePlugin = {
  name: 'my-plugin',
  version: '1.0.0',
};

await client.use(minimalPlugin);
```

---

## Tools and Executors

Tools are capabilities you expose to the AI. The AI sees the tool's `name`, `description`, and `parameters` schema, then decides when to call it.

### Defining a Tool

```typescript
const weatherPlugin: HustlePlugin = {
  name: 'weather-plugin',
  version: '1.0.0',
  tools: [
    {
      name: 'get_weather',
      description: 'Get current weather for a location. Returns temperature, conditions, and humidity.',
      parameters: {
        type: 'object',
        properties: {
          location: {
            type: 'string',
            description: 'City name or coordinates (e.g., "San Francisco" or "37.7749,-122.4194")',
          },
          units: {
            type: 'string',
            description: 'Temperature units',
            enum: ['celsius', 'fahrenheit'],
          },
        },
        required: ['location'],
      },
    },
  ],
  executors: {
    get_weather: async (args) => {
      const { location, units = 'fahrenheit' } = args;

      // Call weather API
      const response = await fetch(
        `https://api.weather.example/current?location=${encodeURIComponent(location)}&units=${units}`
      );
      const data = await response.json();

      return {
        location: data.location,
        temperature: data.temp,
        units,
        conditions: data.conditions,
        humidity: data.humidity,
      };
    },
  },
};
```

### Tool Name Requirements

- Must start with a letter
- Can contain letters, numbers, and underscores
- Maximum 64 characters
- Pattern: `/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/`

### Parameter Schema

Parameters use JSON Schema format:

```typescript
parameters: {
  type: 'object',
  properties: {
    stringParam: {
      type: 'string',
      description: 'A string parameter',
    },
    numberParam: {
      type: 'number',
      description: 'A numeric parameter',
    },
    enumParam: {
      type: 'string',
      enum: ['option1', 'option2', 'option3'],
      description: 'One of the allowed values',
    },
    optionalWithDefault: {
      type: 'boolean',
      description: 'Optional with default',
      default: true,
    },
    arrayParam: {
      type: 'array',
      items: { type: 'string' },
      description: 'An array of strings',
    },
    objectParam: {
      type: 'object',
      properties: {
        nested: { type: 'string' },
      },
      description: 'A nested object',
    },
  },
  required: ['stringParam', 'numberParam'],
}
```

### Executor Function

Executors receive the arguments the AI provided and return any value:

```typescript
type ToolExecutor<T = Record<string, unknown>, R = unknown> = (args: T) => R | Promise<R>;
```

The return value is serialized and sent back to the AI as the tool result.

---

## Lifecycle Hooks

Hooks let you intercept the request/response lifecycle. They execute in order across all registered plugins.

```
User sends message
        │
        ▼
┌─────────────────────────────────────┐
│  beforeRequest (Plugin 1)           │  ◀── Can modify request
│  beforeRequest (Plugin 2)           │
│  beforeRequest (Plugin N)           │
└─────────────────────────────────────┘
        │
        ▼
    Request sent to API
        │
        ▼
    AI processes, may call tools
        │
        ▼
┌─────────────────────────────────────┐
│  Tool executors run (if called)     │
└─────────────────────────────────────┘
        │
        ▼
    Response complete
        │
        ▼
┌─────────────────────────────────────┐
│  afterResponse (Plugin 1)           │  ◀── Can observe response
│  afterResponse (Plugin 2)           │
│  afterResponse (Plugin N)           │
└─────────────────────────────────────┘
```

### onRegister

Called when the plugin is registered via `client.use()`. Use for initialization.

```typescript
const plugin: HustlePlugin = {
  name: 'init-plugin',
  version: '1.0.0',
  hooks: {
    onRegister: async () => {
      console.log('Plugin registered!');

      // Initialize resources
      await loadConfiguration();

      // Validate environment
      if (!window.localStorage) {
        console.warn('localStorage not available');
      }
    },
  },
};
```

### beforeRequest

Called before each chat request is sent. **Can modify the request.**

**Signature:**
```typescript
beforeRequest: (request: HustleRequest) => HustleRequest | Promise<HustleRequest>
```

**What you can access in `HustleRequest`:**
```typescript
interface HustleRequest {
  id: string;                    // Chat session ID
  messages: ChatMessage[];       // Conversation history
  vaultId: string;               // Vault ID
  model?: string;                // Model being used
  apiKey?: string;               // API key (if using key auth)
  attachments?: Attachment[];    // Images/files
  selectedToolCategories?: string[];
  // ... and more
}
```

**Example: Inject User Context**
```typescript
const contextPlugin: HustlePlugin = {
  name: 'user-context',
  version: '1.0.0',
  hooks: {
    beforeRequest: (request) => {
      // Add user context as a system message
      const contextMessage = {
        role: 'system' as const,
        content: `User context:
- Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}
- Local time: ${new Date().toLocaleString()}
- Language: ${navigator.language}
- Platform: ${navigator.platform}`,
      };

      return {
        ...request,
        messages: [contextMessage, ...request.messages],
      };
    },
  },
};
```

**Example: Redact Sensitive Data**
```typescript
const privacyPlugin: HustlePlugin = {
  name: 'privacy-filter',
  version: '1.0.0',
  hooks: {
    beforeRequest: (request) => {
      const redactedMessages = request.messages.map((msg) => ({
        ...msg,
        content: msg.content
          .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN REDACTED]')
          .replace(/\b\d{16}\b/g, '[CARD REDACTED]')
          .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[EMAIL REDACTED]'),
      }));

      return { ...request, messages: redactedMessages };
    },
  },
};
```

**Example: Add Custom Headers Context**
```typescript
const sessionPlugin: HustlePlugin = {
  name: 'session-tracker',
  version: '1.0.0',
  hooks: {
    beforeRequest: (request) => {
      // Add session tracking to messages
      const sessionContext = {
        role: 'system' as const,
        content: `Session ID: ${sessionStorage.getItem('sessionId') || 'unknown'}`,
      };

      return {
        ...request,
        messages: [...request.messages, sessionContext],
      };
    },
  },
};
```

### afterResponse

Called after receiving a complete response. Use for logging, analytics, or side effects.

**Signature:**
```typescript
afterResponse: (response: ProcessedResponse) => void | Promise<void>
```

**What you can access in `ProcessedResponse`:**
```typescript
interface ProcessedResponse {
  content: string;               // AI's text response
  messageId: string | null;      // Message ID
  usage: TokenUsage | null;      // Token counts
  pathInfo: PathInfo | null;     // Cost tracking
  toolCalls: ToolCall[];         // Tools the AI called
  toolResults: ToolResult[];     // Results from tool executions
  reasoning: ReasoningInfo | null;
  intentContext: IntentContextInfo | null;
  devToolsInfo: DevToolsInfo | null;
}
```

**Example: Analytics Tracking**
```typescript
const analyticsPlugin: HustlePlugin = {
  name: 'analytics',
  version: '1.0.0',
  hooks: {
    afterResponse: async (response) => {
      // Track conversation metrics
      await fetch('/api/analytics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'chat_response',
          messageId: response.messageId,
          toolsUsed: response.toolCalls.map((t) => t.toolName),
          tokenUsage: response.usage,
          cost: response.pathInfo?.totalCost,
          timestamp: new Date().toISOString(),
        }),
      });
    },
  },
};
```

**Example: Response Notifications**
```typescript
const notificationPlugin: HustlePlugin = {
  name: 'notifications',
  version: '1.0.0',
  hooks: {
    afterResponse: (response) => {
      // Notify on urgent responses
      const urgentKeywords = ['urgent', 'immediately', 'critical', 'error', 'failed'];
      const isUrgent = urgentKeywords.some((kw) =>
        response.content.toLowerCase().includes(kw)
      );

      if (isUrgent && 'Notification' in window) {
        new Notification('Urgent AI Response', {
          body: response.content.slice(0, 100) + '...',
        });
      }
    },
  },
};
```

**Example: Response Caching**
```typescript
const cachePlugin: HustlePlugin = {
  name: 'response-cache',
  version: '1.0.0',
  hooks: {
    afterResponse: (response) => {
      // Cache responses for debugging/history
      const cache = JSON.parse(localStorage.getItem('responseCache') || '[]');
      cache.push({
        timestamp: Date.now(),
        content: response.content,
        tools: response.toolCalls.map((t) => t.toolName),
      });

      // Keep last 50 responses
      if (cache.length > 50) cache.shift();
      localStorage.setItem('responseCache', JSON.stringify(cache));
    },
  },
};
```

### onUnregister

Called when the plugin is removed via `client.unuse()`. Use for cleanup.

```typescript
const cleanupPlugin: HustlePlugin = {
  name: 'cleanup-plugin',
  version: '1.0.0',
  hooks: {
    onRegister: () => {
      // Set up interval
      (window as any).__myPluginInterval = setInterval(() => {
        console.log('Plugin heartbeat');
      }, 60000);
    },
    onUnregister: () => {
      // Clean up interval
      clearInterval((window as any).__myPluginInterval);
      console.log('Plugin cleaned up');
    },
  },
};
```

### Combining Hooks: Request/Response Transformation

Hooks can work together to transform data on the way out and reverse the transformation on the way back. This is powerful for PII protection, encryption, or localization.

**Example: PII Tokenization with Restoration**

This plugin anonymizes PII before sending to the API, then restores it in the response so the user sees their original data:

```typescript
const piiProtectionPlugin: HustlePlugin = {
  name: 'pii-protection',
  version: '1.0.0',

  hooks: {
    beforeRequest: (request) => {
      const tokenMap = new Map<string, string>();
      let tokenCounter = 0;

      const tokenize = (text: string): string => {
        return text
          // SSNs: 123-45-6789
          .replace(/\b\d{3}-\d{2}-\d{4}\b/g, (match) => {
            const token = `{{SSN_${++tokenCounter}}}`;
            tokenMap.set(token, match);
            return token;
          })
          // Email addresses
          .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/gi, (match) => {
            const token = `{{EMAIL_${++tokenCounter}}}`;
            tokenMap.set(token, match);
            return token;
          })
          // Phone numbers: (123) 456-7890 or 123-456-7890
          .replace(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, (match) => {
            const token = `{{PHONE_${++tokenCounter}}}`;
            tokenMap.set(token, match);
            return token;
          })
          // Credit card numbers (basic pattern)
          .replace(/\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, (match) => {
            const token = `{{CARD_${++tokenCounter}}}`;
            tokenMap.set(token, match);
            return token;
          });
      };

      // Tokenize all user messages
      const anonymizedMessages = request.messages.map((msg) => ({
        ...msg,
        content: typeof msg.content === 'string' ? tokenize(msg.content) : msg.content,
      }));

      // Store token map for response phase (scoped by request ID)
      if (typeof window !== 'undefined') {
        const maps = (window as any).__piiTokenMaps || new Map();
        maps.set(request.id, tokenMap);
        (window as any).__piiTokenMaps = maps;
      }

      console.log(`[PII] Tokenized ${tokenMap.size} sensitive values`);

      return { ...request, messages: anonymizedMessages };
    },

    afterResponse: (response) => {
      if (typeof window === 'undefined') return;

      const maps: Map<string, Map<string, string>> = (window as any).__piiTokenMaps;
      if (!maps) return;

      // Find the token map for this response (using messageId or iterate)
      // For simplicity, we'll restore from all active maps
      let restored = response.content;
      let restoredCount = 0;

      for (const [requestId, tokenMap] of maps) {
        for (const [token, original] of tokenMap) {
          if (restored.includes(token)) {
            restored = restored.replaceAll(token, original);
            restoredCount++;
          }
        }
        // Clean up after restoration
        maps.delete(requestId);
      }

      if (restoredCount > 0) {
        // Mutate the response object (passed by reference)
        response.content = restored;
        console.log(`[PII] Restored ${restoredCount} sensitive values`);
      }
    },
  },
};
```

**How it works:**

```
User: "My email is john@acme.com and SSN is 123-45-6789"
                    │
                    ▼
            ┌─────────────────┐
            │  beforeRequest  │
            └─────────────────┘
                    │
    Tokenized: "My email is {{EMAIL_1}} and SSN is {{SSN_2}}"
    Stored: { "{{EMAIL_1}}": "john@acme.com", "{{SSN_2}}": "123-45-6789" }
                    │
                    ▼
            ┌─────────────────┐
            │   AI (Server)   │  ← Only sees tokens, never real PII
            └─────────────────┘
                    │
    AI responds: "I've noted your email {{EMAIL_1}} and SSN {{SSN_2}}"
                    │
                    ▼
            ┌─────────────────┐
            │  afterResponse  │
            └─────────────────┘
                    │
    Restored: "I've noted your email john@acme.com and SSN 123-45-6789"
                    │
                    ▼
            User sees original values
```

**Key points:**
- The AI and server never see the actual PII - only tokens
- Token format `{{TYPE_N}}` is unlikely to appear naturally
- State is scoped by request ID to handle concurrent requests
- `afterResponse` mutates `response.content` directly (objects are passed by reference)

This pattern works for any reversible transformation: encryption/decryption, placeholder substitution, language translation, etc.

---

## Complete Examples

### Browser Tools Plugin

A plugin that provides browser-specific tools:

```typescript
const browserToolsPlugin: HustlePlugin = {
  name: 'browser-tools',
  version: '1.0.0',
  tools: [
    {
      name: 'get_page_info',
      description: 'Get information about the current web page',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'copy_to_clipboard',
      description: 'Copy text to the user clipboard',
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'Text to copy to clipboard',
          },
        },
        required: ['text'],
      },
    },
    {
      name: 'get_selection',
      description: 'Get the currently selected text on the page',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  ],
  executors: {
    get_page_info: async () => ({
      title: document.title,
      url: window.location.href,
      pathname: window.location.pathname,
      referrer: document.referrer,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
    }),

    copy_to_clipboard: async (args) => {
      await navigator.clipboard.writeText(args.text);
      return { success: true, copiedLength: args.text.length };
    },

    get_selection: async () => {
      const selection = window.getSelection();
      return {
        text: selection?.toString() || '',
        hasSelection: (selection?.toString().length || 0) > 0,
      };
    },
  },
};
```

### Full Lifecycle Plugin

A plugin demonstrating all hooks:

```typescript
const lifecyclePlugin: HustlePlugin = {
  name: 'lifecycle-demo',
  version: '1.0.0',
  tools: [
    {
      name: 'get_stats',
      description: 'Get plugin statistics',
      parameters: { type: 'object', properties: {} },
    },
  ],
  executors: {
    get_stats: async () => {
      const stats = JSON.parse(sessionStorage.getItem('pluginStats') || '{}');
      return stats;
    },
  },
  hooks: {
    onRegister: () => {
      console.log('[lifecycle-demo] Registered');
      sessionStorage.setItem('pluginStats', JSON.stringify({
        registeredAt: new Date().toISOString(),
        requestCount: 0,
        responseCount: 0,
        toolCalls: [],
      }));
    },

    beforeRequest: (request) => {
      console.log('[lifecycle-demo] Before request:', request.messages.length, 'messages');

      const stats = JSON.parse(sessionStorage.getItem('pluginStats') || '{}');
      stats.requestCount = (stats.requestCount || 0) + 1;
      stats.lastRequestAt = new Date().toISOString();
      sessionStorage.setItem('pluginStats', JSON.stringify(stats));

      return request;
    },

    afterResponse: (response) => {
      console.log('[lifecycle-demo] After response:', response.content.length, 'chars');

      const stats = JSON.parse(sessionStorage.getItem('pluginStats') || '{}');
      stats.responseCount = (stats.responseCount || 0) + 1;
      stats.lastResponseAt = new Date().toISOString();
      stats.toolCalls = [
        ...(stats.toolCalls || []),
        ...response.toolCalls.map((t) => t.toolName),
      ];
      sessionStorage.setItem('pluginStats', JSON.stringify(stats));
    },

    onUnregister: () => {
      console.log('[lifecycle-demo] Unregistered');
      const stats = JSON.parse(sessionStorage.getItem('pluginStats') || '{}');
      console.log('[lifecycle-demo] Final stats:', stats);
    },
  },
};
```

### Calculator Plugin

A simple utility plugin:

```typescript
const calculatorPlugin: HustlePlugin = {
  name: 'calculator',
  version: '1.0.0',
  tools: [
    {
      name: 'calculate',
      description: 'Perform mathematical calculations',
      parameters: {
        type: 'object',
        properties: {
          operation: {
            type: 'string',
            enum: ['add', 'subtract', 'multiply', 'divide', 'power', 'sqrt', 'percentage'],
            description: 'The operation to perform',
          },
          a: { type: 'number', description: 'First number' },
          b: { type: 'number', description: 'Second number (not needed for sqrt)' },
        },
        required: ['operation', 'a'],
      },
    },
  ],
  executors: {
    calculate: async (args) => {
      const { operation, a, b } = args;
      let result: number;

      switch (operation) {
        case 'add':
          result = a + b;
          break;
        case 'subtract':
          result = a - b;
          break;
        case 'multiply':
          result = a * b;
          break;
        case 'divide':
          if (b === 0) return { error: 'Division by zero' };
          result = a / b;
          break;
        case 'power':
          result = Math.pow(a, b);
          break;
        case 'sqrt':
          if (a < 0) return { error: 'Cannot take square root of negative number' };
          result = Math.sqrt(a);
          break;
        case 'percentage':
          result = (a / 100) * b;
          break;
        default:
          return { error: `Unknown operation: ${operation}` };
      }

      return { operation, a, b, result };
    },
  },
};
```

---

## Best Practices

### 1. Keep Executors Fast

Tool execution blocks the conversation flow. Keep executors lightweight:

```typescript
// Good: Quick local operation
executors: {
  get_time: async () => ({ time: new Date().toISOString() }),
}

// Caution: Network request (add timeout)
executors: {
  fetch_data: async (args) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(args.url, { signal: controller.signal });
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  },
}
```

### 2. Handle Errors Gracefully

Return error objects instead of throwing:

```typescript
executors: {
  risky_operation: async (args) => {
    try {
      const result = await doSomethingRisky(args);
      return { success: true, result };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
}
```

### 3. Write Clear Descriptions

The AI uses your descriptions to decide when to call tools:

```typescript
// Bad: Vague description
{
  name: 'do_thing',
  description: 'Does a thing',
}

// Good: Specific, actionable description
{
  name: 'format_currency',
  description: 'Format a number as currency with proper symbol and decimal places. Supports USD, EUR, GBP, and JPY. Returns formatted string like "$1,234.56".',
}
```

### 4. Validate Inputs

Don't trust AI-provided arguments blindly:

```typescript
executors: {
  send_email: async (args) => {
    const { to, subject, body } = args;

    // Validate email format
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return { error: 'Invalid email address' };
    }

    // Validate required fields
    if (!subject || !body) {
      return { error: 'Subject and body are required' };
    }

    // Proceed with validated inputs
    return await sendEmail({ to, subject, body });
  },
}
```

### 5. Use Hooks for Cross-Cutting Concerns

Don't duplicate logic in every tool:

```typescript
// Instead of adding logging to every executor...
const loggingPlugin: HustlePlugin = {
  name: 'logging',
  version: '1.0.0',
  hooks: {
    beforeRequest: (request) => {
      console.log('[LOG] Request:', request.messages.length, 'messages');
      return request;
    },
    afterResponse: (response) => {
      console.log('[LOG] Response:', response.toolCalls.length, 'tool calls');
    },
  },
};
```

### 6. Keep Plugins Focused

One plugin = one responsibility:

```typescript
// Good: Separate plugins
const timePlugin = { name: 'time-tools', /* ... */ };
const mathPlugin = { name: 'math-tools', /* ... */ };
const browserPlugin = { name: 'browser-tools', /* ... */ };

// Bad: Kitchen sink plugin
const everythingPlugin = { name: 'all-tools', /* 50 tools */ };
```

---

## TypeScript Types

Import types from the SDK:

```typescript
import type {
  HustlePlugin,
  ClientToolDefinition,
  ToolExecutor,
  JSONSchemaProperty,
  HustleRequest,
  ProcessedResponse,
  ChatMessage,
  ToolCall,
  ToolResult,
} from 'hustle-incognito';
```

### Type-Safe Executors

```typescript
interface CalculateArgs {
  operation: 'add' | 'subtract' | 'multiply' | 'divide';
  a: number;
  b: number;
}

interface CalculateResult {
  operation: string;
  a: number;
  b: number;
  result: number;
}

const typedExecutor: ToolExecutor<CalculateArgs, CalculateResult> = async (args) => {
  const { operation, a, b } = args;
  let result: number;

  switch (operation) {
    case 'add': result = a + b; break;
    case 'subtract': result = a - b; break;
    case 'multiply': result = a * b; break;
    case 'divide': result = a / b; break;
  }

  return { operation, a, b, result };
};
```

---

## Next Steps

- Check out the [examples](./examples) directory for working demos
- See [auth-demo-advanced.html](./examples/auth-demo-advanced.html) for a browser plugin manager UI
- Read the [README](./README.md) for SDK setup and configuration
