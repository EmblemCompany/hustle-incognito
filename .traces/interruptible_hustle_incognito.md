# Interruptible Hustle Incognito System

## Proposal Overview

This trace proposes an interruptible AI agent system built on the `hustle-incognito` library that allows dynamic interruption of ongoing conversations based on configurable importance thresholds and agent-maintained priority counters.

## System Architecture

### Core Components

1. **InterruptibleAgent**: Enhanced Hustle Incognito client with interruption capabilities
2. **EventBus**: In-memory event management system for stream registration
3. **StreamRegistry**: Manages active interrupt streams with metadata
4. **ImportanceThresholdManager**: Configurable priority levels per stream type
5. **REST API Server**: Lightweight server for stream management
6. **Next.js Dashboard**: Web interface for stream monitoring and configuration

### Architecture Diagram

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Next.js UI   │◄──►│   REST Server    │◄──►│   EventBus      │
│   Dashboard     │    │   (Express)      │    │   Manager       │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │                        │
                                ▼                        ▼
                       ┌──────────────────┐    ┌─────────────────┐
                       │ StreamRegistry   │    │ InterruptibleAgent│
                       │ - Email Stream   │    │ + HustleIncognito│
                       │ - News Stream    │    │ + Importance     │
                       │ - Alert Stream   │    │   Counters       │
                       └──────────────────┘    └─────────────────┘
```

## Implementation Details

### 1. InterruptibleAgent Class

```typescript
interface ImportanceCounter {
  category: string;
  currentScore: number;
  threshold: number;
  autoAdjust: boolean;
}

interface InterruptionEvent {
  streamId: string;
  category: string;
  importance: number;
  content: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

class InterruptibleAgent extends HustleIncognitoClient {
  private importanceCounters: Map<string, ImportanceCounter>;
  private activeInterruptions: InterruptionEvent[];
  private systemPromptExtension: string;
  
  constructor(options: InterruptibleAgentOptions) {
    super(options);
    this.initializeImportanceCounters();
    this.setupSystemPromptExtension();
  }
  
  // Enhanced chat method with interruption handling
  async chatWithInterruptions(
    messages: ChatMessage[], 
    options: ChatOptions & { allowInterruptions?: boolean }
  ): Promise<ProcessedResponse> {
    // Check for pending interruptions before processing
    const pendingInterruptions = this.checkPendingInterruptions();
    
    if (pendingInterruptions.length > 0 && options.allowInterruptions !== false) {
      // Inject interruption context into system prompt
      const contextualMessages = this.injectInterruptionContext(messages, pendingInterruptions);
      return super.chat(contextualMessages, options);
    }
    
    return super.chat(messages, options);
  }
  
  // Agent maintains its own importance scores
  updateImportanceCounter(category: string, adjustment: number): void {
    const counter = this.importanceCounters.get(category);
    if (counter && counter.autoAdjust) {
      counter.currentScore += adjustment;
      // Persist changes
      this.saveImportanceCounters();
    }
  }
}
```

### 2. EventBus System

```typescript
interface StreamRegistration {
  id: string;
  category: string;
  endpoint: string;
  importanceThreshold: number;
  enabled: boolean;
  lastActivity: Date;
  metadata: {
    name: string;
    description: string;
    frequency: 'realtime' | 'polling';
    pollInterval?: number;
  };
}

class EventBus {
  private streams: Map<string, StreamRegistration>;
  private eventQueue: InterruptionEvent[];
  private subscribers: Map<string, (event: InterruptionEvent) => void>;
  
  registerStream(registration: StreamRegistration): void {
    this.streams.set(registration.id, registration);
    this.initializeStreamConnection(registration);
  }
  
  async processIncomingEvent(streamId: string, data: any): Promise<void> {
    const stream = this.streams.get(streamId);
    if (!stream || !stream.enabled) return;
    
    const importance = this.calculateImportance(data, stream);
    
    if (importance >= stream.importanceThreshold) {
      const event: InterruptionEvent = {
        streamId,
        category: stream.category,
        importance,
        content: this.extractContent(data),
        timestamp: new Date(),
        metadata: data
      };
      
      this.queueInterruption(event);
      this.notifySubscribers(event);
    }
  }
  
