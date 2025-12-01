const nodemailer = require('nodemailer');
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { getOfferLetterTemplate } = require('./offerLetterService');

// Create transporter with better error handling
const createTransporter = () => {
  // Verify required environment variables
  if (!process.env.SMTP_HOST) {
    throw new Error('SMTP_HOST is not configured in environment variables');
  }
  
  if (!process.env.SMTP_USER) {
    throw new Error('SMTP_USER is not configured in environment variables');
  }
  
  if (!process.env.SMTP_PASS) {
    throw new Error('SMTP_PASS is not configured in environment variables');
  }
  
  // Parse SMTP port as number
  const smtpPort = Number(process.env.SMTP_PORT) || 465;
  
  // Log configuration for debugging
  console.log('📧 SMTP Configuration:', {
    host: process.env.SMTP_HOST,
    port: smtpPort,
    secure: smtpPort === 465,
    user: process.env.SMTP_USER
  });
  
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    tls: {
      rejectUnauthorized: false
    },
    debug: true, // Enable debug output
    logger: true // Log information in Nodemailer
  });
};

// Create S3 client
const createS3Client = () => {
  // Ensure endpoint has protocol
  let endpoint = process.env.MINIO_ENDPOINT;
  if (endpoint && !endpoint.startsWith('http')) {
    endpoint = `https://${endpoint}`;
  }
  
  return new S3Client({
    region: process.env.MINIO_REGION || 'us-east-1',
    endpoint: endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.MINIO_ACCESS_KEY,
      secretAccessKey: process.env.MINIO_SECRET_KEY,
    },
  });
};

// Generate long-lived signed URL (7 days) for MinIO
const generateSignedUrl = async (s3Key) => {
  try {
    const s3 = createS3Client();
    const command = new GetObjectCommand({
      Bucket: process.env.MINIO_BUCKET_NAME,
      Key: s3Key,
    });
    
    // Generate URL with 7 days expiration
    const signedUrl = await getSignedUrl(s3, command, { 
      expiresIn: 7 * 24 * 60 * 60 // 7 days in seconds
    });
    
    console.log(`✅ Generated signed URL for ${s3Key}:`, signedUrl);
    return signedUrl;
  } catch (error) {
    console.error('❌ Error generating signed URL:', error);
    throw error;
  }
};

// Generate offer letter HTML with form data
const generateOfferLetterHTML = (offerData) => {
  // Format salary with currency
  const formatSalary = (amount, currency = 'INR') => {
    if (!amount) return 'To be discussed';
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount)) return amount;
    
    const formatted = numAmount.toLocaleString('en-IN');
    return currency === 'INR' ? `₹${formatted}` : `${currency} ${formatted}`;
  };

  // Format date for display
  const formatDate = (dateStr) => {
    if (!dateStr) return 'To be decided';
    try {
      return new Date(dateStr).toLocaleDateString('en-IN', {
        year: 'numeric',
        month: 'long', 
        day: 'numeric'
      });
    } catch {
      return dateStr;
    }
  };

  // Prepare data for template
  const templateData = {
    candidateName: offerData.candidateName || 'Candidate',
    candidateEmail: offerData.candidateEmail || '',
    candidateAddress: offerData.candidateAddress || '',
    position: offerData.position || 'Position',
    department: offerData.department || '',
    companyName: offerData.companyName || 'Your Company',
    companyAddress: offerData.companyAddress || '',
    companyEmail: offerData.companyEmail || '',
    companyPhone: offerData.companyPhone || '',
    companyWebsite: offerData.companyWebsite || '',
    salary: formatSalary(offerData.salary, offerData.currency),
    startDate: formatDate(offerData.startDate),
    employmentType: offerData.employmentType || 'Full-time',
    reportingManager: offerData.reportingManager || '',
    workLocation: offerData.workLocation || 'Office',
    workingHours: offerData.workingHours || '9 AM to 6 PM',
    workingDays: offerData.workingDays || 'Monday to Friday',
    probationPeriod: offerData.probationPeriod || '3 months',
    noticePeriod: offerData.noticePeriod || '30 days',
    benefits: offerData.benefits || '',
    additionalTerms: offerData.additionalTerms || '',
    specialConditions: offerData.specialConditions || '',
    hrName: offerData.hrName || 'HR Manager',
    hrTitle: offerData.hrTitle || 'Human Resources',
    hrEmail: offerData.hrEmail || '',
    hrPhone: offerData.hrPhone || '',
    interviewDate: formatDate(offerData.interviewDate),
    interviewFeedback: offerData.interviewFeedback || '',
    offerValidUntil: formatDate(offerData.offerValidUntil) || 'One week from date of this letter'
  };

  // Get template and generate HTML
  const template = getOfferLetterTemplate(offerData.template || 'professional');
  return template.generateHTML(templateData);
};

