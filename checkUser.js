require('dotenv').config();
const mongoose = require('mongoose');

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => {
  console.log('Connected to MongoDB');
  
  // Define schemas (matching server.js)
  const jobPosterSchema = new mongoose.Schema({
    name: String,
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    isVerified: { type: Boolean, default: false },
  }, { timestamps: true });
  
  const JobPoster = mongoose.model('JobPoster', jobPosterSchema);
  
  // Check if user exists
  const userEmail = 'santosh.g@cognitbotz.com';
  
  JobPoster.findOne({ email: userEmail })
    .then(jobPoster => {
      if (jobPoster) {
        console.log(`✅ User ${userEmail} found in JobPoster collection:`);
        console.log(JSON.stringify(jobPoster, null, 2));
      } else {
        console.log(`❌ User ${userEmail} NOT found in JobPoster collection`);
        
        // List all job posters to see what's available
        return JobPoster.find({})
          .then(allPosters => {
            console.log(`\n📋 All Job Posters in database (${allPosters.length} total):`);
            allPosters.forEach(poster => {
              console.log(`  - ${poster.email} (${poster.name || 'No name'})`);
            });
          });
      }
    })
    .catch(error => {
      console.error('Error querying database:', error);
    })
    .finally(() => {
      mongoose.connection.close();
    });
})
.catch(error => {
  console.error('Error connecting to MongoDB:', error);
});