  subscribe(agentId: string, callback: (event: InterruptionEvent) => void): void {
    this.subscribers.set(agentId, callback);
  }
}
```

### 3. REST API Endpoints

```typescript
// Stream Management
app.post('/api/streams/register', async (req, res) => {
  const registration: StreamRegistration = req.body;
  await eventBus.registerStream(registration);
  res.json({ success: true, streamId: registration.id });
});

app.delete('/api/streams/:streamId', async (req, res) => {
  await eventBus.unregisterStream(req.params.streamId);
  res.json({ success: true });
});

app.get('/api/streams', async (req, res) => {
  const streams = await eventBus.getAllStreams();
  res.json(streams);
});

// Importance Management
app.put('/api/agents/:agentId/importance/:category', async (req, res) => {
  const { agentId, category } = req.params;
  const { threshold, autoAdjust } = req.body;
  
  await agentManager.updateImportanceSettings(agentId, category, {
    threshold,
    autoAdjust
  });
  
  res.json({ success: true });
});

// Real-time Events
app.get('/api/events/stream', (req, res) => {
  // Server-Sent Events for real-time interruption monitoring
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  
  const subscription = eventBus.subscribe('dashboard', (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });
  
  req.on('close', () => {
    eventBus.unsubscribe('dashboard', subscription);
  });
});
```

### 4. System Prompt Extension

The agent maintains dynamic importance counters through an extended system prompt:

```typescript
const SYSTEM_PROMPT_EXTENSION = `
INTERRUPTION MANAGEMENT:
You maintain importance counters for different categories of information that might interrupt our conversation. Current settings:

${this.formatImportanceCounters()}

When evaluating interruptions:
1. Consider the current conversation context and urgency
2. Adjust your internal importance scores based on relevance
3. For categories you find valuable, you may lower resistance to interruption
4. For routine or low-value interruptions, maintain higher thresholds

Examples of your current preferences:
- Email correspondence: You've indicated moderate interest (threshold: ${this.getThreshold('email')})
- News updates: You've shown ${this.getThreshold('news') < 0.5 ? 'low' : 'high'} interest (threshold: ${this.getThreshold('news')})
- System alerts: Critical only (threshold: ${this.getThreshold('alerts')})

You can adjust these preferences by responding with phrases like:
- "I'm more interested in email updates now" (lowers email threshold)
- "Hold financial news unless urgent" (raises finance threshold)
- "This security alert type is important" (adjusts security threshold)
`;
```

### Interruption Prompt Template

When an interruption event occurs, the system wraps it with this template to guide the LLM's response:

```typescript
const INTERRUPTION_PROMPT_TEMPLATE = `
===== INTERRUPTION RECEIVED =====

**Interruption Details:**
- Category: ${interruption.category}
- Importance Score: ${interruption.importance} (threshold: ${this.getThreshold(interruption.category)})
- Timestamp: ${interruption.timestamp.toISOString()}
- Content: ${interruption.content}

**Current Conversation Context:**
- Topic: ${this.getCurrentConversationTopic()}
- Urgency Level: ${this.assessCurrentUrgency()}
- User Engagement: ${this.assessUserEngagement()}

**Decision Framework:**
You must decide how to handle this interruption. Consider:

1. **Relevance Assessment** (0-1 scale):
   - How relevant is this interruption to our current conversation?
   - Does it provide valuable context or information the user should know?

2. **Timing Evaluation** (immediate/defer/weave):
   - IMMEDIATE: Break conversation flow immediately if critical/urgent
   - DEFER: Acknowledge but continue current topic, mention later
   - WEAVE: Naturally integrate into current conversation flow

3. **User Preference Analysis**:
   - Your current interest level in ${interruption.category}: ${this.getThreshold(interruption.category)}
   - Historical response patterns to this category
   - Explicit user instructions about interruptions

**Response Options:**

**Option A - Immediate Interruption:**
Use when: Critical importance (>0.9), safety concerns, or explicit user priority
Format: "Excuse me, I need to interrupt with something important: [interruption content]. [How it relates to current conversation]. Should we address this now or continue our discussion?"

**Option B - Graceful Weaving:**
Use when: Moderate relevance (0.5-0.8), adds value to current topic
Format: "This relates to what we're discussing - I just received [brief interruption summary]. [Connect to current topic]. [Continue naturally]"

**Option C - Acknowledge and Defer:**
Use when: Low immediate relevance (<0.5), routine information
Format: "I've noted [brief summary] - I'll bring this up after we finish discussing [current topic]" or simply process without mentioning

**Option D - Silent Processing:**
Use when: Very low importance, purely informational, already covered
Action: Update internal context without interrupting conversation flow

**Your Decision Process:**
1. Assess interruption relevance: ___/1.0
2. Evaluate timing appropriateness: [immediate/defer/weave/silent]
3. Choose response option: [A/B/C/D]
4. Adjust your ${interruption.category} interest level if needed: [increase/decrease/maintain]

**Execute your chosen approach now, maintaining natural conversation flow while appropriately handling the interruption.**

======================================
`;
```

### 5. Next.js Dashboard Features

```typescript
// Dashboard Components
const StreamMonitor = () => {
  const [streams, setStreams] = useState<StreamRegistration[]>([]);
  const [events, setEvents] = useState<InterruptionEvent[]>([]);
  
  // Real-time event monitoring
  useEffect(() => {
    const eventSource = new EventSource('/api/events/stream');
    eventSource.onmessage = (event) => {
      const interruption = JSON.parse(event.data);
      setEvents(prev => [interruption, ...prev.slice(0, 99)]);
    };
    return () => eventSource.close();
  }, []);
  
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <StreamList streams={streams} onToggle={toggleStream} />
      <EventFeed events={events} />
      <ImportanceSettings onUpdate={updateThresholds} />
      <AgentStatus />
      <VercelAISDKChatInterface />
    </div>
  );
};

