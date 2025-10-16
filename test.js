// test-multiple.js
require('dotenv').config();
const vision = require('@google-cloud/vision');

const client = new vision.ImageAnnotatorClient();

const testImages = [
  'https://storage.googleapis.com/cloud-samples-data/vision/logo_detection.jpg',
  'https://storage.googleapis.com/cloud-samples-data/vision/label/wakeupcat.jpg',
  'https://storage.googleapis.com/cloud-samples-data/vision/face/face_no_surprise.jpg'
];

async function testAllImages() {
  for (const imageUrl of testImages) {
    console.log(`\n🔍 Analyzing: ${imageUrl}`);
    
    try {
      const [result] = await client.labelDetection(imageUrl);
      const labels = result.labelAnnotations;
      
      if (labels && labels.length > 0) {
        console.log(`✅ Found ${labels.length} labels:`);
        labels.slice(0, 5).forEach(label => {
          console.log(`   - ${label.description} (${(label.score * 100).toFixed(1)}%)`);
        });
      } else {
        console.log('❌ No labels detected');
      }
    } catch (error) {
      console.log('❌ Error:', error.message);
    }
    
    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

testAllImages();