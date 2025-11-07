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

    // Check for required environment variables
    const API_KEY = process.env.HUSTLE_API_KEY;
    const DEFAULT_VAULT_ID = process.env.VAULT_ID || 'default';
    const BASE_URL = process.env.HUSTLE_API_URL;

    if (!API_KEY) {
      console.error('Error: HUSTLE_API_KEY environment variable is required');
      console.error('Please create a .env file with your API key or set it in your environment');
      process.exit(1);
    }

    // Initialize the client
    const client = new HustleIncognitoClient({
      apiKey: API_KEY,
      debug: process.env.DEBUG === 'true',
      ...(BASE_URL && { hustleApiUrl: BASE_URL })
    });

    console.log('✓ Hustle Incognito client initialized');

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

        // Prepare messages array
        const messages = body.messages || [
          { role: 'user', content: body.message }
        ];

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

        // Prepare messages array
        const messages = body.messages || [
          { role: 'user', content: body.message }
        ];

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
     * Serve test UI
     */
    async function handleUI(req, res) {
      try {
        const fs = await import('fs');
        const path = await import('path');
        const { fileURLToPath } = await import('url');
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        const htmlPath = path.join(__dirname, 'demo-ui.html');

        // Read the HTML file
        fs.readFile(htmlPath, 'utf8', (err, data) => {
          if (err) {
            console.error('Error reading demo-ui.html:', err);
            // Fallback to serving error message if file not found
            res.writeHead(500, { 'Content-Type': 'text/html' });
            res.end('<h1>Error: Could not load demo-ui.html</h1><p>Please ensure demo-ui.html exists in the examples directory.</p>');
            return;
          }

          // Replace placeholder values with actual values
          const updatedHtml = data.replace(/{{VAULT_ID_PLACEHOLDER}}/g, DEFAULT_VAULT_ID);

          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(updatedHtml);
        });
      } catch (error) {
        console.error('Error in handleUI:', error);
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end('<h1>Internal Server Error</h1>');
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
        return handleUI(req, res);
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

      // 404 for unknown routes
      sendError(res, 404, 'Not found');
    }

    // Create and start server
    const server = http.createServer(handleRequest);

    server.listen(PORT, () => {
      console.log('');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('  Hustle Incognito Server Started');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('');
      console.log(`  🌐 Test UI:   http://localhost:${PORT}`);
      console.log(`  📡 Server:    http://localhost:${PORT}`);
      console.log('');
      console.log('  Available endpoints:');
      console.log(`    GET  /                    - Test UI (open in browser)`);
      console.log(`    GET  /health              - Health check`);
      console.log(`    POST /api/chat            - Non-streaming chat`);
      console.log(`    POST /api/chat/stream     - Streaming chat (SSE)`);
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
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
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