const StreamRegistrationForm = () => {
  const [formData, setFormData] = useState({
    name: '',
    category: '',
    endpoint: '',
    threshold: 0.5,
    frequency: 'polling' as const,
    pollInterval: 60000
  });
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await fetch('/api/streams/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: generateStreamId(),
        ...formData,
        enabled: true,
        metadata: {
          name: formData.name,
          description: `${formData.category} stream`,
          frequency: formData.frequency,
          pollInterval: formData.pollInterval
        }
      })
    });
  };
  
  // Form UI components...
};

### 6. Vercel AI SDK v4 Integration

The dashboard uses Vercel AI SDK v4 for the chat interface, with hustle-incognito serving as the backend provider instead of traditional Next.js API routes.

#### Custom AI Provider Configuration

```typescript
// lib/hustle-provider.ts
import { HustleIncognitoClient } from '@emblem-vault/hustle-incognito-sdk';
import { StreamingTextResponse, createStreamableValue } from 'ai';

export class HustleAIProvider {
  private client: HustleIncognitoClient;
  
  constructor(apiKey: string, vaultId: string) {
    this.client = new HustleIncognitoClient({
      apiKey,
      debug: false
    });
  }
  
  async *streamChat(messages: any[], options: any = {}) {
    const stream = this.client.chatStream({
      vaultId: options.vaultId,
      messages: messages.map(msg => ({
        role: msg.role,
        content: msg.content
      })),
      processChunks: true,
      ...options
    });
    
    for await (const chunk of stream) {
      if (chunk.type === 'text') {
        yield {
          type: 'text',
          content: chunk.value
        };
      } else if (chunk.type === 'tool_call') {
        yield {
          type: 'tool_call',
          toolCall: chunk.value
        };
      } else if (chunk.type === 'finish') {
        return;
      }
    }
  }
}

// Custom hook for Vercel AI SDK integration
export function useHustleChat(apiKey: string, vaultId: string) {
  const provider = new HustleAIProvider(apiKey, vaultId);
  
  return {
    async sendMessage(messages: any[], options: any = {}) {
      const stream = createStreamableValue('');
      
      (async () => {
        try {
          for await (const chunk of provider.streamChat(messages, { vaultId, ...options })) {
            if (chunk.type === 'text') {
              stream.update(chunk.content);
            }
          }
        } finally {
          stream.done();
        }
      })();
      
      return stream.value;
    }
  };
}
```

#### Chat Interface Component

```typescript
// components/InterruptibleChatInterface.tsx
'use client';
import { useChat } from 'ai/react';
import { useHustleChat } from '@/lib/hustle-provider';
import { useState, useEffect } from 'react';

interface InterruptibleChatProps {
  apiKey: string;
  vaultId: string;
  onInterruption?: (event: InterruptionEvent) => void;
}

export function InterruptibleChatInterface({ 
  apiKey, 
  vaultId, 
  onInterruption 
}: InterruptibleChatProps) {
  const [interruptions, setInterruptions] = useState<InterruptionEvent[]>([]);
  const hustleChat = useHustleChat(apiKey, vaultId);
  
  // Custom chat implementation using Vercel AI SDK patterns
  const {
    messages,
    input,
    handleInputChange,
    handleSubmit: originalHandleSubmit,
    isLoading,
  } = useChat({
    api: undefined, // We bypass the API route
    onFinish: (message) => {
      // Handle message completion
      console.log('Chat completed:', message);
    },
  });
  
  // Custom submit handler that uses hustle-incognito directly
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    
    const newMessages = [
      ...messages,
      { role: 'user' as const, content: input }
    ];
    
    try {
      // Check for pending interruptions before sending
      const pendingInterruptions = await checkPendingInterruptions();
      
      const response = await hustleChat.sendMessage(newMessages, {
        allowInterruptions: true,
        interruptions: pendingInterruptions
      });
      
      // Handle the streaming response
      // This integrates with Vercel AI SDK's streaming patterns
      
    } catch (error) {
      console.error('Chat error:', error);
    }
  };
  
  // Listen for real-time interruptions
  useEffect(() => {
    const eventSource = new EventSource('/api/events/stream');
    eventSource.onmessage = (event) => {
      const interruption = JSON.parse(event.data);
      setInterruptions(prev => [interruption, ...prev]);
      onInterruption?.(interruption);
    };
    
    return () => eventSource.close();
  }, [onInterruption]);
  
  return (
    <div className="flex flex-col h-full">
      {/* Interruption notifications */}
      {interruptions.length > 0 && (
        <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-4">
          <div className="flex">
            <div className="ml-3">
              <p className="text-sm text-yellow-700">
                {interruptions.length} pending interruption(s)
              </p>
              <div className="mt-2 text-sm text-yellow-600">
                {interruptions.slice(0, 2).map((int, i) => (
                  <div key={i} className="mb-1">
                    <strong>{int.category}:</strong> {int.content.substring(0, 100)}...
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Chat messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message, i) => (
          <div key={i} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
              message.role === 'user' 
                ? 'bg-blue-500 text-white' 
                : 'bg-gray-200 text-gray-800'
            }`}>
              {message.content}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-200 text-gray-800 px-4 py-2 rounded-lg">
              <div className="animate-pulse">Thinking...</div>
            </div>
          </div>
        )}
      </div>
      
      {/* Input form */}
      <form onSubmit={handleSubmit} className="p-4 border-t">
        <div className="flex space-x-2">
          <input
            value={input}
            onChange={handleInputChange}
            placeholder="Type your message..."
            className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