// Send offer letter to BOTH candidate AND HR with proper MinIO links
const sendOfferLetterToBoth = async (offerData, s3Key) => {
  try {
    console.log('\n📧 ===== SENDING OFFER LETTERS =====');
    console.log('📊 Offer Data:', {
      candidate: offerData.candidateName,
      candidateEmail: offerData.candidateEmail,
      position: offerData.position,
      company: offerData.companyName,
      s3Key: s3Key
    });

    const transporter = createTransporter();
    
    // Generate signed URL for the PDF
    const signedUrl = await generateSignedUrl(s3Key);
    
    // 1. Send to CANDIDATE
    console.log('\n📧 Step 1: Sending to candidate...');
    const candidateMailOptions = {
      from: `"${offerData.companyName || 'Company'} HR Team" <${process.env.SMTP_USER}>`,
      to: offerData.candidateEmail,
      subject: `🎉 Offer Letter - ${offerData.position} at ${offerData.companyName}`,
      html: `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; background: #f8fafc; padding: 20px;">
          <div style="background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
            
            <!-- Header -->
            <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 30px; text-align: center; color: white;">
              <h1 style="margin: 0; font-size: 28px; font-weight: 700;">🎉 Congratulations!</h1>
              <p style="margin: 10px 0 0 0; font-size: 16px; opacity: 0.9;">You've received an offer letter</p>
            </div>
            
            <!-- Content -->
            <div style="padding: 30px;">
              <p style="font-size: 18px; color: #1f2937; margin: 0 0 20px 0;">Dear <strong>${offerData.candidateName}</strong>,</p>
              
              <p style="color: #374151; line-height: 1.6; margin-bottom: 25px;">
                We are thrilled to extend this formal offer of employment for the position of 
                <strong style="color: #059669;">${offerData.position}</strong> at 
                <strong style="color: #059669;">${offerData.companyName}</strong>!
              </p>
              
              <!-- Offer Summary Box -->
              <div style="background: #f0fdf4; border: 2px solid #bbf7d0; border-radius: 10px; padding: 25px; margin: 25px 0;">
                <h3 style="color: #047857; margin: 0 0 15px 0; font-size: 18px;">📋 Offer Summary</h3>
                <div style="display: grid; gap: 12px;">
                  <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px dotted #d1d5db;">
                    <span style="color: #6b7280; font-weight: 500;">Position:</span>
                    <span style="color: #1f2937; font-weight: 600;">${offerData.position}</span>
                  </div>
                  <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px dotted #d1d5db;">
                    <span style="color: #6b7280; font-weight: 500;">Department:</span>
                    <span style="color: #1f2937; font-weight: 600;">${offerData.department || 'To be assigned'}</span>
                  </div>
                  <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px dotted #d1d5db;">
                    <span style="color: #6b7280; font-weight: 500;">Start Date:</span>
                    <span style="color: #1f2937; font-weight: 600;">${offerData.startDate || 'To be decided'}</span>
                  </div>
                  <div style="display: flex; justify-content: space-between; padding: 8px 0;">
                    <span style="color: #6b7280; font-weight: 500;">Annual Salary:</span>
                    <span style="color: #059669; font-weight: 700; font-size: 16px;">${offerData.salary || 'As discussed'}</span>
                  </div>
                </div>
              </div>
              
              <!-- Download Button -->
              <div style="text-align: center; margin: 30px 0;">
                <a href="${signedUrl}" 
                   style="display: inline-block; background: linear-gradient(135deg, #059669 0%, #047857 100%); 
                          color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; 
                          font-weight: 600; font-size: 16px; box-shadow: 0 4px 15px rgba(5, 150, 105, 0.3);
                          transition: all 0.3s ease;">
                  📄 Download Complete Offer Letter
                </a>
              </div>
              
              <!-- Important Instructions -->
              <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 20px; margin: 25px 0; border-radius: 0 8px 8px 0;">
                <h4 style="color: #92400e; margin: 0 0 10px 0; font-size: 16px;">⚠️ Important Instructions</h4>
                <ul style="color: #92400e; margin: 10px 0; padding-left: 20px; line-height: 1.6;">
                  <li>Please review the complete offer letter carefully</li>
                  <li>Sign and return the acceptance within 7 business days</li>
                  <li>Contact HR if you have any questions</li>
                  <li>Prepare necessary documents for joining formalities</li>
                </ul>
              </div>
              
              <p style="color: #374151; line-height: 1.6; margin-bottom: 20px;">
                We're excited about the possibility of you joining our team and contributing to our continued success. 
                Please don't hesitate to reach out if you have any questions.
              </p>
              
              <p style="color: #374151; margin-bottom: 0;">
                Best regards,<br>
                <strong>${offerData.hrName || 'HR Team'}</strong><br>
                ${offerData.companyName}<br>
                ${offerData.hrEmail ? `<a href="mailto:${offerData.hrEmail}" style="color: #059669;">${offerData.hrEmail}</a>` : ''}
              </p>
            </div>
            
            <!-- Footer -->
            <div style="background: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="color: #6b7280; font-size: 12px; margin: 0;">
                This offer letter is valid for 7 days from the date of generation.<br>
                © ${new Date().getFullYear()} ${offerData.companyName}. All rights reserved.
              </p>
            </div>
          </div>
        </div>
      `
    };

    // Send to candidate
    const candidateResult = await transporter.sendMail(candidateMailOptions);
    console.log('✅ Candidate email sent successfully:', candidateResult.messageId);

    // 2. Send to HR
    console.log('\n📧 Step 2: Sending to HR...');
    const hrMailOptions = {
      from: `"SkillMatrix ATS" <${process.env.SMTP_USER}>`,
      to: offerData.hrEmail || process.env.SMTP_USER,
      subject: `📋 Offer Letter Sent - ${offerData.candidateName} (${offerData.position})`,
      html: `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; background:rgb(0, 0, 0); padding: 20px;">
          <div style="background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
            
            <!-- Header -->
            <div style="background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); padding: 30px; text-align: center; color: white;">
             <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #000;">📋 Offer Letter Sent</h1>

              <p style="margin: 10px 0 0 0; font-size: 14px; opacity: 0.9; color: #000;">HR Notification</p>

            </div>
            
            <!-- Content -->
            <div style="padding: 30px;">
              <p style="font-size: 16px; color: #1f2937; margin: 0 0 20px 0;">Dear HR Team,</p>
              
              <p style="color: #374151; line-height: 1.6; margin-bottom: 25px;">
                An offer letter has been successfully generated and sent to the candidate. Here are the details:
              </p>
              
              <!-- Candidate Details -->
              <div style="background: #f0f9ff; border: 2px solid #bfdbfe; border-radius: 10px; padding: 25px; margin: 25px 0;">
                <h3 style="color: #1e40af; margin: 0 0 15px 0; font-size: 18px;">👤 Candidate Information</h3>
                <div style="display: grid; gap: 12px;">
                  <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px dotted #d1d5db;">
                    <span style="color: #6b7280; font-weight: 500;">Name:</span>
                    <span style="color: #1f2937; font-weight: 600;">${offerData.candidateName}</span>
                  </div>
                  <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px dotted #d1d5db;">
                    <span style="color: #6b7280; font-weight: 500;">Email:</span>
                    <span style="color: #1f2937; font-weight: 600;">${offerData.candidateEmail}</span>
                  </div>
                  <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px dotted #d1d5db;">
                    <span style="color: #6b7280; font-weight: 500;">Position:</span>
                    <span style="color: #1f2937; font-weight: 600;">${offerData.position}</span>
                  </div>
                  <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px dotted #d1d5db;">
                    <span style="color: #6b7280; font-weight: 500;">Department:</span>
                    <span style="color: #1f2937; font-weight: 600;">${offerData.department || 'Not specified'}</span>
                  </div>
                  <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px dotted #d1d5db;">
                    <span style="color: #6b7280; font-weight: 500;">Start Date:</span>
                    <span style="color: #1f2937; font-weight: 600;">${offerData.startDate || 'To be decided'}</span>
                  </div>
                  <div style="display: flex; justify-content: space-between; padding: 8px 0;">
                    <span style="color: #6b7280; font-weight: 500;">Salary:</span>
                    <span style="color: #1e40af; font-weight: 700; font-size: 16px;">${offerData.salary || 'As discussed'}</span>
                  </div>
                </div>
              </div>
              
              <!-- Action Buttons -->
              <div style="text-align: center; margin: 30px 0;">
               <a href="${signedUrl}" 
   style="display: inline-block; background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); 
          color: #000; padding: 12px 25px; text-decoration: none; border-radius: 8px; 
          font-weight: 600; margin: 0 10px; box-shadow: 0 4px 15px rgba(59, 130, 246, 0.3);">
  📄 View Offer Letter
</a>

              </div>
              
              <!-- Status Info -->
              <div style="background: #ecfdf5; border-left: 4px solid #10b981; padding: 20px; margin: 25px 0; border-radius: 0 8px 8px 0;">
                <h4 style="color: #047857; margin: 0 0 10px 0; font-size: 16px;">✅ Email Status</h4>
                <ul style="color: #047857; margin: 10px 0; padding-left: 20px; line-height: 1.6;">
                  <li>Offer letter sent to candidate: <strong>${offerData.candidateEmail}</strong></li>
                  <li>PDF generated and stored in MinIO</li>
                  <li>Signed URL valid for 7 days</li>
                  <li>Candidate has 7 business days to respond</li>
                </ul>
              </div>
              
              <p style="color: #374151; line-height: 1.6; margin-bottom: 0;">
                The candidate will receive a beautifully formatted email with the offer letter. 
                You will be notified once they respond to the offer.
              </p>
            </div>
            
            <!-- Footer -->
            <div style="background: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="color: #6b7280; font-size: 12px; margin: 0;">
                Generated by SkillMatrix ATS on ${new Date().toLocaleString()}<br>
                File stored: ${s3Key}
              </p>
            </div>
          </div>
        </div>
      `
    };

    // Send to HR
    const hrResult = await transporter.sendMail(hrMailOptions);
    console.log('✅ HR email sent successfully:', hrResult.messageId);

    console.log('\n🎉 ===== OFFER LETTERS SENT SUCCESSFULLY =====');
    return {
      success: true,
      candidateEmailSent: true,
      hrEmailSent: true,
      signedUrl: signedUrl,
      candidateMessageId: candidateResult.messageId,
      hrMessageId: hrResult.messageId
    };

  } catch (error) {
    console.error('❌ Error sending offer letters:', error);
    console.error('❌ Error details:', {
      message: error.message,
      code: error.code,
      command: error.command,
      stack: error.stack
    });
    throw new Error(`Failed to send offer letter email: ${error.message}`);
  }
};

module.exports = {
  sendOfferLetterToBoth,
  generateOfferLetterHTML,
  generateSignedUrl
};
