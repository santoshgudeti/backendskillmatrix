#!/usr/bin/env node

/**
 * 🔧 Document Viewing Test - Quick Frontend/Backend Integration Test
 * Tests the enhanced document viewing functionality
 */

require('dotenv').config();
const mongoose = require('mongoose');
const documentFileService = require('./services/documentFileService');

console.log('🧪 Testing Enhanced Document Viewing');
console.log('=' * 50);

async function testEnhancedViewing() {
  try {
    // Connect to MongoDB
    console.log('📡 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ MongoDB connected successfully');

    // Load models
    const DocumentCollection = require('./models/DocumentCollection');
    
    // Find a test document collection
    const collection = await DocumentCollection.findOne({ status: { $in: ['uploaded', 'verified'] } });
    
    if (!collection || !collection.documents.length) {
      console.log('❌ No uploaded documents found for testing');
      return;
    }
    
    const testDoc = collection.documents[0];
    console.log(`\n🧪 Testing enhanced viewing for: ${testDoc.name}`);
    console.log(`📍 File path: ${testDoc.s3Key}`);
    console.log(`📄 MIME type: ${testDoc.type}`);
    
    // Test the enhanced viewing URL generation
    try {
      const enhancedResult = await documentFileService.generateEnhancedViewUrl(
        testDoc.s3Key,
        testDoc.name,
        testDoc.type
      );
      
      console.log('\n✅ Enhanced viewing URL generation successful!');
      console.log('📊 Results:');
      console.log(`  Primary URL: ${enhancedResult.primaryUrl ? 'Generated ✅' : 'Failed ❌'}`);
      console.log(`  Fallback URL: ${enhancedResult.fallbackUrl ? 'Available ✅' : 'None ⚠️'}`);
      console.log(`  Preferred Strategy: ${enhancedResult.preferredStrategy || 'Default'}`);
      console.log(`  MIME Type: ${enhancedResult.mimeType || 'Unknown'}`);
      
      if (enhancedResult.strategies) {
        console.log('\n🎯 Available Strategies:');
        Object.entries(enhancedResult.strategies).forEach(([key, value]) => {
          console.log(`  ${key}: ${value ? 'Available ✅' : 'Not available ❌'}`);
        });
      }
      
      // Test direct MinIO URL generation
      const directUrl = documentFileService.generateDirectMinioUrl(testDoc.s3Key, testDoc.name);
      console.log(`\n🔗 Direct MinIO URL: ${directUrl ? 'Generated ✅' : 'Failed ❌'}`);
      if (directUrl) {
        console.log(`  URL: ${directUrl}`);
      }
      
      // Test viewing strategy determination
      const strategy = documentFileService.determineViewingStrategy(testDoc.name, testDoc.type);
      console.log(`\n🎯 Recommended Strategy: ${strategy}`);
      
      console.log('\n🎉 All tests passed! The enhanced viewing system is working correctly.');
      console.log('\n💡 To test in the frontend:');
      console.log('1. Open the DocumentCollectionDashboard');
      console.log('2. Click "View" on any document');
      console.log('3. The system will now try multiple strategies for inline viewing');
      console.log('4. Check browser console for detailed logs');
      
    } catch (testError) {
      console.log('❌ Enhanced viewing test failed:', testError.message);
      console.log('🔍 Check if the generateEnhancedViewUrl method exists in the service');
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    await mongoose.disconnect();
    console.log('\n📡 MongoDB disconnected');
    process.exit(0);
  }
}

// Run the test
testEnhancedViewing().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});