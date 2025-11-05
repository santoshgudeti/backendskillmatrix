const nodemailer = require('nodemailer');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

// Email configuration
const smtpPort = Number(process.env.SMTP_PORT) || 587;
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: smtpPort,
  secure: smtpPort === 465, // true for port 465 (SSL), false for 587/25 (STARTTLS)
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  tls: {
    // Allow self-signed if needed; change to true in production with valid certs
    rejectUnauthorized: false,
  },
  connectionTimeout: 15000,
  greetingTimeout: 10000,
  socketTimeout: 20000,
});

// Local S3 upload helper (mirrors server upload behavior)
async function uploadToS3(fileData, key, contentType, bucket = process.env.MINIO_BUCKET_NAME) {
  const s3 = new S3Client({
    region: process.env.MINIO_REGION || process.env.AWS_REGION || 'auto',
    endpoint: process.env.MINIO_SECURE === 'true' || process.env.MINIO_SECURE === 'True' 
      ? `https://${process.env.MINIO_ENDPOINT.replace('https://', '').replace('http://', '')}` 
      : `http://${process.env.MINIO_ENDPOINT.replace('https://', '').replace('http://', '')}`,
    forcePathStyle: true,
    credentials: process.env.MINIO_ACCESS_KEY && process.env.MINIO_SECRET_KEY ? {
      accessKeyId: process.env.MINIO_ACCESS_KEY,
      secretAccessKey: process.env.MINIO_SECRET_KEY,
    } : (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY ? {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    } : undefined),
  });

  const upload = new Upload({
    client: s3,
    params: {
      Bucket: bucket,
      Key: key,
      Body: fileData,
      ContentType: contentType,
    },
  });

  return upload.done();
}

// Send offer letter summary (HR)
async function sendOfferLetterToHR(hrData, offerLetterUrl) {
  const { hrEmail, candidateName, position, salary, startDate, assessmentScore = 'N/A', interviewRating = 'N/A', companyName = 'Your Company' } = hrData;

  let resolvedUrl = offerLetterUrl;
  try {
    if (!/^https?:\/\//i.test(offerLetterUrl)) {
      const s3 = new S3Client({
        region: process.env.MINIO_REGION || process.env.AWS_REGION || 'auto',
        endpoint: process.env.MINIO_ENDPOINT || process.env.AWS_S3_ENDPOINT,
        forcePathStyle: true,
        credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        } : (process.env.MINIO_ACCESS_KEY && process.env.MINIO_SECRET_KEY ? {
          accessKeyId: process.env.MINIO_ACCESS_KEY,
          secretAccessKey: process.env.MINIO_SECRET_KEY,
        } : undefined),
      });

      const command = new GetObjectCommand({
        Bucket: process.env.MINIO_BUCKET_NAME || process.env.AWS_S3_BUCKET,
        Key: offerLetterUrl,
      });
      resolvedUrl = await getSignedUrl(s3, command, { expiresIn: 7 * 24 * 60 * 60 });
    }
  } catch (_) {}

  const mailOptions = {
    from: `"${companyName} | SkillMatrix ATS" <${process.env.SMTP_USER}>`,
    to: hrEmail,
    subject: `Offer Letter Sent — ${candidateName}`,
    html: `
      <div style="font-family: Arial, sans-serif; background:#f5f7fb; padding:24px;">
        <div style="max-width:640px; margin:0 auto; background:#ffffff; border:1px solid #e5e7eb; box-shadow:0 10px 24px rgba(0,0,0,0.06); border-radius:10px; overflow:hidden;">
          <div style="background:linear-gradient(90deg,#2563eb,#60a5fa); padding:18px 22px; color:#fff;">
            <div style="font-size:18px; font-weight:700;">${companyName}</div>
            <div style="opacity:0.9; font-size:12px;">Offer Letter Sent</div>
          </div>
          <div style="padding:22px; color:#111827;">
            <div style="margin-bottom:10px;">The offer letter below has been generated and sent to the candidate.</div>
            <div style="background:#f8fafc; border:1px solid #e5e7eb; border-radius:8px; padding:16px; margin:14px 0;">
              <table style="width:100%; border-collapse:collapse; font-size:14px;">
                <tr><td style="padding:6px 0; color:#6b7280;">Candidate</td><td style="padding:6px 0; text-align:right;"><strong>${candidateName}</strong></td></tr>
                <tr><td style="padding:6px 0; color:#6b7280;">Position</td><td style="padding:6px 0; text-align:right;">${position}</td></tr>
                <tr><td style="padding:6px 0; color:#6b7280;">Salary</td><td style="padding:6px 0; text-align:right;">${salary}</td></tr>
                <tr><td style="padding:6px 0; color:#6b7280;">Start Date</td><td style="padding:6px 0; text-align:right;">${new Date(startDate).toLocaleDateString()}</td></tr>
                <tr><td style="padding:6px 0; color:#6b7280;">Assessment Score</td><td style="padding:6px 0; text-align:right;">${assessmentScore}</td></tr>
                <tr><td style="padding:6px 0; color:#6b7280;">Interview Rating</td><td style="padding:6px 0; text-align:right;">${interviewRating}</td></tr>
              </table>
            </div>
            <div style="text-align:center; margin: 16px 0 6px;">
              <a href="${resolvedUrl}" style="background:#2563eb; color:#fff; padding:12px 22px; border-radius:8px; text-decoration:none; font-weight:700; display:inline-block;">View Offer Letter</a>
            </div>
            <p style="font-size:13px; color:#374151; text-align:center;">This link will expire in 7 days.</p>
          </div>
        </div>
      </div>
    `
  };

  console.log(`[MAIL] Sending HR offer summary to ${hrEmail}`);
  const hrResult = await transporter.sendMail(mailOptions);
  console.log('[MAIL] HR offer summary sent:', hrResult?.messageId || 'OK');
}

