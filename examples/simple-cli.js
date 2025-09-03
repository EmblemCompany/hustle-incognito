#!/usr/bin/env node

// Use dynamic import for compatibility with both ESM and CommonJS
async function main() {
  try {
    // Import dependencies
    const { HustleIncognitoClient } = await import('../dist/esm/index.js');
    const dotenv = await import('dotenv');
    const readline = await import('readline');
    const fs = await import('fs');
    const path = await import('path');
    
    // Load environment variables
    dotenv.config();
    
    // Parse command line arguments
    const args = process.argv.slice(2);
    const initialDebugMode = args.includes('--debug');
    const initialStreamMode = args.includes('--stream');
    
    // Check for required environment variables
    const API_KEY = process.env.HUSTLE_API_KEY;
    const VAULT_ID = process.env.VAULT_ID || 'default';
    const ENV_DEBUG = process.env.DEBUG === 'true';
    
    if (!API_KEY) {
      console.error('Error: HUSTLE_API_KEY environment variable is required');
      console.error('Please create a .env file with your API key or set it in your environment');
      process.exit(1);
    }
    
    // Settings that can be toggled during runtime
    let settings = {
      debug: initialDebugMode || ENV_DEBUG,
      stream: initialStreamMode,
      selectedTools: []  // Array of selected tool category IDs
    };
    
    // Store available tools
    let availableTools = [];
    
    // Store pending attachments for the next message
    let pendingAttachments = [];
    
    // Initialize the client
    let client = new HustleIncognitoClient({
      apiKey: API_KEY,
      debug: settings.debug
    });
    
    // Create readline interface for user input
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    // Store conversation history
    const messages = [];
    
    // Stream the response from the API
    async function streamResponse(messages) {
      let fullText = '';
      let toolCalls = [];
      
      process.stdout.write('\nAgent: ');
      
      try {
        const streamOptions = {
          vaultId: VAULT_ID,
          messages,
          processChunks: true
        };
        
        // Add selected tools if any
        if (settings.selectedTools.length > 0) {
          streamOptions.selectedToolCategories = settings.selectedTools;
        }
        
        // Add pending attachments if any
        if (pendingAttachments.length > 0) {
          streamOptions.attachments = [...pendingAttachments];
          console.log(`\n📎 Including ${pendingAttachments.length} attachment(s)`);
          // Clear pending attachments after adding them
          pendingAttachments = [];
        }
        
        for await (const chunk of client.chatStream(streamOptions)) {
          if ('type' in chunk) {
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
        }
      } catch (error) {
        console.error(`\nError during streaming: ${error.message}`);
      }
      
      // Log tool usage if any
      if (toolCalls.length > 0) {
        console.log('\nTools used:');
        toolCalls.forEach((tool, i) => {
          console.log(`${i+1}. ${tool.toolName || 'Unknown tool'} (ID: ${tool.toolCallId || 'unknown'})`);
          if (tool.args) {
            console.log(`   Args: ${JSON.stringify(tool.args)}`);
          }
        });
      }
      
      return fullText;
    }
    
    // Display help information
    function showHelp() {
      console.log('\nAvailable commands:');
      console.log('  /help       - Show this help message');
      console.log('  /settings   - Show current settings');
      console.log('  /stream on|off - Toggle streaming mode');
      console.log('  /debug on|off  - Toggle debug mode');
      console.log('  /tools      - Manage tool categories');
      console.log('  /tools add <id> - Add a tool category');
      console.log('  /tools remove <id> - Remove a tool category');
      console.log('  /tools clear - Use all tools (no filter)');
      console.log('  /image <path> - Upload an image file for the next message');
      console.log('  /attachments  - Show pending attachments');
      console.log('  /clear-attachments - Clear all pending attachments');
      console.log('  /exit or /quit - Exit the application');
    }
    
    // Show current settings
    function showSettings() {
      console.log('\nCurrent settings:');
      console.log(`  Streaming: ${settings.stream ? 'ON' : 'OFF'}`);
      console.log(`  Debug:     ${settings.debug ? 'ON' : 'OFF'}`);
      console.log(`  Selected Tools: ${
        settings.selectedTools.length > 0 
          ? settings.selectedTools.join(', ')
          : 'All tools (no filter)'
      }`);
      console.log(`  Pending Attachments: ${pendingAttachments.length > 0 
        ? pendingAttachments.length + ' file(s)'
        : 'None'
      }`);
    }
    
    // Manage tool categories
    async function manageTools() {
      try {
        // Fetch available tools if not already loaded
        if (availableTools.length === 0) {
          console.log('\nFetching available tool categories...');
          availableTools = await client.getTools();
        }
        
        // Display available tools
        console.log('\n=== Tool Categories ===');
        console.log('Select tool categories to enable/disable:\n');
        
        // Group tools by type
        const analystTools = availableTools.filter(t => t.type === 'analyst');
        const traderTools = availableTools.filter(t => t.type === 'trader');
        
        if (analystTools.length > 0) {
          console.log('📊 Analyst Tools:');
          analystTools.forEach((tool) => {
            const isSelected = settings.selectedTools.includes(tool.id);
            const status = isSelected ? '✅' : '⬜';
            const premium = tool.premium ? ' 💎' : '';
            console.log(`  ${status} ${tool.title}${premium}`);
            console.log(`     ID: ${tool.id}`);
            console.log(`     ${tool.description}`);
          });
          console.log('');
        }
        
        if (traderTools.length > 0) {
          console.log('💹 Trader Tools:');
          traderTools.forEach((tool) => {
            const isSelected = settings.selectedTools.includes(tool.id);
            const status = isSelected ? '✅' : '⬜';
            const premium = tool.premium ? ' 💎' : '';
            console.log(`  ${status} ${tool.title}${premium}`);
            console.log(`     ID: ${tool.id}`);
            console.log(`     ${tool.description}`);
          });
        }
        
        console.log('\nCurrently selected:', 
          settings.selectedTools.length > 0 
            ? settings.selectedTools.join(', ') 
            : 'All tools (no filter)');
        
        console.log('\nCommands:');
        console.log('  /tools add <id>     - Add a tool category');
        console.log('  /tools remove <id>  - Remove a tool category');
        console.log('  /tools clear        - Clear all selections (use all tools)');
        console.log('  /tools list         - Show this list again');
        console.log('  /tools <id>         - Toggle a specific tool category');
        
      } catch (error) {
        console.error('Error fetching tools:', error.message);
      }
    }
    
    // Process commands (now async to handle /tools)
    async function processCommand(command) {
      if (command === '/help') {
        showHelp();
        return true;
      }
      
      if (command === '/settings') {
        showSettings();
        return true;
      }
      
      if (command === '/exit' || command === '/quit') {
        console.log('Goodbye!');
        rl.close();
        process.exit(0);
        return true;
      }
      
      if (command.startsWith('/stream')) {
        const parts = command.split(' ');
        if (parts.length === 2) {
          if (parts[1] === 'on') {
            settings.stream = true;
            console.log('Streaming mode enabled');
          } else if (parts[1] === 'off') {
            settings.stream = false;
            console.log('Streaming mode disabled');
          } else {
            console.log(`Invalid option: ${parts[1]}. Use 'on' or 'off'`);
          }
        } else {
          console.log(`Streaming is currently ${settings.stream ? 'ON' : 'OFF'}`);
        }
        return true;
      }
      
      if (command.startsWith('/tools')) {
        const parts = command.split(' ');
        
        // If just "/tools", show the tool management interface
        if (parts.length === 1) {
          await manageTools();
          return true;
        }
        
        const subCommand = parts[1];
        const toolId = parts[2];
        
        if (subCommand === 'list') {
          await manageTools();
          return true;
        }
        
        if (subCommand === 'clear') {
          settings.selectedTools = [];
          console.log('Tool filter cleared. All tools are now available.');
          return true;
        }
        
        if (subCommand === 'add' && toolId) {
          if (!settings.selectedTools.includes(toolId)) {
            settings.selectedTools.push(toolId);
            console.log(`Added tool category: ${toolId}`);
            console.log('Current selection:', settings.selectedTools.join(', '));
          } else {
            console.log(`Tool category ${toolId} is already selected.`);
          }
          return true;
        }
        
        if (subCommand === 'remove' && toolId) {
          const index = settings.selectedTools.indexOf(toolId);
          if (index > -1) {
            settings.selectedTools.splice(index, 1);
            console.log(`Removed tool category: ${toolId}`);
            console.log('Current selection:', 
              settings.selectedTools.length > 0 
                ? settings.selectedTools.join(', ')
                : 'All tools (no filter)');
          } else {
            console.log(`Tool category ${toolId} is not in selection.`);
          }
          return true;
        }
        
        // If a tool ID is provided directly, toggle it
        if (subCommand && !['add', 'remove', 'clear', 'list'].includes(subCommand)) {
          const index = settings.selectedTools.indexOf(subCommand);
          if (index > -1) {
            settings.selectedTools.splice(index, 1);
            console.log(`Removed tool category: ${subCommand}`);
          } else {
            settings.selectedTools.push(subCommand);
            console.log(`Added tool category: ${subCommand}`);
          }
          console.log('Current selection:', 
            settings.selectedTools.length > 0 
              ? settings.selectedTools.join(', ')
              : 'All tools (no filter)');
          return true;
        }
        
        console.log('Invalid tools command. Use /tools, /tools list, /tools add <id>, /tools remove <id>, or /tools clear');
        return true;
      }
      
      if (command.startsWith('/debug')) {
        const parts = command.split(' ');
        if (parts.length === 2) {
          if (parts[1] === 'on') {
            settings.debug = true;
            // Reinitialize client with new debug setting
            client = new HustleIncognitoClient({
              apiKey: API_KEY,
              debug: true
            });
            console.log('Debug mode enabled');
          } else if (parts[1] === 'off') {
            settings.debug = false;
            // Reinitialize client with new debug setting
            client = new HustleIncognitoClient({
              apiKey: API_KEY,
              debug: false
            });
            console.log('Debug mode disabled');
          } else {
            console.log(`Invalid option: ${parts[1]}. Use 'on' or 'off'`);
          }
        } else {
          console.log(`Debug is currently ${settings.debug ? 'ON' : 'OFF'}`);
        }
        return true;
      }
      
      if (command === '/attachments') {
        if (pendingAttachments.length === 0) {
          console.log('No pending attachments.');
        } else {
          console.log('\nPending attachments:');
          pendingAttachments.forEach((attachment, index) => {
            console.log(`  ${index + 1}. ${attachment.name} (${attachment.contentType})`);
          });
        }
        return true;
      }
      
      if (command === '/clear-attachments') {
        if (pendingAttachments.length === 0) {
          console.log('No attachments to clear.');
        } else {
          const count = pendingAttachments.length;
          pendingAttachments = [];
          console.log(`Cleared ${count} attachment(s).`);
        }
        return true;
      }
      
      if (command.startsWith('/image ')) {
        const imagePath = command.substring(7).trim();
        if (!imagePath) {
          console.log('Please provide an image path: /image <path>');
          return true;
        }
        
        try {
          // Check if file exists and is an image
          if (!fs.existsSync(imagePath)) {
            console.log(`File not found: ${imagePath}`);
            return true;
          }
          
          const stats = fs.statSync(imagePath);
          if (!stats.isFile()) {
            console.log(`Not a file: ${imagePath}`);
            return true;
          }
          
          // Check file extension
          const ext = path.extname(imagePath).toLowerCase();
          const supportedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
          if (!supportedExts.includes(ext)) {
            console.log(`Unsupported image format. Supported formats: ${supportedExts.join(', ')}`);
            return true;
          }
          
          console.log(`📤 Uploading ${path.basename(imagePath)}...`);
          
          const attachment = await client.uploadFile(imagePath);
          pendingAttachments.push(attachment);
          
          console.log(`✅ Upload successful! Image will be included with your next message.`);
          console.log(`   Name: ${attachment.name}`);
          console.log(`   Type: ${attachment.contentType}`);
          console.log(`   URL: ${attachment.url}`);
          
        } catch (error) {
          console.error(`❌ Upload failed: ${error.message}`);
        }
        return true;
      }

      return false;
    }
    
    // Main chat function
    async function chat() {
      rl.question('\nYou: ', async (input) => {
        // Check if the input is a command
        if (input.startsWith('/')) {
          const isCommand = await processCommand(input);
          if (isCommand) {
            chat();
            return;
          }
        }
        
        // Exit condition (handled by processCommand, but kept for compatibility)
        if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
          console.log('Goodbye!');
          rl.close();
          return;
        }
        
        // Add user message to history
        messages.push({ role: 'user', content: input });
        
        if (!settings.stream) {
          console.log('\nAgent is thinking...');
        }
        
        try {
          let assistantResponse = '';
          
          if (settings.stream) {
            // Stream the response
            assistantResponse = await streamResponse([...messages]);
          } else {
            // Get response from the AI (non-streaming)
            const chatOptions = { vaultId: VAULT_ID };
            
            // Add selected tools if any
            if (settings.selectedTools.length > 0) {
              chatOptions.selectedToolCategories = settings.selectedTools;
            }

            // Add attachments if any
            if (pendingAttachments.length > 0) {
              chatOptions.attachments = [...pendingAttachments];
              pendingAttachments.length = 0;
            }

            const response = await client.chat(
              messages,
              chatOptions
            );
            
            console.log(`\nAgent: ${response.content}`);
            
            // Log tool usage if any
            if (response.toolCalls && response.toolCalls.length > 0) {
              console.log('\nTools used:');
              response.toolCalls.forEach((tool, i) => {
                console.log(`${i+1}. ${tool.toolName || 'Unknown tool'} (ID: ${tool.toolCallId || 'unknown'})`);
                if (tool.args) {
                  console.log(`   Args: ${JSON.stringify(tool.args)}`);
                }
              });
            }
            
            assistantResponse = response.content;
          }

          // Add assistant response to history
          if (assistantResponse && assistantResponse.length > 0) {
            if (settings.debug) {
              console.log(`\n[DEBUG] Adding assistant response to history: ${assistantResponse.substring(0, 50)}${assistantResponse.length > 50 ? '...' : ''}`);
            }
            messages.push({ role: 'assistant', content: assistantResponse });
          } else if (settings.debug) {
            console.log('\n[DEBUG] No assistant response to add to history');
          }
          
          // Continue the conversation
          chat();
        } catch (error) {
          console.error('Error:', error.message);
          chat();
        }
      });
    }
    
    // Start the chat
    console.log('Welcome to Emblem Vault Hustle Incognito CLI!');
    console.log('Ask about Solana tokens, trading, or anything crypto-related.');
    console.log('Type "/help" to see available commands or "/exit" to end the conversation.\n');
    
    // Show initial settings
    if (settings.debug) {
      console.log('[DEBUG MODE ENABLED] - Timestamps will be shown with debug information');
    }
    
    if (settings.stream) {
      console.log('[STREAM MODE ENABLED] - Responses will be streamed in real-time');
    }
    
    console.log(''); // Empty line for better spacing
    showSettings();
    chat();
  } catch (error) {
    console.error('Error initializing CLI:', error);
  }
}

// Run the main function
main();
