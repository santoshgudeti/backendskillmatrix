const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { Upload } = require('@aws-sdk/lib-storage');
const mongoose = require('mongoose');
const OfferLetter = require('../models/OfferLetter');
const Letterhead = require('../models/Letterhead');
const letterheadService = require('./letterheadService');
const pdfMergeService = require('./pdfMergeService');
const { generatePDFFromHTML, generateProfessionalTemplate } = require('./offerLetterService');
const { sendOfferLetterToBoth } = require('./fixedOfferEmailService');

/**
 * Industrial-Grade Offer Letter Service
 * Implements the complete production procedure as specified in the blueprint
 */
class IndustrialOfferLetterService {
  constructor() {
    // Initialize S3 client with existing configuration
    this.s3Client = new S3Client({
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
    
    this.bucketName = process.env.MINIO_BUCKET_NAME || process.env.AWS_S3_BUCKET || 'skillmatrix';
  }

  /**
   * Generate offer letter HTML template with proper spacing for letterhead
   * @param {Object} offerData - Offer letter data
   * @returns {string} HTML template
   */
  generateOfferLetterTemplate(offerData) {
    // Validate required fields
    if (!offerData.salary || parseFloat(offerData.salary) <= 0) {
      throw new Error('Valid salary (gross CTC) is required and must be greater than 0');
    }
    
    // Ensure all required data fields are present with proper defaults
    const enhancedOfferData = {
      ...offerData,
      companyName: (offerData.companyName || 'Cognibotz').trim(),
      hrName: (offerData.hrName || 'HR Manager').trim(),
      hrTitle: (offerData.hrTitle || 'Human Resources').trim(),
      hrEmail: (offerData.hrEmail || offerData.hrContact || '').trim(),
      hrPhone: (offerData.hrPhone || '').trim(),
      hrContact: (offerData.hrContact || offerData.hrEmail || '').trim(),
      
      // Calculate offer validity date (default 7 days from now)
      offerDate: offerData.offerDate || new Date(),
      offerValidUntil: offerData.offerValidUntil || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      
      // Auto-calculate CTC breakdown if not provided
      // This ensures the template always shows proper salary breakdown
      basic: offerData.basic || Math.round(parseFloat(offerData.salary) * 0.40),
      hra: offerData.hra || Math.round(parseFloat(offerData.salary) * 0.20),
      allowance: offerData.allowance || Math.round(parseFloat(offerData.salary) * 0.30),
      employerPf: offerData.employerPf || Math.round((offerData.basic || parseFloat(offerData.salary) * 0.40) * 0.12)
    };
    
    return generateProfessionalTemplate(enhancedOfferData);
  }

  /**
   * Convert HTML to PDF with proper A4 formatting
   * @param {string} htmlContent - HTML content
   * @returns {Promise<Buffer>} PDF buffer
   */
  async generateContentPDF(htmlContent) {
    try {
      console.log('🖨️ [OFFER LETTER] Generating content PDF...');
      const pdfBuffer = await generatePDFFromHTML(htmlContent);
      console.log('✅ [OFFER LETTER] Content PDF generated successfully');
      return pdfBuffer;
    } catch (error) {
      console.error('❌ [OFFER LETTER] Error generating content PDF:', error);
      throw new Error(`Failed to generate content PDF: ${error.message}`);
    }
  }

  /**
   * Generate complete offer letter with letterhead merging
   * @param {Object} offerData - Offer letter data
   * @param {string} companyId - Company ID
   * @returns {Promise<Object>} Generated offer letter details
   */
  async generateOfferLetter(offerData, companyId) {
    try {
      console.log('🚀 [OFFER LETTER] Starting industrial-grade offer letter generation...');
      
      // Step 1: Generate HTML template
      console.log('📝 [OFFER LETTER] Generating HTML template...');
      const htmlTemplate = this.generateOfferLetterTemplate(offerData);
      
      // Step 2: Convert HTML to content PDF
      const contentPdfBuffer = await this.generateContentPDF(htmlTemplate);
      
      // Step 3: Get active letterhead for company
      console.log('🔍 [OFFER LETTER] Checking for active letterhead...');
      const letterhead = await letterheadService.getActiveLetterhead(companyId);
      
      let finalPdfBuffer = contentPdfBuffer;
      let letterheadId = null;
      
      // Step 4: Merge with letterhead if available
      if (letterhead) {
        console.log('🔗 [OFFER LETTER] Merging with letterhead...');
        finalPdfBuffer = await pdfMergeService.mergeWithLetterhead(
          contentPdfBuffer, 
          letterhead.s3Key
        );
        letterheadId = letterhead._id;
      } else {
        console.log('⚠️ [OFFER LETTER] No active letterhead found, using content-only PDF');
      }
      
      // Step 5: Upload final PDF to S3 with proper structure
      console.log('📤 [OFFER LETTER] Uploading final PDF to S3...');
      const timestamp = Date.now();
      const safeCandidateName = offerData.candidateName.replace(/[^a-zA-Z0-9]/g, '_');
      const filename = `offer_${safeCandidateName}_${timestamp}.pdf`;
      // Follow the required bucket structure: skillmatrix/offers/{company_id}/{candidate_id}/offer.pdf
      const s3Key = `offers/${companyId}/${offerData.candidateId || 'unknown'}/${filename}`;
      
      const uploadParams = {
        Bucket: this.bucketName,
        Key: s3Key,
        Body: finalPdfBuffer,
        ContentType: 'application/pdf',
        Metadata: {
          companyId: companyId,
          candidateName: offerData.candidateName,
          candidateEmail: offerData.candidateEmail,
          position: offerData.position,
          generatedAt: new Date().toISOString()
        }
      };
      
      const command = new PutObjectCommand(uploadParams);
      await this.s3Client.send(command);
      
      // Step 6: Save offer letter metadata to database
      console.log('💾 [OFFER LETTER] Saving offer letter metadata...');
      const offerLetter = new OfferLetter({
        candidateId: offerData.candidateId,
        assessmentSessionId: offerData.assessmentSessionId,
        companyId: companyId,
        letterheadId: letterheadId,
        s3Key: s3Key,
        filename: filename,
        fileSize: finalPdfBuffer.length,
        candidateName: offerData.candidateName,
        candidateEmail: offerData.candidateEmail,
        position: offerData.position,
        salary: offerData.salary,
        startDate: offerData.startDate,
        offerDetails: offerData,
        status: 'generated'
      });
      
      await offerLetter.save();
      
      console.log('🎉 [OFFER LETTER] Industrial-grade offer letter generation completed successfully');
      
      return {
        success: true,
        offerLetterId: offerLetter._id,
        s3Key: s3Key,
        filename: filename,
        fileSize: finalPdfBuffer.length
      };
      
    } catch (error) {
      console.error('❌ [OFFER LETTER] Error in industrial-grade offer letter generation:', error);
      throw new Error(`Offer letter generation failed: ${error.message}`);
    }
  }

  /**
   * Generate signed URL for offer letter download
   * @param {string} s3Key - S3 key of the offer letter
   * @param {number} expiresIn - Expiry time in seconds (default: 15 minutes)
   * @returns {Promise<string>} Signed URL
   */
  async generateDownloadUrl(s3Key, expiresIn = 900) {
    try {
      console.log('🔗 [OFFER LETTER] Generating download URL...');
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key,
        ResponseContentDisposition: 'attachment',
        ResponseContentType: 'application/pdf'
      });
      
      const signedUrl = await getSignedUrl(this.s3Client, command, { expiresIn });
      console.log('✅ [OFFER LETTER] Download URL generated successfully');
      return signedUrl;
    } catch (error) {
      console.error('❌ [OFFER LETTER] Error generating download URL:', error);
      throw new Error(`Failed to generate download URL: ${error.message}`);
    }
  }

