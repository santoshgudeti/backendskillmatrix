const Letterhead = require('../models/Letterhead');
const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const multer = require('multer');
const path = require('path');

/**
 * Letterhead Service
 * Handles uploading, storing, and retrieving company letterheads for offer letter generation
 */
class LetterheadService {
  constructor() {
    // Initialize S3 client only when needed, not during construction
    this.bucketName = null;
    this.s3Client = null;
    this.upload = null;
  }
  
  /**
   * Initialize the S3 client with environment variables
   * This ensures env vars are loaded before creating the client
   */
  initialize() {
    if (this.s3Client) return; // Already initialized
    
    // Check if required environment variables are present
    if (!process.env.MINIO_ENDPOINT) {
      throw new Error('MINIO_ENDPOINT is not defined in environment variables');
    }
    
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
    
    // Configure multer for letterhead uploads
    this.upload = multer({
      storage: multer.memoryStorage(),
      limits: {
        fileSize: 2 * 1024 * 1024 // 2MB limit
      },
      fileFilter: (req, file, cb) => {
        // Only allow PDF files
        if (file.mimetype === 'application/pdf') {
          cb(null, true);
        } else {
          cb(new Error('Only PDF files are allowed'));
        }
      }
    });
  }

  /**
   * Upload letterhead to S3 and save metadata to database
   * @param {Object} file - Multer file object
   * @param {string} companyId - Company ID
   * @returns {Promise<Object>} - Letterhead document
   */
  async uploadLetterhead(file, companyId) {
    try {
      // Initialize S3 client if not already done
      this.initialize();
      
      console.log('📤 [LETTERHEAD] Uploading letterhead:', { 
        originalName: file.originalname, 
        size: file.size, 
        companyId 
      });

      // Validate inputs
      if (!file) {
        throw new Error('No file provided');
      }

      if (!companyId) {
        throw new Error('Company ID is required');
      }

      // Validate file size (2MB limit)
      if (file.size > 2 * 1024 * 1024) {
        throw new Error('File size exceeds 2MB limit');
      }

      // Validate file type
      if (file.mimetype !== 'application/pdf') {
        throw new Error('Only PDF files are allowed');
      }

      // Validate file content (basic PDF header check)
      if (!file.buffer || file.buffer.length < 4) {
        throw new Error('Invalid file content');
      }

      // Check PDF header
      const header = file.buffer.subarray(0, 4).toString();
      if (header !== '%PDF') {
        throw new Error('File is not a valid PDF');
      }

      // Generate S3 key following the required structure:
      // skillmatrix/letterheads/{company_id}/letterhead.pdf
      const timestamp = Date.now();
      const fileName = `letterhead_${timestamp}_${file.originalname.replace(/\s+/g, '_')}`;
      const s3Key = `letterheads/${companyId}/${fileName}`;

      // Upload to S3
      const uploadParams = {
        Bucket: this.bucketName,
        Key: s3Key,
        Body: file.buffer,
        ContentType: file.mimetype,
        Metadata: {
          companyId: companyId,
          originalName: file.originalname,
          uploadedAt: new Date().toISOString()
        }
      };

      const command = new PutObjectCommand(uploadParams);
      await this.s3Client.send(command);

      // Deactivate any existing letterhead for this company
      await Letterhead.updateMany(
        { companyId: companyId, isActive: true },
        { isActive: false }
      );

      // Save letterhead metadata to database
      const letterhead = new Letterhead({
        companyId,
        fileName,
        originalName: file.originalname,
        s3Key,
        fileSize: file.size
      });

      await letterhead.save();

      console.log('✅ [LETTERHEAD] Letterhead uploaded successfully:', { 
        letterheadId: letterhead._id,
        s3Key 
      });

      return {
        ...letterhead.toObject(),
        id: letterhead._id
      };
    } catch (error) {
      console.error('❌ [LETTERHEAD] Error uploading letterhead:', error);
      throw new Error(`Failed to upload letterhead: ${error.message}`);
    }
  }

  /**
   * Get active letterhead for a company
   * @param {string} companyId - Company ID
   * @returns {Promise<Object|null>} - Active letterhead or null
   */
  async getActiveLetterhead(companyId) {
    try {
      // Initialize S3 client if not already done
      this.initialize();
      
      console.log('🔍 [LETTERHEAD] Looking for active letterhead for company:', companyId);
      
      const letterhead = await Letterhead.findOne({
        companyId,
        isActive: true
      }).sort({ uploadedAt: -1 });
      
      console.log('📊 [LETTERHEAD] Letterhead lookup result:', { 
        found: !!letterhead,
        letterheadId: letterhead?._id,
        s3Key: letterhead?.s3Key,
        companyId: letterhead?.companyId
      });

      return letterhead;
    } catch (error) {
      console.error('❌ [LETTERHEAD] Error getting active letterhead:', error);
      throw new Error(`Failed to get active letterhead: ${error.message}`);
    }
  }

  /**
   * Generate signed URL for letterhead preview
   * @param {string} s3Key - S3 key of the letterhead
   * @returns {Promise<string>} - Signed URL
   */
  async generatePreviewUrl(s3Key) {
    try {
      // Initialize S3 client if not already done
      this.initialize();
      
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key,
        ResponseContentDisposition: 'inline',
        ResponseContentType: 'application/pdf'
      });

      const signedUrl = await getSignedUrl(this.s3Client, command, { expiresIn: 3600 });
      return signedUrl;
    } catch (error) {
      console.error('❌ [LETTERHEAD] Error generating preview URL:', error);
      throw new Error(`Failed to generate preview URL: ${error.message}`);
    }
  }

  /**
   * Get multer upload middleware
   * @returns {Function} - Multer upload middleware
   */
  getUploadMiddleware() {
    // Initialize S3 client if not already done
    this.initialize();
    
    return this.upload.single('letterhead');
  }

  /**
   * Delete old letterheads to prevent storage buildup
   * @param {string} companyId - Company ID
   * @param {number} daysOld - Delete letterheads older than this many days
   * @returns {Promise<Object>} - Deletion result
   */
  async cleanupOldLetterheads(companyId, daysOld = 30) {
    try {
      // Initialize S3 client if not already done
      this.initialize();
      
      console.log(`🧹 [LETTERHEAD] Cleaning up letterheads older than ${daysOld} days for company:`, companyId);
      
      const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
      
      // Find old letterheads
      const oldLetterheads = await Letterhead.find({
        companyId: companyId,
        uploadedAt: { $lt: cutoffDate }
      });
      
      if (oldLetterheads.length === 0) {
        console.log('🧹 [LETTERHEAD] No old letterheads to clean up');
        return { deleted: 0 };
      }
      
      // Delete from S3
      for (const letterhead of oldLetterheads) {
        try {
          const command = new DeleteObjectCommand({
            Bucket: this.bucketName,
            Key: letterhead.s3Key
          });
          await this.s3Client.send(command);
          console.log('🗑️ [LETTERHEAD] Deleted letterhead from S3:', letterhead.s3Key);
        } catch (s3Error) {
          console.error('❌ [LETTERHEAD] Error deleting letterhead from S3:', s3Error);
        }
      }
      
      // Delete from database
      const result = await Letterhead.deleteMany({
        companyId: companyId,
        uploadedAt: { $lt: cutoffDate }
      });
      
      console.log('✅ [LETTERHEAD] Cleanup completed:', { 
        deleted: result.deletedCount,
        cutoffDate 
      });
      
      return { deleted: result.deletedCount };
    } catch (error) {
      console.error('❌ [LETTERHEAD] Error cleaning up old letterheads:', error);
      throw new Error(`Failed to cleanup old letterheads: ${error.message}`);
    }
  }
}

module.exports = new LetterheadService();