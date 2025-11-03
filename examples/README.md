# Hustle Incognito Examples

This directory contains example implementations demonstrating how to use the Hustle Incognito SDK.

## Important Note: Development vs Production

These examples are configured to use the **local build** for development purposes.

### Running Examples from the Repository

If you've cloned this repository, you need to build the SDK first:

```bash
# Install dependencies
npm install

# Build the SDK
npm run build

# Now you can run the examples
npm run example:cli
npm run example:server
```

### Using Examples in Your Own Projects

To use these examples in your own projects with the published npm package:

1. Install the package: `npm install hustle-incognito`
2. In each example file, swap the import statements:
   ```javascript
   // Comment out the local import:
   // const { HustleIncognitoClient } = await import('../dist/esm/index.js');

   // Uncomment the npm package import:
   const { HustleIncognitoClient } = await import('hustle-incognito');
   ```

The examples include both import statements with instructions in the code.

## Examples

### 1. Simple CLI (`simple-cli.js`)

An interactive command-line interface for chatting with the Hustle Incognito agent.

**Features:**
- Interactive conversation mode
- Streaming and non-streaming responses
- Tool category selection
- Image upload support
- Message history management
- Runtime configuration (API key, vault ID, base URL)

**Usage:**

```bash
# Run the CLI
npm run example:cli

# Run with streaming enabled by default
npm run example:cli:stream

# Or run directly
node examples/simple-cli.js
node examples/simple-cli.js --stream
node examples/simple-cli.js --debug
```

**Available Commands:**
- `/help` - Show help message
- `/settings` - Show current settings
- `/stream on|off` - Toggle streaming mode
- `/debug on|off` - Toggle debug mode
- `/history on|off` - Toggle message history retention
- `/clear` - Clear conversation history
- `/baseurl <url>` - Set API base URL
- `/apikey <key>` - Set API key
- `/vaultid <id>` - Set vault ID
- `/tools` - Manage tool categories
- `/image <path>` - Upload an image
- `/exit` or `/quit` - Exit the application

### 2. Simple Server (`simple-server.js`)

A basic HTTP server demonstrating both streaming and non-streaming API endpoints.

**Features:**
- RESTful API endpoints
- Server-Sent Events (SSE) for streaming
- Non-streaming JSON responses
- CORS support
- Health check endpoint

**Usage:**

```bash
# Run the server (default port: 3000)
npm run example:server

# Run on custom port
node examples/simple-server.js --port 8080
```

**Endpoints:**

#### GET /health
Health check endpoint

```bash
curl http://localhost:3000/health
```

#### POST /api/chat
Non-streaming chat endpoint

**Request Body:**
```json
{
  "message": "What is Solana?",
  "vaultId": "default",
  "selectedToolCategories": ["market_data"],
  "messages": [
    { "role": "user", "content": "What is Solana?" }
  ]
}
```

**Example:**
```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What is Solana?", "vaultId": "default"}'
```

**Response:**
```json
{
  "content": "Solana is a high-performance blockchain...",
  "messageId": "msg_123",
  "toolCalls": [],
  "toolResults": [],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 50,
    "total_tokens": 60
  }
}
```

#### POST /api/chat/stream
Streaming chat endpoint (Server-Sent Events)

**Request Body:**
```json
{
  "message": "What is Solana?",
  "vaultId": "default",
  "selectedToolCategories": ["market_data"]
}
```

**Example:**
```bash
curl -X POST http://localhost:3000/api/chat/stream \
  -H "Content-Type: application/json" \
  -d '{"message": "What is Solana?", "vaultId": "default"}' \
  -N
```

**Response (Server-Sent Events):**
```
event: text
data: {"text":"Solana"}

event: text
data: {"text":" is"}

event: text
data: {"text":" a"}

event: tool_call
data: {"toolCallId":"call_123","toolName":"market_data","args":{}}

event: tool_result
data: {"toolCallId":"call_123","result":{}}

event: finish
data: {"reason":"stop","usage":{},"fullText":"Solana is..."}
```

**SSE Event Types:**
- `text` - Streamed text content
- `tool_call` - Tool/function call made by the agent
- `tool_result` - Result from a tool call
- `message_id` - Message ID from the API
- `path_info` - Path information (if available)
- `finish` - Stream completion with metadata
- `error` - Error information

## Environment Variables

Create a `.env` file in the root directory:

```env
# Required
HUSTLE_API_KEY=your-api-key-here

# Optional
VAULT_ID=default
HUSTLE_API_URL=https://agenthustle.ai
DEBUG=false
```

## Copying Examples to Your Projects

To use these examples in your own projects:

### Quick Start

1. **Install the package:**
   ```bash
   npm install hustle-incognito dotenv
   ```

2. **Copy the example file** to your project:
   ```bash
   # For CLI
   cp examples/simple-cli.js my-project/hustle-cli.js

   # For Server
   cp examples/simple-server.js my-project/server.js
   ```

3. **Update the import** (see line ~8 in each file):
   ```javascript
   // Change from:
   const { HustleIncognitoClient } = await import('../dist/esm/index.js');

   // To:
   const { HustleIncognitoClient } = await import('hustle-incognito');
   ```

4. **Create your `.env` file:**
   ```env
   HUSTLE_API_KEY=your-api-key-here
   VAULT_ID=your-vault-id
   HUSTLE_API_URL=https://agenthustle.ai  # Optional
   ```

5. **Run your application:**
   ```bash
   node hustle-cli.js
   # or
   node server.js
   ```

## Notes

- The CLI example demonstrates client-side usage patterns
- The server example demonstrates server-side API integration
- Both examples support the full feature set of the Hustle Incognito SDK
- For production use, add proper error handling, rate limiting, and authentication
- Examples use local build during development; switch to npm package for production
