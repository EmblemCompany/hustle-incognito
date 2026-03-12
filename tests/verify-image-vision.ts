/**
 * Ephemeral script to verify the AI can actually SEE an image attachment.
 *
 * The test image is a black square/rectangle on a white background.
 * We ask the AI to describe it and check that the response mentions
 * "square" or "rectangle" or "black" — proving it processed the image
 * rather than returning a generic or error response.
 *
 * Usage: npx tsx tests/verify-image-vision.ts
 */
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { HustleIncognitoClient, ProcessedResponse } from 'hustle-incognito';

dotenv.config();

const API_KEY = process.env.HUSTLE_API_KEY || process.env.API_KEY;
const VAULT_ID = process.env.VAULT_ID;

if (!API_KEY || !VAULT_ID) {
  console.error('Missing API_KEY or VAULT_ID env vars');
  process.exit(1);
}

const client = new HustleIncognitoClient({ apiKey: API_KEY });

async function main() {
  const testImagePath = path.join(__dirname, 'fixtures', 'test-image.png');

  if (!fs.existsSync(testImagePath)) {
    console.error('test-image.png not found at', testImagePath);
    process.exit(1);
  }

  console.log('1. Uploading test image (black square on white background)...');
  const attachment = await client.uploadFile(testImagePath);
  console.log('   Uploaded:', attachment.url);
  console.log('   Content-Type:', attachment.contentType);
  console.log('   Name:', attachment.name);

  console.log('\n2. Sending chat with image — asking AI to describe what it sees...');
  const response = await client.chat(
    [{ role: 'user', content: 'Describe exactly what you see in this image. Be specific about shapes and colors.' }],
    {
      vaultId: VAULT_ID,
      attachments: [attachment]
    }
  ) as ProcessedResponse;

  console.log('\n3. AI Response:');
  console.log('   ---');
  console.log('  ', response.content);
  console.log('   ---');

  // Verify the AI actually saw the image
  const content = response.content.toLowerCase();
  const visionKeywords = ['square', 'rectangle', 'black', 'box', 'shape', 'border', 'outline'];
  const matched = visionKeywords.filter(kw => content.includes(kw));

  console.log('\n4. Vision verification:');
  console.log('   Keywords found:', matched.length > 0 ? matched.join(', ') : 'NONE');

  if (matched.length >= 2) {
    console.log('   PASS: AI can see the image (matched multiple visual descriptors)');
    process.exit(0);
  } else if (matched.length === 1) {
    console.log('   WEAK PASS: AI mentioned one visual keyword — might be coincidence');
    process.exit(0);
  } else {
    // Check if it's a billing/error response
    if (content.includes('blocked') || content.includes('payg') || content.includes('debt')) {
      console.error('   FAIL: Got a billing error instead of image analysis. Pay PAYG balance first.');
    } else {
      console.error('   FAIL: AI response does not describe the image content.');
    }
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
