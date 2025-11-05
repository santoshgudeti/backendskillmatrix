const { PDFDocument } = require('pdf-lib');
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const mongoose = require('mongoose');

// Initialize S3 client (reuse existing configuration)
const s3 = new S3Client({
  region: process.env.MINIO_REGION || 'us-east-1',
  endpoint: process.env.MINIO_SECURE === 'true' || process.env.MINIO_SECURE === 'True' 
    ? `https://${process.env.MINIO_ENDPOINT}` 
    : `http://${process.env.MINIO_ENDPOINT}`,
  credentials: {
    accessKeyId: process.env.MINIO_ACCESS_KEY,
    secretAccessKey: process.env.MINIO_SECRET_KEY
  },
  forcePathStyle: true,
  s3BucketEndpoint: false,
  tls: process.env.MINIO_SECURE === 'true' || process.env.MINIO_SECURE === 'True'
});

// Upload function for S3/MinIO
async function uploadToS3(fileData, key, contentType, bucket = process.env.MINIO_BUCKET_NAME) {
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

// MongoDB Models - Import from main server file
const { Schema } = mongoose;

// MergedDocument Schema
const MergedDocumentSchema = new mongoose.Schema({
  assessmentSession: { 
    type: Schema.Types.ObjectId, 
    ref: 'AssessmentSession', 
    required: true 
  },
  resumeId: { 
    type: Schema.Types.ObjectId, 
    ref: 'Resume', 
    required: true 
  },
  reportId: { 
    type: Schema.Types.ObjectId, 
    ref: 'Report', 
    required: true 
  },
  s3Key: { type: String, required: true },
  filename: { type: String, required: true },
  fileSize: { type: Number },
  generatedAt: { type: Date, default: Date.now },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  candidateEmail: { type: String, required: true },
  jobTitle: { type: String },
  status: {
    type: String,
    enum: ['generating', 'completed', 'failed'],
    default: 'generating'
  }
}, { timestamps: true });

const MergedDocument = mongoose.model('MergedDocument', MergedDocumentSchema);

/**
 * Download PDF from MinIO S3 bucket
 * @param {string} s3Key - The S3 key of the file
 * @returns {Promise<Buffer>} PDF buffer
 */
async function downloadPDFFromS3(s3Key) {
  try {
    console.log(`📥 [MERGED PDF] Downloading PDF from S3: ${s3Key}`);
    
    const command = new GetObjectCommand({
      Bucket: process.env.MINIO_BUCKET_NAME,
      Key: s3Key
    });
    
    const response = await s3.send(command);
    
    // Convert stream to buffer
    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    
    const buffer = Buffer.concat(chunks);
    console.log(`✅ [MERGED PDF] Downloaded PDF: ${s3Key}, Size: ${buffer.length} bytes`);
    
    return buffer;
  } catch (error) {
    console.error(`❌ [MERGED PDF] Error downloading PDF from S3: ${s3Key}`, error);
    throw new Error(`Failed to download PDF: ${error.message}`);
  }
}

/**
 * Merge resume and report PDFs into a single document
 * @param {Buffer} resumeBuffer - Resume PDF buffer
 * @param {Buffer} reportBuffer - Report PDF buffer
 * @param {Object} metadata - Metadata for the merged document
 * @returns {Promise<Buffer>} Merged PDF buffer
 */
async function mergePDFs(resumeBuffer, reportBuffer, metadata) {
  try {
    console.log('🔄 [MERGED PDF] Starting PDF merge process...');
    
    // Create a new PDF document
    const mergedPdf = await PDFDocument.create();
    
    // Set metadata
    mergedPdf.setTitle(`${metadata.candidateEmail} - Complete Assessment Package`);
    mergedPdf.setSubject(`Resume and Assessment Report for ${metadata.jobTitle}`);
    mergedPdf.setCreator('SkillMatrix - Merged Document Service');
    mergedPdf.setProducer('SkillMatrix Assessment Platform');
    mergedPdf.setCreationDate(new Date());
    
    // Load the resume PDF
    console.log('📄 [MERGED PDF] Loading resume PDF...');
    const resumePdf = await PDFDocument.load(resumeBuffer);
    const resumePages = await mergedPdf.copyPages(resumePdf, resumePdf.getPageIndices());
    
    // Add resume pages to merged document
    resumePages.forEach((page) => mergedPdf.addPage(page));
    console.log(`✅ [MERGED PDF] Added ${resumePages.length} resume pages`);
    
    // Load the report PDF
    console.log('📊 [MERGED PDF] Loading report PDF...');
    const reportPdf = await PDFDocument.load(reportBuffer);
    const reportPages = await mergedPdf.copyPages(reportPdf, reportPdf.getPageIndices());
    
    // Add report pages to merged document
    reportPages.forEach((page) => mergedPdf.addPage(page));
    console.log(`✅ [MERGED PDF] Added ${reportPages.length} report pages`);
    
    // Generate the merged PDF buffer
    const mergedPdfBuffer = await mergedPdf.save();
    console.log(`🎯 [MERGED PDF] Merge completed. Final size: ${mergedPdfBuffer.length} bytes`);
    
    return mergedPdfBuffer;
  } catch (error) {
    console.error('❌ [MERGED PDF] Error merging PDFs:', error);
    throw new Error(`PDF merge failed: ${error.message}`);
  }
}

/**
 * Generate merged PDF for a candidate (resume + assessment report)
 * @param {string} assessmentSessionId - Assessment session ID
 * @param {string} userId - User ID who owns the data
 * @returns {Promise<Object>} Merged document details
 */
async function generateMergedPDF(assessmentSessionId, userId) {
  let mergedDoc = null;
  
  try {
    console.log(`🚀 [MERGED PDF] Starting merged PDF generation for session: ${assessmentSessionId}`);
    
    // Import models dynamically to avoid circular dependency
    const AssessmentSession = mongoose.model('AssessmentSession');
    const Resume = mongoose.model('Resume');
    const Report = mongoose.model('Report');
    
    // Get assessment session with populated data
    const session = await AssessmentSession.findById(assessmentSessionId)
      .populate('resumeId')
      .populate('user');
    
    if (!session) {
      throw new Error('Assessment session not found');
    }
    
    if (!session.resumeId || !session.resumeId.s3Key) {
      throw new Error('Resume not found for this session');
    }
    
    // Get the report for this session
    const report = await Report.findOne({ assessmentSession: assessmentSessionId });
    if (!report || !report.s3Key) {
      throw new Error('Assessment report not found for this session');
    }
    
    // Check if merged document already exists
    const existingMerged = await MergedDocument.findOne({ 
      assessmentSession: assessmentSessionId,
      status: 'completed'
    });
    
    if (existingMerged) {
      console.log(`✅ [MERGED PDF] Merged document already exists: ${existingMerged._id}`);
      return {
        success: true,
        mergedDocumentId: existingMerged._id,
        s3Key: existingMerged.s3Key,
        filename: existingMerged.filename,
        existed: true
      };
    }
    
    // Create merged document record
    const candidateEmail = session.candidateEmail;
    const timestamp = Date.now();
    const filename = `merged_${candidateEmail.replace(/[^a-zA-Z0-9]/g, '_')}_${timestamp}.pdf`;
    const s3Key = `merged-resumes/${userId}/${filename}`;
    
    mergedDoc = new MergedDocument({
      assessmentSession: assessmentSessionId,
      resumeId: session.resumeId._id,
      reportId: report._id,
      s3Key,
      filename,
      user: userId,
      candidateEmail,
      jobTitle: session.jobTitle,
      status: 'generating'
    });
    
    await mergedDoc.save();
    console.log(`📝 [MERGED PDF] Created merged document record: ${mergedDoc._id}`);
    
    // Download both PDFs
    console.log('📥 [MERGED PDF] Downloading source documents...');
    const [resumeBuffer, reportBuffer] = await Promise.all([
      downloadPDFFromS3(session.resumeId.s3Key),
      downloadPDFFromS3(report.s3Key)
    ]);
    
    // Merge PDFs
    const mergedBuffer = await mergePDFs(resumeBuffer, reportBuffer, {
      candidateEmail,
      jobTitle: session.jobTitle
    });
    
    // Upload merged PDF to S3
    console.log(`📤 [MERGED PDF] Uploading merged PDF to S3: ${s3Key}`);
    await uploadToS3(mergedBuffer, s3Key, 'application/pdf');
    
    // Update document record
    mergedDoc.fileSize = mergedBuffer.length;
    mergedDoc.status = 'completed';
    await mergedDoc.save();
    
    console.log(`🎉 [MERGED PDF] Successfully generated merged PDF: ${mergedDoc._id}`);
    
    return {
      success: true,
      mergedDocumentId: mergedDoc._id,
      s3Key,
      filename,
      fileSize: mergedBuffer.length,
      created: true
    };
    
  } catch (error) {
    console.error(`❌ [MERGED PDF] Error generating merged PDF for session ${assessmentSessionId}:`, error);
    
    // Update status to failed if document was created
    if (mergedDoc) {
      try {
        mergedDoc.status = 'failed';
        await mergedDoc.save();
      } catch (updateError) {
        console.error('❌ [MERGED PDF] Error updating failed status:', updateError);
      }
    }
    
    throw error;
  }
}

/**
 * Get merged documents for a user with pagination
 * @param {string} userId - User ID
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Merged documents with pagination
 */
async function getMergedDocuments(userId, options = {}) {
  try {
    const { page = 1, limit = 20, status = 'completed' } = options;
    
    const query = { user: userId };
    if (status !== 'all') {
      query.status = status;
    }
    
    const mergedDocs = await MergedDocument.find(query)
      .populate('assessmentSession', 'candidateEmail jobTitle completedAt')
      .populate('resumeId', 'title filename')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);
    
    const total = await MergedDocument.countDocuments(query);
    
    return {
      documents: mergedDocs,
      pagination: {
        current: page,
        pages: Math.ceil(total / limit),
        total
      }
    };
  } catch (error) {
    console.error('❌ [MERGED PDF] Error getting merged documents:', error);
    throw error;
  }
}

/**
 * Delete merged document (cleanup)
 * @param {string} mergedDocumentId - Merged document ID
 * @param {string} userId - User ID for authorization
 * @returns {Promise<boolean>} Success status
 */
async function deleteMergedDocument(mergedDocumentId, userId) {
  try {
    const mergedDoc = await MergedDocument.findOne({
      _id: mergedDocumentId,
      user: userId
    });
    
    if (!mergedDoc) {
      throw new Error('Merged document not found or access denied');
    }
    
    // TODO: Optionally delete from S3 (implement if needed)
    // await deleteFromS3(mergedDoc.s3Key);
    
    await MergedDocument.findByIdAndDelete(mergedDocumentId);
    
    console.log(`🗑️ [MERGED PDF] Deleted merged document: ${mergedDocumentId}`);
    return true;
  } catch (error) {
    console.error('❌ [MERGED PDF] Error deleting merged document:', error);
    throw error;
  }
}

module.exports = {
  MergedDocument,
  generateMergedPDF,
  getMergedDocuments,
  deleteMergedDocument,
  mergePDFs,
  downloadPDFFromS3
};