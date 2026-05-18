/**
 * Test URL constants — single source of truth for the test suite.
 *
 * Define the host once here; production / dev / staging URLs are derived.
 * Keep TEST_API_HOST in sync with API_ENDPOINTS.PRODUCTION in src/client.ts.
 */
const TEST_API_HOST = 'emblemvault.ai';

/** Production base URL — matches the SDK's default hustleApiUrl. */
export const TEST_API_URL = `https://${TEST_API_HOST}`;

/** Dev base URL — used to verify a custom hustleApiUrl is honored. */
export const TEST_DEV_API_URL = `https://dev.${TEST_API_HOST}`;

/** Staging base URL — used to verify a custom hustleApiUrl is honored. */
export const TEST_STAGING_API_URL = `https://staging.${TEST_API_HOST}`;
