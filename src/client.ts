// src/client.ts
import type {
  Attachment,
  ChatMessage,
  ChatOptions,
  HustleIncognitoClientOptions,
  HustleRequest,
  ProcessedResponse,
  RawChunk,
  RawStreamOptions,
  StreamChunk,
  StreamOptions,
  ToolCategory,
} from './types';

// Define SDK version manually until we can properly import from package.json
const SDK_VERSION = '0.1.0';

// Default API endpoints
const API_ENDPOINTS = {
  PRODUCTION: 'https://agenthustle.ai',
};

/**
 * Client for interacting with the Emblem Vault Hustle Incognito Agent API.
 */
export class HustleIncognitoClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly userKey?: string;
  private readonly userSecret?: string;
  private readonly sdkVersion: string = SDK_VERSION;
  private readonly fetchImpl: typeof fetch;
  private readonly debug: boolean;
  private readonly cookie?: string;

  /**
   * Creates an instance of HustleIncognitoClient.
   * @param options - Configuration options for the client.
   */
  constructor(options: HustleIncognitoClientOptions) {
    if (!options.apiKey) {
      throw new Error('API key is required.');
    }
    this.apiKey = options.apiKey;
    this.baseUrl =
      options.hustleApiUrl ||
      (process.env && process.env['HUSTLE_API_URL']) ||
      API_ENDPOINTS.PRODUCTION;
    this.userKey = options.userKey;
    this.userSecret = options.userSecret;
    this.fetchImpl = options.fetch || fetch;
    this.debug = options.debug || false;
    this.cookie = options.cookie || (process.env && process.env['COOKIE']);

    // Debug info
    if (this.debug) {
      console.log(
        `[${new Date().toISOString()}] Emblem Vault Hustle Incognito SDK v${this.sdkVersion}`
      );
      console.log(`[${new Date().toISOString()}] Using API endpoint: ${this.baseUrl}`);
      if (this.cookie) {
        console.log(`[${new Date().toISOString()}] Using cookie from environment`);
      }
    }
  }

  /**
   * Sends a chat message or conversation history to the API and gets a response.
   * Handles non-streaming responses.
   *
   * @param messages - An array of chat messages representing the conversation history.
   * @param options - Optional parameters like vaultId, userApiKey, etc.
   * @param overrideFunc - Optional function to override the API call (useful for testing)
   * @returns A promise resolving to the API response or an API error.
   */
  public async chat(
    messages: ChatMessage[],
    options: ChatOptions = { vaultId: 'unspecified-incognito' },
    overrideFunc: Function | null = null
  ): Promise<ProcessedResponse | RawChunk[]> {
    // Implement override pattern
    if (overrideFunc && typeof overrideFunc === 'function') {
      if (this.debug)
        console.log(`[${new Date().toISOString()}] Using override function for chat method`);
      return await overrideFunc(this.apiKey, { messages, ...options });
    }

    if (this.debug)
      console.log(
        `[${new Date().toISOString()}] Sending chat request with ${messages.length} messages to vault ${options.vaultId}`
      );

    // Default implementation
    if (options.rawResponse) {
      // Return the raw chunks
      if (this.debug)
        console.log(
          `[${new Date().toISOString()}] Raw response mode enabled, returning all chunks`
        );
      const chunks: RawChunk[] = [];
      for await (const chunk of this.rawStream({
        vaultId: options.vaultId,
        messages,
        userApiKey: options.userApiKey,
        externalWalletAddress: options.externalWalletAddress,
        slippageSettings: options.slippageSettings,
        safeMode: options.safeMode,
        selectedToolCategories: options.selectedToolCategories || [],
      })) {
        if (this.debug)
          console.log(`[${new Date().toISOString()}] Raw chunk:`, JSON.stringify(chunk));
        chunks.push(chunk as RawChunk);
      }
      return chunks;
    }

    // Process and collect the response
    let fullText = '';
    let messageId = null;
    let usage = null;
    let pathInfo = null;
    const toolCalls: any[] = [];
    const toolResults: any[] = [];

    for await (const chunk of this.chatStream({
      vaultId: options.vaultId,
      messages,
      userApiKey: options.userApiKey,
      externalWalletAddress: options.externalWalletAddress,
      slippageSettings: options.slippageSettings,
      safeMode: options.safeMode,
      processChunks: true,
      selectedToolCategories: options.selectedToolCategories || [],
      attachments: options.attachments || [],
    })) {
      if ('type' in chunk) {
        switch (chunk.type) {
          case 'text':
            fullText += chunk.value as string;
            break;
          case 'message_id':
            messageId = chunk.value as string;
            break;
          case 'finish':
            if (chunk.value && typeof chunk.value === 'object' && 'usage' in chunk.value) {
              usage = chunk.value.usage;
            }
            break;
          case 'path_info':
            pathInfo = chunk.value;
            break;
          case 'tool_call':
            toolCalls.push(chunk.value);
            break;
          case 'tool_result':
            toolResults.push(chunk.value);
            break;
        }
      }
    }

    return {
      content: fullText,
      messageId,
      usage,
      pathInfo,
      toolCalls,
      toolResults,
    };
  }

  /**
   * Sends a chat message or conversation history and streams the response.
   *
   * @param options - Chat configuration including messages, vaultId, etc.
   * @param overrideFunc - Optional function to override the API call (useful for testing)
   * @returns An async iterable yielding StreamChunk objects or throwing an ApiError.
   */
  public async *chatStream(
    options: StreamOptions,
    overrideFunc: Function | null = null
  ): AsyncIterable<StreamChunk | RawChunk> {
    // Implement override pattern
    if (overrideFunc && typeof overrideFunc === 'function') {
      if (this.debug)
        console.log(`[${new Date().toISOString()}] Using override function for chatStream method`);
      // For custom stream handling, yield generator from override function
      yield* overrideFunc(this.apiKey, options);
      return;
    }

    // If we're not processing chunks, just use rawStream
    if (options.processChunks === false) {
      if (this.debug)
        console.log(`[${new Date().toISOString()}] Process chunks disabled, using raw stream`);
      yield* this.rawStream(options);
      return;
    }

    if (this.debug)
      console.log(`[${new Date().toISOString()}] Processing stream chunks into structured data`);

    // Otherwise, process chunks into structured data
    for await (const chunk of this.rawStream(options)) {
      if (this.debug)
        console.log(`[${new Date().toISOString()}] Processing chunk:`, JSON.stringify(chunk));

      switch (chunk.prefix) {
        case '0': // Text chunk
          yield { type: 'text', value: chunk.data };
          break;

        case '9': // Tool call
          if (this.debug)
            console.log(
              `[${new Date().toISOString()}] Found tool call:`,
              JSON.stringify(chunk.data)
            );
          yield { type: 'tool_call', value: chunk.data };
          break;

        case 'a': // Tool result
          if (this.debug)
            console.log(
              `[${new Date().toISOString()}] Found tool result:`,
              JSON.stringify(chunk.data)
            );
          yield { type: 'tool_result', value: chunk.data };
          break;

        case 'f': // Message ID
          if (chunk.data && typeof chunk.data === 'object' && 'messageId' in chunk.data) {
            yield { type: 'message_id', value: chunk.data.messageId };
          }
          break;

        case 'e': // Completion event
        case 'd': // Final data
          yield {
            type: 'finish',
            value: {
              reason: chunk.data?.finishReason || 'stop',
              usage: chunk.data?.usage,
            },
          };
          break;

        case '2': // Path info
          try {
            if (Array.isArray(chunk.data) && chunk.data.length > 0) {
              yield { type: 'path_info', value: chunk.data[0] };
            } else {
              yield { type: 'path_info', value: chunk.data };
            }
          } catch (error) {
            if (this.debug)
              console.error(`[${new Date().toISOString()}] Error processing path info:`, error);
          }
          break;

        default:
          // Unknown chunk type, just pass it through
          yield { type: 'unknown', value: chunk };
      }
    }
  }

  /**
   * Low-level function that provides direct access to the raw stream chunks.
   * This is a passthrough mode where processing is left to the consumer.
   *
   * @param options - Chat configuration including messages, vaultId, etc.
   * @param overrideFunc - Optional function to override the API call (useful for testing)
   * @returns An async iterable of raw chunks from the API
   */
  public async *rawStream(
    options: RawStreamOptions,
    overrideFunc: Function | null = null
  ): AsyncIterable<RawChunk> {
    // Implement override pattern
    if (overrideFunc && typeof overrideFunc === 'function') {
      if (this.debug)
        console.log(`[${new Date().toISOString()}] Using override function for rawStream method`);
      // For custom stream handling, yield generator from override function
      yield* overrideFunc(this.apiKey, options);
      return;
    }

    const requestBody = this.prepareRequestBody(options);
    if (this.debug) {
      console.log(
        `[${new Date().toISOString()}] Prepared request body:`,
        JSON.stringify(requestBody)
      );
      console.log(`[${new Date().toISOString()}] Sending request to ${this.baseUrl}/api/chat`);
    }

    try {
      const response = await this.createRequest(requestBody);
      if (this.debug)
        console.log(
          `[${new Date().toISOString()}] Response status: ${response.status} ${response.statusText}`
        );

      const reader = response.body?.getReader();
      if (!reader) throw new Error('Stream reader not available');

      if (this.debug) console.log(`[${new Date().toISOString()}] Starting to read stream`);

      // Buffer for incomplete lines that span chunk boundaries
      let lineBuffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          if (this.debug) console.log(`[${new Date().toISOString()}] Stream complete`);
          // Process any remaining buffered line
          if (lineBuffer.trim()) {
            if (this.debug) console.log(`[${new Date().toISOString()}] Processing final buffered line`);
            const prefix = lineBuffer.charAt(0);
            const data = lineBuffer.substring(2);
            let parsedData;
            try {
              parsedData = JSON.parse(data);
              if (typeof parsedData === 'string' && (parsedData.startsWith('{') || parsedData.startsWith('['))) {
                try {
                  parsedData = JSON.parse(parsedData);
                } catch (e) { /* keep single-decoded version */ }
              }
            } catch (e) {
              parsedData = data;
            }
            yield { prefix, data: parsedData, raw: lineBuffer };
          }
          break;
        }

        const text = new TextDecoder().decode(value);
        if (this.debug) console.log(`[${new Date().toISOString()}] Raw stream data:`, text);

        // Prepend any buffered content from previous chunk
        const fullText = lineBuffer + text;
        const lines = fullText.split('\n');

        // The last element might be incomplete if it doesn't end with \n
        // Save it for the next iteration
        lineBuffer = text.endsWith('\n') ? '' : lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const prefix = line.charAt(0);
            const data = line.substring(2);

            // Parse JSON if it's valid JSON, otherwise leave as string
            // Also handle double-encoded JSON (JSON string within JSON)
            let parsedData;
            try {
              parsedData = JSON.parse(data);

              // Check if the result is still a JSON string (double-encoded)
              // This happens when the server sends tool results as stringified JSON
              if (typeof parsedData === 'string' && (parsedData.startsWith('{') || parsedData.startsWith('['))) {
                try {
                  const doubleDecoded = JSON.parse(parsedData);
                  parsedData = doubleDecoded;
                  if (this.debug)
                    console.log(
                      `[${new Date().toISOString()}] Double-decoded JSON data for prefix ${prefix}`
                    );
                } catch (e) {
                  // If it fails to parse again, keep the single-decoded version
                  if (this.debug)
                    console.log(
                      `[${new Date().toISOString()}] Single-decoded JSON data for prefix ${prefix}`
                    );
                }
              }

              if (this.debug)
                console.log(
                  `[${new Date().toISOString()}] Parsed JSON data for prefix ${prefix}:`,
                  JSON.stringify(parsedData)
                );
            } catch (e) {
              parsedData = data;
              if (this.debug)
                console.log(
                  `[${new Date().toISOString()}] Non-JSON data for prefix ${prefix}:`,
                  data
                );
            }

            yield { prefix, data: parsedData, raw: line };
          } catch (error) {
            if (this.debug)
              console.error(`[${new Date().toISOString()}] Error parsing stream chunk:`, error);
            yield { prefix: 'error', data: line, raw: line };
          }
        }
      }
    } catch (error) {
      if (this.debug) console.error(`[${new Date().toISOString()}] Error in rawStream:`, error);
      yield { prefix: 'error', data: String(error), raw: String(error) };
      throw error;
    }
  }

  public async getTools(): Promise<ToolCategory[]> {
    // GET /api/tools/categories
    const response = await this.fetchImpl(`${this.baseUrl}/api/tools/categories`, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch tools: ${response.status} ${response.statusText}`);
    }

    const parsedResponse = await response.json();
    return parsedResponse.data;
  }

  /**
   * Uploads a file to the server and returns the attachment info.
   *
   * @param filePath - The path to the file to upload
   * @param fileName - Optional custom filename
   * @returns A promise resolving to the Attachment object
   */
  public async uploadFile(filePath: string, fileName?: string): Promise<Attachment> {
    const fs = await import('fs');
    const path = await import('path');
    const { fileTypeFromBuffer } = await import('file-type');

    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const fileBuffer = fs.readFileSync(filePath);
    const actualFileName = fileName || path.basename(filePath);

    // Use proper MIME type detection
    const fileType = await fileTypeFromBuffer(fileBuffer);
    let contentType = 'application/octet-stream';

    if (fileType) {
      contentType = fileType.mime;

      // Check if it's a supported image type
      const supportedImageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
      if (!supportedImageTypes.includes(contentType)) {
        throw new Error(
          `Unsupported file type: ${contentType}. Supported types: JPEG, PNG, GIF, WebP`
        );
      }
    } else {
      // Fallback to extension-based detection if file-type can't determine it
      const ext = path.extname(filePath).toLowerCase();
      if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
        // If it's one of our expected extensions but file-type couldn't detect it,
        // we can still try to proceed with a basic mapping
        const extToMime: Record<string, string> = {
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.png': 'image/png',
          '.gif': 'image/gif',
          '.webp': 'image/webp',
        };
        contentType = extToMime[ext] || 'application/octet-stream';
      } else {
        throw new Error(`Unable to determine file type for: ${actualFileName}`);
      }
    }

    // Check file size (5MB limit)
    if (fileBuffer.length > 5 * 1024 * 1024) {
      throw new Error('File size should be less than 5MB');
    }

    // Create FormData with Node.js compatibility
    const formData = new FormData();

    // Check if we're in Node.js environment
    const isNode = typeof window === 'undefined' && typeof global !== 'undefined';

    if (isNode) {
      // Node.js environment - create a Blob from buffer for undici FormData
      const uint8Array = new Uint8Array(fileBuffer);
      const blob = new Blob([uint8Array], { type: contentType });
      formData.append('file', blob, actualFileName);
    } else {
      // Browser environment - use Blob and File
      const uint8Array = new Uint8Array(fileBuffer);
      const blob = new Blob([uint8Array], { type: contentType });
      const file = new File([blob], actualFileName, { type: contentType });
      formData.append('file', file);
    }

    if (this.debug) {
      console.log(
        `[${new Date().toISOString()}] Uploading file: ${actualFileName} (${contentType})`
      );
    }

    const headers = this.getHeaders();
    // Remove Content-Type header to let the browser set it with boundary for FormData
    delete headers['Content-Type'];

    const response = await this.fetchImpl(`${this.baseUrl}/api/files/upload`, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Upload failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const uploadResult = await response.json();

    if (this.debug) {
      console.log(`[${new Date().toISOString()}] Upload successful:`, uploadResult);
    }

    return {
      name: actualFileName,
      contentType,
      url: uploadResult.url,
    };
  }

  /**
   * Prepares the request body for a chat request
   * @private
   */
  private prepareRequestBody(options: {
    vaultId: string;
    messages: ChatMessage[];
    userApiKey?: string;
    externalWalletAddress?: string;
    slippageSettings?: Record<string, number>;
    safeMode?: boolean;
    currentPath?: string | null;
    selectedToolCategories?: string[];
    attachments?: Attachment[];
  }): HustleRequest {
    const apiKey = options.userApiKey || this.apiKey;
    if (!apiKey) {
      throw new Error('API key is required');
    }

    // Transform attachments to match real Hustle app format
    const transformedMessages = [...options.messages];

    if (options.attachments && options.attachments.length > 0) {
      // Transform the last user message to include experimental_attachments and parts
      const lastUserMessageIndex = transformedMessages.findLastIndex(msg => msg.role === 'user');
      if (lastUserMessageIndex !== -1 && transformedMessages[lastUserMessageIndex]) {
        const lastUserMessage = transformedMessages[lastUserMessageIndex];

        // Create experimental_attachments array in the same format as the main app
        const experimental_attachments = options.attachments.map(attachment => ({
          contentType: attachment.contentType || 'image/png',
          name: attachment.name || 'uploaded-image',
          url: attachment.url || '',
        }));

        // Create parts array with just the text content (no image parts)
        const parts: import('./types').MessagePart[] = [
          { type: 'text' as const, text: lastUserMessage.content || '' },
        ];

        // Update the message with experimental_attachments and parts
        transformedMessages[lastUserMessageIndex] = {
          ...lastUserMessage,
          content: lastUserMessage.content || '',
          experimental_attachments: experimental_attachments,
          parts: parts,
        };
      }
    }

    return {
      id: `chat-${options.vaultId}`,
      messages: transformedMessages,
      apiKey,
      vaultId: options.vaultId,
      externalWalletAddress: options.externalWalletAddress || '',
      slippageSettings: options.slippageSettings || {
        lpSlippage: 5,
        swapSlippage: 5,
        pumpSlippage: 5,
      },
      safeMode: options.safeMode !== false,
      currentPath: options.currentPath || null,
      attachments: options.attachments || [],
      selectedToolCategories: options.selectedToolCategories || [],
    };
  }

  /**
   * Creates a fetch request to the chat API
   * @private
   */
  private async createRequest(requestBody: HustleRequest): Promise<Response> {
    if (this.debug) {
      console.log(`[${new Date().toISOString()}] Making POST request to ${this.baseUrl}/api/chat`);
      console.log(
        `[${new Date().toISOString()}] Request headers:`,
        JSON.stringify(this.getHeaders())
      );
    }

    const response = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      if (this.debug)
        console.error(
          `[${new Date().toISOString()}] HTTP error: ${response.status} ${response.statusText}`
        );
      throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
    }

    return response;
  }

  /**
   * Constructs the necessary headers for API requests.
   * @private
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': `HustleIncognito-SDK/${this.sdkVersion}`,
    };

    // Note: API key goes in the request body for this API, not in headers
    headers['x-mcp-mode'] = 'true';
    if (this.userKey) {
      headers['X-User-Key'] = this.userKey;
      if (this.userSecret) {
        headers['X-User-Secret'] = this.userSecret;
      }
    }

    // Add cookie if available
    if (this.cookie) {
      headers['Cookie'] = this.cookie;
    }

    return headers;
  }
}
