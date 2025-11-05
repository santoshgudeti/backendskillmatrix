const nodemailer = require('nodemailer');

// Create transporter using environment variables
const transporter = nodemailer.createTransporter({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: true,
  tls: {
    rejectUnauthorized: false
  },
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Send interview invitation email to candidate and HR
const sendInterviewInvitation = async (candidateId, assessmentSessionId, interviewDetails, userId) => {
  try {
    console.log('🔄 Starting interview invitation process...');
    console.log('📧 Email configuration check:', {
      host: process.env.SMTP_HOST ? '✅ Set' : '❌ Missing',
      user: process.env.SMTP_USER ? '✅ Set' : '❌ Missing',
      pass: process.env.SMTP_PASS ? '✅ Set' : '❌ Missing'
    });

    // Import models dynamically to avoid circular dependency
    const mongoose = require('mongoose');
    
    // Get assessment session data
    const AssessmentSession = mongoose.model('AssessmentSession');
    const User = mongoose.model('User');
    
    const assessment = await AssessmentSession.findById(assessmentSessionId || candidateId)
      .populate('resumeId');
    
    if (!assessment) {
      throw new Error('Assessment session not found');
    }
    
    const candidateName = assessment.resumeId?.name || assessment.candidateEmail;
    const candidateEmail = assessment.candidateEmail;
    const jobTitle = assessment.jobTitle;
    const hrUser = await User.findById(userId);
    
    if (!hrUser) {
      throw new Error('HR user not found');
    }
    
    console.log('📋 Email details:', {
      candidateName,
      candidateEmail,
      jobTitle,
      hrEmail: hrUser.email,
      companyName: hrUser.companyName
    });
    
    // Send email to candidate
    const candidateMailOptions = {
      from: `"SkillMatrix HR Team" <${process.env.SMTP_USER}>`,
      to: candidateEmail,
      subject: `Interview Invitation - ${jobTitle} Position`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <h2 style="color: #333; margin: 0;">Interview Invitation</h2>
          </div>
          
          <p>Dear ${candidateName},</p>
          
          <p>Congratulations! We are pleased to invite you for an interview for the <strong>${jobTitle}</strong> position.</p>
          
          <div style="background-color: #e3f2fd; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h3 style="color: #1976d2; margin-top: 0;">Interview Details</h3>
            <p style="margin: 5px 0;"><strong>Position:</strong> ${jobTitle}</p>
            <p style="margin: 5px 0;"><strong>Date & Time:</strong> ${interviewDetails.dateTime || 'To be scheduled'}</p>
            <p style="margin: 5px 0;"><strong>Platform:</strong> ${interviewDetails.platform || 'To be confirmed'}</p>
            <p style="margin: 5px 0;"><strong>Duration:</strong> ${interviewDetails.duration || '45-60 minutes'}</p>
            ${interviewDetails.meetingLink ? `<p style="margin: 5px 0;"><strong>Meeting Link:</strong> <a href="${interviewDetails.meetingLink}">${interviewDetails.meetingLink}</a></p>` : ''}
          </div>
          
          <p>Please confirm your availability by replying to this email. ${!interviewDetails.meetingLink ? 'We will send you the meeting link and additional details once confirmed.' : ''}</p>
          
          <p>If you have any questions, please don't hesitate to contact us.</p>
          
          <div style="margin-top: 30px;">
            <p>Best regards,<br>
            ${hrUser.fullName}<br>
            HR Team<br>
            ${hrUser.companyName}</p>
          </div>
        </div>
      `
    };
    
    // Send email to HR (copy)
    const hrMailOptions = {
      from: `"SkillMatrix System" <${process.env.SMTP_USER}>`,
      to: hrUser.email,
      subject: `Interview Invitation Sent - ${candidateName} for ${jobTitle}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #333;">Interview Invitation Sent</h2>
          
          <p>Interview invitation has been sent to <strong>${candidateName}</strong> for the <strong>${jobTitle}</strong> position.</p>
          
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h3>Candidate Details:</h3>
            <p><strong>Name:</strong> ${candidateName}</p>
            <p><strong>Email:</strong> ${candidateEmail}</p>
            <p><strong>Position:</strong> ${jobTitle}</p>
            <p><strong>Interview Date:</strong> ${interviewDetails.dateTime || 'To be scheduled'}</p>
            <p><strong>Platform:</strong> ${interviewDetails.platform || 'To be confirmed'}</p>
          </div>
          
          <p>Please follow up with the candidate to confirm the interview schedule.</p>
        </div>
      `
    };
    
    // Send email to candidate first
    console.log('📤 Sending email to candidate...');
    const candidateResult = await transporter.sendMail(candidateMailOptions);
    console.log('✅ Candidate email sent successfully:', candidateResult.messageId);
    
    // Send email to HR
    console.log('📤 Sending email to HR...');
    const hrResult = await transporter.sendMail(hrMailOptions);
    console.log('✅ HR email sent successfully:', hrResult.messageId);
    
    console.log(`🎉 Interview invitation sent successfully to both ${candidateEmail} and ${hrUser.email}`);
    
    return {
      success: true,
      message: 'Interview invitation sent successfully to both candidate and HR',
      candidateEmail,
      hrEmail: hrUser.email,
      candidateMessageId: candidateResult.messageId,
      hrMessageId: hrResult.messageId
    };
    
  } catch (error) {
    console.error('Error sending interview invitation:', error);
    throw error;
  }
};

// Enhanced offer letter email with proper PDF attachment
const sendOfferLetterWithAttachment = async (candidateEmail, offerData, pdfBuffer, hrEmail) => {
  try {
    // Send to candidate with PDF attachment
    const candidateMailOptions = {
      from: `"SkillMatrix HR Team" <${process.env.SMTP_USER}>`,
      to: candidateEmail,
      subject: `Job Offer - ${offerData.position} Position`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <h2 style="color: #333; margin: 0;">Congratulations! Job Offer</h2>
          </div>
          
          <p>Dear ${offerData.candidateName},</p>
          
          <p>We are delighted to extend an offer of employment for the position of <strong>${offerData.position}</strong> at <strong>${offerData.companyName}</strong>.</p>
          
          <div style="background-color: #e8f5e8; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h3 style="color: #2e7d32; margin-top: 0;">Offer Summary</h3>
            <p style="margin: 5px 0;"><strong>Position:</strong> ${offerData.position}</p>
            <p style="margin: 5px 0;"><strong>Start Date:</strong> ${offerData.startDate}</p>
            <p style="margin: 5px 0;"><strong>Annual Salary:</strong> ${offerData.salary}</p>
          </div>
          
          <p>Please find the detailed offer letter attached to this email. The offer letter contains comprehensive information about:</p>
          <ul>
            <li>Position details and responsibilities</li>
            <li>Compensation and benefits</li>
            <li>Terms and conditions of employment</li>
            <li>Next steps for acceptance</li>
          </ul>
          
          <p><strong>Important:</strong> Please review the offer letter carefully and respond within 7 days of receiving this email.</p>
          
          <p>We are excited about the possibility of you joining our team and look forward to your positive response.</p>
          
          <div style="margin-top: 30px;">
            <p>Best regards,<br>
            HR Team<br>
            ${offerData.companyName}</p>
          </div>
          
          <div style="margin-top: 20px; padding: 15px; background-color: #fff3cd; border-radius: 5px;">
            <p style="margin: 0; font-size: 14px; color: #856404;">
              <strong>Note:</strong> This offer is confidential and intended solely for the recipient. 
              Please do not share this information with unauthorized parties.
            </p>
          </div>
        </div>
      `,
      attachments: [
        {
          filename: `Offer_Letter_${offerData.candidateName.replace(/\s+/g, '_')}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf'
        }
      ]
    };
    
    // Send copy to HR
    const hrMailOptions = {
      from: `"SkillMatrix System" <${process.env.SMTP_USER}>`,
      to: hrEmail,
      subject: `Offer Letter Sent - ${offerData.candidateName} for ${offerData.position}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #333;">Offer Letter Sent Successfully</h2>
          
          <p>The offer letter has been sent to <strong>${offerData.candidateName}</strong> for the <strong>${offerData.position}</strong> position.</p>
          
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h3>Offer Details:</h3>
            <p><strong>Candidate:</strong> ${offerData.candidateName}</p>
            <p><strong>Email:</strong> ${candidateEmail}</p>
            <p><strong>Position:</strong> ${offerData.position}</p>
            <p><strong>Start Date:</strong> ${offerData.startDate}</p>
            <p><strong>Salary:</strong> ${offerData.salary}</p>
            <p><strong>Sent At:</strong> ${new Date().toLocaleString()}</p>
          </div>
          
          <p>The candidate has 7 days to respond to this offer. Please follow up if needed.</p>
          
          <p>A copy of the offer letter is attached for your records.</p>
        </div>
      `,
      attachments: [
        {
          filename: `Offer_Letter_${offerData.candidateName.replace(/\s+/g, '_')}_HR_Copy.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf'
        }
      ]
    };
    
    // Send to candidate first
    console.log('📤 Sending offer letter to candidate with PDF attachment...');
    const candidateResult = await transporter.sendMail(candidateMailOptions);
    console.log('✅ Candidate offer letter sent successfully:', candidateResult.messageId);
    
    // Send to HR
    console.log('📤 Sending HR copy...');
    const hrResult = await transporter.sendMail(hrMailOptions);
    console.log('✅ HR copy sent successfully:', hrResult.messageId);
    
    console.log(`🎉 Offer letter sent successfully to both ${candidateEmail} and ${hrEmail} with PDF attachments`);
    
    return {
      success: true,
      message: 'Offer letter sent successfully to both candidate and HR with PDF attachments',
      candidateEmail,
      hrEmail,
      candidateMessageId: candidateResult.messageId,
      hrMessageId: hrResult.messageId
    };
    
  } catch (error) {
    console.error('Error sending offer letter with attachment:', error);
    throw error;
  }
};

module.exports = {
  sendInterviewInvitation,
  sendOfferLetterWithAttachment
};
