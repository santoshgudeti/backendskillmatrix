require('dotenv').config();
const mongoose = require('mongoose');
const { validateJobPoster, extractJobDetailsFromJD, createExternalJobPost } = require('./services/externalJobPostingService');

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
.then(async () => {
  console.log('Connected to MongoDB');
  
  // Define schemas (matching server.js)
  const jobPosterSchema = new mongoose.Schema({
    name: String,
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    isVerified: { type: Boolean, default: false },
  }, { timestamps: true });
  
  const jobPostSchema = new mongoose.Schema({
    title: String,
    companyName: String,
    location: String,
    experience: String,
    jobType: String,
    department: String,
    skillsRequired: [String],
    salaryRange: String,
    jobDescriptionFile: String,
    descriptionText: String,
    publicId: { type: String, unique: true },
    applications: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Application' }],
    createdAt: { type: Date, default: Date.now },
    postedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'JobPoster' },
  });
  
  // Register models
  mongoose.model('JobPoster', jobPosterSchema);
  mongoose.model('JobPost', jobPostSchema);
  
  console.log('✅ Models registered successfully');
  
  // Test validateJobPoster function
  console.log('\n🔍 Testing validateJobPoster...');
  try {
    const validation = await validateJobPoster('santosh.g@cognitbotz.com');
    console.log('Validation result:', validation);
    
    if (validation.isValid) {
      console.log('✅ Job poster validation successful');
      
      // Test createExternalJobPost with mock data
      console.log('\n📤 Testing createExternalJobPost...');
      const mockJobDetails = {
        title: 'Software Engineer',
        companyName: 'Cognitbotz',
        location: 'Hyderabad',
        type: 'Full-Time',
        experience: '2-5 years',
        department: 'Engineering',
        skills: 'JavaScript, React, Node.js',
        salary: '₹8,00,000 - ₹12,00,000',
        description: 'We are looking for a skilled Software Engineer...'
      };
      
      try {
        const result = await createExternalJobPost(mockJobDetails, validation.jobPoster);
        console.log('✅ Job post creation successful');
        console.log('Job post URL:', result.publicUrl);
        
        // Clean up - delete the test job post
        const JobPost = mongoose.model('JobPost');
        await JobPost.findByIdAndDelete(result.jobPost._id);
        console.log('🧹 Cleaned up test job post');
      } catch (error) {
        console.error('❌ Job post creation failed:', error.message);
      }
    } else {
      console.log('❌ Job poster validation failed');
    }
  } catch (error) {
    console.error('❌ Validation test failed:', error.message);
  }
  
  mongoose.connection.close();
})
.catch(error => {
  console.error('Error connecting to MongoDB:', error);
});