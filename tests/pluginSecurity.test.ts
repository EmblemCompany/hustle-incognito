import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  signCodeHmac,
  verifySignatureHmac,
  verifyPluginCode,
  serializePluginCode,
  isTrustedBuiltin,
  TRUSTED_BUILTINS,
  configurePluginSecurity,
  getSecurityConfig,
  resetSecurityConfig,
  signPluginCode,
  type SecurityConfig,
  type VerificationResult,
} from '../src/security/pluginSecurity';
import { PluginManager } from '../src/plugins';
import type { HustlePlugin } from '../src/types';

// ============================================================================
// Plugin Security Module Tests
// ============================================================================

describe('Plugin Security Module', () => {
  beforeEach(() => {
    resetSecurityConfig();
  });

  afterEach(() => {
    resetSecurityConfig();
  });

  // ==========================================================================
  // HMAC Signing Tests
  // ==========================================================================
  describe('HMAC-SHA256 Signing', () => {
    test('signCodeHmac should produce consistent signatures', async () => {
      const code = 'function test() { return "hello"; }';
      const sig1 = await signCodeHmac(code);
      const sig2 = await signCodeHmac(code);

      expect(sig1).toBe(sig2);
      expect(sig1).toMatch(/^[a-f0-9]{64}$/); // SHA256 produces 64 hex chars
    });

    test('signCodeHmac should produce different signatures for different code', async () => {
      const code1 = 'function a() { return 1; }';
      const code2 = 'function b() { return 2; }';

      const sig1 = await signCodeHmac(code1);
      const sig2 = await signCodeHmac(code2);

      expect(sig1).not.toBe(sig2);
    });

    test('verifySignatureHmac should verify valid signatures', async () => {
      const code = 'const x = 42;';
      const signature = await signCodeHmac(code);

      const isValid = await verifySignatureHmac(code, signature);
      expect(isValid).toBe(true);
    });

    test('verifySignatureHmac should reject invalid signatures', async () => {
      const code = 'const x = 42;';
      const invalidSignature = 'a'.repeat(64); // Invalid but valid-length hex

      const isValid = await verifySignatureHmac(code, invalidSignature);
      expect(isValid).toBe(false);
    });

    test('verifySignatureHmac should reject tampered code', async () => {
      const originalCode = 'function safe() { return true; }';
      const tamperedCode = 'function safe() { return false; }'; // Changed
      const signature = await signCodeHmac(originalCode);

      const isValid = await verifySignatureHmac(tamperedCode, signature);
      expect(isValid).toBe(false);
    });

    test('verifySignatureHmac should handle malformed signatures gracefully', async () => {
      const code = 'const x = 1;';

      // Empty signature
      expect(await verifySignatureHmac(code, '')).toBe(false);

      // Invalid hex
      expect(await verifySignatureHmac(code, 'not-hex-at-all!')).toBe(false);

      // Too short
      expect(await verifySignatureHmac(code, 'abc123')).toBe(false);
    });
  });

  // ==========================================================================
  // Plugin Code Serialization Tests
  // ==========================================================================
  describe('Plugin Code Serialization', () => {
    test('serializePluginCode should produce deterministic output', () => {
      const plugin = {
        name: 'test-plugin',
        version: '1.0.0',
        tools: [{ name: 'tool1', description: 'A tool' }],
        executors: {
          tool1: async () => 'result',
        },
      };

      const code1 = serializePluginCode(plugin);
      const code2 = serializePluginCode(plugin);

      expect(code1).toBe(code2);
    });

    test('serializePluginCode should include plugin metadata', () => {
      const plugin = {
        name: 'metadata-test',
        version: '2.0.0',
        tools: [{ name: 'my_tool', description: 'Does something' }],
      };

      const code = serializePluginCode(plugin);
      const parsed = JSON.parse(code);

      expect(parsed.name).toBe('metadata-test');
      expect(parsed.version).toBe('2.0.0');
      expect(parsed.tools).toHaveLength(1);
      expect(parsed.tools[0].name).toBe('my_tool');
    });

    test('serializePluginCode should serialize executor functions', () => {
      const plugin = {
        name: 'executor-test',
        version: '1.0.0',
        executors: {
          my_func: async (args: Record<string, unknown>) => args.value,
        },
      };

      const code = serializePluginCode(plugin);
      const parsed = JSON.parse(code);

      expect(parsed.executors).toBeDefined();
      expect(typeof parsed.executors.my_func).toBe('string');
      expect(parsed.executors.my_func).toContain('args.value');
    });

    test('serializePluginCode should sort executor keys for determinism', () => {
      const plugin1 = {
        name: 'test',
        version: '1.0.0',
        executors: {
          z_func: async () => 'z',
          a_func: async () => 'a',
          m_func: async () => 'm',
        },
      };

      // Different order of executors
      const plugin2 = {
        name: 'test',
        version: '1.0.0',
        executors: {
          a_func: async () => 'a',
          z_func: async () => 'z',
          m_func: async () => 'm',
        },
      };

      const code1 = serializePluginCode(plugin1);
      const code2 = serializePluginCode(plugin2);

      // Should produce same output regardless of object key order
      expect(code1).toBe(code2);
    });
  });

  // ==========================================================================
  // Trusted Builtins Tests
  // ==========================================================================
  describe('Trusted Builtins', () => {
    test('TRUSTED_BUILTINS should contain expected plugins', () => {
      const expectedBuiltins = [
        'predictionMarket',
        'migrateFun',
        'piiProtection',
        'userQuestion',
        'alert',
        'jsExecutor',
        'screenshot',
        'pluginBuilder',
      ];

      for (const name of expectedBuiltins) {
        expect(TRUSTED_BUILTINS.has(name)).toBe(true);
      }
    });

    test('isTrustedBuiltin should return true for builtin plugins', () => {
      expect(isTrustedBuiltin('predictionMarket')).toBe(true);
      expect(isTrustedBuiltin('alert')).toBe(true);
      expect(isTrustedBuiltin('pluginBuilder')).toBe(true);
    });

    test('isTrustedBuiltin should return false for unknown plugins', () => {
      expect(isTrustedBuiltin('malicious-plugin')).toBe(false);
      expect(isTrustedBuiltin('random-name')).toBe(false);
      expect(isTrustedBuiltin('')).toBe(false);
    });

    test('isTrustedBuiltin should respect custom trustedBuiltins config', () => {
      const customConfig: SecurityConfig = {
        trustedBuiltins: ['custom-trusted', 'another-trusted'],
      };

      // Custom builtins should be trusted
      expect(isTrustedBuiltin('custom-trusted', customConfig)).toBe(true);
      expect(isTrustedBuiltin('another-trusted', customConfig)).toBe(true);

      // Default builtins should NOT be trusted with custom list
      expect(isTrustedBuiltin('predictionMarket', customConfig)).toBe(false);
    });
  });

  // ==========================================================================
  // Security Configuration Tests
  // ==========================================================================
  describe('Security Configuration', () => {
    test('getSecurityConfig should return default config', () => {
      const config = getSecurityConfig();

      expect(config.skipVerification).toBe(false);
      expect(config.allowTrustedBuiltins).toBe(true);
      expect(config.algorithm).toBe('hmac');
    });

    test('configurePluginSecurity should update config', () => {
      configurePluginSecurity({ skipVerification: true });

      const config = getSecurityConfig();
      expect(config.skipVerification).toBe(true);
    });

    test('configurePluginSecurity should merge with existing config', () => {
      configurePluginSecurity({ skipVerification: true });
      configurePluginSecurity({ allowTrustedBuiltins: false });

      const config = getSecurityConfig();
      expect(config.skipVerification).toBe(true);
      expect(config.allowTrustedBuiltins).toBe(false);
    });

    test('resetSecurityConfig should restore defaults', () => {
      configurePluginSecurity({
        skipVerification: true,
        allowTrustedBuiltins: false,
        algorithm: 'ed25519',
      });

      resetSecurityConfig();

      const config = getSecurityConfig();
      expect(config.skipVerification).toBe(false);
      expect(config.allowTrustedBuiltins).toBe(true);
      expect(config.algorithm).toBe('hmac');
    });
  });

  // ==========================================================================
  // Main Verification Function Tests
  // ==========================================================================
  describe('verifyPluginCode', () => {
    test('should pass with skipVerification=true', async () => {
      const config: SecurityConfig = { skipVerification: true };

      const result = await verifyPluginCode(
        'any-plugin',
        'any code',
        undefined,
        config
      );

      expect(result.verified).toBe(true);
      expect(result.reason).toBe('skip_verification');
    });

    test('should pass for trusted builtins', async () => {
      const config: SecurityConfig = { allowTrustedBuiltins: true };

      const result = await verifyPluginCode(
        'predictionMarket', // Trusted builtin
        'any code',
        undefined, // No signature needed
        config
      );

      expect(result.verified).toBe(true);
      expect(result.reason).toBe('trusted_builtin');
    });

    test('should fail for untrusted plugin without signature', async () => {
      const config: SecurityConfig = {
        skipVerification: false,
        allowTrustedBuiltins: false,
      };

      const result = await verifyPluginCode(
        'untrusted-plugin',
        'some code',
        undefined,
        config
      );

      expect(result.verified).toBe(false);
      expect(result.reason).toBe('no_signature');
      expect(result.error).toContain('no signature');
    });

    test('should pass with valid HMAC signature', async () => {
      const config: SecurityConfig = {
        skipVerification: false,
        allowTrustedBuiltins: false,
        algorithm: 'hmac',
      };

      const plugin = {
        name: 'signed-plugin',
        version: '1.0.0',
        tools: [{ name: 'test', description: 'test' }],
      };

      const code = serializePluginCode(plugin);
      const signature = await signCodeHmac(code);

      const result = await verifyPluginCode(
        plugin.name,
        code,
        signature,
        config
      );

      expect(result.verified).toBe(true);
      expect(result.reason).toBe('signature_valid');
    });

    test('should fail with invalid signature', async () => {
      const config: SecurityConfig = {
        skipVerification: false,
        allowTrustedBuiltins: false,
        algorithm: 'hmac',
      };

      const result = await verifyPluginCode(
        'some-plugin',
        'some code',
        'invalid-signature',
        config
      );

      expect(result.verified).toBe(false);
      expect(result.reason).toBe('signature_invalid');
    });

    test('should fail with tampered code', async () => {
      const config: SecurityConfig = {
        skipVerification: false,
        allowTrustedBuiltins: false,
        algorithm: 'hmac',
      };

      const originalCode = 'original code';
      const tamperedCode = 'tampered code';
      const signature = await signCodeHmac(originalCode);

      const result = await verifyPluginCode(
        'tampered-plugin',
        tamperedCode,
        signature,
        config
      );

      expect(result.verified).toBe(false);
      expect(result.reason).toBe('signature_invalid');
    });

    test('should use custom verifier when provided', async () => {
      const customVerifier = vi.fn().mockResolvedValue(true);

      const config: SecurityConfig = {
        skipVerification: false,
        allowTrustedBuiltins: false,
        customVerifier,
      };

      const result = await verifyPluginCode(
        'custom-verified-plugin',
        'some code',
        'some-signature',
        config
      );

      expect(customVerifier).toHaveBeenCalledWith(
        'custom-verified-plugin',
        'some code',
        'some-signature'
      );
      expect(result.verified).toBe(true);
      expect(result.reason).toBe('custom_verifier');
    });

    test('should handle custom verifier rejection', async () => {
      const customVerifier = vi.fn().mockResolvedValue(false);

      const config: SecurityConfig = {
        skipVerification: false,
        allowTrustedBuiltins: false,
        customVerifier,
      };

      const result = await verifyPluginCode(
        'rejected-plugin',
        'some code',
        'some-signature',
        config
      );

      expect(result.verified).toBe(false);
      expect(result.reason).toBe('signature_invalid');
    });

    test('should handle custom verifier errors', async () => {
      const customVerifier = vi.fn().mockRejectedValue(new Error('Verifier crashed'));

      const config: SecurityConfig = {
        skipVerification: false,
        allowTrustedBuiltins: false,
        customVerifier,
      };

      const result = await verifyPluginCode(
        'error-plugin',
        'some code',
        'some-signature',
        config
      );

      expect(result.verified).toBe(false);
      expect(result.reason).toBe('verification_error');
      expect(result.error).toContain('Verifier crashed');
    });
  });

  // ==========================================================================
  // Sign Plugin Code Convenience Function Tests
  // ==========================================================================
  describe('signPluginCode', () => {
    test('should sign plugin and produce verifiable signature', async () => {
      const plugin = {
        name: 'signable-plugin',
        version: '1.0.0',
        tools: [{ name: 'tool', description: 'A tool' }],
        executors: {
          tool: async () => 'result',
        },
      };

      const signature = await signPluginCode(plugin);
      const code = serializePluginCode(plugin);

      const isValid = await verifySignatureHmac(code, signature);
      expect(isValid).toBe(true);
    });

    test('should default to HMAC algorithm', async () => {
      const plugin = {
        name: 'hmac-default',
        version: '1.0.0',
      };

      const signature = await signPluginCode(plugin);
      expect(signature).toMatch(/^[a-f0-9]{64}$/); // SHA256 produces 64 hex chars
    });
  });
});

