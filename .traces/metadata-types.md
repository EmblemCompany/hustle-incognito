# Metadata Types - Server Documentation

This file documents the metadata types sent from the Agent Hustle server via prefix `2` chunks.
These are used for dynamic tool loading based on user intent.

---

## Overview

Instead of loading ALL tools (200+), the server dynamically loads only relevant ones based on user intent.

**Example Flow:**
1. User asks: "What's hot on Polymarket?"
2. Server detects intent: "Finding trending prediction market events"
3. Qualified categories: `["required", "polymarket"]`
4. Only 27 tools loaded instead of 200+

---

## Chunk Types (prefix `2`)

### 1. `reasoning`
LLM's explanation of why it chose certain tool categories.

```typescript
interface ReasoningInfo {
  type: 'reasoning';
  thinking: string;      // LLM's explanation
  networks: string[];    // e.g., ["solana", "ethereum"]
  categories: string[];  // e.g., ["required", "polymarket"]
  activeIntent?: string; // Human-readable intent description
  confidence: number;    // 0-1 confidence score
  timestamp?: string;    // ISO timestamp
}
```

**Example from wire:**
```json
{
  "type": "reasoning",
  "thinking": "The user explicitly asks for 'hot things' on Polymarket, which maps directly to the Polymarket tool category.",
  "networks": [],
  "categories": ["required", "polymarket"],
  "activeIntent": "Finding trending prediction market events on Polymarket",
  "confidence": 0.96,
  "timestamp": "2025-12-13T08:35:13.689Z"
}
```

---

### 2. `intent_context`
Persists across conversation turns so follow-up messages maintain context.
E.g., "buy that" knows which network you were on.

```typescript
interface IntentContext {
  networks: string[];
  categories: string[];
  activeIntent?: string;
  turnsSinceUpdate: number;
  lastConfidence: number;
}

interface IntentContextInfo {
  type: 'intent_context';
  intentContext: IntentContext;  // Nested context
  categories: string[];
  confidence: number;
  reasoning?: string;            // Duplicated from reasoning chunk
  stickyFallbackApplied?: boolean;
  timestamp?: string;
}
```

**Example from wire:**
```json
{
  "type": "intent_context",
  "intentContext": {
    "networks": [],
    "categories": ["required", "polymarket"],
    "activeIntent": "Finding trending prediction market events on Polymarket",
    "turnsSinceUpdate": 0,
    "lastConfidence": 0.96
  },
  "categories": ["required", "polymarket"],
  "confidence": 0.96,
  "reasoning": "The user explicitly asks for 'hot things' on Polymarket...",
  "stickyFallbackApplied": false,
  "timestamp": "2025-12-13T08:35:13.689Z"
}
```

---

### 3. `dev_tools_info`
Shows which tool categories qualified and what tools were loaded.

```typescript
interface DevToolsInfo {
  type: 'dev_tools_info';
  qualifiedCategories: string[];  // Categories that matched
  availableTools: string[];       // Actual tool names loaded
  toolCount: number;              // Total tools loaded
  timestamp?: string;
  reasoning?: string;             // Duplicated from reasoning chunk
}
```

**Example from wire:**
```json
{
  "type": "dev_tools_info",
  "qualifiedCategories": ["required", "polymarket"],
  "availableTools": [
    "wallet", "calculateAdjustedPrice", "currentUnixTimestamp",
    "createMemory", "getUserMemoryCategories", "getPolyMarketEvents",
    "getPolyMarketTags", "searchPolyMarketEvents"
  ],
  "toolCount": 27,
  "timestamp": "2025-12-13T08:35:13.689Z",
  "reasoning": "The user explicitly asks for 'hot things' on Polymarket..."
}
```

---

### 4. `path_info` / `token_usage`
Path/token usage information with cost tracking.

```typescript
interface PathInfo {
  type?: string;          // 'path_info' or 'token_usage'
  message?: string;       // Human-readable usage message
  path?: string;          // e.g., "PATH_1"
  tokensIn?: number;
  tokensOut?: number;
  cachedTokens?: number;
  totalTokens?: number;
  threshold?: number;     // Token threshold for summarization
  thresholdReached?: boolean;
  messageRetentionCount?: number;
  costUsd?: number;       // Estimated cost
  toolsExecuted?: number;
  maxSteps?: number;
  maxToolsReached?: boolean;
  timedOut?: boolean;
  timestamp?: string;
  reasoning?: string;
}
```

**Example from wire:**
```json
{
  "type": "token_usage",
  "message": "[PATH_1_TOKENS] Actual usage - Input: 471169, Output: 754, Cached: 330626, Total: 141297, Cost: $1.2694071",
  "tokensIn": 471169,
  "tokensOut": 754,
  "cachedTokens": 330626,
  "totalTokens": 141297,
  "threshold": 30000,
  "thresholdReached": true,
  "messageRetentionCount": 1,
  "costUsd": 1.2694071,
  "toolsExecuted": 3,
  "maxSteps": 7,
  "maxToolsReached": false,
  "timedOut": false,
  "timestamp": "2025-12-13T08:36:00.039Z"
}
```

---

## Server Types Reference

From the server codebase:

```typescript
// Supported networks (generic string[] in SDK)
type SupportedNetwork = "solana" | "ethereum" | "bsc" | "polygon" | "hedera" | "bitcoin";

// Tool categories (generic string[] in SDK)
type ToolCategory = "required" | "solana" | "ethereum" | "bsc" | "polygon" | "hedera" |
                    "ordiscan" | "coinglass" | "defillama" | "advanced-search" |
                    "lunarcrush" | "messari" | "swell" | "polymarket" | "cross-chain" | "opensea";

// Qualification result from server
interface QualificationResult {
  networks: SupportedNetwork[];
  categories: ToolCategory[];
  confidence: number;
  reasoning: string;
  toolHints: string[];
  intentContext: IntentContext;
}
```

---

## UI Usage Example

From the original Agent Hustle UI, this metadata is displayed as:

```
▼ Used 5 tools

Reasoning: The user asks for promising low-cap gems, which requires token discovery
and fundamental analysis. No specific blockchain network is mentioned, so no
network-specific tools are needed. Relevant categories include messari, defillama
for token data and market caps, advanced-search for web searches, and lunarcrush
for social sentiment.

Categories: required, messari, defillama, advanced-search, lunarcrush

Available: 73 tools

Used: getDefillamaCoinsNarratives, askMessari, Cryptocurrencies, websearch, Topic
```

---

## Notes

- **Reasoning duplication**: The `reasoning` string appears in multiple chunks for context
- **SDK uses generic types**: `string[]` instead of specific enums for flexibility
- **Backward compatible**: Existing clients don't use these fields yet