  /**
   * Get offer letter by ID
   * @param {string} offerLetterId - Offer letter ID
   * @param {string} companyId - Company ID for authorization
   * @returns {Promise<Object>} Offer letter details
   */
  async getOfferLetter(offerLetterId, companyId) {
    try {
      console.log(`🔍 [OFFER LETTER] Retrieving offer letter: ${offerLetterId}`);
      const offerLetter = await OfferLetter.findOne({
        _id: offerLetterId,
        companyId: companyId
      }).populate('letterheadId');
      
      if (!offerLetter) {
        throw new Error('Offer letter not found');
      }
      
      console.log('✅ [OFFER LETTER] Offer letter retrieved successfully');
      return offerLetter;
    } catch (error) {
      console.error('❌ [OFFER LETTER] Error retrieving offer letter:', error);
      throw new Error(`Failed to retrieve offer letter: ${error.message}`);
    }
  }

  /**
   * Get all offer letters for a company with pagination
   * @param {string} companyId - Company ID
   * @param {Object} options - Query options
   * @returns {Promise<Object>} Paginated offer letters
   */
  async getOfferLetters(companyId, options = {}) {
    try {
      const { page = 1, limit = 20, status = 'all' } = options;
      
      const query = { companyId: companyId };
      if (status !== 'all') {
        query.status = status;
      }
      
      const offerLetters = await OfferLetter.find(query)
        .sort({ createdAt: -1 })
        .limit(limit * 1)
        .skip((page - 1) * limit);
      
      const total = await OfferLetter.countDocuments(query);
      
      return {
        offerLetters,
        pagination: {
          current: page,
          pages: Math.ceil(total / limit),
          total
        }
      };
    } catch (error) {
      console.error('❌ [OFFER LETTER] Error retrieving offer letters:', error);
      throw new Error(`Failed to retrieve offer letters: ${error.message}`);
    }
  }