```

#### Integration Benefits

1. **Direct Backend Connection**: Bypasses Next.js API routes for lower latency
2. **Streaming Support**: Leverages both Vercel AI SDK v4 streaming and hustle-incognito's streaming capabilities
3. **Interruption Awareness**: Chat interface can handle real-time interruptions seamlessly
4. **Type Safety**: Full TypeScript support across the integration
5. **State Management**: Uses Vercel AI SDK's state management with custom backend

#### Configuration Example

```typescript
// app/dashboard/page.tsx
import { InterruptibleChatInterface } from '@/components/InterruptibleChatInterface';

export default function DashboardPage() {
  const handleInterruption = (event: InterruptionEvent) => {
    // Handle interruption in the UI
    console.log('Interruption received:', event);
  };
  
  return (
    <div className="container mx-auto p-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <InterruptibleChatInterface
            apiKey={process.env.HUSTLE_API_KEY!}
            vaultId="default"
            onInterruption={handleInterruption}
          />
        </div>
        <div>
          <StreamMonitor />
        </div>
      </div>
    </div>
  );
}
```

## Stream Types & Examples

### 1. Email Stream
```typescript
const emailStreamConfig: StreamRegistration = {
  id: 'email-primary',
  category: 'email',
  endpoint: 'ws://localhost:3001/email-stream',
  importanceThreshold: 0.6,
  enabled: true,
  lastActivity: new Date(),
  metadata: {
    name: 'Primary Email',
    description: 'Gmail inbox monitoring',
    frequency: 'realtime'
  }
};
```

### 2. News Stream
```typescript
const newsStreamConfig: StreamRegistration = {
  id: 'news-tech',
  category: 'news',
  endpoint: 'https://api.news.com/tech-feed',
  importanceThreshold: 0.7,
  enabled: true,
  lastActivity: new Date(),
  metadata: {
    name: 'Tech News',
    description: 'Technology and AI news updates',
    frequency: 'polling',
    pollInterval: 300000 // 5 minutes
  }
};
```

### 3. System Alerts Stream
```typescript
const alertStreamConfig: StreamRegistration = {
  id: 'alerts-security',
  category: 'alerts',
  endpoint: 'ws://monitoring.internal/security-alerts',
  importanceThreshold: 0.9,
  enabled: true,
  lastActivity: new Date(),
  metadata: {
    name: 'Security Alerts',
    description: 'Critical security notifications',
    frequency: 'realtime'
  }
};
```

## Configuration Examples

### Agent Initialization
```typescript
const agent = new InterruptibleAgent({
  apiKey: process.env.HUSTLE_API_KEY,
  debug: false,
  importanceCounters: new Map([
    ['email', { category: 'email', currentScore: 0.6, threshold: 0.6, autoAdjust: true }],
    ['news', { category: 'news', currentScore: 0.7, threshold: 0.7, autoAdjust: true }],
    ['alerts', { category: 'alerts', currentScore: 0.9, threshold: 0.9, autoAdjust: false }]
  ]),
  systemPromptExtension: true
});
```

### Stream Registration
```javascript
// Register email interruption stream
await fetch('/api/streams/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    id: 'email-work',
    category: 'email',
    endpoint: 'ws://localhost:3001/work-email',
    importanceThreshold: 0.5,
    enabled: true,
    metadata: {
      name: 'Work Email',
      description: 'Corporate email monitoring',
      frequency: 'realtime'
    }
  })
});
```

## Benefits & Use Cases

### 1. Contextual Awareness
- Agent can be interrupted by relevant information during conversations
- Maintains context of what types of interruptions are valuable
- Learns user preferences over time through importance counter adjustments

### 2. Multi-Stream Management
- Support for multiple concurrent interrupt streams
- Different threshold levels for different stream types
- Easy stream registration/deregistration through REST API

### 3. Dynamic Priority Adjustment
- Agent self-manages importance scores based on conversation context
- User can explicitly adjust preferences through natural language
- Automatic threshold adjustment based on interaction patterns

### 4. Real-time Monitoring
- Next.js dashboard provides live view of all registered streams
- Event feed shows recent interruption attempts and decisions
- Visual importance threshold management

## Implementation Phases

### Phase 1: Core Infrastructure
- [ ] Implement InterruptibleAgent class
- [ ] Create EventBus system
- [ ] Build basic REST API server
- [ ] Add stream registration capabilities

### Phase 2: Stream Processing
- [ ] Implement stream connection handlers (WebSocket, polling)
- [ ] Add importance calculation algorithms
- [ ] Create interruption queuing system
- [ ] Build system prompt extension logic

### Phase 3: Dashboard & UI
- [ ] Create Next.js dashboard application
- [ ] Implement real-time event monitoring
- [ ] Add stream management interface
- [ ] Build importance settings UI
- [ ] Integrate Vercel AI SDK v4 for chat interface
- [ ] Configure hustle-incognito as AI provider backend (bypassing Next.js API routes)

### Phase 4: Advanced Features
- [ ] Add machine learning for importance prediction
- [ ] Implement conversation context analysis
- [ ] Add stream analytics and reporting
- [ ] Create mobile-responsive dashboard

## Technical Considerations

### Performance
- In-memory event processing for low latency
- Configurable event queue limits to prevent memory bloat
- Efficient WebSocket connection pooling for real-time streams

### Security
- Stream endpoint authentication and validation
- Rate limiting for API endpoints
- Secure WebSocket connection handling
- Agent API key protection

### Scalability
- Horizontal scaling through multiple EventBus instances
- Stream partitioning for high-volume scenarios
- Database persistence for importance counter history
- Load balancing for REST API endpoints

### Reliability
- Automatic stream reconnection on failure
- Graceful degradation when streams are unavailable
- Event replay capabilities for missed interruptions
- Health monitoring for all system components

This interruptible system design provides a robust foundation for creating AI agents that can dynamically respond to real-world interruptions while maintaining conversational context and learning user preferences over time.

## 7. Scheduling Prompt & Observer System

The system includes a scheduled observer that can spawn secondary chat sessions to review conversation history and develop internal monologue insights. This creates a self-reflective AI system that can identify assumptions, gaps, and opportunities for improvement.

#### Observer Architecture

```typescript
interface ScheduledPrompt {
  id: string;
  name: string;
  cronSchedule: string;
  promptTemplate: string;
  enabled: boolean;
  lastRun?: Date;
  nextRun?: Date;
  contextWindow: number; // Number of messages to analyze
  outputDestination: 'internal' | 'user' | 'both';
  metadata: {
    description: string;
    category: string;
    priority: number;
  };
}

