#!/usr/bin/env node
/**
 * QUICK Google Vision API Test
 * Run: node quick-test.js
 */

require('dotenv').config();
const fs = require('fs');

console.log('\n🔍 Quick Google Vision API Test\n');

// 1. Check env var
const cred = process.env.GOOGLE_APPLICATION_CREDENTIALS;
console.log('1. Env Variable:', cred ? '✅' : '❌ NOT SET');

if (!cred) {
  console.log('\n❌ Add this to .env:');
  console.log('GOOGLE_APPLICATION_CREDENTIALS=/full/path/to/google-vision-key.json\n');
  process.exit(1);
}

// 2. Check file exists
console.log('2. File Exists:', fs.existsSync(cred) ? '✅' : '❌ NOT FOUND');

if (!fs.existsSync(cred)) {
  console.log(`\n❌ File not found: ${cred}\n`);
  process.exit(1);
}

// 3. Check JSON valid
try {
  const json = JSON.parse(fs.readFileSync(cred, 'utf8'));
  console.log('3. Valid JSON:', '✅');
  console.log('   Project:', json.project_id);
  console.log('   Email:', json.client_email);
} catch (err) {
  console.log('3. Valid JSON:', '❌', err.message);
  process.exit(1);
}

// 4. Test API
console.log('\n4. Testing API connection...');

(async () => {
  try {
    const { ImageAnnotatorClient } = require('@google-cloud/vision');
    const client = new ImageAnnotatorClient({ keyFilename: cred });
    
    // Simple test - detect text in tiny image
    const testImg = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    await client.textDetection({ image: { content: testImg } });
    
    console.log('   ✅ API Working!\n');
    console.log('🎉 All tests passed! Google Vision API is ready.\n');
  } catch (err) {
    console.log('   ❌ API Failed:', err.message);
    console.log('\n💡 Common fixes:');
    console.log('   • Enable Vision API: https://console.cloud.google.com/apis/library/vision.googleapis.com');
    console.log('   • Check service account has permissions');
    console.log('   • Verify billing is enabled\n');
    process.exit(1);
  }
})();