  /**
   * Update offer letter status
   * @param {string} offerLetterId - Offer letter ID
   * @param {string} companyId - Company ID for authorization
   * @param {Object} updateData - Update data
   * @returns {Promise<Object>} Updated offer letter
   */
  async updateOfferLetter(offerLetterId, companyId, updateData) {
    try {
      console.log(`🔄 [OFFER LETTER] Updating offer letter: ${offerLetterId}`);
      
      const updatedOfferLetter = await OfferLetter.findOneAndUpdate(
        { _id: offerLetterId, companyId: companyId },
        updateData,
        { new: true }
      );
      
      if (!updatedOfferLetter) {
        throw new Error('Offer letter not found or access denied');
      }
      
      console.log('✅ [OFFER LETTER] Offer letter updated successfully');
      return updatedOfferLetter;
    } catch (error) {
      console.error('❌ [OFFER LETTER] Error updating offer letter:', error);
      throw new Error(`Failed to update offer letter: ${error.message}`);
    }
  }

  /**
   * Delete offer letter (soft delete by updating status)
   * @param {string} offerLetterId - Offer letter ID
   * @param {string} companyId - Company ID for authorization
   * @returns {Promise<boolean>} Success status
   */
  async deleteOfferLetter(offerLetterId, companyId) {
    try {
      console.log(`🗑️ [OFFER LETTER] Deleting offer letter: ${offerLetterId}`);
      
      const deletedOfferLetter = await OfferLetter.findOneAndUpdate(
        { _id: offerLetterId, companyId: companyId },
        { status: 'deleted' },
        { new: true }
      );
      
      if (!deletedOfferLetter) {
        throw new Error('Offer letter not found or access denied');
      }
      
      console.log('✅ [OFFER LETTER] Offer letter deleted successfully');
      return true;
    } catch (error) {
      console.error('❌ [OFFER LETTER] Error deleting offer letter:', error);
      throw new Error(`Failed to delete offer letter: ${error.message}`);
    }
  }

  /**
   * Send offer letter email to candidate and HR
   * @param {string} offerLetterId - Offer letter ID
   * @param {string} companyId - Company ID for authorization
   * @returns {Promise<Object>} Email send result
   */
  async sendOfferLetterEmail(offerLetterId, companyId) {
    try {
      console.log(`📧 [OFFER LETTER] Sending offer letter email: ${offerLetterId}`);
      
      // Get offer letter details
      const offerLetter = await this.getOfferLetter(offerLetterId, companyId);
      
      if (!offerLetter) {
        throw new Error('Offer letter not found');
      }
      
      // Send email to both candidate and HR
      const emailResult = await sendOfferLetterToBoth(offerLetter.offerDetails, offerLetter.s3Key);
      
      // Update offer letter status to 'sent'
      await this.updateOfferLetter(offerLetterId, companyId, { 
        status: 'sent',
        sentAt: new Date()
      });
      
      console.log('✅ [OFFER LETTER] Email sent successfully');
      
      return {
        success: true,
        candidateEmailSent: emailResult.candidateEmailSent,
        hrEmailSent: emailResult.hrEmailSent,
        signedUrl: emailResult.signedUrl
      };
    } catch (error) {
      console.error('❌ [OFFER LETTER] Error sending email:', error);
      throw new Error(`Failed to send offer letter email: ${error.message}`);
    }
  }
}

module.exports = new IndustrialOfferLetterService();