interface ObserverInsight {
  id: string;
  promptId: string;
  timestamp: Date;
  analysisType: string;
  insights: string[];
  assumptions: string[];
  recommendations: string[];
  confidence: number;
  conversationContext: {
    messageCount: number;
    topics: string[];
    userEngagement: string;
    lastActivity: Date;
  };
}

class ConversationObserver {
  private client: HustleIncognitoClient;
  private vaultId: string;
  private scheduledPrompts: Map<string, ScheduledPrompt>;
  private insights: ObserverInsight[];
  private scheduler: NodeScheduler;
  
  constructor(apiKey: string, vaultId: string) {
    this.client = new HustleIncognitoClient({ apiKey });
    this.vaultId = vaultId;
    this.scheduledPrompts = new Map();
    this.insights = [];
    this.scheduler = new NodeScheduler();
  }
  
  // Schedule a new observer prompt
  schedulePrompt(prompt: ScheduledPrompt): void {
    this.scheduledPrompts.set(prompt.id, prompt);
    
    this.scheduler.scheduleJob(prompt.id, prompt.cronSchedule, async () => {
      await this.executeObserverPrompt(prompt.id);
    });
  }
  
  // Execute a scheduled observer prompt
  private async executeObserverPrompt(promptId: string): Promise<ObserverInsight | null> {
    const prompt = this.scheduledPrompts.get(promptId);
    if (!prompt || !prompt.enabled) return null;
    
    try {
      // Get recent conversation history
      const recentMessages = await this.getRecentMessages(prompt.contextWindow);
      
      // Create observer context
      const observerMessages = [
        {
          role: 'system' as const,
          content: `You are an internal observer for an AI conversation. Your role is to analyze recent conversation history and provide insights, identify assumptions, and suggest improvements. You have access to the last ${prompt.contextWindow} messages from the conversation.`
        },
        {
          role: 'user' as const,
          content: this.formatObserverPrompt(prompt, recentMessages)
        }
      ];
      
      // Spawn secondary chat session for analysis
      const response = await this.client.chat(observerMessages, {
        vaultId: this.vaultId + '_observer' // Separate observer context
      });
      
      // Parse and store insights
      const insight = this.parseObserverResponse(response, prompt);
      this.insights.push(insight);
      
      // Update prompt execution time
      prompt.lastRun = new Date();
      prompt.nextRun = this.calculateNextRun(prompt.cronSchedule);
      
      return insight;
    } catch (error) {
      console.error(`Observer prompt ${promptId} failed:`, error);
      return null;
    }
  }
  
