console.log('Testing document upload process');

const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log('Connected to MongoDB');
    
    // Test the DocumentCollection model
    const DocumentCollection = require('./models/DocumentCollection');
    console.log('DocumentCollection model loaded successfully');
    
    // Create a test document collection
    const testCollection = new DocumentCollection({
      candidateId: new mongoose.Types.ObjectId(),
      requestedBy: new mongoose.Types.ObjectId(),
      documentTypes: ['aadhaar', 'passport'],
      status: 'requested',
      candidateName: 'Test Candidate',
      candidateEmail: 'test@example.com'
    });
    
    await testCollection.save();
    console.log('Test collection saved with ID:', testCollection._id);
    
    // Simulate document upload
    const uploadedDocuments = [
      {
        name: 'aadhaar_front.jpg',
        s3Key: 'candidate-documents/test_candidate/aadhaar/test_id/123456789_aadhaar_front.jpg',
        type: 'image/jpeg',
        size: 1024000,
        uploadedAt: new Date()
      },
      {
        name: 'passport.pdf',
        s3Key: 'candidate-documents/test_candidate/passport/test_id/123456790_passport.pdf',
        type: 'application/pdf',
        size: 2048000,
        uploadedAt: new Date()
      }
    ];
    
    console.log('Prepared uploaded documents:', JSON.stringify(uploadedDocuments, null, 2));
    
    // Update the document collection
    try {
      testCollection.documents = uploadedDocuments;
      testCollection.status = 'uploaded';
      testCollection.uploadedAt = new Date();
      
      console.log('Saving document collection with documents array');
      await testCollection.save();
      console.log('Document collection saved successfully');
      
      // Verify the saved data
      const savedCollection = await DocumentCollection.findById(testCollection._id);
      console.log('Saved collection documents:', savedCollection.documents);
      console.log('Saved collection status:', savedCollection.status);
    } catch (saveError) {
      console.error('Error saving document collection:', saveError);
      console.error('Error name:', saveError.name);
      console.error('Error message:', saveError.message);
      console.error('Error stack:', saveError.stack);
    }
    
    process.exit(0);
  })
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });