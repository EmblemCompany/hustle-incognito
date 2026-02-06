#!/usr/bin/env node

/**
 * Hustle Incognito CLI with Headless Password Authentication
 *
 * This CLI demonstrates using the SDK with password-based authentication,
 * ideal for servers, CLI tools, and AI agents without browser access.
 *
 * Usage:
 *   node simple-cli-auth.js --password "your-password-min-16-chars"
 *   node simple-cli-auth.js  # Will prompt for password interactively
 *
 * Environment variables:
 *   AGENT_PASSWORD  - Password for authentication (min 16 chars)
 *   APP_ID          - App ID (default: emblem-agent-wallet)
 *   AUTH_API_URL    - Auth API URL (optional, uses SDK default)
 *   HUSTLE_API_URL  - Hustle API URL (optional, uses SDK default)
 *   DEBUG           - Enable debug logging (set to 'true')
 */

async function main() {
  try {
    // Import dependencies
    const { HustleIncognitoClient } = await import('../dist/esm/index.js');
    const { EmblemAuthSDK } = await import('@emblemvault/auth-sdk');
    const dotenv = await import('dotenv');
    const readline = await import('readline');

    // Load environment variables
    dotenv.config();

    // Parse command line arguments
    const args = process.argv.slice(2);
    const getArg = (flag) => {
      const index = args.indexOf(flag);
      return index !== -1 && args[index + 1] ? args[index + 1] : null;
    };

    const initialDebugMode = args.includes('--debug');
    const initialStreamMode = args.includes('--stream');
    const passwordArg = getArg('--password');

    // Environment configuration
    const ENV_PASSWORD = passwordArg || process.env.AGENT_PASSWORD;
    const ENV_APP_ID = process.env.APP_ID || 'emblem-agent-wallet';
    const ENV_AUTH_API_URL = process.env.AUTH_API_URL;  // Uses SDK default if not set
    const ENV_HUSTLE_API_URL = process.env.HUSTLE_API_URL;  // Uses SDK default if not set
    const ENV_DEBUG = process.env.DEBUG === 'true';

    // Create readline interface
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    // Helper to prompt for input
    const prompt = (question) => new Promise((resolve) => {
      rl.question(question, resolve);
    });

    // Helper to prompt for password (hidden input)
    const promptPassword = async (question) => {
      if (process.stdin.isTTY) {
        process.stdout.write(question);

        return new Promise((resolve) => {
          let password = '';

          const onData = (char) => {
            char = char.toString();

            switch (char) {
              case '\n':
              case '\r':
              case '\u0004':
                process.stdin.removeListener('data', onData);
                process.stdin.setRawMode(false);
                process.stdout.write('\n');
                resolve(password);
                break;
              case '\u0003':
                process.exit();
                break;
              case '\u007F':
                if (password.length > 0) {
                  password = password.slice(0, -1);
                  process.stdout.write('\b \b');
                }
                break;
              default:
                password += char;
                process.stdout.write('*');
            }
          };

          process.stdin.setRawMode(true);
          process.stdin.resume();
          process.stdin.on('data', onData);
        });
      } else {
        return prompt(question);
      }
    };

    console.log('========================================');
    console.log('  Hustle Incognito CLI (Auth Edition)');
    console.log('========================================');
    console.log('');
    console.log('This CLI uses headless password authentication.');
    console.log('No API key required - authentication is via password.');
    console.log('');

    // Get password
    let password = ENV_PASSWORD;

    if (!password) {
      console.log('No password provided via --password flag or AGENT_PASSWORD env var.');
      console.log('');
      password = await promptPassword('Enter your password (min 16 chars): ');
    }

    // Validate password
    if (!password || password.length < 16) {
      console.error('\nError: Password must be at least 16 characters.');
      console.error('Use a long, random string like an API key for security.');
      process.exit(1);
    }

    console.log('');
    console.log('Authenticating...');

    // Create auth SDK instance directly (so we can access all its methods)
    let authSdk;
    let client;

    try {
      const sdkConfig = {
        appId: ENV_APP_ID,
        persistSession: false, // No localStorage in Node.js
      };

      if (ENV_AUTH_API_URL) {
        sdkConfig.apiUrl = ENV_AUTH_API_URL;
      }

      authSdk = new EmblemAuthSDK(sdkConfig);

      // Authenticate with password
      const session = await authSdk.authenticatePassword({ password });

      if (!session) {
        throw new Error('Authentication failed - no session returned');
      }

      // Create Hustle client with the authenticated SDK
      const clientConfig = {
        sdk: authSdk,
        debug: initialDebugMode || ENV_DEBUG,
      };

      if (ENV_HUSTLE_API_URL) {
        clientConfig.hustleApiUrl = ENV_HUSTLE_API_URL;
      }

      client = new HustleIncognitoClient(clientConfig);

    } catch (error) {
      console.error('\nAuthentication failed:', error.message);
      if (error.message.includes('@emblemvault/auth-sdk')) {
        console.error('\nTo install the auth SDK:');
        console.error('  npm install @emblemvault/auth-sdk');
      }
      process.exit(1);
    }

    console.log('Authentication successful!');
    console.log('');

    // Settings
    let settings = {
      debug: initialDebugMode || ENV_DEBUG,
      stream: initialStreamMode,
      selectedTools: [],
      retainHistory: true,
      model: null,
    };

    // Store conversation history
    const messages = [];

    // Store intent context for auto-tools mode
    let lastIntentContext = null;

    // Spinner for loading animation
    const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let spinnerInterval = null;
    let spinnerIndex = 0;
    const hideCursor = '\x1B[?25l';
    const showCursor = '\x1B[?25h';

    function startSpinner() {
      spinnerIndex = 0;
      process.stdout.write(hideCursor + spinnerFrames[0]);
      spinnerInterval = setInterval(() => {
        process.stdout.write('\b' + spinnerFrames[spinnerIndex]);
        spinnerIndex = (spinnerIndex + 1) % spinnerFrames.length;
      }, 80);
    }

    function stopSpinner() {
      if (spinnerInterval) {
        clearInterval(spinnerInterval);
        spinnerInterval = null;
        process.stdout.write('\b \b' + showCursor);
      }
    }

    // Stream response
    async function streamResponse(msgs) {
      let fullText = '';
      let toolCalls = [];
      let firstChunkReceived = false;

      process.stdout.write('\nAgent: ');
      startSpinner();

      try {
        const streamOptions = {
          messages: msgs,
          processChunks: true
        };

        if (settings.model) {
          streamOptions.model = settings.model;
        }

        if (settings.selectedTools.length > 0) {
          streamOptions.selectedToolCategories = settings.selectedTools;
        } else if (lastIntentContext) {
          streamOptions.intentContext = lastIntentContext;
        }

        const stream = client.chatStream(streamOptions);

        for await (const chunk of stream) {
          if ('type' in chunk) {
            switch (chunk.type) {
              case 'text':
                if (!firstChunkReceived) {
                  stopSpinner();
                  firstChunkReceived = true;
                }
                process.stdout.write(chunk.value);
                fullText += chunk.value;
                break;

              case 'intent_context':
                if (chunk.value?.intentContext) {
                  lastIntentContext = chunk.value.intentContext;
                  if (settings.debug) {
                    console.log('[DEBUG] Captured intent context:',
                      `activeIntent="${lastIntentContext.activeIntent || 'general'}", ` +
                      `categories=[${lastIntentContext.categories?.join(', ') || 'none'}]`);
                  }
                }
                break;

              case 'tool_call':
                if (!firstChunkReceived) {
                  stopSpinner();
                  firstChunkReceived = true;
                }
                toolCalls.push(chunk.value);
                break;

              case 'finish':
                stopSpinner();
                process.stdout.write('\n');
                break;
            }
          }
        }
      } catch (error) {
        stopSpinner();
        console.error(`\nError during streaming: ${error.message}`);
      }

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

    // Display help
    function showHelp() {
      console.log('\nAvailable commands:');
      console.log('  /help       - Show this help message');
      console.log('  /settings   - Show current settings');
      console.log('  /auth       - Open authentication menu (API key, vault info, etc.)');
      console.log('  /stream on|off - Toggle streaming mode');
      console.log('  /debug on|off  - Toggle debug mode');
      console.log('  /history on|off - Toggle message history retention');
      console.log('  /clear      - Clear conversation history');
      console.log('  /models     - List available models');
      console.log('  /model <id> - Set the model to use');
      console.log('  /model clear - Clear model selection');
      console.log('  /tools      - Manage tool categories');
      console.log('  /tools add <id> - Add a tool category');
      console.log('  /tools remove <id> - Remove a tool category');
      console.log('  /tools clear - Enable auto-tools mode');
      console.log('  /payment            - Show PAYG billing status');
      console.log('  /payment enable     - Enable pay-as-you-go billing');
      console.log('  /payment disable    - Disable pay-as-you-go billing');
      console.log('  /payment token <T>  - Set payment token (SOL, ETH, HUSTLE, etc.)');
      console.log('  /payment mode <M>   - Set payment mode (pay_per_request, debt_accumulation)');
      console.log('  /exit or /quit - Exit the application');
    }

    // Show settings
    function showSettings() {
      const session = authSdk.getSession();
      console.log('\nCurrent settings:');
      console.log(`  App ID:     ${ENV_APP_ID}`);
      console.log(`  Vault ID:   ${session?.user?.vaultId || 'N/A'}`);
      console.log(`  Auth Mode:  Password (headless)`);
      console.log(`  Model:      ${settings.model || 'API default'}`);
      console.log(`  Streaming:  ${settings.stream ? 'ON' : 'OFF'}`);
      console.log(`  Debug:      ${settings.debug ? 'ON' : 'OFF'}`);
      console.log(`  History:    ${settings.retainHistory ? 'ON' : 'OFF'}`);
      console.log(`  Messages:   ${messages.length}`);
      console.log(`  Tools:      ${
        settings.selectedTools.length > 0
          ? settings.selectedTools.join(', ')
          : 'Auto-tools mode'
      }`);
      console.log('  PAYG:      Use /payment to view billing status');
    }

    // Auth menu
    async function showAuthMenu() {
      console.log('\n========================================');
      console.log('         Authentication Menu');
      console.log('========================================');
      console.log('');
      console.log('  1. Get API Key');
      console.log('  2. Get Vault Info');
      console.log('  3. Get Session Info');
      console.log('  4. Refresh Session');
      console.log('  5. Get EVM Address');
      console.log('  6. Get Solana Address');
      console.log('  7. Get BTC Addresses');
      console.log('  8. Logout');
      console.log('  9. Back to chat');
      console.log('');

      const choice = await prompt('Select option (1-9): ');

      switch (choice.trim()) {
        case '1':
          await getApiKey();
          break;
        case '2':
          await getVaultInfo();
          break;
        case '3':
          showSessionInfo();
          break;
        case '4':
          await refreshSession();
          break;
        case '5':
          await getEvmAddress();
          break;
        case '6':
          await getSolanaAddress();
          break;
        case '7':
          await getBtcAddresses();
          break;
        case '8':
          await doLogout();
          break;
        case '9':
          return;
        default:
          console.log('Invalid option');
      }

      // Show menu again after action
      await showAuthMenu();
    }

    async function getApiKey() {
      console.log('\nFetching API key...');
      if (settings.debug) {
        console.log('[DEBUG] Calling authSdk.getVaultApiKey()...');
      }
      try {
        const apiKey = await authSdk.getVaultApiKey();
        if (settings.debug) {
          console.log('[DEBUG] Raw response:', JSON.stringify(apiKey, null, 2));
        }
        console.log('\n========================================');
        console.log('           YOUR API KEY');
        console.log('========================================');
        console.log('');
        console.log(`  ${apiKey}`);
        console.log('');
        console.log('========================================');
        console.log('');
        console.log('IMPORTANT: Store this key securely!');
        console.log('You can use this key with the regular CLI (simple-cli.js)');
        console.log('Set it as HUSTLE_API_KEY in your environment.');
      } catch (error) {
        console.error('Error fetching API key:', error.message);
        if (settings.debug && error.stack) {
          console.error('[DEBUG] Stack:', error.stack);
        }
      }
    }

    async function getVaultInfo() {
      console.log('\nFetching vault info...');
      if (settings.debug) {
        console.log('[DEBUG] Calling authSdk.getVaultInfo()...');
      }
      try {
        const vaultInfo = await authSdk.getVaultInfo();
        if (settings.debug) {
          console.log('[DEBUG] Raw response:');
          console.log(JSON.stringify(vaultInfo, null, 2));
        }
        console.log('\n========================================');
        console.log('           VAULT INFO');
        console.log('========================================');
        console.log('');
        console.log(`  Vault ID:        ${vaultInfo.vaultId || 'N/A'}`);
        console.log(`  Token ID:        ${vaultInfo.tokenId || vaultInfo.vaultId || 'N/A'}`);
        console.log(`  EVM Address:     ${vaultInfo.evmAddress || 'N/A'}`);
        console.log(`  Solana Address:  ${vaultInfo.solanaAddress || vaultInfo.address || 'N/A'}`);
        console.log(`  Hedera Account:  ${vaultInfo.hederaAccountId || 'N/A'}`);
        if (vaultInfo.btcPubkey) {
          console.log(`  BTC Pubkey:      ${vaultInfo.btcPubkey.substring(0, 20)}...`);
        }
        if (vaultInfo.btcAddresses) {
          console.log('  BTC Addresses:');
          if (vaultInfo.btcAddresses.p2pkh) {
            console.log(`    P2PKH:         ${vaultInfo.btcAddresses.p2pkh}`);
          }
          if (vaultInfo.btcAddresses.p2wpkh) {
            console.log(`    P2WPKH:        ${vaultInfo.btcAddresses.p2wpkh}`);
          }
          if (vaultInfo.btcAddresses.p2tr) {
            console.log(`    P2TR:          ${vaultInfo.btcAddresses.p2tr}`);
          }
        }
        if (vaultInfo.createdAt) {
          console.log(`  Created At:      ${vaultInfo.createdAt}`);
        }
        if (vaultInfo.created_by) {
          console.log(`  Created By:      ${vaultInfo.created_by}`);
        }
        console.log('');
        console.log('========================================');
      } catch (error) {
        console.error('Error fetching vault info:', error.message);
        if (settings.debug && error.stack) {
          console.error('[DEBUG] Stack:', error.stack);
        }
      }
    }

    function showSessionInfo() {
      if (settings.debug) {
        console.log('[DEBUG] Calling authSdk.getSession()...');
      }
      const session = authSdk.getSession();
      if (settings.debug) {
        console.log('[DEBUG] Raw response:');
        console.log(JSON.stringify(session, null, 2));
      }
      console.log('\n========================================');
      console.log('           SESSION INFO');
      console.log('========================================');
      console.log('');
      if (session) {
        console.log(`  Identifier:   ${session.user?.identifier || 'N/A'}`);
        console.log(`  Vault ID:     ${session.user?.vaultId || 'N/A'}`);
        console.log(`  App ID:       ${session.appId || 'N/A'}`);
        console.log(`  Auth Type:    ${session.authType || 'N/A'}`);
        console.log(`  Expires At:   ${session.expiresAt ? new Date(session.expiresAt).toISOString() : 'N/A'}`);
        console.log(`  Auth Token:   ${session.authToken ? session.authToken.substring(0, 20) + '...' : 'N/A'}`);
      } else {
        console.log('  No active session');
      }
      console.log('');
      console.log('========================================');
    }

    async function refreshSession() {
      console.log('\nRefreshing session...');
      if (settings.debug) {
        console.log('[DEBUG] Calling authSdk.refreshSession()...');
      }
      try {
        const newSession = await authSdk.refreshSession();
        if (settings.debug) {
          console.log('[DEBUG] Raw response:');
          console.log(JSON.stringify(newSession, null, 2));
        }
        if (newSession) {
          console.log('Session refreshed successfully!');
          console.log(`New expiry: ${new Date(newSession.expiresAt).toISOString()}`);
        } else {
          console.log('Failed to refresh session.');
        }
      } catch (error) {
        console.error('Error refreshing session:', error.message);
        if (settings.debug && error.stack) {
          console.error('[DEBUG] Stack:', error.stack);
        }
      }
    }

    async function getEvmAddress() {
      console.log('\nFetching EVM address...');
      if (settings.debug) {
        console.log('[DEBUG] Calling authSdk.getVaultInfo() for EVM address...');
      }
      try {
        const vaultInfo = await authSdk.getVaultInfo();
        if (settings.debug) {
          console.log('[DEBUG] Raw response:');
          console.log(JSON.stringify(vaultInfo, null, 2));
        }
        if (vaultInfo.evmAddress) {
          console.log('\n========================================');
          console.log('           EVM ADDRESS');
          console.log('========================================');
          console.log('');
          console.log(`  ${vaultInfo.evmAddress}`);
          console.log('');
          console.log('========================================');
        } else {
          console.log('No EVM address available for this vault.');
        }
      } catch (error) {
        console.error('Error fetching EVM address:', error.message);
        if (settings.debug && error.stack) {
          console.error('[DEBUG] Stack:', error.stack);
        }
      }
    }

    async function getSolanaAddress() {
      console.log('\nFetching Solana address...');
      if (settings.debug) {
        console.log('[DEBUG] Calling authSdk.getVaultInfo() for Solana address...');
      }
      try {
        const vaultInfo = await authSdk.getVaultInfo();
        if (settings.debug) {
          console.log('[DEBUG] Raw response:');
          console.log(JSON.stringify(vaultInfo, null, 2));
        }
        const solanaAddr = vaultInfo.solanaAddress || vaultInfo.address;
        if (solanaAddr) {
          console.log('\n========================================');
          console.log('         SOLANA ADDRESS');
          console.log('========================================');
          console.log('');
          console.log(`  ${solanaAddr}`);
          console.log('');
          console.log('========================================');
        } else {
          console.log('No Solana address available for this vault.');
        }
      } catch (error) {
        console.error('Error fetching Solana address:', error.message);
        if (settings.debug && error.stack) {
          console.error('[DEBUG] Stack:', error.stack);
        }
      }
    }

    async function doLogout() {
      console.log('\nLogging out...');
      if (settings.debug) {
        console.log('[DEBUG] Calling authSdk.logout()...');
      }
      try {
        authSdk.logout();
        console.log('Logged out successfully.');
        console.log('Session cleared. Exiting CLI...');
        rl.close();
        process.exit(0);
      } catch (error) {
        console.error('Error during logout:', error.message);
        if (settings.debug && error.stack) {
          console.error('[DEBUG] Stack:', error.stack);
        }
      }
    }

    async function showPaygStatus() {
      console.log('\nFetching PAYG billing status...');
      try {
        const status = await client.getPaygStatus();
        console.log('\n========================================');
        console.log('         PAYG Billing Status');
        console.log('========================================');
        console.log('');
        console.log(`  Enabled:         ${status.enabled ? 'YES' : 'NO'}`);
        console.log(`  Mode:            ${status.mode || 'N/A'}`);
        console.log(`  Payment Token:   ${status.payment_token || 'N/A'}`);
        console.log(`  Payment Chain:   ${status.payment_chain || 'N/A'}`);
        console.log(`  Blocked:         ${status.is_blocked ? 'YES' : 'NO'}`);
        console.log(`  Total Debt:      $${(status.total_debt_usd || 0).toFixed(4)}`);
        console.log(`  Total Paid:      $${(status.total_paid_usd || 0).toFixed(4)}`);
        console.log(`  Debt Ceiling:    $${(status.debt_ceiling_usd || 0).toFixed(2)}`);
        console.log(`  Pending Charges: ${status.pending_charges || 0}`);
        console.log('');
        if (status.available_tokens && status.available_tokens.length > 0) {
          console.log('  Available Tokens:');
          status.available_tokens.forEach(t => console.log(`    - ${t}`));
        }
        console.log('');
        console.log('========================================');
        console.log('');
        console.log('Commands:');
        console.log('  /payment enable          - Enable PAYG billing');
        console.log('  /payment disable         - Disable PAYG billing');
        console.log('  /payment token <TOKEN>   - Set payment token');
        console.log('  /payment mode <MODE>     - Set payment mode');
      } catch (error) {
        console.error('Error fetching PAYG status:', error.message);
      }
    }

    async function getBtcAddresses() {
      console.log('\nFetching BTC addresses...');
      if (settings.debug) {
        console.log('[DEBUG] Calling authSdk.getVaultInfo() for BTC addresses...');
      }
      try {
        const vaultInfo = await authSdk.getVaultInfo();
        if (settings.debug) {
          console.log('[DEBUG] Raw response:');
          console.log(JSON.stringify(vaultInfo, null, 2));
        }
        if (vaultInfo.btcAddresses || vaultInfo.btcPubkey) {
          console.log('\n========================================');
          console.log('         BTC ADDRESSES');
          console.log('========================================');
          console.log('');
          if (vaultInfo.btcPubkey) {
            console.log(`  Pubkey:  ${vaultInfo.btcPubkey}`);
            console.log('');
          }
          if (vaultInfo.btcAddresses) {
            if (vaultInfo.btcAddresses.p2pkh) {
              console.log(`  P2PKH (Legacy):     ${vaultInfo.btcAddresses.p2pkh}`);
            }
            if (vaultInfo.btcAddresses.p2wpkh) {
              console.log(`  P2WPKH (SegWit):    ${vaultInfo.btcAddresses.p2wpkh}`);
            }
            if (vaultInfo.btcAddresses.p2tr) {
              console.log(`  P2TR (Taproot):     ${vaultInfo.btcAddresses.p2tr}`);
            }
          }
          console.log('');
          console.log('========================================');
        } else {
          console.log('No BTC addresses available for this vault.');
        }
      } catch (error) {
        console.error('Error fetching BTC addresses:', error.message);
        if (settings.debug && error.stack) {
          console.error('[DEBUG] Stack:', error.stack);
        }
      }
    }

    // Process commands
    async function processCommand(command) {
      if (command === '/help') {
        showHelp();
        return true;
      }

      if (command === '/settings') {
        showSettings();
        return true;
      }

      if (command === '/auth') {
        await showAuthMenu();
        return true;
      }

      if (command === '/clear') {
        messages.length = 0;
        lastIntentContext = null;
        console.log('Conversation history cleared.');
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
          }
        } else {
          console.log(`Streaming is currently ${settings.stream ? 'ON' : 'OFF'}`);
        }
        return true;
      }

      if (command.startsWith('/debug')) {
        const parts = command.split(' ');
        if (parts.length === 2) {
          if (parts[1] === 'on') {
            settings.debug = true;
            console.log('Debug mode enabled');
          } else if (parts[1] === 'off') {
            settings.debug = false;
            console.log('Debug mode disabled');
          }
        } else {
          console.log(`Debug is currently ${settings.debug ? 'ON' : 'OFF'}`);
        }
        return true;
      }

      if (command.startsWith('/history')) {
        const parts = command.split(' ');
        if (parts.length === 2) {
          if (parts[1] === 'on') {
            settings.retainHistory = true;
            console.log('History retention enabled');
          } else if (parts[1] === 'off') {
            settings.retainHistory = false;
            console.log('History retention disabled');
          }
        } else {
          console.log(`History is currently ${settings.retainHistory ? 'ON' : 'OFF'}`);
        }
        return true;
      }

      if (command === '/models') {
        try {
          console.log('\nFetching available models...');
          const models = await client.getModels();
          console.log('\n=== Available Models ===\n');
          models.forEach((model) => {
            const isSelected = settings.model === model.id;
            const status = isSelected ? '>' : ' ';
            console.log(`${status} ${model.name}`);
            console.log(`    ID: ${model.id}`);
          });
          console.log('\nCurrent model:', settings.model || 'API default');
        } catch (error) {
          console.error('Error fetching models:', error.message);
        }
        return true;
      }

      if (command.startsWith('/model')) {
        const parts = command.split(' ');
        if (parts.length === 1) {
          console.log(`Current model: ${settings.model || 'API default'}`);
          return true;
        }
        const modelArg = parts.slice(1).join(' ');
        if (modelArg === 'clear') {
          settings.model = null;
          console.log('Model selection cleared.');
        } else {
          settings.model = modelArg;
          console.log(`Model set to: ${settings.model}`);
        }
        return true;
      }

      if (command.startsWith('/tools')) {
        const parts = command.split(' ');

        if (parts.length === 1) {
          try {
            console.log('\nFetching available tools...');
            const tools = await client.getTools();
            console.log('\n=== Tool Categories ===\n');
            tools.forEach((tool) => {
              const isSelected = settings.selectedTools.includes(tool.id);
              const status = isSelected ? '✅' : '⬜';
              console.log(`${status} ${tool.title} (${tool.id})`);
              console.log(`   ${tool.description}`);
            });
            console.log('\nCurrently selected:',
              settings.selectedTools.length > 0
                ? settings.selectedTools.join(', ')
                : 'Auto-tools mode');
          } catch (error) {
            console.error('Error fetching tools:', error.message);
          }
          return true;
        }

        const subCommand = parts[1];
        const toolId = parts[2];

        if (subCommand === 'clear') {
          settings.selectedTools = [];
          console.log('Auto-tools mode enabled.');
          return true;
        }

        if (subCommand === 'add' && toolId) {
          if (!settings.selectedTools.includes(toolId)) {
            settings.selectedTools.push(toolId);
            lastIntentContext = null;
            console.log(`Added: ${toolId}`);
          }
          return true;
        }

        if (subCommand === 'remove' && toolId) {
          const index = settings.selectedTools.indexOf(toolId);
          if (index > -1) {
            settings.selectedTools.splice(index, 1);
            console.log(`Removed: ${toolId}`);
          }
          return true;
        }

        return true;
      }

      if (command.startsWith('/payment')) {
        const parts = command.split(' ');

        if (parts.length === 1) {
          await showPaygStatus();
          return true;
        }

        const subCommand = parts[1];

        if (subCommand === 'enable') {
          try {
            const result = await client.configurePayg({ enabled: true });
            console.log(result.success ? 'PAYG billing enabled.' : 'Failed to enable PAYG.');
          } catch (error) {
            console.error('Error enabling PAYG:', error.message);
          }
          return true;
        }

        if (subCommand === 'disable') {
          try {
            const result = await client.configurePayg({ enabled: false });
            console.log(result.success ? 'PAYG billing disabled.' : 'Failed to disable PAYG.');
          } catch (error) {
            console.error('Error disabling PAYG:', error.message);
          }
          return true;
        }

        if (subCommand === 'token' && parts[2]) {
          const token = parts[2].toUpperCase();
          try {
            const result = await client.configurePayg({ payment_token: token });
            console.log(result.success ? `Payment token set to: ${token}` : 'Failed to set payment token.');
          } catch (error) {
            console.error('Error setting payment token:', error.message);
          }
          return true;
        }

        if (subCommand === 'mode' && parts[2]) {
          const mode = parts[2];
          if (mode !== 'pay_per_request' && mode !== 'debt_accumulation') {
            console.log('Invalid mode. Use: pay_per_request or debt_accumulation');
            return true;
          }
          try {
            const result = await client.configurePayg({ mode });
            console.log(result.success ? `Payment mode set to: ${mode}` : 'Failed to set payment mode.');
          } catch (error) {
            console.error('Error setting payment mode:', error.message);
          }
          return true;
        }

        console.log('Invalid /payment command. Use /payment for status, or /payment enable|disable|token|mode');
        return true;
      }

      return false;
    }

    // Main chat loop
    async function chat() {
      rl.question('\nYou: ', async (input) => {
        if (input.startsWith('/')) {
          const isCommand = await processCommand(input);
          if (isCommand) {
            chat();
            return;
          }
        }

        if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
          console.log('Goodbye!');
          rl.close();
          return;
        }

        const currentMessages = settings.retainHistory ? [...messages] : [];
        currentMessages.push({ role: 'user', content: input });

        if (!settings.stream) {
          console.log('\nAgent is thinking...');
        }

        try {
          let assistantResponse = '';

          if (settings.stream) {
            assistantResponse = await streamResponse([...currentMessages]);
          } else {
            const chatOptions = {};

            if (settings.model) {
              chatOptions.model = settings.model;
            }

            if (settings.selectedTools.length > 0) {
              chatOptions.selectedToolCategories = settings.selectedTools;
            } else if (lastIntentContext) {
              chatOptions.intentContext = lastIntentContext;
            }

            const response = await client.chat(currentMessages, chatOptions);

            if (response.intentContext?.intentContext) {
              lastIntentContext = response.intentContext.intentContext;
            }

            console.log(`\nAgent: ${response.content}`);

            if (response.toolCalls && response.toolCalls.length > 0) {
              console.log('\nTools used:');
              response.toolCalls.forEach((tool, i) => {
                console.log(`${i+1}. ${tool.toolName || 'Unknown'}`);
              });
            }

            assistantResponse = response.content;
          }

          if (settings.retainHistory && assistantResponse) {
            messages.push({ role: 'user', content: input });
            messages.push({ role: 'assistant', content: assistantResponse });
          }

          chat();
        } catch (error) {
          console.error('Error:', error.message);
          chat();
        }
      });
    }

    // Start
    console.log('Type "/help" for commands, "/auth" for auth menu, or "/exit" to quit.\n');
    showSettings();
    chat();

  } catch (error) {
    console.error('Error initializing CLI:', error);
    process.exit(1);
  }
}

main();
