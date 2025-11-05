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
    function handleUI(req, res) {
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hustle Incognito Test UI</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
    }
    h1 {
      color: white;
      text-align: center;
      margin-bottom: 30px;
      font-size: 2.5em;
      text-shadow: 2px 2px 4px rgba(0,0,0,0.2);
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-bottom: 20px;
    }
    @media (max-width: 768px) {
      .grid {
        grid-template-columns: 1fr;
      }
    }
    .panel {
      background: white;
      border-radius: 12px;
      padding: 25px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.2);
    }
    h2 {
      color: #667eea;
      margin-bottom: 20px;
      font-size: 1.5em;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .badge {
      font-size: 0.7em;
      padding: 4px 10px;
      border-radius: 12px;
      font-weight: normal;
    }
    .badge.streaming {
      background: #10b981;
      color: white;
    }
    .badge.non-streaming {
      background: #3b82f6;
      color: white;
    }
    .input-group {
      margin-bottom: 15px;
    }
    label {
      display: block;
      margin-bottom: 5px;
      color: #374151;
      font-weight: 500;
    }
    input, textarea {
      width: 100%;
      padding: 12px;
      border: 2px solid #e5e7eb;
      border-radius: 8px;
      font-size: 14px;
      font-family: inherit;
      transition: border-color 0.2s;
    }
    input:focus, textarea:focus {
      outline: none;
      border-color: #667eea;
    }
    textarea {
      resize: vertical;
      min-height: 80px;
    }
    button {
      width: 100%;
      padding: 12px 24px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    button:hover:not(:disabled) {
      transform: translateY(-2px);
      box-shadow: 0 5px 15px rgba(102, 126, 234, 0.4);
    }
    button:active:not(:disabled) {
      transform: translateY(0);
    }
    button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .response-box {
      margin-top: 20px;
      padding: 15px;
      background: #f9fafb;
      border-radius: 8px;
      border: 2px solid #e5e7eb;
      min-height: 200px;
      max-height: 400px;
      overflow-y: auto;
      font-family: 'Courier New', monospace;
      font-size: 13px;
      line-height: 1.6;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    .response-box.streaming {
      background: #f0fdf4;
      border-color: #86efac;
    }
    .loading {
      color: #667eea;
      font-style: italic;
    }
    .error {
      color: #dc2626;
      background: #fee2e2;
      padding: 10px;
      border-radius: 6px;
      margin-top: 10px;
    }
    .success {
      color: #059669;
    }
    .meta {
      margin-top: 10px;
      padding: 10px;
      background: #eff6ff;
      border-radius: 6px;
      font-size: 12px;
      color: #1e40af;
    }
    .event-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      margin-right: 5px;
    }
    .event-text { background: #dbeafe; color: #1e40af; }
    .event-tool { background: #fef3c7; color: #92400e; }
    .event-finish { background: #d1fae5; color: #065f46; }
    .settings-panel {
      background: white;
      border-radius: 12px;
      padding: 25px;
      margin-bottom: 20px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.2);
    }
    .settings-grid {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 15px;
      margin-top: 15px;
    }
    @media (max-width: 768px) {
      .settings-grid {
        grid-template-columns: 1fr;
      }
    }
    .settings-toggle {
      text-align: right;
      margin-bottom: 15px;
    }
    .toggle-btn {
      background: #667eea;
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
    }
    .toggle-btn:hover {
      background: #5568d3;
    }
    .settings-content {
      display: none;
    }
    .settings-content.visible {
      display: block;
    }
    .save-btn {
      margin-top: 15px;
      background: #10b981;
    }
    .save-btn:hover {
      background: #059669;
    }
    .tools-panel {
      background: white;
      border-radius: 12px;
      padding: 25px;
      margin-bottom: 20px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.2);
    }
    .tools-content {
      display: none;
    }
    .tools-content.visible {
      display: block;
    }
    .tools-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 15px;
      margin-top: 15px;
    }
    .tool-card {
      border: 2px solid #e5e7eb;
      border-radius: 8px;
      padding: 15px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .tool-card:hover {
      border-color: #667eea;
      box-shadow: 0 2px 8px rgba(102, 126, 234, 0.2);
    }
    .tool-card.selected {
      border-color: #667eea;
      background: #f0f4ff;
    }
    .tool-card.disabled {
      opacity: 0.5;
      background: #f9fafb;
    }
    .tool-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }
    .tool-title {
      font-weight: 600;
      color: #1f2937;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .tool-checkbox {
      width: 20px;
      height: 20px;
      cursor: pointer;
    }
    .tool-description {
      font-size: 13px;
      color: #6b7280;
      margin-top: 5px;
    }
    .tool-id {
      font-size: 11px;
      color: #9ca3af;
      margin-top: 5px;
      font-family: 'Courier New', monospace;
    }
    .premium-badge {
      background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
      color: white;
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 4px;
      font-weight: 600;
    }
    .tool-type-header {
      font-size: 18px;
      font-weight: 600;
      color: #374151;
      margin-top: 20px;
      margin-bottom: 10px;
      padding-bottom: 8px;
      border-bottom: 2px solid #e5e7eb;
    }
    .tool-type-header:first-child {
      margin-top: 0;
    }
    .loading-tools {
      text-align: center;
      padding: 20px;
      color: #6b7280;
    }
    .tool-actions {
      margin-top: 15px;
      display: flex;
      gap: 10px;
    }
    .clear-btn {
      background: #ef4444;
    }
    .clear-btn:hover {
      background: #dc2626;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🚀 Hustle Incognito Test UI</h1>

    <!-- Settings Panel -->
    <div class="settings-panel">
      <div class="settings-toggle">
        <button class="toggle-btn" onclick="toggleSettings()">⚙️ Settings</button>
      </div>
      <div id="settingsContent" class="settings-content">
        <h2 style="margin-bottom: 15px;">Configuration</h2>
        <div class="settings-grid">
          <div class="input-group">
            <label for="apiKey">API Key</label>
            <input type="password" id="apiKey" placeholder="Enter API key">
          </div>
          <div class="input-group">
            <label for="baseUrl">Base URL</label>
            <input type="text" id="baseUrl" placeholder="https://agenthustle.ai">
          </div>
          <div class="input-group">
            <label for="defaultVaultId">Default Vault ID</label>
            <input type="text" id="defaultVaultId" placeholder="default">
          </div>
        </div>
        <button class="save-btn" onclick="saveSettings()">💾 Save Settings</button>
      </div>
    </div>

    <!-- Tools Panel -->
    <div class="tools-panel">
      <div class="settings-toggle">
        <button class="toggle-btn" onclick="toggleTools()">🔧 Tool Selection</button>
      </div>
      <div id="toolsContent" class="tools-content">
        <h2 style="margin-bottom: 15px;">Available Tool Categories</h2>
        <div id="toolsLoader" class="loading-tools">Loading tools...</div>
        <div id="toolsList" style="display: none;"></div>
        <div class="tool-actions" id="toolActions" style="display: none;">
          <button class="save-btn" onclick="saveToolSelection()">💾 Save Tool Selection</button>
          <button class="clear-btn" onclick="clearToolSelection()">🗑️ Clear Selection</button>
        </div>
      </div>
    </div>

    <div class="grid">
      <!-- Non-Streaming Panel -->
      <div class="panel">
        <h2>
          Non-Streaming Chat
          <span class="badge non-streaming">Standard</span>
        </h2>
        <form id="nonStreamForm">
          <div class="input-group">
            <label for="message1">Message</label>
            <textarea id="message1" placeholder="What is Solana?" required></textarea>
          </div>
          <div class="input-group">
            <label for="vaultId1">Vault ID</label>
            <input type="text" id="vaultId1" value="${DEFAULT_VAULT_ID}" placeholder="default">
          </div>
          <button type="submit" id="submitBtn1">Send Message</button>
        </form>
        <div id="response1" class="response-box">Response will appear here...</div>
      </div>

      <!-- Streaming Panel -->
      <div class="panel">
        <h2>
          Streaming Chat
          <span class="badge streaming">SSE</span>
        </h2>
        <form id="streamForm">
          <div class="input-group">
            <label for="message2">Message</label>
            <textarea id="message2" placeholder="Tell me about Solana tokens" required></textarea>
          </div>
          <div class="input-group">
            <label for="vaultId2">Vault ID</label>
            <input type="text" id="vaultId2" value="${DEFAULT_VAULT_ID}" placeholder="default">
          </div>
          <button type="submit" id="submitBtn2">Stream Message</button>
        </form>
        <div id="response2" class="response-box streaming">Streaming response will appear here...</div>
      </div>
    </div>
  </div>

  <script>
    // Load settings from localStorage
    function loadSettings() {
      const apiKey = localStorage.getItem('hustle_api_key') || '';
      const baseUrl = localStorage.getItem('hustle_base_url') || '';
      const defaultVaultId = localStorage.getItem('hustle_vault_id') || '${DEFAULT_VAULT_ID}';

      document.getElementById('apiKey').value = apiKey;
      document.getElementById('baseUrl').value = baseUrl;
      document.getElementById('defaultVaultId').value = defaultVaultId;

      // Pre-fill vault ID fields
      document.getElementById('vaultId1').value = defaultVaultId;
      document.getElementById('vaultId2').value = defaultVaultId;
    }

    // Save settings to localStorage
    function saveSettings() {
      const apiKey = document.getElementById('apiKey').value;
      const baseUrl = document.getElementById('baseUrl').value;
      const defaultVaultId = document.getElementById('defaultVaultId').value;

      localStorage.setItem('hustle_api_key', apiKey);
      localStorage.setItem('hustle_base_url', baseUrl);
      localStorage.setItem('hustle_vault_id', defaultVaultId);

      // Update vault ID fields
      document.getElementById('vaultId1').value = defaultVaultId;
      document.getElementById('vaultId2').value = defaultVaultId;

      alert('Settings saved! ✓');
    }

    // Toggle settings visibility
    function toggleSettings() {
      const content = document.getElementById('settingsContent');
      content.classList.toggle('visible');
    }

    // Get current settings
    function getCurrentSettings() {
      return {
        apiKey: localStorage.getItem('hustle_api_key') || '',
        baseUrl: localStorage.getItem('hustle_base_url') || '',
        vaultId: localStorage.getItem('hustle_vault_id') || '${DEFAULT_VAULT_ID}'
      };
    }

    // Load settings on page load
    loadSettings();

    // Tools management
    let availableTools = [];
    let selectedToolIds = [];

    // Load selected tools from localStorage
    function loadToolSelection() {
      const saved = localStorage.getItem('hustle_selected_tools');
      selectedToolIds = saved ? JSON.parse(saved) : [];
    }

    // Save selected tools to localStorage
    function saveToolSelection() {
      localStorage.setItem('hustle_selected_tools', JSON.stringify(selectedToolIds));
      alert('Tool selection saved! ✓');
    }

    // Clear tool selection
    function clearToolSelection() {
      selectedToolIds = [];
      localStorage.removeItem('hustle_selected_tools');
      renderTools();
      alert('Tool selection cleared! ✓');
    }

    // Toggle tool selection
    function toggleTool(toolId) {
      const index = selectedToolIds.indexOf(toolId);
      if (index > -1) {
        selectedToolIds.splice(index, 1);
      } else {
        selectedToolIds.push(toolId);
      }
      // Save to localStorage immediately
      localStorage.setItem('hustle_selected_tools', JSON.stringify(selectedToolIds));
      renderTools();
    }

    // Render tools UI
    function renderTools() {
      const toolsList = document.getElementById('toolsList');
      if (availableTools.length === 0) return;

      // Group tools by type
      const analystTools = availableTools.filter(t => t.type === 'analyst');
      const traderTools = availableTools.filter(t => t.type === 'trader');
      const otherTools = availableTools.filter(t => t.type !== 'analyst' && t.type !== 'trader');

      let html = '';

      if (analystTools.length > 0) {
        html += '<div class="tool-type-header">📊 Analyst Tools</div>';
        html += '<div class="tools-grid">';
        analystTools.forEach(tool => {
          const isSelected = selectedToolIds.includes(tool.id);
          const isDisabled = tool.disabled || false;
          html += \`
            <div class="tool-card \${isSelected ? 'selected' : ''} \${isDisabled ? 'disabled' : ''}"
                 onclick="toggleTool('\${tool.id}')">
              <div class="tool-header">
                <div class="tool-title">
                  <input type="checkbox" class="tool-checkbox" \${isSelected ? 'checked' : ''}
                         \${isDisabled ? 'disabled' : ''} onclick="event.stopPropagation()">
                  \${tool.title}
                  \${tool.premium ? '<span class="premium-badge">💎 Premium</span>' : ''}
                </div>
              </div>
              <div class="tool-description">\${tool.description || 'No description'}</div>
              <div class="tool-id">ID: \${tool.id}</div>
            </div>
          \`;
        });
        html += '</div>';
      }

      if (traderTools.length > 0) {
        html += '<div class="tool-type-header">💹 Trader Tools</div>';
        html += '<div class="tools-grid">';
        traderTools.forEach(tool => {
          const isSelected = selectedToolIds.includes(tool.id);
          const isDisabled = tool.disabled || false;
          html += \`
            <div class="tool-card \${isSelected ? 'selected' : ''} \${isDisabled ? 'disabled' : ''}"
                 onclick="toggleTool('\${tool.id}')">
              <div class="tool-header">
                <div class="tool-title">
                  <input type="checkbox" class="tool-checkbox" \${isSelected ? 'checked' : ''}
                         \${isDisabled ? 'disabled' : ''} onclick="event.stopPropagation()">
                  \${tool.title}
                  \${tool.premium ? '<span class="premium-badge">💎 Premium</span>' : ''}
                </div>
              </div>
              <div class="tool-description">\${tool.description || 'No description'}</div>
              <div class="tool-id">ID: \${tool.id}</div>
            </div>
          \`;
        });
        html += '</div>';
      }

      if (otherTools.length > 0) {
        html += '<div class="tool-type-header">🔧 Other Tools</div>';
        html += '<div class="tools-grid">';
        otherTools.forEach(tool => {
          const isSelected = selectedToolIds.includes(tool.id);
          const isDisabled = tool.disabled || false;
          html += \`
            <div class="tool-card \${isSelected ? 'selected' : ''} \${isDisabled ? 'disabled' : ''}"
                 onclick="toggleTool('\${tool.id}')">
              <div class="tool-header">
                <div class="tool-title">
                  <input type="checkbox" class="tool-checkbox" \${isSelected ? 'checked' : ''}
                         \${isDisabled ? 'disabled' : ''} onclick="event.stopPropagation()">
                  \${tool.title}
                  \${tool.premium ? '<span class="premium-badge">💎 Premium</span>' : ''}
                </div>
              </div>
              <div class="tool-description">\${tool.description || 'No description'}</div>
              <div class="tool-id">ID: \${tool.id}</div>
            </div>
          \`;
        });
        html += '</div>';
      }

      toolsList.innerHTML = html;
    }

    // Fetch available tools
    async function fetchTools() {
      try {
        const settings = getCurrentSettings();
        const headers = {};

        if (settings.apiKey) {
          headers['X-API-Key'] = settings.apiKey;
        }
        if (settings.baseUrl) {
          headers['X-Base-URL'] = settings.baseUrl;
        }

        const response = await fetch('/api/tools', { headers });
        const data = await response.json();

        if (response.ok) {
          availableTools = data.tools || [];
          document.getElementById('toolsLoader').style.display = 'none';
          document.getElementById('toolsList').style.display = 'block';
          document.getElementById('toolActions').style.display = 'flex';
          renderTools();
        } else {
          throw new Error(data.error || 'Failed to fetch tools');
        }
      } catch (error) {
        document.getElementById('toolsLoader').innerHTML = \`<div class="error">Error loading tools: \${error.message}</div>\`;
      }
    }

    // Toggle tools visibility
    function toggleTools() {
      const content = document.getElementById('toolsContent');
      const isVisible = content.classList.toggle('visible');

      // Fetch tools when first opened
      if (isVisible && availableTools.length === 0) {
        fetchTools();
      }
    }

    // Load tool selection on page load
    loadToolSelection();

    // Non-streaming form handler
    document.getElementById('nonStreamForm').addEventListener('submit', async (e) => {
      e.preventDefault();

      const message = document.getElementById('message1').value;
      const vaultId = document.getElementById('vaultId1').value;
      const responseBox = document.getElementById('response1');
      const submitBtn = document.getElementById('submitBtn1');

      responseBox.textContent = 'Sending request...';
      responseBox.className = 'response-box loading';
      submitBtn.disabled = true;

      try {
        const settings = getCurrentSettings();
        const headers = { 'Content-Type': 'application/json' };

        // Add custom headers if settings are provided
        if (settings.apiKey) {
          headers['X-API-Key'] = settings.apiKey;
        }
        if (settings.baseUrl) {
          headers['X-Base-URL'] = settings.baseUrl;
        }

        const requestBody = { message, vaultId };

        // Add selected tools if any
        if (selectedToolIds.length > 0) {
          requestBody.selectedToolCategories = selectedToolIds;
        }

        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(requestBody)
        });

        const data = await response.json();

        if (response.ok) {
          responseBox.className = 'response-box success';
          responseBox.innerHTML = '';

          // Display main response content
          if (data.content) {
            const contentDiv = document.createElement('div');
            contentDiv.textContent = data.content;
            responseBox.appendChild(contentDiv);
          }

          // Display tool calls if any
          if (data.toolCalls && data.toolCalls.length > 0) {
            const toolsSection = document.createElement('div');
            toolsSection.style.marginTop = '15px';

            const toolsHeader = document.createElement('div');
            toolsHeader.style.fontWeight = 'bold';
            toolsHeader.style.marginBottom = '8px';
            toolsHeader.style.color = '#92400e';
            toolsHeader.textContent = '🔧 Tool Calls:';
            toolsSection.appendChild(toolsHeader);

            data.toolCalls.forEach((tool, index) => {
              const toolDiv = document.createElement('div');
              toolDiv.style.marginLeft = '10px';
              toolDiv.style.marginBottom = '8px';
              toolDiv.style.padding = '8px';
              toolDiv.style.background = '#fef3c7';
              toolDiv.style.borderRadius = '4px';
              toolDiv.style.fontSize = '12px';

              const toolName = document.createElement('div');
              toolName.style.fontWeight = '600';
              toolName.textContent = \`\${index + 1}. \${tool.toolName || 'Unknown'}\`;
              toolDiv.appendChild(toolName);

              if (tool.args && Object.keys(tool.args).length > 0) {
                const argsDiv = document.createElement('div');
                argsDiv.style.fontSize = '11px';
                argsDiv.style.color = '#6b7280';
                argsDiv.style.marginTop = '4px';
                argsDiv.textContent = 'Args: ' + JSON.stringify(tool.args);
                toolDiv.appendChild(argsDiv);
              }

              toolsSection.appendChild(toolDiv);
            });

            responseBox.appendChild(toolsSection);
          }

          // Display tool results if any
          if (data.toolResults && data.toolResults.length > 0) {
            const resultsSection = document.createElement('div');
            resultsSection.style.marginTop = '10px';

            const resultsHeader = document.createElement('div');
            resultsHeader.style.fontWeight = 'bold';
            resultsHeader.style.marginBottom = '8px';
            resultsHeader.style.color = '#065f46';
            resultsHeader.textContent = '📋 Tool Results:';
            resultsSection.appendChild(resultsHeader);

            data.toolResults.forEach((result, index) => {
              const resultDiv = document.createElement('div');
              resultDiv.style.marginLeft = '10px';
              resultDiv.style.marginBottom = '8px';
              resultDiv.style.padding = '8px';
              resultDiv.style.background = '#d1fae5';
              resultDiv.style.borderRadius = '4px';
              resultDiv.style.fontSize = '12px';

              const resultHeader = document.createElement('div');
              resultHeader.style.fontWeight = '600';
              resultHeader.textContent = \`\${index + 1}. Result for: \${result.toolName || 'Unknown'}\`;
              resultDiv.appendChild(resultHeader);

              if (result.result) {
                const resultContent = document.createElement('div');
                resultContent.style.fontSize = '11px';
                resultContent.style.color = '#374151';
                resultContent.style.marginTop = '4px';
                resultContent.style.maxHeight = '100px';
                resultContent.style.overflow = 'auto';
                resultContent.textContent = typeof result.result === 'string'
                  ? result.result
                  : JSON.stringify(result.result, null, 2);
                resultDiv.appendChild(resultContent);
              }

              resultsSection.appendChild(resultDiv);
            });

            responseBox.appendChild(resultsSection);
          }

          // Display metadata
          if (data.messageId || data.usage || data.pathInfo) {
            const meta = document.createElement('div');
            meta.className = 'meta';
            meta.innerHTML = \`
              \${data.messageId ? \`<div><strong>Message ID:</strong> \${data.messageId}</div>\` : ''}
              \${data.toolCalls?.length ? \`<div><strong>Total Tool Calls:</strong> \${data.toolCalls.length}</div>\` : ''}
              \${data.usage?.total_tokens ? \`<div><strong>Total Tokens:</strong> \${data.usage.total_tokens}</div>\` : ''}
              \${data.pathInfo ? \`<div><strong>Path:</strong> \${data.pathInfo.path || 'N/A'}</div>\` : ''}
            \`;
            responseBox.appendChild(meta);
          }
        } else {
          throw new Error(data.error || 'Request failed');
        }
      } catch (error) {
        responseBox.className = 'response-box';
        responseBox.innerHTML = \`<div class="error">Error: \${error.message}</div>\`;
      } finally {
        submitBtn.disabled = false;
      }
    });

    // Streaming form handler
    document.getElementById('streamForm').addEventListener('submit', async (e) => {
      e.preventDefault();

      const message = document.getElementById('message2').value;
      const vaultId = document.getElementById('vaultId2').value;
      const responseBox = document.getElementById('response2');
      const submitBtn = document.getElementById('submitBtn2');

      responseBox.textContent = 'Connecting to stream...';
      responseBox.className = 'response-box streaming loading';
      submitBtn.disabled = true;

      try {
        const settings = getCurrentSettings();
        const headers = { 'Content-Type': 'application/json' };

        // Add custom headers if settings are provided
        if (settings.apiKey) {
          headers['X-API-Key'] = settings.apiKey;
        }
        if (settings.baseUrl) {
          headers['X-Base-URL'] = settings.baseUrl;
        }

        const requestBody = { message, vaultId };

        // Add selected tools if any
        if (selectedToolIds.length > 0) {
          requestBody.selectedToolCategories = selectedToolIds;
        }

        const response = await fetch('/api/chat/stream', {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
          throw new Error('Stream request failed');
        }

        responseBox.innerHTML = '';
        responseBox.className = 'response-box streaming';

        // Create container for text content
        let textContainer = document.createElement('div');
        responseBox.appendChild(textContainer);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let currentEventType = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\\n');

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEventType = line.slice(7).trim();
              continue;
            }

            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));

                if (currentEventType === 'text' && data.text) {
                  // Append text to current text container
                  textContainer.textContent += data.text;
                  // Auto-scroll to bottom
                  responseBox.scrollTop = responseBox.scrollHeight;
                } else if (currentEventType === 'tool_call' && data.toolName) {
                  // Create a new text container for the next response
                  textContainer = document.createElement('div');
                  textContainer.style.marginTop = '10px';

                  const toolBadge = document.createElement('div');
                  toolBadge.style.marginTop = '10px';
                  toolBadge.innerHTML = \`<span class="event-badge event-tool">🔧 TOOL: \${data.toolName}</span>\`;
                  responseBox.appendChild(toolBadge);

                  if (data.args && Object.keys(data.args).length > 0) {
                    const argsDiv = document.createElement('div');
                    argsDiv.style.fontSize = '11px';
                    argsDiv.style.color = '#6b7280';
                    argsDiv.style.marginLeft = '10px';
                    argsDiv.textContent = 'Args: ' + JSON.stringify(data.args);
                    responseBox.appendChild(argsDiv);
                  }

                  responseBox.appendChild(textContainer);
                  responseBox.scrollTop = responseBox.scrollHeight;
                } else if (currentEventType === 'tool_result') {
                  const resultBadge = document.createElement('div');
                  resultBadge.style.marginTop = '5px';
                  resultBadge.innerHTML = \`<span class="event-badge event-tool">📋 RESULT</span>\`;
                  responseBox.appendChild(resultBadge);

                  // Create a new text container for the next response after tool result
                  textContainer = document.createElement('div');
                  textContainer.style.marginTop = '10px';
                  responseBox.appendChild(textContainer);
                  responseBox.scrollTop = responseBox.scrollHeight;
                } else if (currentEventType === 'finish' && data.reason) {
                  const finishBadge = document.createElement('div');
                  finishBadge.style.marginTop = '15px';
                  finishBadge.innerHTML = \`<span class="event-badge event-finish">✓ FINISHED</span>\`;
                  responseBox.appendChild(finishBadge);

                  if (data.usage || data.messageId) {
                    const meta = document.createElement('div');
                    meta.className = 'meta';
                    meta.innerHTML = \`
                      <div><strong>Finish Reason:</strong> \${data.reason}</div>
                      \${data.messageId ? \`<div><strong>Message ID:</strong> \${data.messageId}</div>\` : ''}
                      \${data.toolCalls?.length ? \`<div><strong>Total Tool Calls:</strong> \${data.toolCalls.length}</div>\` : ''}
                      \${data.usage?.total_tokens ? \`<div><strong>Total Tokens:</strong> \${data.usage.total_tokens}</div>\` : ''}
                    \`;
                    responseBox.appendChild(meta);
                  }
                  responseBox.scrollTop = responseBox.scrollHeight;
                } else if (data.error) {
                  throw new Error(data.error);
                }
              } catch (parseError) {
                console.error('Error parsing SSE data:', parseError);
              }
            }
          }
        }
      } catch (error) {
        responseBox.className = 'response-box streaming';
        responseBox.innerHTML = \`<div class="error">Error: \${error.message}</div>\`;
      } finally {
        submitBtn.disabled = false;
      }
    });
  </script>
</body>
</html>`;

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
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
