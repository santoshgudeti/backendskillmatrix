console.log('Testing document collection model');

const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

console.log('Mongo URI:', process.env.MONGO_URI);

mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('Connected to MongoDB');
    
    // Test the DocumentCollection model
    const DocumentCollection = require('./models/DocumentCollection');
    console.log('DocumentCollection model loaded successfully');
    
    // Test creating a sample document collection
    const testCollection = new DocumentCollection({
      candidateId: new mongoose.Types.ObjectId(),
      requestedBy: new mongoose.Types.ObjectId(),
      documentTypes: ['aadhaar', 'passport'],
      status: 'requested',
      candidateName: 'Test Candidate',
      candidateEmail: 'test@example.com'
    });
    
    console.log('Test collection created:', testCollection);
    console.log('Documents array type:', typeof testCollection.documents);
    console.log('Documents array:', testCollection.documents);
    
    process.exit(0);
  })
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });