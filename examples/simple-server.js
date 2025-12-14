#!/usr/bin/env node

/**
 * Simple HTTP Server Example for Hustle Incognito Client
 *
 * This example demonstrates how to use the Hustle Incognito client in a server context
 * with both streaming and non-streaming endpoints.
 *
 * Endpoints:
 * - POST /api/chat - Non-streaming chat endpoint
 * - POST /api/chat/stream - Server-Sent Events (SSE) streaming endpoint
 *
 * Usage:
 *   node examples/simple-server.js [--port PORT]
 *
 * Example requests:
 *
 * Non-streaming:
 *   curl -X POST http://localhost:3000/api/chat \
 *     -H "Content-Type: application/json" \
 *     -d '{"message": "What is Solana?", "vaultId": "default"}'
 *
 * Streaming:
 *   curl -X POST http://localhost:3000/api/chat/stream \
 *     -H "Content-Type: application/json" \
 *     -d '{"message": "What is Solana?", "vaultId": "default"}' \
 *     -N
 */

import http from 'http';
import { URL } from 'url';

// Use dynamic import for compatibility
async function main() {
  try {
    // Import dependencies
    // For development: using local build
    const { HustleIncognitoClient } = await import('../dist/esm/index.js');

    // For production: use the npm package instead
    // Uncomment the line below and comment out the line above:
    // const { HustleIncognitoClient } = await import('hustle-incognito');

    const dotenv = await import('dotenv');

    // Load environment variables
    dotenv.config();

    // Parse command line arguments
    const args = process.argv.slice(2);
    const portIndex = args.indexOf('--port');
    const PORT = portIndex !== -1 && args[portIndex + 1]
      ? parseInt(args[portIndex + 1])
      : (process.env.PORT || 3000);

    // =========================================================================
    // ENVIRONMENT-BASED CONFIGURATION
    // =========================================================================
    // This server is configured entirely via environment variables.
    // No hardcoded URLs or defaults - all configuration must come from .env
    // or environment variables:
    //
    //   HUSTLE_API_KEY   - Required. Your Hustle API key
    //   HUSTLE_API_URL   - Required. API endpoint (e.g., https://agenthustle.ai)
    //   VAULT_ID         - Optional. Default vault ID (defaults to 'default')
    //   PORT             - Optional. Server port (defaults to 3000)
    //   DEBUG            - Optional. Enable debug logging (set to 'true')
    //
    // For production: HUSTLE_API_URL=https://agenthustle.ai
    // For development: HUSTLE_API_URL=https://dev.agenthustle.ai
    // =========================================================================

    const API_KEY = process.env.HUSTLE_API_KEY;
    const BASE_URL = process.env.HUSTLE_API_URL;
    const DEFAULT_VAULT_ID = process.env.VAULT_ID || 'default';

    if (!API_KEY) {
      console.error('Error: HUSTLE_API_KEY environment variable is required');
      console.error('Please create a .env file with your API key or set it in your environment');
      process.exit(1);
    }

    if (!BASE_URL) {
      console.error('Error: HUSTLE_API_URL environment variable is required');
      console.error('Set to https://agenthustle.ai for production or https://dev.agenthustle.ai for development');
      process.exit(1);
    }

    // Initialize the client with environment-based configuration
    const client = new HustleIncognitoClient({
      apiKey: API_KEY,
      hustleApiUrl: BASE_URL,
      debug: process.env.DEBUG === 'true'
    });

    console.log('✓ Hustle Incognito client initialized');
    console.log(`  API URL: ${BASE_URL}`);

    /**
     * Parse JSON body from request
     */
    async function parseBody(req) {
      return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
          body += chunk.toString();
        });
        req.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(new Error('Invalid JSON'));
          }
        });
        req.on('error', reject);
      });
    }

    /**
     * Send JSON response
     */
    function sendJSON(res, statusCode, data) {
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    }

    /**
     * Send error response
     */
    function sendError(res, statusCode, message) {
      sendJSON(res, statusCode, { error: message });
    }

    // Helper function to build messages array with optional system prompt
    function buildMessages(body) {
      if (body.messages) {
        // Use provided messages array
        return body.messages;
      }

      const messages = [];

      // Add system prompt if provided
      if (body.systemPrompt && body.systemPrompt.trim()) {
        messages.push({ role: 'system', content: body.systemPrompt.trim() });
      }

      // Add user message
      if (body.message) {
        messages.push({ role: 'user', content: body.message });
      }

      return messages;
    }

    /**
     * Non-streaming chat endpoint handler
     */
    async function handleChat(req, res) {
      try {
        const body = await parseBody(req);

        // Validate request
        if (!body.message) {
          return sendError(res, 400, 'Message is required');
        }

        // Check for custom headers
        const customApiKey = req.headers['x-api-key'];
        const customBaseUrl = req.headers['x-base-url'];

        // Use custom client if headers provided
        let clientToUse = client;
        if (customApiKey || customBaseUrl) {
          clientToUse = new HustleIncognitoClient({
            apiKey: customApiKey || API_KEY,
            debug: process.env.DEBUG === 'true',
            ...(customBaseUrl && { hustleApiUrl: customBaseUrl })
          });
          console.log(`[${new Date().toISOString()}] Using custom client config`);
        }

        // Prepare messages array with optional system prompt
        const messages = buildMessages(body);

        // Log the message structure being sent to SDK
        console.log('\n📨 Messages being sent to SDK:');
        console.log(JSON.stringify(messages, null, 2));

        // Prepare chat options
        const chatOptions = {
          vaultId: body.vaultId || DEFAULT_VAULT_ID,
        };

        if (body.selectedToolCategories) {
          chatOptions.selectedToolCategories = body.selectedToolCategories;
        }

        if (body.attachments) {
          chatOptions.attachments = body.attachments;
        }

        console.log(`[${new Date().toISOString()}] Processing non-streaming chat request`);

        // Get response from the AI
        const response = await clientToUse.chat(messages, chatOptions);

        // Send response
        sendJSON(res, 200, {
          content: response.content,
          messageId: response.messageId,
          toolCalls: response.toolCalls || [],
          toolResults: response.toolResults || [],
          usage: response.usage,
          pathInfo: response.pathInfo
        });

        console.log(`[${new Date().toISOString()}] Chat request completed`);
      } catch (error) {
        console.error('Error in handleChat:', error);
        sendError(res, 500, error.message);
      }
    }

    /**
     * Streaming chat endpoint handler (Server-Sent Events)
     */
    async function handleChatStream(req, res) {
      try {
        const body = await parseBody(req);

        // Validate request
        if (!body.message) {
          return sendError(res, 400, 'Message is required');
        }

        // Check for custom headers
        const customApiKey = req.headers['x-api-key'];
        const customBaseUrl = req.headers['x-base-url'];

        // Use custom client if headers provided
        let clientToUse = client;
        if (customApiKey || customBaseUrl) {
          clientToUse = new HustleIncognitoClient({
            apiKey: customApiKey || API_KEY,
            debug: process.env.DEBUG === 'true',
            ...(customBaseUrl && { hustleApiUrl: customBaseUrl })
          });
          console.log(`[${new Date().toISOString()}] Using custom client config for streaming`);
        }

        // Prepare messages array with optional system prompt
        const messages = buildMessages(body);

        // Log the message structure being sent to SDK
        console.log('\n📨 Messages being sent to SDK (streaming):');
        console.log(JSON.stringify(messages, null, 2));

        // Prepare stream options
        const streamOptions = {
          vaultId: body.vaultId || DEFAULT_VAULT_ID,
          messages,
          processChunks: true
        };

        if (body.selectedToolCategories) {
          streamOptions.selectedToolCategories = body.selectedToolCategories;
        }

        if (body.attachments) {
          streamOptions.attachments = body.attachments;
        }

        console.log(`[${new Date().toISOString()}] Processing streaming chat request`);

        // Set up Server-Sent Events headers
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*'
        });

        // Track response data
        let fullText = '';
        const toolCalls = [];
        const toolResults = [];
        let messageId = null;
        let usage = null;
        let pathInfo = null;

        // Stream the response
        for await (const chunk of clientToUse.chatStream(streamOptions)) {
          if ('type' in chunk) {
            switch (chunk.type) {
              case 'text':
                fullText += chunk.value;
                res.write(`event: text\n`);
                res.write(`data: ${JSON.stringify({ text: chunk.value })}\n\n`);
                break;

              case 'tool_call':
                toolCalls.push(chunk.value);
                res.write(`event: tool_call\n`);
                res.write(`data: ${JSON.stringify(chunk.value)}\n\n`);
                break;

              case 'tool_result':
                toolResults.push(chunk.value);
                res.write(`event: tool_result\n`);
                res.write(`data: ${JSON.stringify(chunk.value)}\n\n`);
                break;

              case 'message_id':
                messageId = chunk.value;
                res.write(`event: message_id\n`);
                res.write(`data: ${JSON.stringify({ messageId: chunk.value })}\n\n`);
                break;

              case 'path_info':
                pathInfo = chunk.value;
                res.write(`event: path_info\n`);
                res.write(`data: ${JSON.stringify(chunk.value)}\n\n`);
                break;

              case 'finish':
                usage = chunk.value.usage;
                res.write(`event: finish\n`);
                res.write(`data: ${JSON.stringify({
                  reason: chunk.value.reason,
                  usage: chunk.value.usage,
                  fullText,
                  messageId,
                  toolCalls,
                  toolResults,
                  pathInfo
                })}\n\n`);
                break;
            }
          }
        }

        // Close the stream
        res.end();
        console.log(`[${new Date().toISOString()}] Streaming chat request completed`);
      } catch (error) {
        console.error('Error in handleChatStream:', error);
        res.write(`event: error\n`);
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
      }
    }

    /**
     * Health check endpoint
     */
    function handleHealth(req, res) {
      sendJSON(res, 200, {
        status: 'ok',
        timestamp: new Date().toISOString(),
        service: 'hustle-incognito-server'
      });
    }

    /**
     * Get available tools endpoint
     */
    async function handleGetTools(req, res) {
      try {
        // Check for custom headers
        const customApiKey = req.headers['x-api-key'];
        const customBaseUrl = req.headers['x-base-url'];

        // Use custom client if headers provided
        let clientToUse = client;
        if (customApiKey || customBaseUrl) {
          clientToUse = new HustleIncognitoClient({
            apiKey: customApiKey || API_KEY,
            debug: process.env.DEBUG === 'true',
            ...(customBaseUrl && { hustleApiUrl: customBaseUrl })
          });
        }

        console.log(`[${new Date().toISOString()}] Fetching available tools`);
        const tools = await clientToUse.getTools();

        sendJSON(res, 200, { tools });
      } catch (error) {
        console.error('Error fetching tools:', error);
        sendError(res, 500, error.message);
      }
    }

    /**
     * Handle file upload endpoint
     */
    async function handleUpload(req, res) {
      try {
        // Collect the file data
        const chunks = [];
        let totalSize = 0;
        const maxSize = 10 * 1024 * 1024; // 10MB limit

        req.on('data', (chunk) => {
          totalSize += chunk.length;
          if (totalSize > maxSize) {
            res.writeHead(413, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'File too large. Maximum size is 10MB.' }));
            return;
          }
          chunks.push(chunk);
        });

        req.on('end', async () => {
          try {
            const buffer = Buffer.concat(chunks);

            // Parse multipart form data (simple implementation)
            const boundary = req.headers['content-type'].split('boundary=')[1];
            if (!boundary) {
              return sendError(res, 400, 'No boundary found in multipart request');
            }

            // Extract file data from multipart
            const parts = buffer.toString('binary').split(`--${boundary}`);
            let fileBuffer = null;
            let fileName = 'uploaded-file';

            for (const part of parts) {
              if (part.includes('Content-Disposition: form-data')) {
                const filenameMatch = part.match(/filename="(.+?)"/);
                if (filenameMatch) {
                  fileName = filenameMatch[1];
                }

                // Find the file content (after double CRLF)
                const contentStart = part.indexOf('\r\n\r\n');
                if (contentStart !== -1) {
                  const contentEnd = part.lastIndexOf('\r\n');
                  if (contentEnd > contentStart) {
                    const binaryContent = part.slice(contentStart + 4, contentEnd);
                    fileBuffer = Buffer.from(binaryContent, 'binary');
                    break;
                  }
                }
              }
            }

            if (!fileBuffer) {
              return sendError(res, 400, 'No file found in request');
            }

            // Check for custom headers
            const customApiKey = req.headers['x-api-key'];
            const customBaseUrl = req.headers['x-base-url'];

            // Use custom client if headers provided
            let clientToUse = client;
            if (customApiKey || customBaseUrl) {
              clientToUse = new HustleIncognitoClient({
                apiKey: customApiKey || API_KEY,
                debug: process.env.DEBUG === 'true',
                ...(customBaseUrl && { hustleApiUrl: customBaseUrl })
              });
            }

            console.log(`[${new Date().toISOString()}] Uploading file: ${fileName}`);

            // Create a temporary file path
            const fs = await import('fs');
            const path = await import('path');
            const os = await import('os');
            const tempDir = os.tmpdir();
            const tempFilePath = path.join(tempDir, `upload-${Date.now()}-${fileName}`);

            // Write buffer to temp file
            await fs.promises.writeFile(tempFilePath, fileBuffer);

            try {
              // Upload using the client
              const attachment = await clientToUse.uploadFile(tempFilePath);

              // Clean up temp file
              await fs.promises.unlink(tempFilePath);

              console.log(`[${new Date().toISOString()}] Upload successful: ${attachment.url}`);

              // Send response
              sendJSON(res, 200, {
                success: true,
                attachment
              });
            } catch (error) {
              // Clean up temp file on error
              await fs.promises.unlink(tempFilePath).catch(() => {});
              throw error;
            }
          } catch (error) {
            console.error('Error processing upload:', error);
            sendError(res, 500, error.message);
          }
        });

        req.on('error', (error) => {
          console.error('Upload request error:', error);
          sendError(res, 500, error.message);
        });
      } catch (error) {
        console.error('Error in handleUpload:', error);
        sendError(res, 500, error.message);
      }
    }

    /**
     * Serve static HTML files
     */
    async function serveHtmlFile(res, filename, replacements = {}) {
      try {
        const fs = await import('fs');
        const path = await import('path');
        const { fileURLToPath } = await import('url');
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        const htmlPath = path.join(__dirname, filename);

        // Read the HTML file
        fs.readFile(htmlPath, 'utf8', (err, data) => {
          if (err) {
            console.error(`Error reading ${filename}:`, err);
            res.writeHead(500, { 'Content-Type': 'text/html' });
            res.end(`<h1>Error: Could not load ${filename}</h1><p>Please ensure ${filename} exists in the examples directory.</p>`);
            return;
          }

          // Apply any placeholder replacements
          let updatedHtml = data;
          for (const [placeholder, value] of Object.entries(replacements)) {
            updatedHtml = updatedHtml.replace(new RegExp(placeholder, 'g'), value);
          }

          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(updatedHtml);
        });
      } catch (error) {
        console.error(`Error serving ${filename}:`, error);
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end('<h1>Internal Server Error</h1>');
      }
    }

    /**
     * Serve landing page
     */
    function handleLandingPage(req, res) {
      serveHtmlFile(res, 'index.html');
    }

    /**
     * Serve API key demo UI (deprecated)
     */
    function handleDemoUI(req, res) {
      serveHtmlFile(res, 'demo-ui.html', {
        '{{VAULT_ID_PLACEHOLDER}}': DEFAULT_VAULT_ID
      });
    }

    /**
     * Serve Emblem Auth demo
     */
    function handleAuthDemo(req, res) {
      serveHtmlFile(res, 'auth-chat-demo.html');
    }

    /**
     * Serve static files from dist directory (for browser SDK)
     */
    async function handleDistFiles(req, res, filepath) {
      try {
        const fs = await import('fs');
        const path = await import('path');
        const { fileURLToPath } = await import('url');
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);

        // Go up one level from examples to reach dist
        const distPath = path.join(__dirname, '..', filepath);

        // Determine content type
        const ext = path.extname(filepath).toLowerCase();
        const contentTypes = {
          '.js': 'application/javascript',
          '.mjs': 'application/javascript',
          '.json': 'application/json',
          '.css': 'text/css',
          '.map': 'application/json'
        };
        const contentType = contentTypes[ext] || 'application/octet-stream';

        fs.readFile(distPath, (err, data) => {
          if (err) {
            console.error(`Error reading ${filepath}:`, err);
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found');
            return;
          }

          res.writeHead(200, { 'Content-Type': contentType });
          res.end(data);
        });
      } catch (error) {
        console.error(`Error serving ${filepath}:`, error);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
      }
    }

    /**
     * Main request handler
     */
    async function handleRequest(req, res) {
      const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
      const pathname = parsedUrl.pathname;
      const method = req.method;

      // Enable CORS
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      // Handle preflight requests
      if (method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      // Route requests
      if (pathname === '/' && method === 'GET') {
        return handleLandingPage(req, res);
      }

      if (pathname === '/demo-ui.html' && method === 'GET') {
        return handleDemoUI(req, res);
      }

      if (pathname === '/auth-chat-demo.html' && method === 'GET') {
        return handleAuthDemo(req, res);
      }

      // Serve SDK browser build files
      if (pathname.startsWith('/dist/') && method === 'GET') {
        return handleDistFiles(req, res, pathname);
      }

      if (pathname === '/health' && method === 'GET') {
        return handleHealth(req, res);
      }

      if (pathname === '/api/tools' && method === 'GET') {
        return handleGetTools(req, res);
      }

      if (pathname === '/api/chat' && method === 'POST') {
        return handleChat(req, res);
      }

      if (pathname === '/api/chat/stream' && method === 'POST') {
        return handleChatStream(req, res);
      }

      if (pathname === '/api/upload' && method === 'POST') {
        return handleUpload(req, res);
      }

      // 404 for unknown routes
      sendError(res, 404, 'Not found');
    }

    // Create and start server
    const server = http.createServer(handleRequest);

    server.listen(PORT, () => {
      console.log('');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('  Hustle Incognito Server Started');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('');
      console.log(`  🌐 Open in browser: http://localhost:${PORT}`);
      console.log('');
      console.log('  Demo Pages:');
      console.log(`    /                         - Landing page (choose demo)`);
      console.log(`    /auth-chat-demo.html      - Emblem Auth demo (recommended)`);
      console.log(`    /demo-ui.html             - API Key demo (deprecated)`);
      console.log('');
      console.log('  API Endpoints:');
      console.log(`    GET  /health              - Health check`);
      console.log(`    GET  /api/tools           - Get available tools`);
      console.log(`    POST /api/chat            - Non-streaming chat`);
      console.log(`    POST /api/chat/stream     - Streaming chat (SSE)`);
      console.log(`    POST /api/upload          - File upload`);
      console.log('');
      console.log('  Example requests:');
      console.log('');
      console.log('  Non-streaming:');
      console.log(`    curl -X POST http://localhost:${PORT}/api/chat \\`);
      console.log(`      -H "Content-Type: application/json" \\`);
      console.log(`      -d '{"message": "What is Solana?", "vaultId": "${DEFAULT_VAULT_ID}"}'`);
      console.log('');
      console.log('  Streaming:');
      console.log(`    curl -X POST http://localhost:${PORT}/api/chat/stream \\`);
      console.log(`      -H "Content-Type: application/json" \\`);
      console.log(`      -d '{"message": "What is Solana?", "vaultId": "${DEFAULT_VAULT_ID}"}' \\`);
      console.log(`      -N`);
      console.log('');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('');
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('SIGTERM received, shutting down gracefully');
      server.close(() => {
        console.log('Server closed');
        process.exit(0);
      });
    });

    process.on('SIGINT', () => {
      console.log('\nSIGINT received, shutting down gracefully');
      server.close(() => {
        console.log('Server closed');
        process.exit(0);
      });
    });

  } catch (error) {
    console.error('Error initializing server:', error);
    process.exit(1);
  }
}

// Run the main function
main();