// Interview scheduling service
async function scheduleInterview(interviewData) {
  try {
    const { candidateId, assessmentSessionId, platform, date, time, duration, notes } = interviewData;
    
    // Create interview record in database
    const interview = new Interview({
      candidateId,
      assessmentSessionId,
      platform,
      scheduledDate: new Date(`${date}T${time}:00`),
      duration,
      notes,
      status: 'scheduled',
      createdAt: new Date()
    });
    
    await interview.save();
    
    // Send calendar invite email
    await sendInterviewInvite(interviewData);
    
    return {
      success: true,
      interviewId: interview._id,
      message: 'Interview scheduled successfully'
    };
  } catch (error) {
    console.error('Error scheduling interview:', error);
    throw error;
  }
}

// Send interview invite email
async function sendInterviewInvite(interviewData) {
  const { candidateEmail, candidateName, platform, date, time, duration, notes, jobTitle } = interviewData;
  
  const eventDetails = {
    title: `Interview - ${jobTitle}`,
    description: notes || `Interview for ${candidateName}`,
    startTime: `${date}T${time}:00`,
    duration: duration,
    attendee: candidateEmail
  };

  // Generate calendar links based on platform
  let calendarUrl = '';
  let platformName = '';
  
  switch (platform) {
    case 'google-meet':
      calendarUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(eventDetails.title)}&dates=${eventDetails.startTime}&details=${encodeURIComponent(eventDetails.description)}&add=${candidateEmail}`;
      platformName = 'Google Meet';
      break;
    case 'microsoft-teams':
      calendarUrl = `https://outlook.office.com/calendar/0/deeplink/compose?to=${candidateEmail}&subject=${encodeURIComponent(eventDetails.title)}&body=${encodeURIComponent(eventDetails.description)}`;
      platformName = 'Microsoft Teams';
      break;
    case 'zoom':
      calendarUrl = `https://zoom.us/schedule?email=${candidateEmail}&topic=${encodeURIComponent(eventDetails.title)}`;
      platformName = 'Zoom';
      break;
    case 'google-calendar':
      calendarUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(eventDetails.title)}&dates=${eventDetails.startTime}&details=${encodeURIComponent(eventDetails.description)}&add=${candidateEmail}`;
      platformName = 'Google Calendar';
      break;
  }

  const mailOptions = {
    from: `"SkillMatrix ATS" <${process.env.SMTP_USER}>`,
    to: candidateEmail,
    subject: `Interview Invitation - ${jobTitle}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2563eb;">Interview Invitation</h2>
        <p>Dear ${candidateName},</p>
        <p>We are pleased to invite you for an interview for the position of <strong>${jobTitle}</strong>.</p>
        
        <div style="background-color: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="color: #1e40af; margin-top: 0;">Interview Details</h3>
          <p><strong>Date:</strong> ${new Date(`${date}T${time}:00`).toLocaleDateString()}</p>
          <p><strong>Time:</strong> ${new Date(`${date}T${time}:00`).toLocaleTimeString()}</p>
          <p><strong>Duration:</strong> ${duration} minutes</p>
          <p><strong>Platform:</strong> ${platformName}</p>
          ${notes ? `<p><strong>Notes:</strong> ${notes}</p>` : ''}
        </div>
        
        <div style="text-align: center; margin: 20px 0;">
          <a href="${calendarUrl}" 
             style="background-color: #2563eb; color: white; padding: 12px 24px; 
                    text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">
            Add to Calendar
          </a>
        </div>
        
        <p>Please confirm your attendance by replying to this email.</p>
        <p>If you have any questions, please don't hesitate to contact us.</p>
        
        <p style="color: #6b7280; font-size: 12px; margin-top: 30px;">
          Best regards,<br>
          The SkillMatrix ATS Team
        </p>
      </div>
    `
  };

  try {
    console.log(`[MAIL] Sending candidate offer email to ${candidateEmail}`);
    const result = await transporter.sendMail(mailOptions);
    console.log('[MAIL] Candidate offer email sent:', result?.messageId || 'OK');
  } catch (err) {
    console.error('[MAIL] Candidate offer send failed:', err?.message || err);
    throw err;
  }
}

// Generate offer letter
async function generateOfferLetter(offerData) {
  try {
    const { candidateName, candidateEmail, position, salary, startDate, benefits, notes, companyName = 'Your Company' } = offerData;
    
    // Create PDF document
    const doc = new PDFDocument();
    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    
    // Add header
    doc.fontSize(24).text('OFFER LETTER', { align: 'center' });
    doc.moveDown(2);
    
    // Date
    doc.fontSize(12).text(`Date: ${new Date().toLocaleDateString()}`, { align: 'right' });
    doc.moveDown(2);
    
    // Candidate details
    doc.fontSize(14).text(`Dear ${candidateName},`);
    doc.moveDown();
    
    // Offer content
    doc.fontSize(12).text(`We are pleased to offer you the position of ${position} at ${companyName}.`);
    doc.moveDown();
    
    doc.text('Position Details:');
    doc.text(`• Position: ${position}`);
    doc.text(`• Salary: ${salary}`);
    doc.text(`• Start Date: ${new Date(startDate).toLocaleDateString()}`);
    doc.moveDown();
    
    if (benefits) {
      doc.text('Benefits:');
      const benefitsList = benefits.split('\n').filter(b => b.trim());
      benefitsList.forEach(benefit => {
        doc.text(`• ${benefit.trim()}`);
      });
      doc.moveDown();
    }
    
    if (notes) {
      doc.text('Additional Terms:');
      doc.text(notes);
      doc.moveDown();
    }
    
    doc.text('Please confirm your acceptance of this offer by signing and returning this letter within 7 business days.');
    doc.moveDown(2);
    
    doc.text('We look forward to welcoming you to our team!');
    doc.moveDown(2);
    
    doc.text('Best regards,');
    doc.text('HR Department');
    doc.text(companyName);
    
    // Finalize PDF
    return new Promise((resolve, reject) => {
      doc.on('end', async () => {
        try {
          const pdfBuffer = Buffer.concat(buffers);
          const filename = `offer_letter_${candidateName.replace(/\s+/g, '_')}_${Date.now()}.pdf`;
          const s3Key = `offer-letters/${filename}`;
          
          // Upload to S3
          await uploadToS3(pdfBuffer, s3Key, 'application/pdf');
          
          resolve({
            s3Key,
            filename,
            url: `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`
          });
        } catch (err) {
          reject(err);
        }
      });
      
      doc.end();
    });
  } catch (error) {
    console.error('Error generating offer letter:', error);
    throw error;
  }
}

// Send offer letter email (Candidate)
async function sendOfferLetter(offerData, offerLetterUrl) {
  const { candidateName, candidateEmail, position, salary, startDate, companyName = 'Your Company' } = offerData;
  // If an S3 key was passed instead of a URL, try to create a signed URL (works for MinIO/private buckets)
  let resolvedUrl = offerLetterUrl;
  try {
    if (!/^https?:\/\//i.test(offerLetterUrl)) {
      const s3 = new S3Client({
        region: process.env.MINIO_REGION || process.env.AWS_REGION || 'auto',
        endpoint: process.env.MINIO_ENDPOINT || process.env.AWS_S3_ENDPOINT,
        forcePathStyle: true,
        credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        } : (process.env.MINIO_ACCESS_KEY && process.env.MINIO_SECRET_KEY ? {
          accessKeyId: process.env.MINIO_ACCESS_KEY,
          secretAccessKey: process.env.MINIO_SECRET_KEY,
        } : undefined),
      });

      const command = new GetObjectCommand({
        Bucket: process.env.MINIO_BUCKET_NAME || process.env.AWS_S3_BUCKET,
        Key: offerLetterUrl,
      });
      resolvedUrl = await getSignedUrl(s3, command, { expiresIn: 7 * 24 * 60 * 60 });
    }
  } catch (e) {
    // fallback to PUBLIC_S3_BASE_URL if configured
    if (!/^https?:\/\//i.test(offerLetterUrl)) {
      if (process.env.PUBLIC_S3_BASE_URL) {
        resolvedUrl = `${process.env.PUBLIC_S3_BASE_URL.replace(/\/$/, '')}/${offerLetterUrl}`;
      } else if (process.env.PUBLIC_S3_BROWSER_URL) {
        resolvedUrl = `${process.env.PUBLIC_S3_BROWSER_URL.replace(/\/$/, '')}/${encodeURIComponent(offerLetterUrl)}`;
      }
    }
  }
  // Final fallback using MINIO_ENDPOINT + BUCKET if still not a full URL
  if (!/^https?:\/\//i.test(resolvedUrl)) {
    const endpoint = (process.env.MINIO_ENDPOINT || '').replace(/\/$/, '');
    const bucket = process.env.MINIO_BUCKET_NAME || process.env.AWS_S3_BUCKET || '';
    if (endpoint && bucket) {
      // Ensure proper HTTPS URL format for MinIO
      const base = endpoint.startsWith('http') ? endpoint : `https://${endpoint}`;
      resolvedUrl = `${base}/${bucket}/${offerLetterUrl}`;
      console.log('[MAIL] Generated fallback URL:', resolvedUrl);
    } else {
      console.error('[MAIL] Missing MINIO_ENDPOINT or BUCKET configuration');
    }
  }
  console.log('[MAIL] Candidate offer URL:', resolvedUrl);
  
  const mailOptions = {
    from: `"${companyName} | SkillMatrix ATS" <${process.env.SMTP_USER}>`,
    to: candidateEmail,
    subject: `Your Offer Letter — ${position} at ${companyName}`,
    html: `
      <div style="font-family: Arial, sans-serif; background:#f5f7fb; padding:24px;">
        <div style="max-width:640px; margin:0 auto; background:#ffffff; border:1px solid #e5e7eb; box-shadow:0 10px 24px rgba(0,0,0,0.06); border-radius:10px; overflow:hidden;">
          <div style="background:linear-gradient(90deg,#059669,#34d399); padding:18px 22px; color:#fff;">
            <div style="font-size:18px; font-weight:700;">${companyName}</div>
            <div style="opacity:0.9; font-size:12px;">Offer of Employment</div>
          </div>
          <div style="padding:22px; color:#111827;">
            <p style="margin:0 0 8px 0;">Dear <strong>${candidateName}</strong>,</p>
            <p style="margin:0 0 12px 0;">We are delighted to offer you the position of <strong>${position}</strong> at <strong>${companyName}</strong>.</p>
            <div style="background:#f8fafc; border:1px solid #e5e7eb; border-radius:8px; padding:16px; margin:14px 0;">
              <div style="font-weight:700; color:#065f46; margin-bottom:8px;">Offer Summary</div>
              <table style="width:100%; border-collapse:collapse; font-size:14px;">
                <tr><td style="padding:6px 0; color:#6b7280;">Position</td><td style="padding:6px 0; text-align:right;">${position}</td></tr>
                <tr><td style="padding:6px 0; color:#6b7280;">Salary</td><td style="padding:6px 0; text-align:right;">${salary}</td></tr>
                <tr><td style="padding:6px 0; color:#6b7280;">Start Date</td><td style="padding:6px 0; text-align:right;">${new Date(startDate).toLocaleDateString()}</td></tr>
              </table>
            </div>
            <div style="text-align:center; margin: 20px 0 6px;">
              <a href="${resolvedUrl}" style="background:#059669; color:#fff; padding:12px 22px; border-radius:8px; text-decoration:none; font-weight:700; display:inline-block;">View Offer Letter</a>
            </div>
            <p style="font-size:13px; color:#374151;">Please review your offer and confirm your acceptance within 7 business days. If you have any questions, feel free to reply to this email.</p>
            <p style="margin-top:18px;">Best regards,<br/><strong>HR Team</strong><br/>${companyName}</p>
          </div>
        </div>
      </div>
    `
  };

  await transporter.sendMail(mailOptions);
}

