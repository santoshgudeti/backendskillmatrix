require('dotenv').config();
const mongoose = require('mongoose');

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
.then(() => {
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
  const JobPoster = mongoose.model('JobPoster', jobPosterSchema);
  const JobPost = mongoose.model('JobPost', jobPostSchema);
  
  console.log('✅ Models registered successfully');
  
  // Test accessing models
  JobPoster.findOne({ email: 'santosh.g@cognitbotz.com' })
    .then(jobPoster => {
      if (jobPoster) {
        console.log('✅ JobPoster model access working');
        console.log(`User: ${jobPoster.email}`);
      } else {
        console.log('❌ JobPoster not found');
      }
      
      // Try to access JobPost model
      return JobPost.findOne({}).then(jobPost => {
        console.log('✅ JobPost model access working');
        if (jobPost) {
          console.log(`Found job post: ${jobPost.title}`);
        } else {
          console.log('No job posts found (this is OK)');
        }
      });
    })
    .catch(error => {
      console.error('❌ Error accessing models:', error.message);
    })
    .finally(() => {
      mongoose.connection.close();
    });
})
.catch(error => {
  console.error('Error connecting to MongoDB:', error);
});