  // Format the observer prompt with context
  private formatObserverPrompt(prompt: ScheduledPrompt, messages: any[]): string {
    const conversationSummary = this.summarizeConversation(messages);
    
    return prompt.promptTemplate
      .replace('{messageCount}', messages.length.toString())
      .replace('{conversationSummary}', conversationSummary)
      .replace('{recentMessages}', this.formatMessages(messages))
      .replace('{timestamp}', new Date().toISOString());
  }
}
```

#### Scheduled Prompt Templates

```typescript
// Built-in observer prompt templates
const OBSERVER_PROMPT_TEMPLATES = {
  assumptionChecker: {
    id: 'assumption-checker',
    name: 'Assumption Checker',
    cronSchedule: '*/30 * * * *', // Every 30 minutes
    promptTemplate: `
INTERNAL MONOLOGUE - ASSUMPTION ANALYSIS

Review the last {messageCount} messages from our conversation:

{recentMessages}

**Analysis Framework:**
1. **Unstated Assumptions**: What assumptions are being made by either party that haven't been explicitly addressed?
2. **Knowledge Gaps**: What information might be missing that could improve the conversation?
3. **Communication Patterns**: Are there recurring themes or concerns that warrant attention?
4. **Opportunity Identification**: What opportunities for deeper exploration exist?

**Generate insights on:**
- **Pattern Recognition**: Recurring themes, interests, or concerns
- **Synthesis Opportunities**: How different conversation threads might connect
- **Proactive Suggestions**: Topics or questions that might add value
- **Long-term Themes**: Emerging patterns that span multiple conversations

**Output Format:**
- **Key Patterns**: [Significant patterns or themes identified]
- **Connection Opportunities**: [Ways to connect different topics or ideas]
- **Proactive Topics**: [Subjects that might interest the user based on conversation history]
- **Strategic Insights**: [Larger implications or opportunities]

**Actionability**: For each insight, indicate how it might be naturally woven into future conversation.
`,
    enabled: true,
    contextWindow: 10,
    outputDestination: 'internal',
    metadata: {
      description: 'Identifies assumptions and knowledge gaps in recent conversation',
      category: 'analysis',
      priority: 1
    }
  },
  
  engagementAnalyzer: {
    id: 'engagement-analyzer',
    name: 'User Engagement Analyzer',
    cronSchedule: '0 */2 * * *', // Every 2 hours
    promptTemplate: `
INTERNAL MONOLOGUE - ENGAGEMENT ANALYSIS

Conversation Context ({messageCount} recent messages):
{conversationSummary}

**Engagement Metrics to Analyze:**
1. **Response Patterns**: Length, frequency, and depth of user responses
2. **Topic Interest**: Which topics generate more engagement vs. less
3. **Question Types**: What kinds of questions or prompts work best
4. **Energy Levels**: Detect enthusiasm, frustration, or disengagement

**Analysis Questions:**
- How engaged is the user in the current conversation?
- Are there signs of confusion, frustration, or boredom?
- What topics or approaches seem to resonate most?
- Should the conversation style or approach be adjusted?

**Provide analysis in this format:**
- **Engagement Level**: [High/Medium/Low with explanation]
- **Interest Patterns**: [Topics and approaches that work well]
- **Warning Signs**: [Any indicators of disengagement or confusion]
- **Optimization Suggestions**: [How to improve future interactions]

**Next Steps**: Based on this analysis, what should I focus on or adjust in upcoming responses?
`,
    enabled: true,
    contextWindow: 15,
    outputDestination: 'internal',
    metadata: {
      description: 'Analyzes user engagement patterns and suggests optimizations',
      category: 'engagement',
      priority: 2
    }
  },
  
  contextualInsights: {
    id: 'contextual-insights',
    name: 'Contextual Insights Generator',
    cronSchedule: '0 */4 * * *', // Every 4 hours
    promptTemplate: `
INTERNAL MONOLOGUE - CONTEXTUAL INSIGHTS

Recent Conversation Analysis ({messageCount} messages):
{recentMessages}

**Deep Context Analysis:**
1. **Hidden Connections**: Are there connections between topics that haven't been explicitly explored?
2. **Broader Implications**: What are the wider implications of the topics being discussed?
3. **Knowledge Synthesis**: How do different parts of the conversation connect to create larger insights?
4. **Opportunity Identification**: What opportunities for deeper exploration exist?

**Generate insights on:**
- **Pattern Recognition**: Recurring themes, interests, or concerns
- **Synthesis Opportunities**: How different conversation threads might connect
- **Proactive Suggestions**: Topics or questions that might add value
- **Long-term Themes**: Emerging patterns that span multiple conversations

**Output Format:**
- **Key Patterns**: [Significant patterns or themes identified]
- **Connection Opportunities**: [Ways to connect different topics or ideas]
- **Proactive Topics**: [Subjects that might interest the user based on conversation history]
- **Strategic Insights**: [Larger implications or opportunities]

**Actionability**: For each insight, indicate how it might be naturally woven into future conversation.
`,
    enabled: true,
    contextWindow: 20,
    outputDestination: 'internal',
    metadata: {
      description: 'Generates deeper contextual insights and connection opportunities',
      category: 'synthesis',
      priority: 3
    }
  }
};
```

#### Observer Integration with Main System

```typescript
class InterruptibleAgent extends HustleIncognitoClient {
  private observer: ConversationObserver;
  private observerInsights: ObserverInsight[];
  
