const axios = require('axios');
const FormData = require('form-data');
const nodemailer = require('nodemailer');
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

// Import the uploadToS3 function from the interviewService
const { uploadToS3 } = require('./interviewService');

/**
 * Service to handle automatic job posting to external system
 */

// Create transporter using environment variables
const createTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: true, // Use STARTTLS instead of direct TLS
    tls: {
      rejectUnauthorized: false // Allow self-signed certificates
    },
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
};

// Function to send notification email to HR
async function sendHRNotificationEmail(hrEmail, jobDetails, publicUrl, jobPostId) {
  try {
    console.log(`📧 Sending job posting notification to HR: ${hrEmail}`);
    
    const transporter = createTransporter();
    
    // Get frontend URL from environment variables
    const frontendUrl = process.env.FRONTEND_URL;
    const jobPortalLoginUrl = `${frontendUrl}/jobportal/login`;
    const jobPostViewUrl = `${frontendUrl}/jobportal/dashboard`; // Assuming HR views job posts in their dashboard
    
    const mailOptions = {
      from: `"SkillMatrix ATS" <${process.env.SMTP_USER}>`,
      to: hrEmail,
      subject: `✅ New Job Posted: ${jobDetails.title || 'Untitled Position'}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0; color: white;">
            <h1 style="margin: 0; font-size: 28px;">Job Posted Successfully!</h1>
            <p style="margin: 10px 0 0 0; font-size: 16px; opacity: 0.9;">Your job has been automatically posted</p>
          </div>
          
          <div style="background: white; padding: 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 10px 10px;">
            <h2 style="color: #333; margin-top: 0;">${jobDetails.title || 'Untitled Position'}</h2>
            
            <div style="background: #f5f7ff; border-left: 4px solid #667eea; padding: 15px; margin: 20px 0; border-radius: 0 4px 4px 0;">
              <h3 style="margin-top: 0; color: #667eea;">Job Details</h3>
              <p style="margin: 5px 0;"><strong>Company:</strong> ${jobDetails.companyName || 'Not specified'}</p>
              <p style="margin: 5px 0;"><strong>Location:</strong> ${jobDetails.location || 'Not specified'}</p>
              <p style="margin: 5px 0;"><strong>Experience:</strong> ${jobDetails.experience || 'Not specified'}</p>
              ${jobDetails.salary ? `<p style="margin: 5px 0;"><strong>Salary Range:</strong> ${jobDetails.salary}</p>` : ''}
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <p style="font-size: 16px; color: #333; margin-bottom: 20px;">Public Job URL (Share this link with candidates):</p>
              <div style="background: #f0f0f0; padding: 15px; border-radius: 8px; word-break: break-all; font-family: monospace; font-size: 14px;">
                ${publicUrl}
              </div>
              <p style="margin-top: 10px; font-size: 14px; color: #666;">
                Copy and share this URL with candidates or use it to promote the position
              </p>
            </div>
            
            <div style="display: flex; justify-content: center; gap: 20px; flex-wrap: wrap; margin: 30px 0;">
              <a href="${jobPostViewUrl}" 
                 style="background: #667eea; color: white; padding: 12px 25px; text-decoration: none; border-radius: 6px; font-weight: bold;">
                View Job Post
              </a>
              <a href="${jobPortalLoginUrl}" 
                 style="background: #f0f0f0; color: #333; padding: 12px 25px; text-decoration: none; border-radius: 6px; font-weight: bold; border: 1px solid #ddd;">
                Job Portal Login
              </a>
            </div>
            
            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
              <p style="color: #666; font-size: 14px; text-align: center;">
                This job was automatically posted when you uploaded the job description through the main ATS.
              </p>
            </div>
          </div>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ Job posting notification sent successfully to: ${hrEmail}`);
  } catch (error) {
    console.error(`❌ Failed to send job posting notification to ${hrEmail}:`, error.message);
  }
}