// ============================================================================
// PluginManager Security Integration Tests
// ============================================================================

describe('PluginManager Security Integration', () => {
  describe('with security disabled (skipVerification=true)', () => {
    let manager: PluginManager;

    beforeEach(() => {
      manager = new PluginManager({
        security: { skipVerification: true },
      });
    });

    test('should register unsigned plugin', async () => {
      const plugin: HustlePlugin = {
        name: 'unsigned-plugin',
        version: '1.0.0',
        tools: [{
          name: 'test_tool',
          description: 'A test tool',
          parameters: { type: 'object', properties: {} },
        }],
        executors: {
          test_tool: async () => 'result',
        },
      };

      await manager.register(plugin);
      expect(manager.hasPlugin('unsigned-plugin')).toBe(true);
    });
  });

  describe('with security enabled (skipVerification=false)', () => {
    let manager: PluginManager;

    beforeEach(() => {
      manager = new PluginManager({
        security: {
          skipVerification: false,
          allowTrustedBuiltins: true,
        },
      });
    });

    test('should register trusted builtin without signature', async () => {
      const plugin: HustlePlugin = {
        name: 'predictionMarket', // Trusted builtin
        version: '1.0.0',
        tools: [{
          name: 'predict',
          description: 'Make a prediction',
          parameters: { type: 'object', properties: {} },
        }],
        executors: {
          predict: async () => ({ probability: 0.5 }),
        },
      };

      await manager.register(plugin);
      expect(manager.hasPlugin('predictionMarket')).toBe(true);
    });

    test('should reject untrusted plugin without signature', async () => {
      const plugin: HustlePlugin = {
        name: 'untrusted-plugin',
        version: '1.0.0',
        tools: [{
          name: 'malicious_tool',
          description: 'Does bad things',
          parameters: { type: 'object', properties: {} },
        }],
        executors: {
          malicious_tool: async () => 'evil',
        },
      };

      await expect(manager.register(plugin)).rejects.toThrow(
        'failed security verification'
      );
      expect(manager.hasPlugin('untrusted-plugin')).toBe(false);
    });

    test('should register signed plugin', async () => {
      const plugin: HustlePlugin = {
        name: 'signed-plugin',
        version: '1.0.0',
        tools: [{
          name: 'signed_tool',
          description: 'A signed tool',
          parameters: { type: 'object', properties: {} },
        }],
        executors: {
          signed_tool: async () => 'signed result',
        },
      };

      // Sign the plugin
      const signature = await signPluginCode(plugin);
      plugin.signature = signature;

      await manager.register(plugin);
      expect(manager.hasPlugin('signed-plugin')).toBe(true);
    });

    test('should reject plugin with invalid signature', async () => {
      const plugin: HustlePlugin = {
        name: 'bad-sig-plugin',
        version: '1.0.0',
        signature: 'obviously-invalid-signature',
        tools: [{
          name: 'tool',
          description: 'A tool',
          parameters: { type: 'object', properties: {} },
        }],
        executors: {
          tool: async () => 'result',
        },
      };

      await expect(manager.register(plugin)).rejects.toThrow(
        'failed security verification'
      );
    });

    test('should reject plugin with tampered code', async () => {
      // Create and sign original plugin
      const originalPlugin: HustlePlugin = {
        name: 'tampered-plugin',
        version: '1.0.0',
        tools: [{
          name: 'safe_tool',
          description: 'A safe tool',
          parameters: { type: 'object', properties: {} },
        }],
        executors: {
          safe_tool: async () => 'safe',
        },
      };

      const signature = await signPluginCode(originalPlugin);

      // Create tampered version with same signature
      const tamperedPlugin: HustlePlugin = {
        name: 'tampered-plugin',
        version: '1.0.0',
        signature, // Original signature
        tools: [{
          name: 'safe_tool',
          description: 'A TAMPERED tool', // Changed!
          parameters: { type: 'object', properties: {} },
        }],
        executors: {
          safe_tool: async () => 'MALICIOUS', // Changed!
        },
      };

      await expect(manager.register(tamperedPlugin)).rejects.toThrow(
        'failed security verification'
      );
    });
  });

  describe('security events', () => {
    test('should emit verification success event', async () => {
      const manager = new PluginManager({
        security: { skipVerification: false, allowTrustedBuiltins: true },
      });

      const events: Array<{ type: string; pluginName: string }> = [];
      manager.onSecurityEvent((event) => {
        events.push({ type: event.type, pluginName: event.pluginName });
      });

      const plugin: HustlePlugin = {
        name: 'alert', // Trusted builtin
        version: '1.0.0',
      };

      await manager.register(plugin);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('plugin_verification_success');
      expect(events[0].pluginName).toBe('alert');
    });

    test('should emit verification failed event', async () => {
      const manager = new PluginManager({
        security: { skipVerification: false, allowTrustedBuiltins: false },
      });

      const events: Array<{ type: string; pluginName: string }> = [];
      manager.onSecurityEvent((event) => {
        events.push({ type: event.type, pluginName: event.pluginName });
      });

      const plugin: HustlePlugin = {
        name: 'unsigned-plugin',
        version: '1.0.0',
      };

      await expect(manager.register(plugin)).rejects.toThrow();

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('plugin_verification_failed');
      expect(events[0].pluginName).toBe('unsigned-plugin');
    });

    test('should emit verification skipped event', async () => {
      const manager = new PluginManager({
        security: { skipVerification: true },
      });

      const events: Array<{ type: string; pluginName: string }> = [];
      manager.onSecurityEvent((event) => {
        events.push({ type: event.type, pluginName: event.pluginName });
      });

      const plugin: HustlePlugin = {
        name: 'skipped-plugin',
        version: '1.0.0',
      };

      await manager.register(plugin);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('plugin_verification_skipped');
    });

    test('should allow unsubscribing from events', async () => {
      const manager = new PluginManager({
        security: { skipVerification: true },
      });

      const events: string[] = [];
      const unsubscribe = manager.onSecurityEvent((event) => {
        events.push(event.type);
      });

      // Register first plugin
      await manager.register({ name: 'plugin1', version: '1.0.0' });
      expect(events).toHaveLength(1);

      // Unsubscribe
      unsubscribe();

      // Register second plugin - should not receive event
      await manager.register({ name: 'plugin2', version: '1.0.0' });
      expect(events).toHaveLength(1); // Still 1
    });
  });

  describe('setSecurityConfig', () => {
    test('should update security config after construction', async () => {
      const manager = new PluginManager({
        security: { skipVerification: false, allowTrustedBuiltins: false },
      });

      // Should fail initially
      const plugin: HustlePlugin = {
        name: 'dynamic-config-plugin',
        version: '1.0.0',
      };

      await expect(manager.register(plugin)).rejects.toThrow();

      // Update config
      manager.setSecurityConfig({ skipVerification: true });

      // Should succeed now
      await manager.register({ name: 'dynamic-config-plugin-2', version: '1.0.0' });
      expect(manager.hasPlugin('dynamic-config-plugin-2')).toBe(true);
    });
  });

  describe('custom verifier integration', () => {
    test('should use custom verifier from config', async () => {
      const customVerifier = vi.fn().mockResolvedValue(true);

      const manager = new PluginManager({
        security: {
          skipVerification: false,
          allowTrustedBuiltins: false,
          customVerifier,
        },
      });

      const plugin: HustlePlugin = {
        name: 'custom-verified',
        version: '1.0.0',
        signature: 'custom-signature-format',
        tools: [{
          name: 'tool',
          description: 'Tool',
          parameters: { type: 'object', properties: {} },
        }],
        executors: {
          tool: async () => 'result',
        },
      };

      await manager.register(plugin);

      expect(customVerifier).toHaveBeenCalled();
      expect(manager.hasPlugin('custom-verified')).toBe(true);
    });
  });
});
