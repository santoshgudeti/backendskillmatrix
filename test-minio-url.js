// Test MinIO URL construction
const dotenv = require('dotenv');
dotenv.config();

console.log('🔧 Testing MinIO URL Construction...');
console.log('Environment Variables:');
console.log('  MINIO_ENDPOINT:', process.env.MINIO_ENDPOINT);
console.log('  MINIO_BUCKET_NAME:', process.env.MINIO_BUCKET_NAME);
console.log('  MINIO_SECURE:', process.env.MINIO_SECURE);

// Simulate the URL construction logic from the updated route
const minioEndpoint = 'storageapi.docapture.com'; // Direct browser endpoint
const bucketName = process.env.MINIO_BUCKET_NAME || 'skillmatrix';

// Test with the actual s3Key format you provided
const testS3Key = 'candidate-documents/2025-10-08/Santoshguddeti19/aadhaar/1759916379932_Skill Matrix MoM_Recruitment_Workflow (1) (1).docx';

// Construct the direct MinIO browser URL
const directMinioUrl = `https://${minioEndpoint}/browser/${bucketName}/${encodeURIComponent(testS3Key)}`;

console.log('\n🎯 Generated URL:');
console.log('  Direct MinIO URL:', directMinioUrl);
console.log('\n📊 URL Components:');
console.log('  Endpoint:', minioEndpoint);
console.log('  Bucket:', bucketName);
console.log('  S3 Key:', testS3Key);
console.log('  Encoded S3 Key:', encodeURIComponent(testS3Key));

console.log('\n✨ Expected URL format (from your example):');
console.log('  https://storageapi.docapture.com/browser/skillmatrix/candidate-documents%2F2025-10-08%2FSantoshguddeti19%2Faadhaar%2F1759916379932_Skill%20Matrix%20MoM_Recruitment_Workflow%20(1)%20(1).docx');

console.log('\n🔍 URL Match Check:');
const expectedPattern = 'https://storageapi.docapture.com/browser/skillmatrix/candidate-documents%2F';
const actualPattern = directMinioUrl.substring(0, expectedPattern.length);
console.log('  Expected pattern:', expectedPattern);
console.log('  Actual pattern:', actualPattern);
console.log('  Patterns match:', expectedPattern === actualPattern);