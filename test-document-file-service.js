#!/usr/bin/env node

/**
 * 🔧 Comprehensive Document File Service Test
 * Tests the complete file access workflow including MinIO integration
 */

require('dotenv').config();
const mongoose = require('mongoose');
const documentFileService = require('./services/documentFileService');

console.log('🧪 Starting Document File Service Test Suite');
console.log('=' * 60);

async function runTests() {
  try {
    // Connect to MongoDB
    console.log('📡 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ MongoDB connected successfully');

    // Load models
    const DocumentCollection = require('./models/DocumentCollection');
    
    console.log('\n🔍 Testing MinIO Configuration...');
    console.log('Environment Variables:');
    console.log('  MINIO_ENDPOINT:', process.env.MINIO_ENDPOINT);
    console.log('  MINIO_BUCKET_NAME:', process.env.MINIO_BUCKET_NAME);
    console.log('  MINIO_SECURE:', process.env.MINIO_SECURE);
    console.log('  MINIO_ACCESS_KEY:', process.env.MINIO_ACCESS_KEY ? '✅ Set' : '❌ Missing');
    console.log('  MINIO_SECRET_KEY:', process.env.MINIO_SECRET_KEY ? '✅ Set' : '❌ Missing');

    console.log('\n🔍 Finding test document collections...');
    const collections = await DocumentCollection.find().limit(3);
    console.log(`📊 Found ${collections.length} document collections`);

    if (collections.length === 0) {
      console.log('❌ No document collections found for testing');
      console.log('💡 Create some document collections first through the UI');
      return;
    }

    // Test each collection
    for (let i = 0; i < Math.min(collections.length, 2); i++) {
      const collection = collections[i];
      console.log(`\n🧪 Testing Collection ${i + 1}: ${collection._id}`);
      console.log(`  Candidate: ${collection.candidateName || 'Unknown'}`);
      console.log(`  Status: ${collection.status}`);
      console.log(`  Documents: ${collection.documents.length}`);

      if (collection.documents.length === 0) {
        console.log('  ⚠️ No documents to test');
        continue;
      }

      // Test file verification
      console.log('\n  🔍 Testing file verification...');
      try {
        const verification = await documentFileService.verifyDocumentCollection(collection._id);
        console.log('  📊 Verification Results:');
        console.log(`    Total files: ${verification.summary.total}`);
        console.log(`    Existing files: ${verification.summary.existing}`);
        console.log(`    Missing files: ${verification.summary.missing}`);
        console.log(`    All files exist: ${verification.allExist ? '✅' : '❌'}`);

        // Show detailed results for each file
        verification.details.forEach((detail, idx) => {
          const status = detail.exists ? '✅' : '❌';
          console.log(`      ${idx + 1}. ${detail.name} ${status}`);
          if (detail.s3Key) {
            console.log(`         Path: ${detail.s3Key}`);
          }
          if (!detail.exists && detail.error) {
            console.log(`         Error: ${detail.error}`);
          }
        });

      } catch (verifyError) {
        console.log('  ❌ Verification failed:', verifyError.message);
      }

      // Test URL generation for first document
      if (collection.documents.length > 0) {
        const firstDoc = collection.documents[0];
        console.log(`\n  🔗 Testing URL generation for: ${firstDoc.name}`);

        try {
          // Test view URL
          console.log('    Testing view URL...');
          const viewUrl = await documentFileService.generateViewUrl(
            firstDoc.s3Key,
            firstDoc.name,
            firstDoc.type
          );
          console.log('    ✅ View URL generated successfully');
          console.log(`       URL length: ${viewUrl.url.length} chars`);
          console.log(`       Expires in: ${viewUrl.expiresIn} seconds`);

          // Test download URL
          console.log('    Testing download URL...');
          const downloadUrl = await documentFileService.generateDownloadUrl(
            firstDoc.s3Key,
            firstDoc.name
          );
          console.log('    ✅ Download URL generated successfully');
          console.log(`       URL length: ${downloadUrl.url.length} chars`);
          console.log(`       Expires in: ${downloadUrl.expiresIn} seconds`);

        } catch (urlError) {
          console.log('    ❌ URL generation failed:', urlError.message);
        }

        // Test bulk URL generation
        console.log('    Testing bulk URL generation...');
        try {
          const bulkResult = await documentFileService.generateBulkUrls(
            collection.documents.slice(0, 3), // Test first 3 documents
            'view'
          );
          console.log('    ✅ Bulk URL generation completed');
          console.log(`       Total: ${bulkResult.summary.total}`);
          console.log(`       Successful: ${bulkResult.summary.successful}`);
          console.log(`       Failed: ${bulkResult.summary.failed}`);
        } catch (bulkError) {
          console.log('    ❌ Bulk URL generation failed:', bulkError.message);
        }
      }

      // Test path analysis
      if (collection.documents.length > 0) {
        console.log('\n  🔍 Testing path analysis...');
        collection.documents.slice(0, 2).forEach((doc, idx) => {
          const analysis = documentFileService.analyzeDocumentPath(doc.s3Key);
          console.log(`    Document ${idx + 1}: ${doc.name}`);
          console.log(`      Valid path: ${analysis.isValidPath ? '✅' : '❌'}`);
          if (analysis.isValidPath) {
            console.log(`      Date: ${analysis.date}`);
            console.log(`      Candidate: ${analysis.candidateName}`);
            console.log(`      Document type: ${analysis.documentType}`);
            console.log(`      Filename: ${analysis.filename}`);
          } else if (analysis.error) {
            console.log(`      Error: ${analysis.error}`);
          }
        });
      }

      // Test MIME type detection
      console.log('\n  🔍 Testing MIME type detection...');
      collection.documents.slice(0, 3).forEach((doc, idx) => {
        const detectedMime = documentFileService.detectMimeType(doc.name);
        const storedMime = doc.type;
        console.log(`    ${idx + 1}. ${doc.name}`);
        console.log(`       Stored MIME: ${storedMime}`);
        console.log(`       Detected MIME: ${detectedMime || 'Unknown'}`);
        console.log(`       Match: ${detectedMime === storedMime ? '✅' : '⚠️'}`);
      });
    }

    // Test candidate document listing (if we have valid paths)
    console.log('\n🔍 Testing candidate document listing...');
    const firstCollection = collections.find(c => c.documents.length > 0);
    if (firstCollection && firstCollection.documents.length > 0) {
      const firstDoc = firstCollection.documents[0];
      const pathAnalysis = documentFileService.analyzeDocumentPath(firstDoc.s3Key);
      
      if (pathAnalysis.isValidPath) {
        try {
          const listResult = await documentFileService.listCandidateDocuments(
            pathAnalysis.candidateName,
            pathAnalysis.date
          );
          console.log('✅ Document listing successful');
          console.log(`  Prefix: ${listResult.prefix}`);
          console.log(`  Files found: ${listResult.count}`);
          
          listResult.files.slice(0, 3).forEach((file, idx) => {
            console.log(`    ${idx + 1}. ${file.filename}`);
            console.log(`       Size: ${(file.size / 1024).toFixed(1)} KB`);
            console.log(`       Type: ${file.documentType}`);
            console.log(`       Modified: ${file.lastModified.toISOString()}`);
          });
        } catch (listError) {
          console.log('❌ Document listing failed:', listError.message);
        }
      } else {
        console.log('⚠️ No valid document paths found for listing test');
      }
    }

    console.log('\n🎯 Test Summary:');
    console.log('✅ Document File Service tests completed');
    console.log('📊 Check the results above for any issues');
    console.log('\n💡 Next steps:');
    console.log('1. Review any missing files and fix storage issues');
    console.log('2. Test the document viewing in the frontend');
    console.log('3. Verify download functionality works correctly');

  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error('Stack trace:', error.stack);
  } finally {
    await mongoose.disconnect();
    console.log('\n📡 MongoDB disconnected');
    process.exit(0);
  }
}

// Run the tests
runTests().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});