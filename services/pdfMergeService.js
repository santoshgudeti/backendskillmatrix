const { PDFDocument } = require('pdf-lib');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');

/**
 * PDF Merge Service
 * Handles merging of offer content PDF with letterhead PDF
 */
class PDFMergeService {
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
   * Merge offer content PDF with letterhead PDF
   * @param {Buffer} contentPdfBuffer - Buffer of the offer content PDF
   * @param {string} letterheadS3Key - S3 key of the letterhead PDF
   * @returns {Promise<Buffer>} - Merged PDF buffer
   */
  async mergeWithLetterhead(contentPdfBuffer, letterheadS3Key) {
    try {
      console.log('🔄 [PDF MERGE] Starting PDF merge process:', { 
        contentSize: contentPdfBuffer.length, 
        letterheadS3Key 
      });

      // Load the content PDF
      const contentPdf = await PDFDocument.load(contentPdfBuffer);
      
      // Download letterhead from S3
      console.log('📥 [PDF MERGE] Downloading letterhead from S3:', letterheadS3Key);
      const letterheadBuffer = await this.downloadFromS3(letterheadS3Key);
      console.log('✅ [PDF MERGE] Letterhead downloaded successfully, size:', letterheadBuffer.length);
      
      // Load the letterhead PDF
      const letterheadPdf = await PDFDocument.load(letterheadBuffer);
      
      // Get letterhead page count
      const letterheadPageCount = letterheadPdf.getPageCount();
      console.log('📄 [PDF MERGE] Letterhead page count:', letterheadPageCount);
      
      // Create a new document for the merged result
      const mergedPdf = await PDFDocument.create();
      
      // Copy pages from content PDF and overlay on letterhead
      const contentPageCount = contentPdf.getPageCount();
      console.log('📄 [PDF MERGE] Content page count:', contentPageCount);
      
      for (let i = 0; i < contentPageCount; i++) {
        // Determine which letterhead page to use (cycle through if content has more pages)
        const letterheadPageIndex = i % letterheadPageCount;
        const letterheadPage = letterheadPdf.getPage(letterheadPageIndex);
        const letterheadDims = letterheadPage.getSize();
        
        console.log('📄 [PDF MERGE] Processing page:', { 
          contentPage: i, 
          letterheadPage: letterheadPageIndex,
          letterheadWidth: letterheadDims.width,
          letterheadHeight: letterheadDims.height
        });
        
        // Add a new page to the merged PDF with letterhead dimensions
        const mergedPage = mergedPdf.addPage([letterheadDims.width, letterheadDims.height]);
        
        // Draw the letterhead as background
        const [letterheadEmbeddedPage] = await mergedPdf.embedPdf(letterheadPdf, [letterheadPageIndex]);
        mergedPage.drawPage(letterheadEmbeddedPage);
        
        // Overlay the content page
        const contentPage = contentPdf.getPage(i);
        const contentDims = contentPage.getSize();
        
        // Embed and draw the content page with proper positioning to avoid header/footer overlap
        const [contentEmbeddedPage] = await mergedPdf.embedPdf(contentPdf, [i]);
        
        // Position content to avoid overlapping with letterhead header (180px) and footer (120px)
        // Convert pixels to points (1px = 0.75pt, approximately)
        const headerOffset = 180 * 0.75; // Convert pixels to points
        const footerOffset = 120 * 0.75;  // Convert pixels to points
        
        // Calculate available content area
        const availableHeight = letterheadDims.height - headerOffset - footerOffset;
        
        // Scale content to fit within available area while maintaining aspect ratio
        const scaleX = letterheadDims.width / contentDims.width;
        const scaleY = availableHeight / contentDims.height;
        const scale = Math.min(scaleX, scaleY, 1); // Don't upscale
        
        // Calculate position to center the content within available area
        const scaledWidth = contentDims.width * scale;
        const scaledHeight = contentDims.height * scale;
        const x = (letterheadDims.width - scaledWidth) / 2;
        const y = footerOffset + (availableHeight - scaledHeight) / 2;
        
        mergedPage.drawPage(contentEmbeddedPage, {
          x: x,
          y: y,
          xScale: scale,
          yScale: scale
        });
      }
      
      // Save the merged PDF
      const mergedPdfBytes = await mergedPdf.save();
      const mergedBuffer = Buffer.from(mergedPdfBytes);
      
      console.log('✅ [PDF MERGE] PDF merge completed successfully:', { 
        mergedSize: mergedBuffer.length,
        contentPages: contentPageCount,
        letterheadPages: letterheadPageCount
      });
      
      return mergedBuffer;
    } catch (error) {
      console.error('❌ [PDF MERGE] Error merging PDFs:', error);
      throw new Error(`Failed to merge PDFs: ${error.message}`);
    }
  }

  /**
   * Download file from S3
   * @param {string} s3Key - S3 key of the file
   * @returns {Promise<Buffer>} - File buffer
   */
  async downloadFromS3(s3Key) {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key
      });
      
      const response = await this.s3Client.send(command);
      const chunks = [];
      
      for await (const chunk of response.Body) {
        chunks.push(chunk);
      }
      
      return Buffer.concat(chunks);
    } catch (error) {
      console.error('❌ [PDF MERGE] Error downloading from S3:', error);
      throw new Error(`Failed to download file from S3: ${error.message}`);
    }
  }
}

module.exports = new PDFMergeService();