const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

// Clear any existing models
delete mongoose.models.DocumentCollection;
delete mongoose.connection.models.DocumentCollection;

// Load the model
const DocumentCollection = require('./models/DocumentCollection');

console.log('Model schema paths:', Object.keys(DocumentCollection.schema.paths));
console.log('Documents path type:', DocumentCollection.schema.paths.documents);

// Check the documents field definition
const documentsPath = DocumentCollection.schema.paths.documents;
console.log('Documents path instance:', documentsPath.instance);
console.log('Documents path options:', documentsPath.options);

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log('Connected to MongoDB');
    
    // Create a simple test
    const testDoc = new DocumentCollection({
      candidateId: new mongoose.Types.ObjectId(),
      requestedBy: new mongoose.Types.ObjectId(),
      documentTypes: ['aadhaar'],
      status: 'requested',
      candidateName: 'Test',
      candidateEmail: 'test@example.com'
    });
    
    console.log('Test doc created');
    
    // Try to save with empty documents array
    await testDoc.save();
    console.log('Test doc saved successfully');
    
    // Try to update with documents
    testDoc.documents = [{
      name: 'test.jpg',
      s3Key: 'test/test.jpg',
      type: 'image/jpeg',
      size: 1000,
      uploadedAt: new Date()
    }];
    
    console.log('Documents assigned');
    await testDoc.save();
    console.log('Test doc updated successfully');
    
    process.exit(0);
  })
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });