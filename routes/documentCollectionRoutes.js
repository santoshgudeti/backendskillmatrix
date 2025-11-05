
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const documentFileService = require('../services/documentFileService');

const router = express.Router();

// Multer configuration for file uploads
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept pdf, doc, docx, jpg, jpeg, png files
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg',
      'image/png'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, DOC, DOCX, JPG, and PNG files are allowed.'));
    }
  }
});

// Document Collection Model
const DocumentCollection = require('../models/DocumentCollection');
// Assessment Session Model
const AssessmentSession = mongoose.model('AssessmentSession');
// User Model
const User = mongoose.model('User');
// Resume Model
const Resume = mongoose.model('Resume');

// 🔒 SECURITY MIDDLEWARE: Verify user owns document collection (simplified version)
const verifyDocumentCollectionOwnership = async (req, res, next) => {
  try {
    const { documentCollectionId } = req.params;
    
    console.log('🔐 [SECURITY] Document collection ownership check:', {
      documentCollectionId,
      userId: req.user?.id,
      userIsAdmin: req.user?.isAdmin,
      timestamp: new Date().toISOString()
    });
    
    // Find collection
    const collection = await DocumentCollection.findById(documentCollectionId);
    
    if (!collection) {
      console.log('❌ [SECURITY] Collection not found:', documentCollectionId);
      return res.status(404).json({
        success: false,
        error: 'Document collection not found'
      });
    }
    
    // Admins skip ownership check (following same pattern as verifyOwnership in server.js)
    if (req.user?.isAdmin) {
      console.log('✅ [SECURITY] Admin access granted for collection:', documentCollectionId);
      req.documentCollection = collection;
      return next();
    }
    
    // Regular ownership check (following same pattern as server.js line 566)
    if (!collection.requestedBy || collection.requestedBy.toString() !== req.user.id) {
      console.log('🚫 [SECURITY] Access denied - ownership mismatch:', {
        collectionId: documentCollectionId,
        collectionOwner: collection.requestedBy?.toString(),
        requestingUser: req.user.id,
        collectionOwnerType: typeof collection.requestedBy,
        requestingUserType: typeof req.user.id
      });
      
      return res.status(403).json({
        success: false,
        error: 'Access denied - You do not have permission to access this document collection'
      });
    }
    
    console.log('✅ [SECURITY] Ownership verified successfully:', {
      documentCollectionId,
      userId: req.user.id
    });
    
    // Add collection to request for use in route handler
    req.documentCollection = collection;
    next();
    
  } catch (error) {
    console.error('❌ [SECURITY] Error verifying ownership:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Template Service
const { 
  getUserTemplates, 
  getTemplateById, 
  createTemplate, 
  updateTemplate, 
  deleteTemplate,
  getDefaultTemplate
} = require('../services/documentTemplateService');

// Get all document collections for the authenticated user
router.get('/', async (req, res) => {
  try {
    console.log('🔍 [SECURITY] Fetching document collections for user:', {
      userId: req.user.id,
      isAdmin: req.user.isAdmin
    });
    
    let query = {};
    
    // Admins can see all collections, regular users only see their own
    if (!req.user.isAdmin) {
      query.requestedBy = req.user.id;
    }
    
    console.log('🔍 [SECURITY] Query filter:', query);
    
    const documentCollections = await DocumentCollection.find(query)
      .populate('candidateId', 'name email')
      .populate('requestedBy', 'fullName email')
      .populate('verifiedBy', 'fullName email')
      .populate('rejectedBy', 'fullName email')
      .sort({ createdAt: -1 });
    
    console.log('📊 [SECURITY] Found collections:', {
      userId: req.user.id,
      isAdmin: req.user.isAdmin,
      collectionsCount: documentCollections.length,
      firstFewIds: documentCollections.slice(0, 3).map(c => c._id)
    });
    
    res.status(200).json({
      success: true,
      data: documentCollections
    });
  } catch (error) {
    console.error('Error fetching document collections:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch document collections',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Request documents from candidate
router.post('/request', async (req, res) => {
  try {
    const { 
      candidateId, 
      assessmentSessionId, 
      documentTypes, 
      customMessage, 
      template,
      requestedBy,
      candidateName,
      candidateEmail
    } = req.body;
    
    // Validate required fields
    if (!candidateId || !assessmentSessionId || !documentTypes || !requestedBy) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: candidateId, assessmentSessionId, documentTypes, and requestedBy are required'
      });
    }
    
    // If template is a user-defined template ID, validate it
    let templateToUse = template;
    if (template && !['standard', 'formal', 'friendly'].includes(template)) {
      // This is likely a user-defined template ID
      try {
        const userTemplate = await getTemplateById(template, requestedBy);
        if (!userTemplate) {
          templateToUse = 'standard'; // Fallback to standard if template not found
        }
      } catch (error) {
        console.error('Error validating user template:', error);
        templateToUse = 'standard'; // Fallback to standard if validation fails
      }
    }
    
    // Get assessment session data to get candidate info
    const assessment = await AssessmentSession.findById(assessmentSessionId || candidateId)
      .populate('resumeId');
    
    // Use provided candidate name/email, fallback to assessment data
    const candidateNameToUse = candidateName || assessment?.resumeId?.name || assessment?.candidateEmail || 'Candidate';
    const candidateEmailToUse = candidateEmail || assessment?.candidateEmail || '';
    
    // Create document collection record
    const documentCollection = new DocumentCollection({
      candidateId,
      assessmentSessionId,
      requestedBy,
      documentTypes,
      customMessage,
      template: templateToUse,
      status: 'requested',
      candidateName: candidateNameToUse,
      candidateEmail: candidateEmailToUse
    });
    
    await documentCollection.save();
    
    // Send document collection email to candidate
    try {
      // Get user data for company info
      const user = await User.findById(requestedBy);
      
      // Send document collection email to candidate
      const { sendDocumentCollectionEmail } = require('../services/interviewService');
      
      await sendDocumentCollectionEmail({
        candidateName: candidateNameToUse,
        candidateEmail: candidateEmailToUse,
        companyName: user?.companyName || 'Your Company',
        documentTypes,
        customMessage,
        template: templateToUse,
        templateId: templateToUse !== 'standard' && templateToUse !== 'formal' && templateToUse !== 'friendly' ? templateToUse : undefined,
        userId: requestedBy,
        documentCollectionId: documentCollection._id
      });
      
      console.log(`Document collection email sent successfully to ${candidateEmailToUse}`);
    } catch (emailError) {
      console.error('Error sending document collection email:', emailError);
      // Don't fail the request if email sending fails - but log it
    }
    
    res.status(201).json({
      success: true,
      message: 'Document collection request created successfully',
      data: documentCollection
    });
  } catch (error) {
    console.error('Error requesting documents:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create document collection request',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Upload documents
router.post('/upload', upload.array('documents'), async (req, res) => {
  try {
    const { documentCollectionId, candidateName, candidateEmail } = req.body;
    const files = req.files;
    
    console.log('Upload request received:', { documentCollectionId, candidateName, candidateEmail, fileCount: files?.length });
    
    // Validate required fields
    if (!documentCollectionId) {
      return res.status(400).json({
        success: false,
        error: 'documentCollectionId is required'
      });
    }
    
    if (!files || files.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No documents uploaded'
      });
    }
    
    // Validate file sizes (10MB limit per file)
    const maxSize = 10 * 1024 * 1024; // 10MB
    for (const file of files) {
      if (file.size > maxSize) {
        return res.status(400).json({
          success: false,
          error: `File ${file.originalname} exceeds 10MB limit`
        });
      }
    }
    
    // Find document collection record
    const documentCollection = await DocumentCollection.findById(documentCollectionId);
    if (!documentCollection) {
      console.log('Document collection not found:', documentCollectionId);
      return res.status(404).json({
        success: false,
        error: 'Document collection record not found'
      });
    }
    
    console.log('Found document collection:', documentCollection._id);
    
    // Check if collection is already uploaded
    if (documentCollection.status === 'uploaded' || documentCollection.status === 'verified') {
      return res.status(400).json({
        success: false,
        error: 'Documents have already been uploaded for this collection'
      });
    }
    
    // Update candidate name and email if provided
    if (candidateName) {
      documentCollection.candidateName = candidateName;
    }
    if (candidateEmail) {
      documentCollection.candidateEmail = candidateEmail;
    }
    
    // Import the uploadToS3 function directly
    const interviewService = require('../services/interviewService');
    
    // Upload documents to S3 and update record
    const uploadedDocuments = [];
    
    // Group files by document type for better organization
    const fileGroups = {};
    files.forEach((file, index) => {
      const documentType = documentCollection.documentTypes[index % documentCollection.documentTypes.length];
      if (!fileGroups[documentType]) {
        fileGroups[documentType] = [];
      }
      fileGroups[documentType].push(file);
    });
    
    for (const [documentType, typeFiles] of Object.entries(fileGroups)) {
      for (const file of typeFiles) {
        // Enhanced folder structure for better organization
        const fileExtension = file.originalname.split('.').pop();
        const timestamp = Date.now();
        const candidateIdentifier = documentCollection.candidateName || documentCollection.candidateEmail || documentCollectionId;
        const safeCandidateName = candidateIdentifier.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50); // Limit length
        const safeDocumentType = documentType.replace(/[^a-zA-Z0-9]/g, '_');
        const formattedDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
        
        // Organized folder structure: candidate-documents/DATE/CANDIDATE_NAME/DOCUMENT_TYPE/
        const s3Key = `candidate-documents/${formattedDate}/${safeCandidateName}/${safeDocumentType}/${timestamp}_${file.originalname}`;
        
        console.log('Uploading file with enhanced structure:', { 
          fileName: file.originalname, 
          s3Key, 
          documentType: safeDocumentType,
          candidateName: safeCandidateName,
          date: formattedDate
        });
        
        // Upload to S3
        try {
          await interviewService.uploadToS3(file.buffer, s3Key, file.mimetype);
        } catch (uploadError) {
          console.error('Error uploading to S3:', uploadError);
          return res.status(500).json({
            success: false,
            error: 'Failed to upload document to storage',
            details: process.env.NODE_ENV === 'development' ? uploadError.message : undefined
          });
        }
        
        const documentRecord = {
          name: file.originalname,
          s3Key: s3Key,
          type: file.mimetype,
          size: file.size,
          uploadedAt: new Date()
        };
        
        console.log('Adding document record:', documentRecord);
        uploadedDocuments.push(documentRecord);
      }
    }
    
    console.log('Prepared uploaded documents:', JSON.stringify(uploadedDocuments, null, 2));
    
    // Update document collection record
    try {
      // Make sure we're assigning the array correctly
      documentCollection.documents = uploadedDocuments;
      documentCollection.status = 'uploaded';
      documentCollection.uploadedAt = new Date();
      
      console.log('Saving document collection with documents array');
      await documentCollection.save();
      console.log('Document collection saved successfully');
    } catch (saveError) {
      console.error('Error saving document collection:', saveError);
      console.error('Document collection object:', JSON.stringify(documentCollection, null, 2));
      console.error('Uploaded documents:', JSON.stringify(uploadedDocuments, null, 2));
      throw saveError;
    }
    
    res.status(200).json({
      success: true,
      message: 'Documents uploaded successfully',
      data: {
        documentCollectionId,
        documents: uploadedDocuments
      }
    });
  } catch (error) {
    console.error('Error uploading documents:', error);
    console.error('Error stack:', error.stack);
    
    // Log the full error object for debugging
    if (process.env.NODE_ENV === 'development') {
      console.error('Full error object:', error);
    }
    
    res.status(500).json({
      success: false,
      error: 'Failed to upload documents',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get document collection status (with ownership verification)
router.get('/:documentCollectionId', verifyDocumentCollectionOwnership, async (req, res) => {
  try {
    const { documentCollectionId } = req.params;
    
    console.log('🔍 [BACKEND DEBUG] Document collection GET request received:', {
      documentCollectionId,
      userId: req.user.id,
      timestamp: new Date().toISOString(),
      requestHeaders: req.headers,
      queryParams: req.query
    });
    
    // Use pre-verified collection from middleware
    const documentCollection = req.documentCollection;
    
    console.log('📊 [BACKEND DEBUG] Document collection lookup result:', {
      found: !!documentCollection,
      id: documentCollection?._id,
      status: documentCollection?.status,
      candidateId: documentCollection?.candidateId,
      assessmentSessionId: documentCollection?.assessmentSessionId,
      candidateName: documentCollection?.candidateName,
      candidateEmail: documentCollection?.candidateEmail,
      documentsCount: documentCollection?.documents?.length || 0,
      verifiedAt: documentCollection?.verifiedAt,
      verifiedBy: documentCollection?.verifiedBy,
      rejectedAt: documentCollection?.rejectedAt,
      rejectedBy: documentCollection?.rejectedBy,
      uploadedAt: documentCollection?.uploadedAt,
      requestedAt: documentCollection?.requestedAt,
      ownedBy: documentCollection?.requestedBy,
      accessedBy: req.user.id
    });
      
    // No need to check if collection exists - middleware already verified it
    
    const responseData = {
      success: true,
      data: documentCollection
    };
    
    console.log('📤 [BACKEND DEBUG] Sending document collection response:', {
      success: responseData.success,
      dataId: responseData.data._id,
      dataStatus: responseData.data.status,
      candidateInfo: {
        candidateId: responseData.data.candidateId,
        candidateName: responseData.data.candidateName,
        candidateEmail: responseData.data.candidateEmail
      },
      documentsCount: responseData.data.documents?.length || 0,
      timestamp: new Date().toISOString()
    });
    
    res.status(200).json(responseData);
    
  } catch (error) {
    console.error('❌ [BACKEND DEBUG] Error fetching document collection:', {
      error: error.message,
      stack: error.stack,
      documentCollectionId: req.params.documentCollectionId,
      timestamp: new Date().toISOString()
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to fetch document collection',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// 🔒 SECURED: Unified document access endpoint with ownership verification
router.get('/:documentCollectionId/documents/:documentIndex', verifyDocumentCollectionOwnership, async (req, res) => {
  try {
    const { documentCollectionId, documentIndex } = req.params;
    const { view, bulk } = req.query;
    
    console.log('🔍 [DOCUMENT ACCESS] Request received:', {
      documentCollectionId,
      documentIndex,
      view: view === 'true',
      bulk: bulk === 'true',
      timestamp: new Date().toISOString()
    });
    
    // Use pre-verified collection from middleware
    const documentCollection = req.documentCollection;
    
    console.log('📊 [DOCUMENT ACCESS] Found collection:', {
      id: documentCollection._id,
      status: documentCollection.status,
      documentsCount: documentCollection.documents.length,
      candidateName: documentCollection.candidateName
    });
    
    // Handle bulk URL generation for all documents
    if (bulk === 'true') {
      try {
        const mode = view === 'true' ? 'view' : 'download';
        const bulkResult = await documentFileService.generateBulkUrls(documentCollection.documents, mode);
        
        console.log('📦 [DOCUMENT ACCESS] Bulk URLs generated:', bulkResult.summary);
        
        return res.json({
          success: true,
          mode,
          documentCollectionId,
          ...bulkResult
        });
      } catch (error) {
        console.error('❌ [DOCUMENT ACCESS] Bulk URL generation failed:', error);
        return res.status(500).json({
          success: false,
          error: 'Failed to generate bulk document URLs',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
      }
    }
    
    // Handle single document access
    const documentIndexNum = parseInt(documentIndex);
    if (isNaN(documentIndexNum) || documentIndexNum < 0 || documentIndexNum >= documentCollection.documents.length) {
      console.log('❌ [DOCUMENT ACCESS] Invalid document index:', {
        provided: documentIndex,
        parsed: documentIndexNum,
        available: documentCollection.documents.length
      });
      return res.status(400).json({
        success: false,
        error: 'Invalid document index',
        details: {
          provided: documentIndex,
          availableRange: `0-${documentCollection.documents.length - 1}`
        }
      });
    }
    
    const document = documentCollection.documents[documentIndexNum];
    console.log('📄 [DOCUMENT ACCESS] Accessing document:', {
      index: documentIndexNum,
      name: document.name,
      s3Key: document.s3Key,
      type: document.type,
      size: document.size,
      mode: view === 'true' ? 'view' : 'download'
    });
    
    try {
      let result;
      
      if (view === 'true') {
        // Generate enhanced view URL with fallback strategies
        result = await documentFileService.generateEnhancedViewUrl(
          document.s3Key,
          document.name,
          document.type
        );
        
        console.log('✅ [DOCUMENT ACCESS] Enhanced view URL generated:', {
          primaryUrl: result.primaryUrl ? 'Generated' : 'Failed',
          fallbackUrl: result.fallbackUrl ? 'Available' : 'None',
          strategy: result.preferredStrategy,
          mimeType: result.mimeType
        });
      } else {
        // Generate signed URL for downloading
        result = await documentFileService.generateDownloadUrl(
          document.s3Key,
          document.name
        );
      }
      
      console.log('✅ [DOCUMENT ACCESS] URL generated successfully:', {
        mode: result.mode || 'unknown',
        filename: result.filename || document.name,
        expiresIn: result.expiresIn,
        hasStrategies: !!result.strategies,
        preferredStrategy: result.preferredStrategy
      });
      
      // Enhanced response with fallback strategies
      const responseData = {
        success: true,
        documentCollectionId,
        documentIndex: documentIndexNum,
        document: {
          name: document.name,
          type: document.type,
          size: document.size,
          uploadedAt: document.uploadedAt
        },
        // Primary response data
        url: result.primaryUrl || result.url,
        mode: result.mode || (view === 'true' ? 'view' : 'download'),
        filename: result.filename || document.name,
        expiresIn: result.expiresIn
      };
      
      // Add enhanced viewing data if available
      if (result.fallbackUrl) {
        responseData.fallbackUrl = result.fallbackUrl;
      }
      if (result.preferredStrategy) {
        responseData.preferredStrategy = result.preferredStrategy;
      }
      if (result.strategies) {
        responseData.strategies = result.strategies;
      }
      if (result.mimeType) {
        responseData.mimeType = result.mimeType;
      }
      
      return res.json(responseData);
      
    } catch (fileError) {
      console.error('❌ [DOCUMENT ACCESS] File service error:', {
        error: fileError.message,
        document: {
          name: document.name,
          s3Key: document.s3Key
        }
      });
      
      // Enhanced error handling based on error type
      let statusCode = 500;
      let errorMessage = 'Failed to access document';
      
      if (fileError.message.includes('NoSuchKey')) {
        statusCode = 404;
        errorMessage = 'Document file not found in storage';
      } else if (fileError.message.includes('AccessDenied')) {
        statusCode = 403;
        errorMessage = 'Access denied to document';
      }
      
      return res.status(statusCode).json({
        success: false,
        error: errorMessage,
        documentInfo: {
          name: document.name,
          uploadedAt: document.uploadedAt
        },
        details: process.env.NODE_ENV === 'development' ? fileError.message : undefined
      });
    }
    
  } catch (error) {
    console.error('❌ [DOCUMENT ACCESS] Unexpected error:', {
      error: error.message,
      stack: error.stack,
      params: req.params,
      query: req.query
    });
    
    return res.status(500).json({
      success: false,
      error: 'Internal server error accessing document',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// 🔒 SECURED: Verify documents (with ownership verification)
router.put('/:documentCollectionId/verify', verifyDocumentCollectionOwnership, async (req, res) => {
  try {
    const { documentCollectionId } = req.params;
    const { verifiedBy, verificationNotes } = req.body;
    
    console.log('🔍 [BACKEND DEBUG] Document verification request received:', {
      documentCollectionId,
      verifiedBy,
      verificationNotes: verificationNotes ? '✅ provided' : '❌ empty',
      userId: req.user.id,
      timestamp: new Date().toISOString(),
      requestHeaders: req.headers
    });
    
    // Use pre-verified collection from middleware
    const documentCollection = req.documentCollection;
    
    console.log('📋 [BACKEND DEBUG] Document collection lookup result:', {
      found: !!documentCollection,
      currentStatus: documentCollection?.status,
      candidateId: documentCollection?.candidateId,
      assessmentSessionId: documentCollection?.assessmentSessionId,
      documentsCount: documentCollection?.documents?.length || 0,
      candidateName: documentCollection?.candidateName,
      candidateEmail: documentCollection?.candidateEmail,
      ownedBy: documentCollection?.requestedBy,
      accessedBy: req.user.id
    });
    
    // No need to check existence - middleware already verified
    
    const previousStatus = documentCollection.status;
    
    // Update verification status
    documentCollection.status = 'verified';
    documentCollection.verifiedAt = new Date();
    documentCollection.verifiedBy = verifiedBy;
    documentCollection.verificationNotes = verificationNotes;
    
    console.log('💾 [BACKEND DEBUG] Saving verification updates:', {
      previousStatus,
      newStatus: 'verified',
      verifiedAt: documentCollection.verifiedAt,
      verifiedBy,
      documentCollectionId
    });
    
    const savedCollection = await documentCollection.save();
    
    console.log('✅ [BACKEND DEBUG] Document verification saved successfully:', {
      id: savedCollection._id,
      status: savedCollection.status,
      verifiedAt: savedCollection.verifiedAt,
      verifiedBy: savedCollection.verifiedBy,
      candidateInfo: {
        candidateId: savedCollection.candidateId,
        candidateName: savedCollection.candidateName,
        candidateEmail: savedCollection.candidateEmail
      },
      documentsCount: savedCollection.documents?.length || 0
    });
    
    const responseData = {
      success: true,
      message: 'Documents verified successfully',
      data: savedCollection
    };
    
    console.log('📤 [BACKEND DEBUG] Sending verification response:', {
      success: responseData.success,
      message: responseData.message,
      dataStatus: responseData.data.status,
      dataId: responseData.data._id,
      timestamp: new Date().toISOString()
    });
    
    res.status(200).json(responseData);
    
  } catch (error) {
    console.error('❌ [BACKEND DEBUG] Error verifying documents:', {
      error: error.message,
      stack: error.stack,
      documentCollectionId: req.params.documentCollectionId,
      requestBody: req.body,
      timestamp: new Date().toISOString()
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to verify documents',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// 🔒 SECURED: Reject documents (with ownership verification)
router.put('/:documentCollectionId/reject', verifyDocumentCollectionOwnership, async (req, res) => {
  try {
    const { documentCollectionId } = req.params;
    const { rejectedBy, rejectionReason } = req.body;
    
    console.log('🚫 [BACKEND DEBUG] Document rejection request received:', {
      documentCollectionId,
      rejectedBy,
      rejectionReason: rejectionReason ? '✅ provided' : '❌ empty',
      userId: req.user.id,
      timestamp: new Date().toISOString(),
      requestHeaders: req.headers
    });
    
    // Use pre-verified collection from middleware
    const documentCollection = req.documentCollection;
    
    console.log('📋 [BACKEND DEBUG] Document collection lookup for rejection:', {
      found: !!documentCollection,
      currentStatus: documentCollection?.status,
      candidateId: documentCollection?.candidateId,
      assessmentSessionId: documentCollection?.assessmentSessionId,
      documentsCount: documentCollection?.documents?.length || 0,
      candidateName: documentCollection?.candidateName,
      candidateEmail: documentCollection?.candidateEmail,
      ownedBy: documentCollection?.requestedBy,
      accessedBy: req.user.id
    });
    
    // No need to check existence - middleware already verified
    
    const previousStatus = documentCollection.status;
    
    // Update rejection status
    documentCollection.status = 'rejected';
    documentCollection.rejectedAt = new Date();
    documentCollection.rejectedBy = rejectedBy;
    documentCollection.rejectionReason = rejectionReason;
    
    console.log('💾 [BACKEND DEBUG] Saving rejection updates:', {
      previousStatus,
      newStatus: 'rejected',
      rejectedAt: documentCollection.rejectedAt,
      rejectedBy,
      rejectionReason,
      documentCollectionId
    });
    
    const savedCollection = await documentCollection.save();
    
    console.log('✅ [BACKEND DEBUG] Document rejection saved successfully:', {
      id: savedCollection._id,
      status: savedCollection.status,
      rejectedAt: savedCollection.rejectedAt,
      rejectedBy: savedCollection.rejectedBy,
      rejectionReason: savedCollection.rejectionReason,
      candidateInfo: {
        candidateId: savedCollection.candidateId,
        candidateName: savedCollection.candidateName,
        candidateEmail: savedCollection.candidateEmail
      },
      documentsCount: savedCollection.documents?.length || 0
    });
    
    const responseData = {
      success: true,
      message: 'Documents rejected successfully',
      data: savedCollection
    };
    
    console.log('📤 [BACKEND DEBUG] Sending rejection response:', {
      success: responseData.success,
      message: responseData.message,
      dataStatus: responseData.data.status,
      dataId: responseData.data._id,
      timestamp: new Date().toISOString()
    });
    
    res.status(200).json(responseData);
    
  } catch (error) {
    console.error('❌ [BACKEND DEBUG] Error rejecting documents:', {
      error: error.message,
      stack: error.stack,
      documentCollectionId: req.params.documentCollectionId,
      requestBody: req.body,
      timestamp: new Date().toISOString()
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to reject documents',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Template Management Routes

// 🔒 SECURED: Get all templates for current user (already secured by requiring req.user.id)
router.get('/templates', async (req, res) => {
  try {
    console.log('🔍 [TEMPLATES] Fetching templates for user:', req.user.id);
    
    const templates = await getUserTemplates(req.user.id);
    
    console.log('📊 [TEMPLATES] Found templates:', {
      userId: req.user.id,
      templatesCount: templates.length
    });
    
    res.status(200).json({
      success: true,
      data: templates
    });
  } catch (error) {
    console.error('Error fetching templates:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch templates',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// 🔒 SECURED: Create a new template (user-scoped)
router.post('/templates', async (req, res) => {
  try {
    const templateData = req.body;
    
    console.log('🔍 [TEMPLATES] Creating template for user:', {
      userId: req.user.id,
      templateName: templateData.name
    });
    
    const template = await createTemplate(templateData, req.user.id);
    
    console.log('✅ [TEMPLATES] Template created:', {
      templateId: template._id,
      userId: req.user.id
    });
    
    res.status(201).json({
      success: true,
      message: 'Template created successfully',
      data: template
    });
  } catch (error) {
    console.error('Error creating template:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create template',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Update a template
router.put('/templates/:templateId', async (req, res) => {
  try {
    const { templateId } = req.params;
    const templateData = req.body;
    const template = await updateTemplate(templateId, templateData, req.user.id);
    
    if (!template) {
      return res.status(404).json({
        success: false,
        error: 'Template not found'
      });
    }
    
    res.status(200).json({
      success: true,
      message: 'Template updated successfully',
      data: template
    });
  } catch (error) {
    console.error('Error updating template:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update template',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Delete a template
router.delete('/templates/:templateId', async (req, res) => {
  try {
    const { templateId } = req.params;
    const result = await deleteTemplate(templateId, req.user.id);
    
    if (!result) {
      return res.status(404).json({
        success: false,
        error: 'Template not found'
      });
    }
    
    res.status(200).json({
      success: true,
      message: 'Template deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting template:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete template',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// 🔒 SECURED: Document collection verification endpoint (with ownership verification)
router.get('/:documentCollectionId/verify-files', verifyDocumentCollectionOwnership, async (req, res) => {
  try {
    const { documentCollectionId } = req.params;
    
    console.log('🔍 [FILE VERIFICATION] Starting verification for collection:', {
      documentCollectionId,
      userId: req.user.id
    });
    
    const verificationResult = await documentFileService.verifyDocumentCollection(documentCollectionId);
    
    console.log('📊 [FILE VERIFICATION] Verification complete:', verificationResult.summary);
    
    return res.json({
      success: true,
      verification: verificationResult,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ [FILE VERIFICATION] Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to verify document files',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// 🔒 SECURED: Bulk document URL generation (with ownership verification)
router.get('/:documentCollectionId/bulk-urls', verifyDocumentCollectionOwnership, async (req, res) => {
  try {
    const { documentCollectionId } = req.params;
    const { mode = 'view' } = req.query; // 'view' or 'download'
    
    console.log('📦 [BULK URLS] Generating bulk URLs:', { 
      documentCollectionId, 
      mode,
      userId: req.user.id
    });
    
    // Use pre-verified collection from middleware
    const documentCollection = req.documentCollection;
    
    const bulkResult = await documentFileService.generateBulkUrls(documentCollection.documents, mode);
    
    console.log('📊 [BULK URLS] Generated:', bulkResult.summary);
    
    return res.json({
      success: true,
      documentCollectionId,
      candidateName: documentCollection.candidateName,
      ...bulkResult,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ [BULK URLS] Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to generate bulk document URLs',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;