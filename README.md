# Emblem Vault Hustle Incognito SDK

> **Power your applications with EmblemVault's AI Agent Hustle API – the secure, intelligent assistant for crypto & web3.**

[![npm version](https://img.shields.io/npm/v/hustle-incognito.svg)](https://www.npmjs.com/package/hustle-incognito)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue)](https://www.typescriptlang.org/)
[![Maintainer](https://img.shields.io/badge/maintainer-genecyber-blue)](https://www.npmjs.com/~genecyber)

## ✨ Build an AI-powered CLI in 10 lines

```typescript
import { HustleIncognitoClient } from 'hustle-incognito';

// Create client with your API key
const client = new HustleIncognitoClient({
  apiKey: process.env.HUSTLE_API_KEY
});

// Get a response from the AI
const response = await client.chat([
  { role: 'user', content: 'What can you tell me about the current trending tokens on Solana?' }
], { vaultId: process.env.VAULT_ID });

console.log(response.content);
```

## 🚀 Features

- **Three Flexible Modes**: Simple request/response, processed streaming, or raw API output
- **Intelligent AI Agent**: Access to 25+ built-in crypto & web3 tools
- **Automatic Summarization**: Built-in conversation management for unlimited context
- **Both Browser & Node.js**: Works seamlessly in any JavaScript environment
- **Multiple Auth Options**: API key, JWT, or EmblemAuthSDK integration
- **Minimal Setup**: Production-ready with sensible defaults
- **Built for Testing**: Override pattern allows easy mocking

## 📝 Examples

Looking for complete, working examples? Check out the [`examples/`](./examples) directory:

- **[Auth Chat Demo](./examples/auth-demo-simple.html)** *(Recommended)* - Full-featured browser demo with EmblemAuthSDK, streaming, tool visualization, and summarization display
- **[Simple CLI](./examples/simple-cli.js)** - Interactive command-line chat with streaming, tool categories, and image upload
- **[HTTP Server](./examples/simple-server.js)** - REST API server with SSE streaming endpoint

See the [Examples README](./examples/README.md) for setup instructions, usage details, and additional examples.

## 📦 Installation

```bash
# Using npm
npm install hustle-incognito

# Using yarn
yarn add hustle-incognito

# Using pnpm
pnpm add hustle-incognito
```

## 🔑 Authentication

The SDK supports multiple authentication methods to suit different use cases:

### API Key (Server-Side)

The simplest method - provide your API key directly:

```typescript
const client = new HustleIncognitoClient({
  apiKey: 'your-api-key-here',
  // Optional configuration
  hustleApiUrl: 'https://agenthustle.ai', // Defaults to https://agenthustle.ai
  debug: true // Enable verbose logging
});
```

### EmblemAuthSDK Integration (Browser Apps)

For browser applications using the [Emblem Auth SDK](https://www.npmjs.com/package/@anthropic/auth-sdk), pass the SDK instance directly. The client will automatically use JWT authentication with session auto-refresh:

```typescript
import { EmblemAuthSDK } from '@anthropic/auth-sdk';

const authSdk = new EmblemAuthSDK({ appId: 'your-app-id' });
await authSdk.authenticate();

const client = new HustleIncognitoClient({
  sdk: authSdk,  // Pass the SDK instance directly
  debug: true
});

// vaultId is optional when using SDK auth - it will be auto-fetched from the session
const response = await client.chat([
  { role: 'user', content: 'Show me trending tokens' }
]);
```

### JWT Authentication

For custom JWT-based authentication:

```typescript
// Static JWT token
const client = new HustleIncognitoClient({
  jwt: 'your-jwt-token'
});

// Dynamic JWT getter (useful for token refresh)
const client = new HustleIncognitoClient({
  getJwt: async () => {
    const session = await fetchSession();
    return session.authToken;
  }
});
```

### Custom Auth Headers

For maximum flexibility, provide a custom headers function:

```typescript
const client = new HustleIncognitoClient({
  getAuthHeaders: async () => ({
    'Authorization': `Bearer ${await getToken()}`,
    'X-Custom-Header': 'value'
  })
});
```

### Authentication Priority

When multiple auth methods are provided, they are resolved in this order:
1. `getAuthHeaders()` - Custom headers (highest priority)
2. `apiKey` - Traditional x-api-key header
3. `jwt` / `getJwt()` / `sdk` - Bearer token authentication

## 🔍 Usage Modes

### 1️⃣ Simple Request/Response

Perfect for CLI tools or simple applications - send a message, get back a complete response:

```typescript
// Get a complete response
const response = await client.chat([
  { role: 'user', content: 'Show me the top Solana Tokens this week' }
], { vaultId: 'my-vault' });

console.log(response.content);
console.log(`Used ${response.usage?.total_tokens} tokens`);

// Tool calls are also available
if (response.toolCalls?.length > 0) {
  console.log('Agent used these tools:', response.toolCalls);
}
```

### 2️⃣ Processed Streaming (for interactive UIs)

Receive typed, structured chunks for building interactive experiences:

```typescript
// For UIs with streaming responses
for await (const chunk of client.chatStream({ 
  messages: [{ role: 'user', content: 'Show me the top Solana tokens this week' }],
  vaultId: 'my-vault',
  processChunks: true 
})) {
  switch (chunk.type) {
    case 'text':
      ui.appendText(chunk.value);
      break;
    case 'tool_call':
      ui.showToolInProgress(chunk.value);
      break;
    case 'tool_result':
      ui.showToolResult(chunk.value);
      break;
    case 'finish':
      ui.complete(chunk.value);
      break;
  }
}
```

### 3️⃣ Raw API Streaming (maximum control)

Direct access to the raw API stream format:

```typescript
// For maximum control and custom processing
for await (const rawChunk of client.rawStream({
  messages: [{ role: 'user', content: 'Find transactions for address 0x123...' }],
  vaultId: 'my-vault'
})) {
  // Raw chunks have prefix character and data
  console.log(`Received ${rawChunk.prefix}: ${rawChunk.raw}`);
  
  // Process different prefix types
  switch (rawChunk.prefix) {
    case '0': // Text chunk
      console.log('Text:', rawChunk.data);
      break;
    case '9': // Tool call
      console.log('Tool call:', rawChunk.data);
      break;
    case 'a': // Tool result
      console.log('Tool result:', rawChunk.data);
      break;
    case 'f': // Message ID
      console.log('Message ID:', rawChunk.data.messageId);
      break;
    case '2': // Path info
      console.log('Path info:', rawChunk.data);
      break;
    case 'e': // Completion event
    case 'd': // Final data
      console.log('Finished:', rawChunk.data);
      break;
  }
}
```

## 🛠 Tools

The Agent Hustle API has access to 25+ powerful tool categories for comprehensive crypto trading, analysis, and DeFi operations.

### Available Tools
*This list might not be exhaustive, use the getTools method to get the latest tools*

#### Core Trading Tools

- **Standard Tools**: Core trading toolbox with token research, contract addresses, strategic pricing, swaps, transfers, and persistent memory for end-to-end trading workflow management
- **PumpFun**: Discover trending memecoins, buy/sell tokens, create new tokens, and track graduation status across the complete PumpFun lifecycle
- **Meteora DBC** *(Premium)*: Management for Meteora's premier token launchpad with trending launches and position management
- **Launch Lab**: Complete Raydium LaunchLab project lifecycle management with trending launches, token verification, trading, and professional token creation
- **Conditional Trading**: Sophisticated automated buy/sell orders with stop-losses, take-profits, staged entries/exits, and professional order management
- **Liquidity Pools**: Professional yield farming across Orca, Meteora, Raydium with standard and concentrated liquidity strategies and position optimization

#### Analysis & Research Tools *(Premium)*

- **Solana Token Ecosystem**: Comprehensive token research combining security audits, holder analysis, real-time trading data, trending insights, and rugpull detection
- **Advanced Search**: Data extraction from any website, report, or online content transformed into structured, actionable intelligence
- **InfoFI**: Social intelligence with influencer credibility scoring, sentiment analysis, narrative tracking, and signal filtering
- **TVL Analysis**: DeFi protocol analytics with health metrics, capital flow tracking, cross-chain analysis, and token deployment insights
- **Stablecoins**: Market intelligence on stablecoin ecosystems with market cap dominance, growth trends, compliance profiles, and arbitrage opportunities
- **Companies & Protocols**: Protocol intelligence with security histories, fundraising data, treasury health, token unlocks, and institutional backing
- **Yield**: Comprehensive yield farming with APY comparisons, performance tracking, borrowing rates, perpetual funding, and liquid staking analysis
- **Perps**: Derivatives analytics with market overviews, protocol performance, volume tracking, growth analysis, and risk assessment
- **Users**: User analytics with active user tracking, growth momentum, retention metrics, and ecosystem maturity assessment
- **Narratives**: Crypto theme trading with narrative identification, lifecycle tracking, rotation patterns, and emerging theme discovery
- **Bridges**: Cross-chain bridge analytics with volume tracking, protocol performance, and liquidity trend analysis
- **Fees & Revenue**: Protocol financial intelligence with fee generation tracking, sustainability metrics, and fee-sharing opportunities
- **Coin Prices**: Real-time multi-chain price data and performance tracking across any tokens with arbitrage detection
- **DEX Volumes**: Comprehensive DEX analytics with market-wide volumes, chain competition data, and protocol performance metrics
- **Bitcoin Tools**: Complete Bitcoin assets analysis for Inscriptions, Runes, BRC-20s, Stamps, Alkanes, and rare sats
- **ETF Data**: Institutional crypto intelligence tracking Bitcoin/Ethereum ETF assets, flows, market share, and Grayscale holdings
- **Indices Data**: Advanced derivatives intelligence with futures basis analysis, whale positioning, and market health indicators
- **Spot Data**: Margin and premium analytics with Coinbase institutional premium, Bitfinex positioning, and cross-exchange rates
- **Options Data**: Comprehensive options analytics with open interest tracking, implied volatility analysis, and cross-exchange comparisons
- **On-Chain Data**: Exchange flow analytics with asset holdings, balance distributions, and transfer pattern analysis
- **Whale Analytics**: Hyperliquid whale intelligence with real-time alerts on million-dollar positions and smart money tracking
- **Platform Features**: Visual feedback, technical analysis visualization, and miscellaneous platform features

### Get tools list

To get a list of available tools, you can use the following API endpoint:

```typescript
const tools = await client.getTools();
console.log('Available tools:', tools);
```

#### ToolCategory Type

The `getTools()` method returns an array of `ToolCategory` objects. Each tool category represents a collection of related functionality:

```typescript
interface ToolCategory {
  /** Unique identifier for the tool category */
  id: string;
  /** Human-readable name of the tool category */
  title: string;
  /** Detailed description of what this tool category provides */
  description: string;
  /** Example use cases or queries that would trigger this tool category */
  examples: string[];
  /** UI color theme for this category */
  type: "analyst" | "trader";
  /** Whether this tool category requires a premium subscription */
  premium?: boolean;
}
```

#### Example Response

```typescript
const tools = await client.getTools();
// Example tool categories you might receive:

[
  {
    id: "standard-tools",
    title: "Standard Tools",
    description: "Core trading toolbox with token research, contract addresses, strategic pricing, swaps, transfers, and persistent memory",
    examples: [
      "What's the contract address for SOL?",
      "Help me swap 1 SOL for USDC",
      "Remember my preferred slippage settings"
    ],
    type: "trader"
  },
  {
    id: "solana-token-ecosystem",
    title: "Solana Token Ecosystem",
    description: "Comprehensive token research combining security audits, holder analysis, real-time trading data, trending insights, and rugpull detection",
    examples: [
      "Analyze the security of this token",
      "Show me holder distribution for BONK",
      "Is this token a potential rugpull?"
    ],
    type: "analyst",
    premium: true
  },
  {
    id: "info-fi",
    title: "InfoFI",
    description: "Social intelligence with influencer credibility scoring, sentiment analysis, narrative tracking, and signal filtering",
    examples: [
      "What are crypto influencers saying about Bitcoin?",
      "Track sentiment around this narrative",
      "Score this influencer's credibility"
    ],
    type: "analyst",
    premium: true
  }
]
```

#### Using Tool Categories

You can filter and select specific tool categories when making requests:

```typescript
// Get all available tool categories
const allTools = await client.getTools();

// Filter for trader-focused tools
const traderTools = allTools.filter(tool => tool.type === "trader");

// Filter for free tools only
const freeTools = allTools.filter(tool => !tool.premium);

// Use specific tool categories in your chat requests
const response = await client.chat([
  { role: 'user', content: 'Analyze trending Solana tokens' }
], { 
  vaultId: 'my-vault',
  selectedToolCategories: ['solana-token-ecosystem', 'standard-tools']
});
```

### Multiple Tool Execution

The API can execute multiple tools in a single conversation. For example, you can ask for trending tokens and a rugcheck in the same request:

```typescript
// Request that uses multiple tools
const response = await client.chat([
  { role: 'user', content: 'Check trending tokens and get token details for the top one' }
], { 
  vaultId: 'my-vault',
  selectedToolCategories: ['standard-tools']
});

// All tool calls are available in the response
console.log(`Number of tools used: ${response.toolCalls.length}`);

// Access individual tool calls by index or filter by tool name
const rugcheckCalls = response.toolCalls.filter(tool => tool.name === 'rugcheck');
const trendingCalls = response.toolCalls.filter(tool => tool.name === 'birdeye-trending');

// Tool results are also available
console.log('Tool results:', response.toolResults);
```

For streaming interfaces, you can observe multiple tool calls in real-time:

```typescript
for await (const chunk of client.chatStream({ 
  messages: [{ role: 'user', content: 'Check trending tokens and get token details for the top one' }],
  vaultId: 'my-vault',
  selectedToolCategories: ['standard-tools'],
  processChunks: true 
})) {
  if (chunk.type === 'tool_call') {
    console.log(`Tool called: ${chunk.value.toolCallId} (${chunk.value.toolName})`);
    // You can track which tools are being used
  } else if (chunk.type === 'tool_result') {
    console.log(`Tool result received for: ${chunk.value.toolCallId}`);
    // Match results to their corresponding tool calls
  }
}
```

### Accessing Tool Data

```typescript
// Get a complete response with tool calls and results
const response = await client.chat([
  { role: 'user', content: 'What is the current price of SOL in USD?' }
], {
  vaultId: 'my-vault',
  selectedToolCategories: ['standard-tools']
});

// Tool calls and results are available in the response
console.log('Tools called:', response.toolCalls);
console.log('Tool results:', response.toolResults);
```

For streaming interfaces, you can observe tool activity in real-time:****

```typescript
for await (const chunk of client.chatStream({ 
  messages: [{ role: 'user', content: 'Check the price of SOL in USD' }],
  vaultId: 'my-vault',
  selectedToolCategories: ['standard-tools'],
  processChunks: true 
})) {
  if (chunk.type === 'tool_call') {
    console.log('Agent is using tool:', chunk.value.name);
  } else if (chunk.type === 'tool_result') {
    console.log('Tool returned:', chunk.value);
  }
}
```

## 🔌 Plugin System (Client-Side Tools)

The SDK includes a powerful plugin system that allows you to extend the AI agent with custom client-side tools. Unlike server-side tools, these execute directly in your application.

### Registering Plugins

Use the `use()` method to register plugins:

```typescript
import { HustleIncognitoClient, HustlePlugin } from 'hustle-incognito';

const client = new HustleIncognitoClient({ apiKey: 'your-key' });

// Define a plugin with tools and executors
const myPlugin: HustlePlugin = {
  name: 'my-plugin',
  version: '1.0.0',
  tools: [
    {
      name: 'get_current_time',
      description: 'Get the current date and time',
      parameters: {
        type: 'object',
        properties: {
          timezone: { type: 'string', description: 'Timezone (e.g., UTC)' }
        }
      }
    }
  ],
  executors: {
    get_current_time: async (args) => {
      const tz = args.timezone || 'UTC';
      return { time: new Date().toISOString(), timezone: tz };
    }
  }
};

// Register the plugin
await client.use(myPlugin);
```

### Plugin Structure

```typescript
interface HustlePlugin {
  name: string;           // Unique plugin identifier
  version: string;        // Semantic version
  tools?: ClientToolDefinition[];  // Tool schemas sent to server
  executors?: Record<string, ToolExecutor>;  // Local execution functions
  hooks?: {
    onRegister?: () => void | Promise<void>;
    beforeRequest?: (req: HustleRequest) => HustleRequest | Promise<HustleRequest>;
    afterResponse?: (res: ProcessedResponse) => void | Promise<void>;
    onError?: (error: Error, context: ErrorContext) => void | Promise<void>;
  };
}
```

### Client-Side Tool Execution

When the AI model calls a client-side tool, the SDK automatically executes it locally:

```typescript
// Register plugin with tools
await client.use({
  name: 'browser-tools',
  version: '1.0.0',
  tools: [
    {
      name: 'get_page_title',
      description: 'Get the current page title',
      parameters: { type: 'object', properties: {} }
    }
  ],
  executors: {
    get_page_title: async () => ({ title: document.title })
  }
});

// When you chat, the model can now use this tool
const response = await client.chat([
  { role: 'user', content: 'What is the title of this page?' }
], { vaultId: 'my-vault' });
// The model will call get_page_title and receive the result
```

### Custom Tool Call Handler

For more control, use the `onToolCall` callback:

```typescript
for await (const chunk of client.chatStream({
  messages: [{ role: 'user', content: 'Take a screenshot' }],
  vaultId: 'my-vault',
  onToolCall: async (toolCall) => {
    // Custom handling for specific tools
    if (toolCall.toolName === 'take_screenshot') {
      const screenshot = await captureScreen();
      return { url: screenshot.url };
    }
    // Return undefined to use default executor
    return undefined;
  }
})) {
  // Process chunks
}
```

### Tool Execution Loop

The SDK supports multi-round tool execution where the model can call multiple tools in sequence:

```typescript
for await (const chunk of client.chatStream({
  messages: [{ role: 'user', content: 'Check the time and send an alert' }],
  vaultId: 'my-vault',
  maxToolRounds: 5,  // Maximum tool execution rounds (default: 5, 0 = unlimited)
})) {
  switch (chunk.type) {
    case 'tool_call':
      console.log('Tool called:', chunk.value.toolName);
      break;
    case 'tool_result':
      console.log('Tool result:', chunk.value.result);
      break;
  }
}
```

### Lifecycle Hooks

Plugins can hook into the request/response lifecycle:

```typescript
await client.use({
  name: 'logging-plugin',
  version: '1.0.0',
  hooks: {
    onRegister: () => console.log('Plugin registered'),
    beforeRequest: (req) => {
      console.log('Sending request:', req.messages.length, 'messages');
      return req; // Can modify the request
    },
    afterResponse: (res) => {
      console.log('Received response:', res.content?.slice(0, 50));
    },
    onError: (error) => {
      console.error('Error occurred:', error.message);
    }
  }
});
```

### Multiple Plugins

Register multiple plugins - they execute in registration order:

```typescript
await client.use(analyticsPlugin);
await client.use(browserToolsPlugin);
await client.use(customToolsPlugin);

// Or chain them
await client
  .use(plugin1)
  .then(c => c.use(plugin2))
  .then(c => c.use(plugin3));
```

## 📎 Image Attachments

The SDK supports attaching images to your prompts, allowing the AI agent to analyze visual content like charts, token logos, screenshots, or any other images relevant to your crypto queries.

### Uploading Images

Use the `uploadFile` method to upload an image and get an attachment object:

```typescript
// Upload an image file
const attachment = await client.uploadFile('./chart.png');

// Use the attachment in your chat request
const response = await client.chat([
  { role: 'user', content: 'Analyze this price chart and give me your insights' }
], {
  vaultId: 'my-vault',
  attachments: [attachment]
});
```

### Supported Image Formats

The SDK supports common image formats:
- **PNG** (`.png`)
- **JPEG** (`.jpg`, `.jpeg`)
- **GIF** (`.gif`)
- **WebP** (`.webp`)

**Note:** The SDK uses intelligent MIME type detection based on file content, not just file extensions. This means images without extensions or with incorrect extensions will still be properly identified.

### File Size Limits

- Maximum file size: **5MB**
- Files are automatically validated before upload

### Using Attachments with Streaming

Attachments work with all SDK modes including streaming:

```typescript
// Upload image first
const chartImage = await client.uploadFile('./trading-chart.png');

// Stream response with image analysis
for await (const chunk of client.chatStream({
  messages: [{ role: 'user', content: 'What do you see in this chart?' }],
  vaultId: 'my-vault',
  attachments: [chartImage],
  processChunks: true
})) {
  if (chunk.type === 'text') {
    process.stdout.write(chunk.value);
  }
}
```

### Multiple Images

You can attach multiple images to a single prompt:

```typescript
// Upload multiple images
const [chart1, chart2, screenshot] = await Promise.all([
  client.uploadFile('./btc-chart.png'),
  client.uploadFile('./eth-chart.png'),
  client.uploadFile('./dex-screenshot.png')
]);

// Send all images together
const response = await client.chat([
  { role: 'user', content: 'Compare these charts and analyze the trading interface' }
], {
  vaultId: 'my-vault',
  attachments: [chart1, chart2, screenshot]
});
```

### Custom File Names

You can provide a custom filename when uploading:

```typescript
// Upload with custom name
const attachment = await client.uploadFile('./temp/img12345.tmp', 'price-chart.png');
// attachment.name will be 'price-chart.png' instead of 'img12345.tmp'
```

### Images Without Extensions

The SDK can handle images without file extensions by detecting the format from the file content:

```typescript
// Upload an image without extension (MIME type auto-detected)
const attachment = await client.uploadFile('./screenshots/latest');
// The SDK will detect if it's PNG, JPEG, etc. from the file content
```

### Attachment Object Structure

The `uploadFile` method returns an `Attachment` object:

```typescript
interface Attachment {
  /** The name of the file */
  name: string;
  /** MIME type of the file (auto-detected from content) */
  contentType: string;
  /** URL to the uploaded file */
  url: string;
}

// Example attachment object:
{
  name: "chart.png",
  contentType: "image/png",  // Detected from file content, not extension
  url: "https://api.agenthustle.ai/uploads/abc123/chart.png"
}
```

### Error Handling

The upload method includes comprehensive error handling:

```typescript
try {
  const attachment = await client.uploadFile('./image.png');
} catch (error) {
  // Possible errors:
  // - File not found
  // - File too large (>5MB)
  // - Unsupported file type (not an image)
  // - Network/upload errors
  console.error('Upload failed:', error.message);
}
```

## 🧪 Testing Your Integration

The SDK supports an override pattern for easy testing without making real API calls:

```typescript
// Mock stream results for testing
const mockResponse = await client.chat(
  [{ role: 'user', content: 'Test message' }],
  { vaultId: 'test-vault' },
  async () => ({ content: 'Mocked response', toolCalls: [] })
);

// Mock stream chunks for testing UI
for await (const chunk of client.chatStream(
  { messages: [...], vaultId: 'test-vault' },
  async function* () {
    yield { type: 'text', value: 'Mocked ' };
    yield { type: 'text', value: 'streaming ' };
    yield { type: 'text', value: 'response' };
    yield { type: 'finish', value: { reason: 'stop' } };
  }
)) {
  // Process mocked chunks in tests
}
```

## 📜 Automatic Conversation Summarization

The SDK includes built-in support for automatic conversation summarization when token limits are approached. This allows for longer conversations without losing context.

### How It Works

Summarization is handled automatically by the SDK:

1. When your conversation approaches the token limit, the server indicates `thresholdReached: true`
2. The SDK automatically manages the summarization flow on subsequent requests
3. Older messages are summarized while recent context is preserved

### Accessing Summarization Data

When a summary is generated, it's available in the response:

```typescript
const response = await client.chat(messages, { vaultId: 'my-vault' });

// Check if summarization info is available
if (response.pathInfo?.summary) {
  console.log('Conversation summary:', response.pathInfo.summary);
  console.log('Summary covers messages up to index:', response.pathInfo.summaryEndIndex);
}

// Token usage info also includes summarization status
if (response.pathInfo?.thresholdReached) {
  console.log('Token threshold reached - conversation will be summarized');
}
```

### Streaming with Summarization

For streaming responses, summarization data appears in the `path_info` chunk:

```typescript
for await (const chunk of client.chatStream({
  messages,
  vaultId: 'my-vault',
  processChunks: true
})) {
  if (chunk.type === 'path_info') {
    const { summary, summaryEndIndex, thresholdReached } = chunk.value;
    if (summary) {
      console.log('Summary available:', summary);
    }
  }
}
```

### Token Usage Information

The `pathInfo` object includes comprehensive token tracking:

```typescript
interface PathInfo {
  inputTokens?: number;      // Tokens in your prompt
  outputTokens?: number;     // Tokens in the response
  totalTokens?: number;      // Total tokens used
  threshold?: number;        // Token limit threshold
  thresholdReached?: boolean; // Whether threshold was hit
  messageRetentionCount?: number; // Messages kept after summarization
  summary?: string;          // Conversation summary (when generated)
  summaryEndIndex?: number;  // Index where summary ends
  costUsd?: number;          // Estimated cost
}
```

## 🔐 Security

- Never hardcode API keys in your client code
- Use environment variables for sensitive credentials
- For browser applications, proxy requests through your backend

## 📚 Usage in Different Environments

### Node.js (CommonJS)

```javascript
const { HustleIncognitoClient } = require('hustle-incognito');

const client = new HustleIncognitoClient({ apiKey: process.env.HUSTLE_API_KEY });
// Use the client...
```

### Node.js (ESM) / Modern JavaScript

```javascript
import { HustleIncognitoClient } from 'hustle-incognito';

const client = new HustleIncognitoClient({ apiKey: process.env.HUSTLE_API_KEY });
// Use the client...
```

### TypeScript

```typescript
import { HustleIncognitoClient, ChatMessage, ToolCategory } from 'hustle-incognito';

const client = new HustleIncognitoClient({ apiKey: process.env.HUSTLE_API_KEY });
const messages: ChatMessage[] = [{ role: 'user', content: 'Hello' }];

// Get available tool categories
const tools: ToolCategory[] = await client.getTools();
console.log('Available tools:', tools);

// Use the client...
```

### Next.js (App Router)

```typescript
// app/api/chat/route.ts
import { HustleIncognitoClient } from 'hustle-incognito';

export async function POST(req: Request) {
  const { message, vaultId } = await req.json();

  const client = new HustleIncognitoClient({
    apiKey: process.env.HUSTLE_API_KEY!
  });

  const response = await client.chat(
    [{ role: 'user', content: message }],
    { vaultId: vaultId || 'default' }
  );

  return Response.json({ content: response.content });
}
```

### Next.js (Pages Router)

```typescript
// pages/api/hustle.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { HustleIncognitoClient } from 'hustle-incognito';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const client = new HustleIncognitoClient({
    apiKey: process.env.HUSTLE_API_KEY!
  });

  const response = await client.chat(
    req.body.messages,
    { vaultId: req.body.vaultId || 'default' }
  );

  res.status(200).json(response);
}
```

### Express Server

```javascript
import express from 'express';
import { HustleIncognitoClient } from 'hustle-incognito';

const app = express();
app.use(express.json());

const client = new HustleIncognitoClient({
  apiKey: process.env.HUSTLE_API_KEY
});

// Non-streaming endpoint
app.post('/api/chat', async (req, res) => {
  const { message, vaultId } = req.body;

  const response = await client.chat(
    [{ role: 'user', content: message }],
    { vaultId: vaultId || 'default' }
  );

  res.json({ content: response.content });
});

// Streaming endpoint with Server-Sent Events
app.post('/api/chat/stream', async (req, res) => {
  const { message, vaultId } = req.body;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  for await (const chunk of client.chatStream({
    messages: [{ role: 'user', content: message }],
    vaultId: vaultId || 'default',
    processChunks: true
  })) {
    if (chunk.type === 'text') {
      res.write(`data: ${JSON.stringify({ text: chunk.value })}\n\n`);
    }
  }

  res.end();
});

app.listen(3000, () => console.log('Server running on port 3000'));
```

### Browser (via bundler)

```typescript
import { HustleIncognitoClient } from 'hustle-incognito';

// NOTE: For security, you should proxy API requests through your backend
// rather than including API keys in client-side code
const client = new HustleIncognitoClient({
  apiKey: 'YOUR_API_KEY', // Better to fetch this from your backend
  hustleApiUrl: '/api/hustle-proxy' // Proxy through your backend
});

// Use the client...
```

### CDN Usage (Browser)

For quick prototyping or simple browser applications, you can load the SDK directly from a CDN using ES modules:

```html
<script type="module">
  import { HustleIncognitoClient } from 'https://unpkg.com/hustle-incognito@latest/dist/browser/hustle-incognito.esm.js';

  const client = new HustleIncognitoClient({
    apiKey: 'your-api-key',
    debug: true
  });

  const response = await client.chat([
    { role: 'user', content: 'Hello!' }
  ], { vaultId: 'your-vault-id' });

  console.log(response.content);
</script>
```

Alternative CDNs:
- **unpkg**: `https://unpkg.com/hustle-incognito@latest/dist/browser/hustle-incognito.esm.js`
- **jsDelivr**: `https://cdn.jsdelivr.net/npm/hustle-incognito@latest/dist/browser/hustle-incognito.esm.js`
- **Specific version**: `https://unpkg.com/hustle-incognito@0.2.6/dist/browser/hustle-incognito.esm.js`

#### With EmblemAuthSDK (Recommended for Production)

For production browser apps, combine with EmblemAuthSDK for secure JWT authentication:

```html
<!-- Load EmblemAuthSDK (UMD build) -->
<script src="https://unpkg.com/emblem-auth-sdk@latest/dist/emblem-auth.min.js"></script>

<script type="module">
  import { HustleIncognitoClient } from 'https://unpkg.com/hustle-incognito@latest/dist/browser/hustle-incognito.esm.js';

  // Initialize auth (EmblemAuth is available globally from UMD build)
  const auth = new EmblemAuth.EmblemAuthSDK({ appId: 'your-app-id' });

  // Wait for user authentication
  auth.on('session', (session) => {
    // Create Hustle client with SDK auth (JWT auto-refresh)
    const client = new HustleIncognitoClient({
      sdk: auth,
      debug: true
    });

    // Now you can use the client
    // vaultId is automatically fetched from the session
  });

  // Open auth modal
  auth.openAuthModal();
</script>
```

See the [Auth Chat Demo](./examples/auth-demo-simple.html) for a complete working example.

## 🛠️ Contributing & Development

Want to contribute to the SDK? Here's how to get started:

### Setup

```bash
# Clone the repository
git clone https://github.com/EmblemCompany/hustle-incognito.git
cd hustle-incognito

# Install dependencies
npm install

# Build the SDK
npm run build
```

### Testing

```bash
# Run all tests
npm test

# Watch mode for development
npm run test:watch
```

### Build System

The SDK uses a dual package approach to support both ESM and CommonJS:

```bash
# Build both versions (ESM + CommonJS)
npm run build

# Build individually
npm run build:esm
npm run build:cjs
```

### Running Examples

See the [Examples README](./examples/README.md) for instructions on running the example applications.

### Publishing

```bash
# Prepare for publishing (runs tests, lint, and build)
npm version patch # or minor, or major
npm publish
```

## 📄 License

MIT
