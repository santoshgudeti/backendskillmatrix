const express = require('express');
const router = express.Router();
const htmlToPdf = require('html-pdf');
const { sendOfferLetterToBoth, generateOfferLetterHTML } = require('../services/fixedOfferEmailService');
const { getOfferLetterTemplate } = require('../services/offerLetterService');
const AssessmentSession = require('../models/AssessmentSession'); // Adjust path as needed
const User = require('../models/User'); // Adjust path as needed
const { uploadToS3 } = require('../utils/s3Utils'); // Adjust path as needed

// Middleware to authenticate JWT (adjust import as needed)
const authenticateJWT = require('../middleware/auth'); // Adjust path as needed

// Generate Offer Draft with Form Data Integration
router.post('/draft', authenticateJWT, async (req, res) => {
  try {
    const { candidateId, assessmentSessionId, template, offerData } = req.body;
    
    console.log('📋 Generating offer draft with data:', {
      candidateId,
      assessmentSessionId,
      template,
      hasOfferData: !!offerData
    });

    // Get assessment session
    const assessment = await AssessmentSession.findById(assessmentSessionId || candidateId)
      .populate('resumeId');
    if (!assessment) {
      return res.status(404).json({ success: false, error: 'Assessment session not found' });
    }

    const user = await User.findById(req.user.id);
    
    // Merge form data with assessment data (form data takes priority)
    const mergedData = {
      // Candidate info
      candidateName: offerData?.candidateName || assessment.resumeId?.name || assessment.candidateEmail || 'Candidate',
      candidateEmail: offerData?.candidateEmail || assessment.candidateEmail,
      candidateAddress: offerData?.candidateAddress || '',
      candidatePhone: offerData?.candidatePhone || '',
      
      // Position info
      position: offerData?.position || assessment.jobTitle || 'Position',
      department: offerData?.department || '',
      employmentType: offerData?.employmentType || 'Full-time',
      reportingManager: offerData?.reportingManager || '',
      workLocation: offerData?.workLocation || 'Office',
      workingHours: offerData?.workingHours || '9 AM to 6 PM',
      workingDays: offerData?.workingDays || 'Monday to Friday',
      
      // Salary info
      salary: offerData?.salary || 'To be discussed',
      currency: offerData?.currency || 'INR',
      salaryFrequency: offerData?.salaryFrequency || 'per annum',
      
      // Dates
      startDate: offerData?.startDate || 'To be decided',
      endDate: offerData?.endDate || '',
      interviewDate: offerData?.interviewDate || '',
      
      // Terms
      probationPeriod: offerData?.probationPeriod || '3 months',
      noticePeriod: offerData?.noticePeriod || '30 days',
      benefits: offerData?.benefits || '',
      additionalTerms: offerData?.additionalTerms || '',
      specialConditions: offerData?.specialConditions || '',
      
      // Company info
      companyName: offerData?.companyName || user?.companyName || 'Your Company',
      companyAddress: offerData?.companyAddress || '',
      companyEmail: offerData?.companyEmail || '',
      companyPhone: offerData?.companyPhone || '',
      companyWebsite: offerData?.companyWebsite || user?.companyWebsite || '',
      
      // HR info
      hrName: offerData?.hrName || user?.fullName || 'HR Manager',
      hrTitle: offerData?.hrTitle || 'Human Resources',
      hrEmail: offerData?.hrEmail || user?.email || '',
      hrPhone: offerData?.hrPhone || '',
      
      // Additional
      interviewFeedback: offerData?.interviewFeedback || '',
      template: template || 'professional'
    };

    console.log('✅ Merged data prepared:', {
      candidateName: mergedData.candidateName,
      position: mergedData.position,
      salary: mergedData.salary,
      companyName: mergedData.companyName
    });

    // Generate HTML using the new service
    const draftHtml = generateOfferLetterHTML(mergedData);

    return res.json({ 
      success: true, 
      draftHtml,
      message: 'Offer letter template generated successfully with form data',
      mergedData // Include for debugging
    });

  } catch (error) {
    console.error('Error generating offer draft:', error);
    return res.status(500).json({ success: false, error: 'Failed to generate draft' });
  }
});

// Finalize and Send Offer Letter (Fixed Version)
router.post('/finalize', authenticateJWT, async (req, res) => {
  try {
    const { candidateId, assessmentSessionId, editedHtml, offerData } = req.body;
    
    console.log('\n🚀 ===== FINALIZING OFFER LETTER =====');
    console.log('📊 Request data:', {
      candidateId,
      assessmentSessionId,
      hasEditedHtml: !!editedHtml,
      hasOfferData: !!offerData
    });

    if (!editedHtml) {
      return res.status(400).json({ success: false, error: 'editedHtml is required' });
    }

    // Get assessment session
    const assessment = await AssessmentSession.findById(assessmentSessionId || candidateId)
      .populate('resumeId');
    if (!assessment) {
      return res.status(404).json({ success: false, error: 'Assessment session not found' });
    }

    const user = await User.findById(req.user.id);
    
    // Prepare complete offer data for email service
    const completeOfferData = {
      // Candidate info
      candidateName: offerData?.candidateName || assessment.resumeId?.name || assessment.candidateEmail || 'Candidate',
      candidateEmail: offerData?.candidateEmail || assessment.candidateEmail,
      candidateAddress: offerData?.candidateAddress || '',
      candidatePhone: offerData?.candidatePhone || '',
      
      // Position info
      position: offerData?.position || assessment.jobTitle || 'Position',
      department: offerData?.department || '',
      employmentType: offerData?.employmentType || 'Full-time',
      reportingManager: offerData?.reportingManager || '',
      workLocation: offerData?.workLocation || 'Office',
      workingHours: offerData?.workingHours || '9 AM to 6 PM',
      workingDays: offerData?.workingDays || 'Monday to Friday',
      
      // Salary info
      salary: offerData?.salary || 'To be discussed',
      currency: offerData?.currency || 'INR',
      salaryFrequency: offerData?.salaryFrequency || 'per annum',
      
      // Dates
      startDate: offerData?.startDate || 'To be decided',
      endDate: offerData?.endDate || '',
      interviewDate: offerData?.interviewDate || '',
      
      // Terms
      probationPeriod: offerData?.probationPeriod || '3 months',
      noticePeriod: offerData?.noticePeriod || '30 days',
      benefits: offerData?.benefits || '',
      additionalTerms: offerData?.additionalTerms || '',
      specialConditions: offerData?.specialConditions || '',
      
      // Company info
      companyName: offerData?.companyName || user?.companyName || 'Your Company',
      companyAddress: offerData?.companyAddress || '',
      companyEmail: offerData?.companyEmail || '',
      companyPhone: offerData?.companyPhone || '',
      companyWebsite: offerData?.companyWebsite || user?.companyWebsite || '',
      
      // HR info
      hrName: offerData?.hrName || user?.fullName || 'HR Manager',
      hrTitle: offerData?.hrTitle || 'Human Resources',
      hrEmail: offerData?.hrEmail || user?.email || '',
      hrPhone: offerData?.hrPhone || '',
      
      // Additional
      interviewFeedback: offerData?.interviewFeedback || '',
      template: offerData?.template || 'professional'
    };

    console.log('📋 Complete offer data prepared for:', completeOfferData.candidateName);

    // Sanitize HTML (basic sanitization - use a proper library in production)
    const safeHtml = String(editedHtml).replace(/<script[\s\S]*?<\/script>/gi, '');

    // Generate PDF from HTML
    console.log('📄 Converting HTML to PDF...');
    const pdfBuffer = await new Promise((resolve, reject) => {
      htmlToPdf.create(safeHtml, { 
        format: 'A4', 
        border: '10mm',
        timeout: 30000 // 30 seconds timeout
      }).toBuffer((err, buffer) => {
        if (err) {
          console.error('❌ PDF generation error:', err);
          return reject(err);
        }
        resolve(buffer);
      });
    });

    console.log('✅ PDF generated successfully, size:', pdfBuffer.length, 'bytes');

    // Upload to S3/MinIO
    const fileName = `offer_letter_${(completeOfferData.candidateName || 'candidate').replace(/\s+/g, '_')}_${Date.now()}.pdf`;
    const s3Key = `offer-letters/${fileName}`;
    
    console.log('📤 Uploading to MinIO:', s3Key);
    await uploadToS3(pdfBuffer, s3Key, 'application/pdf');
    console.log('✅ PDF uploaded to MinIO successfully');

    // Send emails to BOTH candidate and HR using the fixed service
    console.log('📧 Sending emails to both candidate and HR...');
    const emailResult = await sendOfferLetterToBoth(completeOfferData, s3Key);
    
    console.log('🎉 ===== OFFER LETTER PROCESS COMPLETED =====');
    console.log('📊 Final result:', {
      candidateEmailSent: emailResult.candidateEmailSent,
      hrEmailSent: emailResult.hrEmailSent,
      s3Key: s3Key,
      signedUrl: emailResult.signedUrl
    });

    return res.json({ 
      success: true, 
      s3Key,
      emailResult,
      message: 'Offer letter sent successfully to both candidate and HR'
    });

  } catch (error) {
    console.error('❌ Error finalizing offer:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Failed to finalize offer',
      details: error.message 
    });
  }
});

// Get available templates
router.get('/templates', authenticateJWT, (req, res) => {
  try {
    const templates = [
      { id: 'professional', name: 'Professional Corporate', description: 'Clean, modern design suitable for corporate environments' },
      { id: 'executive', name: 'Executive Level', description: 'Premium design for senior positions' },
      { id: 'startup', name: 'Modern Startup', description: 'Contemporary design for tech companies' },
      { id: 'formal', name: 'Formal Traditional', description: 'Traditional formal letter format' }
    ];
    
    res.json({ success: true, templates });
  } catch (error) {
    console.error('Error fetching templates:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch templates' });
  }
});

module.exports = router;
