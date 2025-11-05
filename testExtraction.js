require('dotenv').config();
const fs = require('fs');
const path = require('path');

// Test if we can read a sample job description file
const sampleJDPath = path.join(__dirname, 'sample_jd.pdf');

// If the file doesn't exist, let's create a simple test
if (!fs.existsSync(sampleJDPath)) {
  console.log('Creating a sample PDF file for testing...');
  // Create a simple buffer to simulate a PDF file
  const sampleBuffer = Buffer.from('%PDF-1.4\n%âãÏÓ\n1 0 obj\n<<\n/Type /Catalog\n/Pages 2 0 R\n>>\nendobj\n2 0 obj\n<<\n/Type /Pages\n/Kids [3 0 R]\n/Count 1\n>>\nendobj\n3 0 obj\n<<\n/Type /Page\n/Parent 2 0 R\n/MediaBox [0 0 612 792]\n/Contents 4 0 R\n/Resources <<\n/ProcSet [/PDF /Text]\n/Font <<\n/F1 5 0 R\n>>\n>>\n>>\nendobj\n4 0 obj\n<<\n/Length 44\n>>\nstream\nBT\n/F1 12 Tf\n72 720 Td\n(Hello, this is a sample job description.) Tj\nET\nendstream\nendobj\n5 0 obj\n<<\n/Type /Font\n/Subtype /Type1\n/BaseFont /Helvetica\n>>\nendobj\nxref\n0 6\n0000000000 65535 f \n0000000015 00000 n \n0000000060 00000 n \n0000000111 00000 n \n0000000234 00000 n \n0000000325 00000 n \ntrailer\n<<\n/Size 6\n/Root 1 0 R\n>>\nstartxref\n385\n%%EOF', 'binary');
  fs.writeFileSync(sampleJDPath, sampleBuffer);
  console.log('Sample PDF created at:', sampleJDPath);
}

// Now test the extractJobDetailsFromJD function
const { extractJobDetailsFromJD } = require('./services/externalJobPostingService');

async function testExtraction() {
  try {
    // Read the sample file
    const jobDescriptionBuffer = fs.readFileSync(sampleJDPath);
    const filename = 'sample_jd.pdf';
    
    console.log('📤 Testing job details extraction...');
    const jobDetails = await extractJobDetailsFromJD(jobDescriptionBuffer, filename);
    console.log('✅ Job details extracted successfully:');
    console.log(JSON.stringify(jobDetails, null, 2));
  } catch (error) {
    console.error('❌ Job details extraction failed:', error.message);
    
    // Test with the actual API endpoint
    console.log('\n🔍 Checking API endpoint configuration...');
    console.log('EXTERNAL_JOB_POSTING_API:', process.env.EXTERNAL_JOB_POSTING_API);
    console.log('JOB_EXTRACT:', process.env.JOB_EXTRACT);
  }
}

testExtraction();