// Function to send registration guidance email to HR (when user doesn't exist as job poster)
async function sendRegistrationGuidanceEmail(hrEmail) {
  try {
    console.log(`📧 Sending registration guidance to HR: ${hrEmail}`);
    
    const transporter = createTransporter();
    
    // Get frontend URL from environment variables
    const frontendUrl = process.env.FRONTEND_URL;
    const jobPortalRegisterUrl = `${frontendUrl}/jobportal/register`;
    const jobPortalLoginUrl = `${frontendUrl}/jobportal/login`;
    
    const mailOptions = {
      from: `"SkillMatrix ATS" <${process.env.SMTP_USER}>`,
      to: hrEmail,
      subject: "📝 Please Register for Job Posting Feature",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0; color: white;">
            <h1 style="margin: 0; font-size: 28px;">Job Posting Feature</h1>
            <p style="margin: 10px 0 0 0; font-size: 16px; opacity: 0.9;">Registration Required</p>
          </div>
          
          <div style="background: white; padding: 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 10px 10px;">
            <h2 style="color: #333; margin-top: 0;">Welcome to SkillMatrix Job Posting!</h2>
            
            <p>Hello,</p>
            
            <p>We noticed you've uploaded a job description through our main ATS, but you don't have an account in our Job Posting feature yet.</p>
            
            <div style="background: #fff8e1; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 0 4px 4px 0;">
              <h3 style="margin-top: 0; color: #ff9800;">Please register in the Job Post feature</h3>
              <p style="margin-bottom: 0;">
                Once registered, the documents you upload will automatically create a job post, which can then be used to promote candidates.
              </p>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${jobPortalRegisterUrl}" 
                 style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px; display: inline-block;">
                Register for Job Posting
              </a>
            </div>
            
            <p style="text-align: center; color: #666;">
              Already have an account? <a href="${jobPortalLoginUrl}" style="color: #f5576c;">Login here</a>
            </p>
            
            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
              <p style="color: #666; font-size: 14px; text-align: center;">
                After registration, all job descriptions you upload will be automatically posted with public URLs for easy candidate promotion.
              </p>
            </div>
          </div>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ Registration guidance email sent successfully to: ${hrEmail}`);
  } catch (error) {
    console.error(`❌ Failed to send registration guidance email to ${hrEmail}:`, error.message);
  }
}

// Function to extract job details from JD using external API
async function extractJobDetailsFromJD(jobDescriptionBuffer, filename) {
  try {
    console.log('📤 Extracting job details from JD using external API...');
    
    const formData = new FormData();
    formData.append('job_description', jobDescriptionBuffer, {
      filename: filename,
      contentType: 'application/pdf'
    });

    // Use environment variable for API endpoint
    const response = await axios.post(
      process.env.EXTERNAL_JOB_POSTING_API || process.env.JOB_EXTRACT,
      formData,
      {
        headers: {
          ...formData.getHeaders()
        },
        timeout: 30000 // 30 second timeout
      }
    );

    if (response.data.success) {
      console.log('✅ Job details extracted successfully');
      return response.data.data;
    } else {
      throw new Error('Failed to extract job details from JD');
    }
  } catch (error) {
    console.error('❌ Error extracting job details:', error.message);
    throw error;
  }
}

// Function to check if user exists as job poster
async function validateJobPoster(userEmail) {
  try {
    console.log(`🔍 Validating if user ${userEmail} exists as job poster...`);
    
    // Access models from mongoose (they're already defined in server.js)
    const JobPoster = mongoose.model('JobPoster');
    
    // Check if the user exists in the job poster collection
    const jobPoster = await JobPoster.findOne({ email: userEmail });
    
    if (jobPoster) {
      console.log(`✅ User ${userEmail} is a valid job poster`);
      return { isValid: true, jobPoster };
    } else {
      console.log(`❌ User ${userEmail} is not registered as a job poster`);
      return { isValid: false, jobPoster: null };
    }
  } catch (error) {
    console.error('❌ Error validating job poster:', error.message);
    return { isValid: false, jobPoster: null };
  }
}

// Function to create job post in external system
async function createExternalJobPost(jobDetails, jobPoster, jobDescriptionBuffer, filename) {
  try {
    console.log('📤 Creating job post in external system...');
    
    // Access models from mongoose (they're already defined in server.js)
    const JobPost = mongoose.model('JobPost');
    
    // Upload job description file to S3 if provided
    let s3Key = '';
    if (jobDescriptionBuffer && filename) {
      try {
        const safeTitle = (jobDetails.title || 'Untitled').replace(/\s+/g, '_');
        const fileName = `JD_${safeTitle}_${Date.now()}_${uuidv4()}${path.extname(filename)}`;
        const folderPrefix = process.env.MINIO_JD_FOLDER || 'jobposting-jd-files';
        const key = `${folderPrefix}/${fileName}`;
        const result = await uploadToS3(jobDescriptionBuffer, key, 'application/pdf'); // Assuming PDF, but could be dynamic
        s3Key = result?.Key || key;
        console.log(`✅ Job description file uploaded to S3: ${s3Key}`);
      } catch (uploadError) {
        console.error('❌ Error uploading job description file to S3:', uploadError.message);
        // Continue without the file if upload fails
      }
    }
    
    // Prepare job post data - properly mapping fields from extracted data
    const jobPostData = {
      title: jobDetails.title || 'Untitled Position',
      companyName: jobDetails.companyName || jobPoster.companyName || 'Unknown Company',
      location: jobDetails.location || '',
      jobType: jobDetails.type || 'Full-Time', // Mapping "type" to "jobType"
      experience: jobDetails.experience || '',
      department: jobDetails.department || '',
      skillsRequired: jobDetails.skills ? jobDetails.skills.split(',').map(skill => skill.trim()) : [], // Convert comma-separated string to array
      salaryRange: jobDetails.salary || 'Negotiable',
      descriptionText: jobDetails.description || '',
      jobDescriptionFile: s3Key, // Add the S3 key for the job description file
      postedBy: jobPoster._id
    };

    // Create job post in our system first
    const jobPost = new JobPost(jobPostData);
    await jobPost.save();
    
    // Generate public URL for the job post
    const publicId = jobPost._id.toString();
    jobPost.publicId = publicId;
    await jobPost.save();
    
    const publicUrl = `${process.env.FRONTEND_URL}/jobs/${publicId}`;
    
    console.log(`✅ Job post created successfully with public URL: ${publicUrl}`);
    return { success: true, jobPost, publicUrl };
  } catch (error) {
    console.error('❌ Error creating external job post:', error.message);
    throw error;
  }
}

// Main function to handle automatic job posting
async function handleAutomaticJobPosting(jobDescriptionBuffer, filename, userEmail) {
  try {
    console.log(`🚀 Starting automatic job posting process for user: ${userEmail}`);
    
    // Step 1: Validate if user is a job poster
    const validation = await validateJobPoster(userEmail);
    if (!validation.isValid) {
      console.log('⚠️  User is not a job poster. Sending registration guidance email.');
      // Send registration guidance email
      await sendRegistrationGuidanceEmail(userEmail);
      
      return { 
        success: false, 
        reason: 'User is not registered as a job poster',
        jobPost: null,
        publicUrl: null
      };
    }
    
    // Step 2: Extract job details from JD
    const jobDetails = await extractJobDetailsFromJD(jobDescriptionBuffer, filename);
    
    // Step 3: Create job post in external system (pass the job description buffer and filename)
    const result = await createExternalJobPost(jobDetails, validation.jobPoster, jobDescriptionBuffer, filename);
    
    // Step 4: Send notification email to HR with job details and public URL
    await sendHRNotificationEmail(userEmail, jobDetails, result.publicUrl, result.jobPost._id);
    
    console.log('🎉 Automatic job posting process completed successfully');
    return {
      success: true,
      jobPost: result.jobPost,
      publicUrl: result.publicUrl
    };
  } catch (error) {
    console.error('❌ Automatic job posting failed:', error.message);
    return {
      success: false,
      error: error.message,
      jobPost: null,
      publicUrl: null
    };
  }
}

module.exports = {
  handleAutomaticJobPosting,
  extractJobDetailsFromJD,
  validateJobPoster,
  createExternalJobPost,
  sendHRNotificationEmail,
  sendRegistrationGuidanceEmail
};