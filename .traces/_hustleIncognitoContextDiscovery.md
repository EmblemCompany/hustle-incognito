# Hustle Incognito SDK Context Documentation

## Purpose
This comprehensive guide provides an in-depth look at the Hustle Incognito SDK, covering its architecture, API reference, and best practices for effective usage. It serves as a complete resource for LLMs and developers to understand and integrate the SDK into their applications.

## Quick Start

Get started with the Hustle Incognito SDK in just a few steps:

```javascript
// 1. Install the SDK
npm install @emblemcompany/emblemvault-ai-sdk

// 2. Basic usage
import { HustleIncognitoClient } from 'hustle-incognito';

const client = new HustleIncognitoClient({
  apiKey: 'your-api-key'  // Scoped to a specific vault
});

// Non-streaming chat
const response = await client.chat([
  { role: 'user', content: 'What is the price of SOL?' }
]);

// Streaming chat
for await (const chunk of client.chatStream({
  messages: [{ role: 'user', content: 'Explain DeFi' }],
  vaultId: 'my-vault'
})) {
  if (chunk.type === 'text') {
    process.stdout.write(chunk.value);
  }
}
```

## Table of Contents
1. [Overview](#overview)
2. [Core Architecture](#core-architecture)
3. [API Reference](#api-reference)
4. [Authentication & Configuration](#authentication--configuration)
5. [Key Classes and Methods](#key-classes-and-methods)
6. [Common Usage Patterns](#common-usage-patterns)
7. [Example Analysis](#example-analysis)
8. [Advanced Features](#advanced-features)
9. [Best Practices](#best-practices)
10. [Cross-Reference Guide](#cross-reference-guide)

## Overview

The Hustle Incognito SDK (also known as EmblemVault AI SDK) is a modern TypeScript/JavaScript library that provides a client for interacting with the Hustle AI agent platform. The SDK supports both ESM and CommonJS modules, offers streaming and non-streaming chat capabilities, and includes sophisticated error handling and debug features.

### Key Features
- **Dual Module Support**: Works with both ESM and CommonJS projects
- **Streaming Support**: Real-time response streaming for better UX  
- **Tool Call Integration**: Access to 40+ tools for DeFi operations, token analysis, and more
- **Debug Mode**: Comprehensive logging for troubleshooting
- **Flexible Configuration**: Environment variables and runtime settings
- **Conversation Management**: Client-side control over message history
- **Multi-User Support**: Separate vaults for different contexts and users
- **Stateless Design**: SDK doesn't persist conversation state between calls

## API Reference

### HustleIncognitoClient

The main client class for interacting with the Hustle AI platform.

#### Constructor
```typescript
new HustleIncognitoClient(options: HustleIncognitoClientOptions)
```

**Options:**
- `apiKey` (required): Your API key for authentication
- `hustleApiUrl` (optional): Custom API endpoint (defaults to `https://agenthustle.ai`)
- `userKey` (optional): User-specific key for context
- `userSecret` (optional): Secret associated with userKey
- `debug` (optional): Enable debug logging
- `cookie` (optional): Cookie for authentication with Vercel
- `fetch` (optional): Custom fetch implementation

#### Methods

##### chat()
Non-streaming chat interaction.

```typescript
async chat(
  messages: ChatMessage[],
  options?: {
    vaultId: string;
    userApiKey?: string;
    externalWalletAddress?: string;
    slippageSettings?: Record<string, number>;
    safeMode?: boolean;
    rawResponse?: boolean;
  }
): Promise<ProcessedResponse | RawChunk[]>
```

##### chatStream()
Streaming chat with processed chunks.

```typescript
async *chatStream(
  options: StreamOptions
): AsyncIterable<StreamChunk>
```

##### rawStream()
Low-level streaming access for custom processing.

```typescript
async *rawStream(
  options: {
    vaultId: string;
    messages: ChatMessage[];
    // ... other options
  }
): AsyncIterable<RawChunk>
```

## Authentication & Configuration

### Vault & API Key Architecture

The Hustle Incognito SDK uses a sophisticated authentication system based on vaults and API keys:

#### Vaults
- **HD TEE Wallets**: Vaults are Hierarchical Deterministic (HD) Trusted Execution Environment (TEE) wallets
- **Co-ownership**: Each vault is co-owned by the user and the agent
- **User Binding**: A vault is bound to a specific user
- **Isolation**: Each vault provides isolated context for conversations and operations

#### API Keys
- **Generation**: API keys are generated using Hustle v2 auth (typically via SIWE - Sign-In With Ethereum message signature)
- **Scope**: Each API key is scoped to a single vault
- **Security**: Keys provide secure access to vault-specific operations and tools

```javascript
// API key is vault-scoped
const client = new HustleIncognitoClient({
  apiKey: 'vault-specific-api-key'
});

// Different vaults for different contexts
const tradingClient = new HustleIncognitoClient({
  apiKey: 'trading-vault-api-key'
});

const researchClient = new HustleIncognitoClient({
  apiKey: 'research-vault-api-key'
});
```

### Environment Variables

```bash
HUSTLE_API_KEY=your-api-key-here
VAULT_ID=your-vault-id
HUSTLE_API_URL=https://agenthustle.ai  # Optional custom endpoint
COOKIE=your-cookie  # Optional for Vercel auth
```

### Client Initialization

```javascript
import { HustleIncognitoClient } from 'hustle-incognito';

const client = new HustleIncognitoClient({
  apiKey: process.env.HUSTLE_API_KEY,
  debug: true  // Enable debug logging
});
```

## Key Classes and Methods

### Core Types

#### ChatMessage
Represents a message in the conversation.

```typescript
interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  name?: string;
  parts?: MessagePart[];
}
```

#### StreamChunk
Represents a chunk of data from the streaming API.

```typescript
interface StreamChunk {
  type: 'text' | 'tool_call' | 'tool_call_delta' | 
        'tool_result' | 'message_id' | 'path_info' | 
        'error' | 'finish' | 'unknown';
  value: string | ToolCall | ToolResult | any;
}
```

#### ProcessedResponse
The assembled response from non-streaming or processed streaming.

```typescript
interface ProcessedResponse {
  content: string;
  messageId: string | null;
  usage: any | null;
  pathInfo: any | null;
  toolCalls: any[];
  toolResults: any[];
}
```

#### StreamOptions
Configuration for streaming requests.

```typescript
interface StreamOptions {
  vaultId: string;
  messages: ChatMessage[];
  userApiKey?: string;
  externalWalletAddress?: string;
  slippageSettings?: Record<string, number>;
  safeMode?: boolean;
  currentPath?: string | null;
  processChunks?: boolean;  // Important for structured streaming
}
```

### Request Configuration

#### Slippage Settings
Controls tolerance for price movements in trading operations:

```javascript
slippageSettings: {
  lpSlippage: 5,    // Liquidity pool operations
  swapSlippage: 5,  // Token swaps
  pumpSlippage: 5   // Pump operations
}
```

#### Safe Mode
When enabled (default), provides additional safety checks for operations.

## Common Usage Patterns

### Basic Setup and Initialization

```javascript
// 1. Import the SDK (ESM)
import { HustleIncognitoClient } from 'hustle-incognito';

// OR Dynamic import for compatibility
const { HustleIncognitoClient } = await import('hustle-incognito');

// 2. Load environment variables
import dotenv from 'dotenv';
dotenv.config();

// 3. Initialize the client
const client = new HustleIncognitoClient({
  apiKey: process.env.HUSTLE_API_KEY,
  debug: true  // Optional: Enable debug logging
});
```

### Conversation State Management

**Important**: The SDK is stateless - conversation history must be managed by your application:

```javascript
// Client manages conversation history
const messages = [];

// Add user message
messages.push({ role: 'user', content: 'What is the price of SOL?' });

// Send full conversation history
const response = await client.chat(messages);

// Add assistant response to history
messages.push({ 
  role: 'assistant', 
  content: response.content 
});

// Next request includes full history
messages.push({ role: 'user', content: 'How about ETH?' });
const nextResponse = await client.chat(messages);
```

This design pattern provides:
- **Full Control**: Manage conversation length and context
- **Flexibility**: Implement custom windowing or filtering
- **Persistence**: Store conversations in your preferred database
- **Privacy**: Conversations are not stored server-side between requests

### Non-Streaming Chat

```javascript
// Simple chat request
const messages = [
  { role: 'user', content: 'What is the current price of SOL?' }
];

const response = await client.chat(messages, { 
  vaultId: 'default' 
});

console.log('Response:', response.content);

// Check for tool usage
if (response.toolCalls && response.toolCalls.length > 0) {
  response.toolCalls.forEach(tool => {
    console.log(`Tool used: ${tool.toolName}`);
  });
}
```

### Streaming Chat

```javascript
// Stream responses for better UX
const messages = [
  { role: 'user', content: 'Explain how to swap tokens on Solana' }
];

for await (const chunk of client.chatStream({
  vaultId: 'default',
  messages,
  processChunks: true  // Important: Enables structured chunks
})) {
  switch (chunk.type) {
    case 'text':
      process.stdout.write(chunk.value);
      break;
    case 'tool_call':
      console.log('\nTool called:', chunk.value);
      break;
    case 'finish':
      console.log('\nResponse complete');
      break;
  }
}
```

### Advanced Configuration

```javascript
// Trading operations with custom settings
const response = await client.chat(messages, {
  vaultId: 'trading-vault',
  externalWalletAddress: 'Your-Solana-Wallet-Address',
  slippageSettings: {
    lpSlippage: 3,      // Lower slippage for LP operations
    swapSlippage: 2,    // Tighter slippage for swaps
    pumpSlippage: 10    // Higher tolerance for pump operations
  },
  safeMode: true  // Enable safety checks
});
```

### Error Handling

```javascript
try {
  const response = await client.chat(messages, { vaultId: 'default' });
  console.log(response.content);
} catch (error) {
  if (error.message.includes('HTTP error: 401')) {
    console.error('Invalid API key');
  } else if (error.message.includes('HTTP error: 429')) {
    console.error('Rate limit exceeded');
  } else {
    console.error('Error:', error.message);
  }
}
```

## Available Tools

The Hustle Incognito SDK provides access to over 40 tools for comprehensive DeFi operations:

### Token Information & Analysis
- **birdeye-trending** - Get trending tokens with real-time price and market data across multiple chains
- **birdeye-trade** - Get detailed trade data including recent trades and market metrics
- **getTokenPrices** - Get current token prices
- **rugcheck** - Check if a token is potentially a scam
- **holderScan** - Get token holder information
- **sniffToken** - Audit token details for security analysis
- **alpha** - Search for alpha opportunities on projects and tokens

### Token Trading & Swapping
- **findSwapToken** - Find Solana tokens by name or symbol for swapping
- **swap** - Perform token swaps on Solana
- **swapQuote** - Get quotes for token swaps
- **transferSol** - Transfer SOL or tokens to another wallet
- **setSlippageSettings** - Configure slippage preferences for trades

### PumpFun Integration
- **getPumpFunTokens** - Query PumpFun tokens (new, graduating, or graduated)
- **buyPumpFunTokens** - Buy PumpFun tokens
- **sellPumpFunTokens** - Sell PumpFun tokens
- **isPumpfunTokenGraduated** - Check if a PumpFun token has graduated
- **deployPumpFunToken** - Create new PumpFun tokens

### Raydium LaunchLab
- **buyRaydiumLaunchLabToken** - Buy Raydium LaunchLab tokens
- **sellRaydiumLaunchLabToken** - Sell Raydium LaunchLab tokens
- **createRaydiumLaunchLabToken** - Create new LaunchLab tokens
- **getRaydiumLaunchLabTokens** - Get LaunchLab tokens for an address
- **isRaydiumLaunchLabToken** - Check if a token is from LaunchLab

### Liquidity Pool Management

#### Standard AMM Pools
- **findLPPoolsForPair** - Find liquidity pools for token pairs
- **addAMMLPPosition** - Add liquidity to standard AMM pools
- **removeAMMLPPosition** - Remove liquidity from AMM pools
- **calculateAMMLPAmount** - Calculate token amounts for AMM liquidity

#### Concentrated Liquidity (CLMM)
- **openCLMMLPPosition** - Open concentrated liquidity positions
- **removeCLMMLPPosition** - Remove concentrated liquidity positions
- **getCLMMPositions** - Get all concentrated positions for a user
- **getCLMMDefaultPriceBoundary** - Get recommended price boundaries
- **increaseCLMMLiquidity** - Increase liquidity in concentrated positions
- **calculateCLMMLPAmount** - Calculate token amounts for concentrated liquidity

#### Platform-Specific Pools
- **getMeteoraDLMMPools** - Get Meteora DLMM pools
- **getMeteoraDAMMPools** - Get Meteora DAMM pools
- **getMeteoraLSTPools** - Get Meteora LST pools
- **getOrcaPools** - Get Orca pools information

### Trading Automation
- **createDCAOrder** - Create dollar-cost averaging orders
- **cancelDCAOrder** - Cancel DCA orders
- **getDCAOrders** - Get all DCA orders
- **createLimitOrder** - Create limit orders to buy/sell tokens
- **cancelLimitOrder** - Cancel limit orders
- **getLimitOrders** - Get limit orders for a wallet
- **getTokenPairPriceForLimitOrder** - Get token pair prices for limit orders

### Wallet & Vault Management
- **wallet** - Get connected wallet and vault info
- **balances** - Get wallet balances
- **depositSol** - Deposit SOL to connected vault
- **viewAPIKey** - View current API key
- **copyAPIKey** - Copy API key to clipboard

### Data & Knowledge Management
- **memoryStorage** - Store conversation messages in memory
- **memoryRetrieval** - Search memory system for information
- **graphDataStorage** - Store structured data in knowledge graph
- **websearch** - Search the web for information

### Utility Functions
- **currentUnixTimestamp** - Get current Unix timestamp
- **calculateAdjustedPrice** - Calculate price adjustments
- **viewChart** - View trading chart for a token
- **displayRecommendedTokensToBuy** - Display token recommendations
- **confetti** - Trigger confetti animation

### Event Triggers
- **triggerOnSwapSuccess** - Trigger event after successful swap
- **triggerOnAddLiquidity** - Trigger event after adding liquidity
- **triggerOnBuyPumpFunTokens** - Trigger event after buying PumpFun tokens

## Advanced Features

### Streaming Utilities

The SDK provides sophisticated streaming capabilities that can be leveraged for various use cases:

#### Real-time Processing
```javascript
// Process chunks as they arrive
for await (const chunk of client.chatStream(options)) {
  switch (chunk.type) {
    case 'text':
      // Update UI immediately
      updateChatUI(chunk.value);
      break;
    case 'tool_call':
      // Show tool usage in real-time
      showToolIndicator(chunk.value);
      break;
    case 'path_info':
      // Update navigation context
      updatePathContext(chunk.value);
      break;
  }
}
```

#### Custom Stream Processing
```javascript
// Use rawStream for custom processing
for await (const rawChunk of client.rawStream(options)) {
  // rawChunk has: { prefix, data, raw }
  if (rawChunk.prefix === '0') {
    // Text content
    processText(rawChunk.data);
  } else if (rawChunk.prefix === '8') {
    // Tool calls
    processTool(JSON.parse(rawChunk.data));
  }
}
```

### Debug Mode Features

The SDK provides comprehensive debugging capabilities:

```javascript
// Enable debug mode for detailed logging
const client = new HustleIncognitoClient({
  apiKey: API_KEY,
  debug: true
});

// Debug output includes:
// - Timestamps for all operations
// - API endpoint information
// - Request/response details
// - Stream chunk processing
// - Error stack traces
```

### Error Recovery

The SDK supports graceful error handling:

```javascript
// Implement retry logic
async function chatWithRetry(messages, options, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await client.chat(messages, options);
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      
      // Exponential backoff
      const delay = Math.pow(2, i) * 1000;
      console.log(`Retry ${i + 1} after ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
```

## Best Practices

### 1. Vault Management

Use descriptive vault IDs to organize different contexts:

```javascript
// Use specific vaults for different purposes
const tradingVault = 'trading-strategies';
const researchVault = 'market-research';
const generalVault = 'general-assistant';

// Switch vaults based on context
const vaultId = isTrading ? tradingVault : generalVault;
```

### 2. Message History

Maintain clean conversation history:

```javascript
// Limit conversation history to prevent token overflow
const MAX_HISTORY = 20;

function addToHistory(messages, newMessage) {
  messages.push(newMessage);
  
  // Keep only recent messages
  if (messages.length > MAX_HISTORY) {
    // Keep system message if present
    const systemMsg = messages.find(m => m.role === 'system');
    const recentMsgs = messages.slice(-MAX_HISTORY);
    
    return systemMsg ? [systemMsg, ...recentMsgs] : recentMsgs;
  }
  
  return messages;
}
```

### 3. Stream vs Non-Stream Decision

Choose the appropriate method based on use case:

```javascript
// Use streaming for:
// - Interactive applications
// - Long responses
// - Real-time feedback needed

// Use non-streaming for:
// - Batch processing
// - Simple request/response
// - When full response needed before processing
```

### 4. Tool Call Handling

Always handle tool calls appropriately:

```javascript
// Track and display tool usage
function processToolCalls(toolCalls) {
  const toolSummary = toolCalls.reduce((acc, tool) => {
    acc[tool.toolName] = (acc[tool.toolName] || 0) + 1;
    return acc;
  }, {});
  
  console.log('Tools used:', Object.entries(toolSummary)
    .map(([name, count]) => `${name} (${count}x)`)
    .join(', '));
}
```

### 5. Environment Configuration

Use environment variables for configuration:

```javascript
// .env file
HUSTLE_API_KEY=your-api-key
VAULT_ID=default-vault
HUSTLE_API_URL=https://agenthustle.ai  # Optional
DEBUG=false

// Load configuration
import dotenv from 'dotenv';
dotenv.config();

// Validate required variables
const required = ['HUSTLE_API_KEY'];
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}
```

### 6. Testing and Evaluation

Use the evaluation framework for comprehensive testing:

```javascript
// Define test suites for different features
{
  "metadata": {
    "name": "token-info-suite",
    "description": "Tests token information queries"
  },
  "testCases": [
    {
      "id": "sol_price",
      "userPrompt": "What is the current price of SOL?",
      "expectedBehavior": {
        "toolCalls": [
          { "tool": "get_token_price", "parameters": { "symbol": "SOL" } }
        ]
      }
    }
  ]
}

// Run evaluations regularly
npm run eval:run token-info-suite
```

### 7. Production Considerations

- **API Key Security**: Never commit API keys to version control
- **Rate Limiting**: Implement appropriate delays between requests
- **Error Monitoring**: Log errors for debugging but sanitize sensitive data
- **Performance**: Use streaming for better perceived performance
- **Timeout Handling**: Set appropriate timeouts for long-running operations

## Cross-Reference Guide

### API Methods to Examples

| Method | Simple CLI Usage | Evaluation Framework Usage |
|--------|-----------------|---------------------------|
| `new HustleIncognitoClient()` | Initial setup | Evaluator & Scorer init |
| `client.chat()` | Non-streaming mode | Fallback when streaming unavailable |
| `client.chatStream()` | Main interaction loop | Test execution & scoring |
| `client.rawStream()` | Not used | Not used (advanced feature) |

### Configuration Patterns

| Configuration | Environment Variable | Simple CLI | Evaluation Framework |
|--------------|---------------------|------------|---------------------|
| API Key | `HUSTLE_API_KEY` | ✓ | ✓ |
| Vault ID | `VAULT_ID` | ✓ | Per-test configuration |
| Debug Mode | `DEBUG` | ✓ | Command-line option |
| Streaming | `STREAMING_MODE` | ✓ | Always enabled |

### Type Usage Across Examples

| Type | Simple CLI | Evaluation Framework | Purpose |
|------|------------|---------------------|---------|
| `ChatMessage` | User/assistant messages | Test prompts & evaluations | Message formatting |
| `StreamChunk` | Console output | Traced & processed | Real-time handling |
| `ProcessedResponse` | Final display | Not directly used | Complete responses |
| `ToolCall` | Logged & counted | Scored & validated | Tool usage tracking |

### Common Patterns Reference

1. **Initialization Pattern**: Both examples use environment variables with fallbacks
2. **Streaming Pattern**: Unified `streamToConsole` utility (eval framework) vs inline processing (CLI)
3. **Error Handling**: Try-catch blocks with user-friendly messages
4. **State Management**: Conversation history (CLI) vs test traces (eval)
5. **Configuration**: Runtime toggles (CLI) vs initialization options (eval)

## Conclusion

The Hustle Incognito SDK provides a powerful and flexible interface for interacting with the Hustle AI platform. By following the patterns demonstrated in the examples and adhering to best practices, developers can build robust applications that leverage the full capabilities of the platform.

Key takeaways:
- Use streaming for interactive applications
- Maintain proper conversation context
- Handle errors gracefully
- Leverage the evaluation framework for testing
- Follow security best practices with API keys
- Choose appropriate vaults for different contexts

For the latest updates and additional examples, refer to the official repository and documentation.