// Send rejection email
async function sendRejectionEmail(rejectionData) {
  const { candidateName, candidateEmail, reason, customReason, feedback, jobTitle } = rejectionData;
  
  const reasonText = reason === 'custom' ? customReason : reason.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  
  const mailOptions = {
    from: `"SkillMatrix ATS" <${process.env.EMAIL_USER}>`,
    to: candidateEmail,
    subject: `Application Update - ${jobTitle}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #dc2626;">Application Update</h2>
        <p>Dear ${candidateName},</p>
        <p>Thank you for your interest in the <strong>${jobTitle}</strong> position.</p>
        
        <div style="background-color: #fef2f2; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #dc2626;">
          <p>After careful consideration, we have decided not to move forward with your application at this time.</p>
          <p><strong>Reason:</strong> ${reasonText}</p>
        </div>
        
        ${feedback ? `
          <div style="background-color: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="color: #1e40af; margin-top: 0;">Feedback</h3>
            <p>${feedback}</p>
          </div>
        ` : ''}
        
        <p>We encourage you to apply for other positions that may be a better fit for your skills and experience.</p>
        <p>Thank you for your time and interest in our company.</p>
        
        <p style="color: #6b7280; font-size: 12px; margin-top: 30px;">
          Best regards,<br>
          The SkillMatrix ATS Team
        </p>
      </div>
    `
  };

  await transporter.sendMail(mailOptions);
}