  constructor(options: InterruptibleAgentOptions) {
    super(options);
    this.observer = new ConversationObserver(options.apiKey, options.vaultId);
    this.observerInsights = [];
    this.initializeObserver();
  }
  
  private initializeObserver(): void {
    // Register default observer prompts
    Object.values(OBSERVER_PROMPT_TEMPLATES).forEach(template => {
      this.observer.schedulePrompt(template);
    });
    
    // Listen for observer insights
    this.observer.onInsight((insight: ObserverInsight) => {
      this.observerInsights.push(insight);
      this.processObserverInsight(insight);
    });
  }
  
  // Process observer insights and potentially surface them
  private async processObserverInsight(insight: ObserverInsight): Promise<void> {
    const prompt = this.observer.getPrompt(insight.promptId);
    
    if (prompt?.outputDestination === 'user' || prompt?.outputDestination === 'both') {
      // Surface insight to user as a gentle interruption
      const interruptionEvent: InterruptionEvent = {
        streamId: 'observer-insights',
        category: 'insights',
        importance: 0.4, // Relatively low importance
        content: this.formatInsightForUser(insight),
        timestamp: insight.timestamp,
        metadata: { insight }
      };
      
      await this.queueInterruption(interruptionEvent);
    }
    
    if (prompt?.outputDestination === 'internal' || prompt?.outputDestination === 'both') {
      // Update internal context for future responses
      this.updateInternalContext(insight);
    }
  }
  
  // Enhanced chat with observer context
  async chatWithObserver(
    messages: ChatMessage[], 
    options: ChatOptions & { includeObserverInsights?: boolean }
  ): Promise<ProcessedResponse> {
    if (options.includeObserverInsights !== false) {
      // Get recent relevant insights
      const relevantInsights = this.getRelevantInsights(messages);
      
      if (relevantInsights.length > 0) {
        // Inject observer insights into system context
        const enhancedMessages = this.injectObserverContext(messages, relevantInsights);
        return super.chat(enhancedMessages, options);
      }
    }
    
    return super.chat(messages, options);
  }
  
  private formatInsightForUser(insight: ObserverInsight): string {
    return `
I've been reflecting on our conversation and noticed: ${insight.insights.join(', ')}. 
${insight.recommendations.length > 0 ? `You might find it interesting to explore: ${insight.recommendations.join(', ')}.` : ''}
    `.trim();
  }
}
```

#### REST API for Observer Management

```typescript
// Observer management endpoints
app.post('/api/observer/prompts', async (req, res) => {
  const prompt: ScheduledPrompt = req.body;
  await observer.schedulePrompt(prompt);
  res.json({ success: true, promptId: prompt.id });
});

