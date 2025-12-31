/**
 * Plugin Security Module
 *
 * Provides signature verification for plugin code execution.
 * Supports both HMAC-SHA256 (for backwards compatibility) and
 * Ed25519 asymmetric signing (recommended for production).
 *
 * Security is enforced at the SDK level in PluginManager.register()
 * to ensure all tool executions are verified before registration.
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Security configuration for plugin verification
 */
export interface SecurityConfig {
  /**
   * Skip all verification checks. Use only in development.
   * @default false
   */
  skipVerification?: boolean;

  /**
   * Allow trusted builtin plugins to bypass verification.
   * @default true
   */
  allowTrustedBuiltins?: boolean;

  /**
   * Custom list of trusted builtin plugin names.
   * If not provided, uses the default TRUSTED_BUILTINS set.
   */
  trustedBuiltins?: string[];

  /**
   * Custom verifier function for advanced use cases.
   * If provided, this is called instead of the default signature verification.
   */
  customVerifier?: (
    pluginName: string,
    code: string,
    signature: string
  ) => Promise<boolean>;

  /**
   * Signing algorithm to use.
   * - 'hmac': HMAC-SHA256 (symmetric, simpler but less secure)
   * - 'ed25519': Ed25519 (asymmetric, production-grade)
   * @default 'hmac'
   */
  algorithm?: 'hmac' | 'ed25519';

  /**
   * Public key for Ed25519 verification (hex-encoded).
   * Required when algorithm is 'ed25519'.
   */
  publicKey?: string;

  /**
   * Emit events for security operations.
   * @default true
   */
  emitEvents?: boolean;
}

/**
 * Result of plugin verification
 */
export interface VerificationResult {
  verified: boolean;
  reason:
    | 'skip_verification'
    | 'trusted_builtin'
    | 'signature_valid'
    | 'signature_invalid'
    | 'no_signature'
    | 'custom_verifier'
    | 'verification_error';
  pluginName: string;
  error?: string;
}

/**
 * Plugin with security metadata
 */