// Get candidate details for interview workflow
async function getCandidateDetails(candidateId, assessmentSessionId) {
  try {
    // This would typically fetch from your database
    // For now, returning a mock structure
    const candidate = await Candidate.findById(candidateId);
    const assessment = await AssessmentSession.findById(assessmentSessionId)
      .populate('resumeId')
      .populate('jobDescriptionId')
      .populate('testResult');
    
    return {
      candidate,
      assessment
    };
  } catch (error) {
    console.error('Error fetching candidate details:', error);
    throw error;
  }
}

// Send document collection email
async function sendDocumentCollectionEmail(documentData) {
  const { candidateName, candidateEmail, companyName = 'Your Company', documentTypes, customMessage, template = 'standard', templateId, userId, documentCollectionId } = documentData;
  
  // Map document types to human-readable names
  const documentTypeMap = {
    'aadhaar': 'Aadhaar Card',
    'passport': 'Passport',
    'voter-id': 'Voter ID',
    'driving-license': 'Driving License',
    'address-proof': 'Address Proof',
    'educational-certificates': 'Educational Certificates',
    'experience-certificates': 'Experience Certificates',
    'relieving-letters': 'Relieving Letters',
    'salary-slips': 'Salary Slips',
    'form-16': 'Form 16',
    'photographs': 'Passport Size Photographs',
    'bank-details': 'Bank Details (Cancelled Cheque or Passbook)',
    'pan-card': 'PAN Card',
    'medical-certificates': 'Medical/Health Certificates',
    'nda': 'NDA (Non-Disclosure Agreement)',
    'background-verification': 'Background Verification Consent',
    'references': 'Reference Details',
    'other': 'Other Documents'
  };
  
  // Generate document list
  const documentList = documentTypes.map(type => {
    return `<li style="margin-bottom: 8px;">${documentTypeMap[type] || type}</li>`;
  }).join('');
  
  // If a specific template ID is provided, use that template
  let emailTemplate = null;
  if (templateId && userId) {
    try {
      const { getTemplateById } = require('./documentTemplateService');
      emailTemplate = await getTemplateById(templateId, userId);
    } catch (error) {
      console.error('Error fetching user template:', error);
    }
  }
  
  // Use user template if available, otherwise use default template
  const subject = emailTemplate ? emailTemplate.subject : `Document Collection Request - ${companyName}`;
  
  // Replace placeholders in the template
  let htmlContent = emailTemplate ? emailTemplate.content : `
    <div style="font-family: Arial, sans-serif; background:#f5f7fb; padding:24px;">
      <div style="max-width:640px; margin:0 auto; background:#ffffff; border:1px solid #e5e7eb; box-shadow:0 10px 24px rgba(0,0,0,0.06); border-radius:10px; overflow:hidden;">
        <div style="background:linear-gradient(90deg,#2563eb,#60a5fa); padding:18px 22px; color:#fff;">
          <div style="font-size:18px; font-weight:700;">{{companyName}}</div>
          <div style="opacity:0.9; font-size:12px;">Document Collection Request</div>
        </div>
        <div style="padding:22px; color:#111827;">
          <p style="margin:0 0 16px 0;">Dear <strong>{{candidateName}}</strong>,</p>
          <p style="margin:0 0 16px 0;">Congratulations on your selection! We are pleased to inform you that you have been selected for the position.</p>
          
          <div style="background:#fffbeb; border:1px solid #fbbf24; border-radius:8px; padding:16px; margin:16px 0;">
            <div style="font-weight:700; color:#92400e; margin-bottom:8px; display:flex; align-items:center;">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:8px;">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
              Important Next Step
            </div>
            <p style="margin:0 0 12px 0;">As part of our onboarding process, we request you to submit the following documents:</p>
            <ul style="margin:0; padding-left:20px;">
              {{documentList}}
            </ul>
          </div>
          
          {{#if customMessage}}
            <div style="background:#f0f9ff; border:1px solid #7dd3fc; border-radius:8px; padding:16px; margin:16px 0;">
              <div style="font-weight:700; color:#0369a1; margin-bottom:8px;">Message from HR:</div>
              <p style="margin:0;">{{customMessage}}</p>
            </div>
          {{/if}}
          
          <div style="background:#f0fdf4; border:1px solid #86efac; border-radius:8px; padding:16px; margin:16px 0;">
            <div style="font-weight:700; color:#166534; margin-bottom:8px; display:flex; align-items:center;">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:8px;">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
                <polyline points="10 9 9 9 8 9"></polyline>
              </svg>
              Submission Instructions
            </div>
            <p style="margin:0 0 12px 0;">Please upload these documents using the link below:</p>
            <div style="text-align:center; margin: 16px 0;">
              <a href="{{uploadLink}}" 
                 style="background:#10b981; color:#fff; padding:12px 24px; border-radius:8px; text-decoration:none; font-weight:700; display:inline-block;">
                Upload Documents
              </a>
            </div>
            <p style="margin:0; font-size:13px; color:#374151;">
              If you have any questions, please contact our HR team at {{hrEmail}}
            </p>
          </div>
          
          <p style="margin:16px 0 0 0;">We look forward to welcoming you to our team!</p>
          <p style="margin:16px 0 0 0;">Best regards,<br/><strong>HR Team</strong><br/>{{companyName}}</p>
        </div>
      </div>
    </div>
  `;
  
  // Create upload link with document collection ID
  const uploadLink = documentCollectionId 
    ? `${process.env.FRONTEND_URL || 'http://localhost:5173'}/document-upload/${documentCollectionId}`
    : `${process.env.FRONTEND_URL || 'http://localhost:5173'}/document-upload`;
  
  // Replace placeholders in the HTML content
  htmlContent = htmlContent
    .replace(/{{candidateName}}/g, candidateName)
    .replace(/{{companyName}}/g, companyName)
    .replace(/{{documentList}}/g, documentList)
    .replace(/{{customMessage}}/g, customMessage || '')
    .replace(/{{uploadLink}}/g, uploadLink)
    .replace(/{{hrEmail}}/g, process.env.SMTP_USER);
  
  const mailOptions = {
    from: `"${companyName} | SkillMatrix ATS" <${process.env.SMTP_USER}>`,
    to: candidateEmail,
    subject: subject,
    html: htmlContent
  };

  try {
    console.log(`[MAIL] Sending document collection email to ${candidateEmail}`);
    const result = await transporter.sendMail(mailOptions);
    console.log('[MAIL] Document collection email sent:', result?.messageId || 'OK');
    return result;
  } catch (err) {
    console.error('[MAIL] Document collection email send failed:', err?.message || err);
    throw err;
  }
}

module.exports = {
  scheduleInterview,
  sendInterviewInvite,
  generateOfferLetter,
  sendOfferLetter,
  sendOfferLetterToHR,
  sendRejectionEmail,
  getCandidateDetails,
  sendDocumentCollectionEmail,
  uploadToS3
};