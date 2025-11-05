const { S3Client, GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const DocumentCollection = require('../models/DocumentCollection');

/**
 * Unified Document File Service
 * Handles all file operations for document collections with proper error handling
 */
class DocumentFileService {
  constructor() {
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
   * Generate a signed URL for file viewing (inline display)
   */
  async generateViewUrl(s3Key, filename, mimeType) {
    try {
      console.log('🔗 [FILE SERVICE] Generating view URL:', { s3Key, filename, mimeType });
      
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key,
        ResponseContentDisposition: `inline; filename="${encodeURIComponent(filename)}"`,
        ResponseContentType: mimeType || 'application/octet-stream',
        ResponseCacheControl: 'no-cache, no-store, must-revalidate',
        ResponseExpires: new Date(Date.now() + 3600000) // 1 hour
      });
      
      const signedUrl = await getSignedUrl(this.s3Client, command, { expiresIn: 3600 });
      
      console.log('✅ [FILE SERVICE] View URL generated successfully');
      return {
        success: true,
        url: signedUrl,
        mode: 'view',
        filename,
        expiresIn: 3600
      };
    } catch (error) {
      console.error('❌ [FILE SERVICE] Error generating view URL:', error);
      throw new Error(`Failed to generate view URL: ${error.message}`);
    }
  }

  /**
   * Generate a signed URL for file downloading
   */
  async generateDownloadUrl(s3Key, filename) {
    try {
      console.log('📥 [FILE SERVICE] Generating download URL:', { s3Key, filename });
      
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key,
        ResponseContentDisposition: `attachment; filename="${encodeURIComponent(filename)}"`,
        ResponseCacheControl: 'no-cache'
      });
      
      const signedUrl = await getSignedUrl(this.s3Client, command, { expiresIn: 1800 }); // 30 minutes
      
      console.log('✅ [FILE SERVICE] Download URL generated successfully');
      return {
        success: true,
        url: signedUrl,
        mode: 'download',
        filename,
        expiresIn: 1800
      };
    } catch (error) {
      console.error('❌ [FILE SERVICE] Error generating download URL:', error);
      throw new Error(`Failed to generate download URL: ${error.message}`);
    }
  }

  /**
   * Get file metadata from MinIO (verify file exists)
   */
  async getFileMetadata(s3Key) {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key
      });
      
      // Just get metadata without downloading content
      const response = await this.s3Client.send(command);
      
      return {
        exists: true,
        size: response.ContentLength,
        lastModified: response.LastModified,
        contentType: response.ContentType,
        etag: response.ETag
      };
    } catch (error) {
      if (error.name === 'NoSuchKey') {
        return { exists: false };
      }
      throw error;
    }
  }

  /**
   * Verify all documents in a collection exist in MinIO
   */
  async verifyDocumentCollection(documentCollectionId) {
    try {
      console.log('🔍 [FILE SERVICE] Verifying document collection:', documentCollectionId);
      
      const collection = await DocumentCollection.findById(documentCollectionId);
      if (!collection) {
        throw new Error('Document collection not found');
      }

      const verificationResults = [];
      
      for (const doc of collection.documents) {
        try {
          const metadata = await this.getFileMetadata(doc.s3Key);
          verificationResults.push({
            name: doc.name,
            s3Key: doc.s3Key,
            exists: metadata.exists,
            size: metadata.size || doc.size,
            contentType: metadata.contentType || doc.type,
            databaseSize: doc.size,
            actualSize: metadata.size,
            sizeMatch: doc.size === metadata.size
          });
        } catch (error) {
          verificationResults.push({
            name: doc.name,
            s3Key: doc.s3Key,
            exists: false,
            error: error.message
          });
        }
      }

      const allExist = verificationResults.every(result => result.exists);
      
      console.log('📊 [FILE SERVICE] Verification complete:', {
        total: verificationResults.length,
        existing: verificationResults.filter(r => r.exists).length,
        missing: verificationResults.filter(r => !r.exists).length,
        allExist
      });

      return {
        collectionId: documentCollectionId,
        allExist,
        details: verificationResults,
        summary: {
          total: verificationResults.length,
          existing: verificationResults.filter(r => r.exists).length,
          missing: verificationResults.filter(r => !r.exists).length
        }
      };
    } catch (error) {
      console.error('❌ [FILE SERVICE] Error verifying document collection:', error);
      throw error;
    }
  }

  /**
   * Generate multiple file URLs at once (bulk operation)
   */
  async generateBulkUrls(documents, mode = 'view') {
    try {
      console.log('📦 [FILE SERVICE] Generating bulk URLs:', { count: documents.length, mode });
      
      const results = await Promise.allSettled(
        documents.map(async (doc, index) => {
          try {
            const result = mode === 'download' 
              ? await this.generateDownloadUrl(doc.s3Key, doc.name)
              : await this.generateViewUrl(doc.s3Key, doc.name, doc.type);
            
            return {
              index,
              name: doc.name,
              s3Key: doc.s3Key,
              ...result
            };
          } catch (error) {
            return {
              index,
              name: doc.name,
              s3Key: doc.s3Key,
              success: false,
              error: error.message
            };
          }
        })
      );

      const successful = results.filter(r => r.status === 'fulfilled' && r.value.success);
      const failed = results.filter(r => r.status === 'rejected' || !r.value.success);

      console.log('📊 [FILE SERVICE] Bulk URL generation complete:', {
        total: documents.length,
        successful: successful.length,
        failed: failed.length
      });

      return {
        success: true,
        mode,
        results: results.map(r => r.status === 'fulfilled' ? r.value : { success: false, error: r.reason }),
        summary: {
          total: documents.length,
          successful: successful.length,
          failed: failed.length
        }
      };
    } catch (error) {
      console.error('❌ [FILE SERVICE] Error in bulk URL generation:', error);
      throw error;
    }
  }

  /**
   * List all files in a candidate's document folder
   */
  async listCandidateDocuments(candidateName, date = null) {
    try {
      const datePrefix = date || new Date().toISOString().split('T')[0];
      const safeCandidateName = candidateName.replace(/[^a-zA-Z0-9]/g, '_');
      const prefix = `candidate-documents/${datePrefix}/${safeCandidateName}/`;
      
      console.log('📁 [FILE SERVICE] Listing candidate documents:', { candidateName, prefix });
      
      const command = new ListObjectsV2Command({
        Bucket: this.bucketName,
        Prefix: prefix
      });
      
      const response = await this.s3Client.send(command);
      
      const files = (response.Contents || []).map(obj => ({
        key: obj.Key,
        size: obj.Size,
        lastModified: obj.LastModified,
        documentType: this.extractDocumentType(obj.Key),
        filename: this.extractFilename(obj.Key)
      }));

      console.log('📊 [FILE SERVICE] Listed files:', { count: files.length, prefix });
      
      return {
        success: true,
        prefix,
        files,
        count: files.length
      };
    } catch (error) {
      console.error('❌ [FILE SERVICE] Error listing candidate documents:', error);
      throw error;
    }
  }

  /**
   * Generate a direct MinIO browser URL as fallback for viewing
   * This works better for certain file types and browsers
   */
  generateDirectMinioUrl(s3Key, filename) {
    try {
      // Use the direct MinIO endpoint for browser access
      const minioEndpoint = process.env.MINIO_ENDPOINT?.replace(/^https?:\/\//, '');
      const bucketName = this.bucketName;
      
      if (minioEndpoint && bucketName) {
        // Construct direct MinIO browser URL
        const protocol = process.env.MINIO_SECURE === 'true' ? 'https' : 'http';
        const directUrl = `${protocol}://${minioEndpoint}/browser/${bucketName}/${encodeURIComponent(s3Key)}`;
        
        console.log('🔗 [FILE SERVICE] Generated direct MinIO URL:', {
          s3Key,
          directUrl,
          protocol,
          endpoint: minioEndpoint
        });
        
        return directUrl;
      }
      
      return null;
    } catch (error) {
      console.error('❌ [FILE SERVICE] Error generating direct MinIO URL:', error);
      return null;
    }
  }

  /**
   * Enhanced file viewing strategy with multiple fallbacks
   */
  async generateEnhancedViewUrl(s3Key, filename, mimeType) {
    try {
      console.log('🔗 [FILE SERVICE] Generating enhanced view URL:', { s3Key, filename, mimeType });
      
      // Detect proper MIME type
      const detectedMimeType = this.detectMimeType(filename) || mimeType || 'application/octet-stream';
      
      // Strategy 1: Signed URL with enhanced headers
      const signedUrlResult = await this.generateViewUrl(s3Key, filename, detectedMimeType);
      
      // Strategy 2: Direct MinIO URL as fallback
      const directUrl = this.generateDirectMinioUrl(s3Key, filename);
      
      // Strategy 3: Determine best strategy based on file type
      const preferredStrategy = this.determineViewingStrategy(filename, detectedMimeType);
      
      return {
        success: true,
        primaryUrl: signedUrlResult.url,
        fallbackUrl: directUrl,
        preferredStrategy,
        mimeType: detectedMimeType,
        filename,
        mode: 'view',
        strategies: {
          signedUrl: signedUrlResult.url,
          directMinIO: directUrl,
          recommended: preferredStrategy
        }
      };
    } catch (error) {
      console.error('❌ [FILE SERVICE] Error generating enhanced view URL:', error);
      throw error;
    }
  }

  /**
   * Determine the best viewing strategy based on file type
   */
  determineViewingStrategy(filename, mimeType) {
    const ext = filename.toLowerCase().split('.').pop();
    
    // PDF files generally work better with signed URLs
    if (ext === 'pdf' || mimeType === 'application/pdf') {
      return 'signed-url';
    }
    
    // Office documents often work better with direct MinIO URLs
    if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext)) {
      return 'direct-minio';
    }
    
    // Images work well with both, prefer signed URL
    if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'].includes(ext)) {
      return 'signed-url';
    }
    
    // Default to signed URL with fallback
    return 'signed-url-with-fallback';
  }

  /**
   * Enhanced MIME type detection based on file extension
   */
  detectMimeType(filename) {
    const ext = filename.toLowerCase().split('.').pop();
    const mimeTypes = {
      // Documents
      'pdf': 'application/pdf',
      'doc': 'application/msword',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'xls': 'application/vnd.ms-excel',
      'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'ppt': 'application/vnd.ms-powerpoint',
      'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'txt': 'text/plain',
      'rtf': 'application/rtf',
      
      // Images
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'bmp': 'image/bmp',
      'webp': 'image/webp',
      'svg': 'image/svg+xml',
      
      // Archives
      'zip': 'application/zip',
      'rar': 'application/x-rar-compressed',
      '7z': 'application/x-7z-compressed',
      
      // Other
      'json': 'application/json',
      'xml': 'application/xml',
      'csv': 'text/csv'
    };
    
    return mimeTypes[ext] || null;
  }

  /**
   * Enhanced path analysis for better MinIO integration
   */
  analyzeDocumentPath(s3Key) {
    try {
      const parts = s3Key.split('/');
      
      if (parts.length >= 4 && parts[0] === 'candidate-documents') {
        return {
          isValidPath: true,
          date: parts[1],
          candidateName: parts[2],
          documentType: parts[3],
          filename: parts.slice(4).join('/'),
          path: s3Key
        };
      }
      
      return {
        isValidPath: false,
        path: s3Key,
        error: 'Invalid document path structure'
      };
    } catch (error) {
      return {
        isValidPath: false,
        path: s3Key,
        error: error.message
      };
    }
  }

  /**
   * Helper method to extract document type from S3 key
   */
  extractDocumentType(s3Key) {
    const parts = s3Key.split('/');
    return parts.length >= 4 ? parts[3] : 'unknown';
  }

  /**
   * Helper method to extract filename from S3 key
   */
  extractFilename(s3Key) {
    const parts = s3Key.split('/');
    const filename = parts[parts.length - 1];
    // Remove timestamp prefix if present
    return filename.replace(/^\d+_/, '');
  }
}

module.exports = new DocumentFileService();