export interface SecurePlugin {
  name: string;
  version: string;
  /** Cryptographic signature of the serialized plugin code */
  signature?: string;
  /** Identity of the signer (e.g., publisher name or public key fingerprint) */
  signedBy?: string;
  /** Timestamp when the plugin was signed */
  signedAt?: string;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Default trusted builtin plugins that bypass verification.
 * These are core plugins shipped with the SDK.
 */
export const TRUSTED_BUILTINS = new Set([
  'predictionMarket',
  'migrateFun',
  'piiProtection',
  'userQuestion',
  'alert',
  'jsExecutor',
  'screenshot',
  'pluginBuilder',
]);

/**
 * Default HMAC signing key for development.
 * WARNING: This is public and should only be used for development.
 * Production should use Ed25519 with proper key management.
 */
const DEV_HMAC_KEY = 'hustle-plugin-signing-key-v1';

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Convert ArrayBuffer to hex string
 */
function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert hex string to Uint8Array
 */
function hexToBuffer(hex: string): Uint8Array {
  const matches = hex.match(/.{1,2}/g);
  if (!matches) {
    return new Uint8Array(0);
  }
  return new Uint8Array(matches.map((byte) => parseInt(byte, 16)));
}

/**
 * Get the Web Crypto API (works in both browser and Node.js)
 */
function getCrypto(): Crypto {
  if (typeof globalThis.crypto !== 'undefined') {
    return globalThis.crypto;
  }
  // Node.js fallback
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const nodeCrypto = require('crypto');
  return nodeCrypto.webcrypto as Crypto;
}

// ============================================================================
// HMAC-SHA256 Implementation (Symmetric)
// ============================================================================

/**
 * Get HMAC signing key for development use
 */
async function getHmacKey(): Promise<CryptoKey> {
  const crypto = getCrypto();
  const encoder = new TextEncoder();
  const keyMaterial = encoder.encode(DEV_HMAC_KEY);
  return crypto.subtle.importKey(
    'raw',
    keyMaterial,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

/**
 * Sign code using HMAC-SHA256
 * @param code - The code string to sign
 * @returns Hex-encoded signature
 */
export async function signCodeHmac(code: string): Promise<string> {
  const crypto = getCrypto();
  const key = await getHmacKey();
  const encoder = new TextEncoder();
  const data = encoder.encode(code);
  const signature = await crypto.subtle.sign('HMAC', key, data);
  return bufferToHex(signature);
}

/**
 * Verify HMAC-SHA256 signature
 * @param code - The code string that was signed
 * @param signature - Hex-encoded signature to verify
 * @returns True if signature is valid
 */
export async function verifySignatureHmac(
  code: string,
  signature: string
): Promise<boolean> {
  try {
    const crypto = getCrypto();
    const key = await getHmacKey();
    const encoder = new TextEncoder();
    const data = encoder.encode(code);
    const signatureBytes = hexToBuffer(signature);
    // Cast to satisfy TypeScript's strict BufferSource type
    return crypto.subtle.verify(
      'HMAC',
      key,
      signatureBytes.buffer as ArrayBuffer,
      data
    );
  } catch {
    return false;
  }
}

// ============================================================================
// Ed25519 Implementation (Asymmetric - Production Grade)
// ============================================================================

/**
 * Generate Ed25519 keypair for signing
 * @returns Object with hex-encoded publicKey and privateKey
 */
export async function generateEd25519Keypair(): Promise<{
  publicKey: string;
  privateKey: string;
}> {
  const crypto = getCrypto();
  // Ed25519 is supported in modern runtimes but not in TS lib types yet
  const keyPair = await (crypto.subtle.generateKey as Function)(
    'Ed25519',
    true,
    ['sign', 'verify']
  ) as CryptoKeyPair;

  const publicKeyBuffer = await crypto.subtle.exportKey(
    'raw',
    keyPair.publicKey
  );
  const privateKeyBuffer = await crypto.subtle.exportKey(
    'pkcs8',
    keyPair.privateKey
  );

  return {
    publicKey: bufferToHex(publicKeyBuffer),
    privateKey: bufferToHex(privateKeyBuffer),
  };
}

/**
 * Sign code using Ed25519
 * @param code - The code string to sign
 * @param privateKeyHex - Hex-encoded private key (PKCS8 format)
 * @returns Hex-encoded signature
 */
export async function signCodeEd25519(
  code: string,
  privateKeyHex: string
): Promise<string> {
  const crypto = getCrypto();
  const privateKeyBuffer = hexToBuffer(privateKeyHex);

  // Ed25519 is supported in modern runtimes but not in TS lib types yet
  const privateKey = await (crypto.subtle.importKey as Function)(
    'pkcs8',
    privateKeyBuffer,
    'Ed25519',
    false,
    ['sign']
  ) as CryptoKey;

  const encoder = new TextEncoder();
  const data = encoder.encode(code);
  const signature = await (crypto.subtle.sign as Function)(
    'Ed25519',
    privateKey,
    data
  ) as ArrayBuffer;

  return bufferToHex(signature);
}

/**
 * Verify Ed25519 signature
 * @param code - The code string that was signed
 * @param signature - Hex-encoded signature to verify
 * @param publicKeyHex - Hex-encoded public key (raw format)
 * @returns True if signature is valid
 */
export async function verifySignatureEd25519(
  code: string,
  signature: string,
  publicKeyHex: string
): Promise<boolean> {
  try {
    const crypto = getCrypto();
    const publicKeyBuffer = hexToBuffer(publicKeyHex);

    // Ed25519 is supported in modern runtimes but not in TS lib types yet
    const publicKey = await (crypto.subtle.importKey as Function)(
      'raw',
      publicKeyBuffer,
      'Ed25519',
      false,
      ['verify']
    ) as CryptoKey;

    const encoder = new TextEncoder();
    const data = encoder.encode(code);
    const signatureBytes = hexToBuffer(signature);

    return (crypto.subtle.verify as Function)(
      'Ed25519',
      publicKey,
      signatureBytes,
      data
    ) as Promise<boolean>;
  } catch {
    return false;
  }
}

// ============================================================================
// Main Verification API
// ============================================================================

/**
 * Global security configuration
 */
let globalConfig: SecurityConfig = {
  skipVerification: false,
  allowTrustedBuiltins: true,
  algorithm: 'hmac',
  emitEvents: true,
};

/**
 * Configure global plugin security settings
 */
export function configurePluginSecurity(
  newConfig: Partial<SecurityConfig>
): void {
  globalConfig = { ...globalConfig, ...newConfig };
}

/**
 * Get current security configuration
 */
export function getSecurityConfig(): SecurityConfig {
  return { ...globalConfig };
}

/**
 * Reset security configuration to defaults
 */
export function resetSecurityConfig(): void {
  globalConfig = {
    skipVerification: false,
    allowTrustedBuiltins: true,
    algorithm: 'hmac',
    emitEvents: true,
  };
}

/**
 * Check if a plugin name is in the trusted builtins list
 */
export function isTrustedBuiltin(
  pluginName: string,
  config?: SecurityConfig
): boolean {
  const effectiveConfig = config || globalConfig;
  const trustedSet = effectiveConfig.trustedBuiltins
    ? new Set(effectiveConfig.trustedBuiltins)
    : TRUSTED_BUILTINS;
  return trustedSet.has(pluginName);
}

/**
 * Serialize plugin code for signing/verification.
 * This creates a deterministic string representation of the plugin's
 * executable code (tools and executors).
 */
export function serializePluginCode(plugin: {
  name: string;
  version: string;
  tools?: Array<{ name: string; description: string }>;
  executors?: Record<string, unknown>;
}): string {
  // Create a deterministic representation
  const codeObj = {
    name: plugin.name,
    version: plugin.version,
    tools: plugin.tools?.map((t) => ({
      name: t.name,
      description: t.description,
    })),
    executors: plugin.executors
      ? Object.keys(plugin.executors)
          .sort()
          .reduce(
            (acc, key) => {
              // Serialize executor functions to strings
              const executor = plugin.executors![key];
              acc[key] =
                typeof executor === 'function' ? executor.toString() : executor;
              return acc;
            },
            {} as Record<string, unknown>
          )
      : undefined,
  };

  return JSON.stringify(codeObj, null, 0);
}

/**
 * Verify plugin code before registration.
 * This is the main entry point for plugin security verification.
 *
 * @param pluginName - Name of the plugin
 * @param code - Serialized plugin code (use serializePluginCode)
 * @param signature - Optional signature to verify
 * @param config - Optional config override (uses global config if not provided)
 * @returns Verification result with reason
 */
export async function verifyPluginCode(
  pluginName: string,
  code: string,
  signature?: string,
  config?: SecurityConfig
): Promise<VerificationResult> {
  const effectiveConfig = config || globalConfig;

  // Check skip verification flag
  if (effectiveConfig.skipVerification) {
    return {
      verified: true,
      reason: 'skip_verification',
      pluginName,
    };
  }

  // Check trusted builtins
  if (
    effectiveConfig.allowTrustedBuiltins &&
    isTrustedBuiltin(pluginName, effectiveConfig)
  ) {
    return {
      verified: true,
      reason: 'trusted_builtin',
      pluginName,
    };
  }

  // No signature provided
  if (!signature) {
    return {
      verified: false,
      reason: 'no_signature',
      pluginName,
      error: `Plugin "${pluginName}" has no signature`,
    };
  }

  // Custom verifier
  if (effectiveConfig.customVerifier) {
    try {
      const result = await effectiveConfig.customVerifier(
        pluginName,
        code,
        signature
      );
      return {
        verified: result,
        reason: result ? 'custom_verifier' : 'signature_invalid',
        pluginName,
        error: result ? undefined : 'Custom verifier rejected signature',
      };
    } catch (err) {
      return {
        verified: false,
        reason: 'verification_error',
        pluginName,
        error: `Custom verifier error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // Built-in verification based on algorithm
  try {
    let isValid: boolean;

    if (effectiveConfig.algorithm === 'ed25519') {
      if (!effectiveConfig.publicKey) {
        return {
          verified: false,
          reason: 'verification_error',
          pluginName,
          error: 'Ed25519 verification requires publicKey in config',
        };
      }
      isValid = await verifySignatureEd25519(
        code,
        signature,
        effectiveConfig.publicKey
      );
    } else {
      // Default to HMAC
      isValid = await verifySignatureHmac(code, signature);
    }

    return {
      verified: isValid,
      reason: isValid ? 'signature_valid' : 'signature_invalid',
      pluginName,
      error: isValid ? undefined : 'Signature verification failed',
    };
  } catch (err) {
    return {
      verified: false,
      reason: 'verification_error',
      pluginName,
      error: `Verification error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Convenience function for signing plugin code (development use).
 * For production, use signCodeEd25519 with proper key management.
 */
export async function signPluginCode(
  plugin: {
    name: string;
    version: string;
    tools?: Array<{ name: string; description: string }>;
    executors?: Record<string, unknown>;
  },
  options?: {
    algorithm?: 'hmac' | 'ed25519';
    privateKey?: string;
  }
): Promise<string> {
  const code = serializePluginCode(plugin);

  if (options?.algorithm === 'ed25519') {
    if (!options.privateKey) {
      throw new Error('Ed25519 signing requires privateKey');
    }
    return signCodeEd25519(code, options.privateKey);
  }

  return signCodeHmac(code);
}
