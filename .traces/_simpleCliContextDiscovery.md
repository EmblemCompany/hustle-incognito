# Context Discovery: Simple CLI Architecture Analysis

## Overview
This document analyzes the architecture and usage patterns of the `simple-cli.js` example, which demonstrates how to use the Hustle Incognito SDK client.

## Architecture Components

### 1. Package Structure

The SDK follows a modern TypeScript/JavaScript hybrid approach:

```
emblemvault-ai-sdk/
├── src/                    # TypeScript source files
│   ├── client.ts          # Main client implementation
│   ├── types.ts           # TypeScript interfaces and types
│   └── index.ts           # Main export file
├── dist/                   # Compiled output
│   ├── esm/               # ES Module build
│   └── cjs/               # CommonJS build
├── examples/              
│   └── simple-cli.js      # CLI example implementation
└── package.json           # Dual module support (ESM/CJS)
```

### 2. Build Configuration

From `package.json`:
- **Module Type**: ESM (`"type": "module"`)
- **Dual Module Support**: Exports both ESM and CommonJS builds
- **Build Process**:
  - ESM Build: `tsc --outDir ./dist/esm`
  - CJS Build: `tsc --module commonjs --outDir ./dist/cjs`
- **Entry Points**:
  - Main: `./dist/cjs/index.js`
  - Module: `./dist/esm/index.js`
  - Types: `./dist/esm/index.d.ts`

### 3. Client Architecture

#### Core Client (`src/client.ts`)

The `HustleIncognitoClient` class provides:

1. **Constructor Configuration**:
   - Required: `apiKey`
   - Optional: `hustleApiUrl`, `userKey`, `userSecret`, `debug`, `cookie`, `fetch`
   - Defaults to production API endpoint: `https://agenthustle.ai`

2. **Main Methods**:
   - `chat()`: Non-streaming chat interaction
   - `chatStream()`: Streaming chat with processed chunks
   - `rawStream()`: Low-level streaming access

3. **Request Flow**:
   - Prepares request body with `prepareRequestBody()`
   - Creates fetch request with proper headers
   - Handles streaming/non-streaming responses
   - Processes chunks into structured data

#### Type System (`src/types.ts`)

Key interfaces:
- `HustleIncognitoClientOptions`: Client configuration
- `ChatMessage`: Message structure with roles (user/assistant/system/tool)
- `StreamChunk`: Processed streaming data chunks
- `ProcessedResponse`: Assembled response from chunks
- `RawChunk`: Low-level stream data

### 4. CLI Implementation Analysis

#### Initialization Flow

```javascript
// 1. Dynamic import for ESM/CJS compatibility
const { HustleIncognitoClient } = await import('../dist/esm/index.js');

// 2. Environment configuration
dotenv.config();
const API_KEY = process.env.HUSTLE_API_KEY;
const VAULT_ID = process.env.VAULT_ID || 'default';

// 3. Client instantiation
let client = new HustleIncognitoClient({
  apiKey: API_KEY,
  debug: settings.debug
});
```

#### Key Features

1. **Command-Line Arguments**:
   - `--debug`: Enable debug logging
   - `--stream`: Enable streaming mode

2. **Runtime Commands**:
   - `/help`: Show available commands
   - `/settings`: Display current settings
   - `/stream on|off`: Toggle streaming mode
   - `/debug on|off`: Toggle debug mode
   - `/exit` or `/quit`: Exit application

3. **Conversation Management**:
   - Maintains message history array
   - Adds user/assistant messages to history
   - Passes full history to API for context

#### Streaming Implementation

The CLI implements a sophisticated streaming handler:

```javascript
async function streamResponse(messages) {
  let fullText = '';
  let toolCalls = [];
  
  for await (const chunk of client.chatStream({
    vaultId: VAULT_ID,
    messages,
    processChunks: true  // Important: Enables chunk processing
  })) {
    switch (chunk.type) {
      case 'text':
        process.stdout.write(chunk.value);
        fullText += chunk.value;
        break;
      case 'tool_call':
        toolCalls.push(chunk.value);
        break;
      case 'finish':
        process.stdout.write('\n');
        break;
    }
  }
  
  return fullText;
}
```

#### Non-Streaming Mode

```javascript
const response = await client.chat(
  messages,
  { vaultId: VAULT_ID }
);
console.log(`Agent: ${response.content}`);
```

### 5. Key Design Patterns

#### 1. Dynamic Client Reconfiguration
The CLI can reinitialize the client when settings change:

```javascript
if (parts[1] === 'on') {
  settings.debug = true;
  client = new HustleIncognitoClient({
    apiKey: API_KEY,
    debug: true
  });
}
```

#### 2. Error Handling
- Try-catch blocks around API calls
- Graceful error messages
- Conversation continues after errors

#### 3. Tool Call Logging
Both streaming and non-streaming modes log tool usage:

```javascript
if (toolCalls.length > 0) {
  console.log('\nTools used:');
  toolCalls.forEach((tool, i) => {
    console.log(`${i+1}. ${tool.toolName || 'Unknown tool'} (ID: ${tool.toolCallId || 'unknown'})`);
    if (tool.args) {
      console.log(`   Args: ${JSON.stringify(tool.args)}`);
    }
  });
}
```

### 6. SDK Usage Patterns

#### Basic Chat Flow
1. Initialize client with API key
2. Create message array with conversation history
3. Call `chat()` or `chatStream()` with messages
4. Process response (content, tool calls, etc.)
5. Add response to message history
6. Continue conversation loop

#### Streaming vs Non-Streaming
- **Streaming**: Real-time output, better UX for long responses
- **Non-Streaming**: Simpler implementation, wait for complete response
- Toggle-able at runtime without restarting

#### Debug Mode
- Logs timestamps with all operations
- Shows API endpoint being used
- Displays request/response details
- Helps troubleshoot integration issues

### 7. Integration Insights

The CLI demonstrates several best practices:

1. **Environment Configuration**: Uses dotenv for sensitive data
2. **Flexible Module Loading**: Dynamic imports for compatibility
3. **User Experience**: Clear prompts, help system, settings display
4. **State Management**: Maintains conversation context properly
5. **Error Recovery**: Continues operation after errors
6. **Real-time Feedback**: Streaming mode for responsive interaction

### 8. SDK Client Features

From analyzing the client implementation:

1. **Multi-Environment Support**: 
   - Custom API endpoints via `hustleApiUrl`
   - Environment variable fallbacks
   - Cookie authentication support

2. **Request Enrichment**:
   - Automatic vault ID handling
   - Slippage settings for trading operations
   - Safe mode toggle
   - External wallet address support

3. **Stream Processing**:
   - Raw stream access for custom processing
   - Processed chunks for easy consumption
   - Automatic chunk type detection

4. **Extensibility**:
   - Override functions for testing
   - Custom fetch implementation support
   - Debug logging throughout

### Conclusion

The simple-cli example effectively demonstrates the SDK's capabilities while providing a practical, user-friendly interface. It showcases both basic and advanced features of the client, making it an excellent reference implementation for SDK users.