app.get('/api/observer/insights', async (req, res) => {
  const { limit = 10, category, since } = req.query;
  const insights = await observer.getInsights({
    limit: parseInt(limit as string),
    category: category as string,
    since: since ? new Date(since as string) : undefined
  });
  res.json(insights);
});

app.put('/api/observer/prompts/:promptId/toggle', async (req, res) => {
  const { promptId } = req.params;
  const { enabled } = req.body;
  await observer.togglePrompt(promptId, enabled);
  res.json({ success: true });
});

app.get('/api/observer/status', async (req, res) => {
  const status = await observer.getStatus();
  res.json(status);
});
```

#### Dashboard Integration

```typescript
// Observer status component
const ObserverStatus = () => {
  const [insights, setInsights] = useState<ObserverInsight[]>([]);
  const [prompts, setPrompts] = useState<ScheduledPrompt[]>([]);
  
  useEffect(() => {
    const fetchData = async () => {
      const [insightsData, promptsData] = await Promise.all([
        fetch('/api/observer/insights').then(r => r.json()),
        fetch('/api/observer/prompts').then(r => r.json())
      ]);
      setInsights(insightsData);
      setPrompts(promptsData);
    };
    
    fetchData();
    const interval = setInterval(fetchData, 30000); // Update every 30 seconds
    return () => clearInterval(interval);
  }, []);
  
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h3 className="text-lg font-semibold mb-4">Observer Status</h3>
      
      {/* Active prompts */}
      <div className="mb-6">
        <h4 className="font-medium mb-2">Scheduled Prompts</h4>
        <div className="space-y-2">
          {prompts.map(prompt => (
            <div key={prompt.id} className="flex items-center justify-between p-2 bg-gray-50 rounded">
              <div>
                <span className="font-medium">{prompt.name}</span>
                <span className="text-sm text-gray-500 ml-2">
                  Next: {prompt.nextRun ? new Date(prompt.nextRun).toLocaleTimeString() : 'Not scheduled'}
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <span className={`px-2 py-1 text-xs rounded ${
                  prompt.enabled ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                }`}>
                  {prompt.enabled ? 'Active' : 'Paused'}
                </span>
                <button
                  onClick={() => togglePrompt(prompt.id, !prompt.enabled)}
                  className="text-sm text-blue-600 hover:text-blue-800"
                >
                  {prompt.enabled ? 'Pause' : 'Resume'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
      
      {/* Recent insights */}
      <div>
        <h4 className="font-medium mb-2">Recent Insights</h4>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {insights.slice(0, 5).map(insight => (
            <div key={insight.id} className="p-3 bg-blue-50 rounded">
              <div className="flex justify-between items-start mb-1">
                <span className="font-medium text-sm">{insight.analysisType}</span>
                <span className="text-xs text-gray-500">
                  {new Date(insight.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <div className="text-sm text-gray-700">
                {insight.insights.slice(0, 2).map((item, i) => (
                  <div key={i} className="mb-1">• {item}</div>
                ))}
              </div>
              {insight.recommendations.length > 0 && (
                <div className="text-xs text-blue-600 mt-2">
                  Recommendations: {insight.recommendations.join(', ')}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
```

#### Observer Prompt Customization

```typescript
// Custom observer prompt builder
const ObserverPromptBuilder = () => {
  const [prompt, setPrompt] = useState({
    name: '',
    cronSchedule: '0 * * * *', // Every hour
    promptTemplate: '',
    contextWindow: 10,
    outputDestination: 'internal' as const,
    category: 'custom'
  });
  
  const predefinedTemplates = [
    {
      name: 'Decision Point Analyzer',
      template: `
Analyze the last {messageCount} messages for decision points:

{recentMessages}

Identify:
1. Decisions that were made explicitly
2. Implicit decisions or assumptions
3. Pending decisions that might need attention
4. Alternative perspectives that weren't considered

Provide structured analysis of decision quality and completeness.
      `
    },
    {
      name: 'Learning Opportunity Detector',
      template: `
Review our conversation for learning opportunities:

{recentMessages}

Look for:
1. Topics where deeper knowledge would be valuable
2. Skills or concepts that came up repeatedly
3. Questions that suggest interest in learning more
4. Connections to broader educational themes

Suggest specific learning paths or resources.
      `
    }
  ];
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await fetch('/api/observer/prompts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: generateId(),
        ...prompt,
        enabled: true,
        metadata: {
          description: `Custom observer prompt: ${prompt.name}`,
          category: prompt.category,
          priority: 5
        }
      })
    });
  };
  
  // Form UI implementation...
};
```

This observer system creates a self-reflective AI that continuously analyzes conversation patterns, identifies assumptions, and generates insights to improve future interactions. The system maintains conversation context while providing valuable internal monologue capabilities.
