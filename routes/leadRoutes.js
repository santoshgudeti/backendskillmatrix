const express = require('express');
const router = express.Router();
const XLSX = require('xlsx');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { Readable } = require('stream');

// MinIO Configuration
const s3Client = new S3Client({
  endpoint: `https://${process.env.MINIO_ENDPOINT}`,
  region: process.env.MINIO_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.MINIO_ACCESS_KEY,
    secretAccessKey: process.env.MINIO_SECRET_KEY,
  },
  forcePathStyle: true,
});

const BUCKET_NAME = process.env.MINIO_BUCKET_NAME;
const EXCEL_FILE_KEY = 'leads/leads_data.xlsx'; // Fixed path in MinIO

/**
 * Helper: Download Excel from MinIO
 */
async function downloadExcelFromMinIO() {
  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: EXCEL_FILE_KEY,
    });

    const response = await s3Client.send(command);
    const stream = response.Body;

    // Convert stream to buffer
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    // Read Excel from buffer
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(worksheet);

    return { workbook, data };
  } catch (error) {
    if (error.name === 'NoSuchKey') {
      // File doesn't exist yet - return empty
      return { workbook: null, data: [] };
    }
    throw error;
  }
}

/**
 * Helper: Upload Excel to MinIO
 */
async function uploadExcelToMinIO(workbook) {
  // Convert workbook to buffer
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: EXCEL_FILE_KEY,
    Body: buffer,
    ContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  await s3Client.send(command);

  // Generate shareable download link (valid for 7 days)
  const downloadCommand = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: EXCEL_FILE_KEY,
  });

  const downloadUrl = await getSignedUrl(s3Client, downloadCommand, { expiresIn: 604800 }); // 7 days
  return downloadUrl;
}

/**
 * POST /api/save-lead
 * Save lead information to Excel file in MinIO
 */
router.post('/save-lead', async (req, res) => {
  try {
    const { name, email, contact, service } = req.body;

    // Validation
    if (!name || !email || !contact || !service) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required'
      });
    }

    // Prepare lead data with timestamp
    const leadData = {
      'Date/Time': new Date().toLocaleString('en-US', { 
        timeZone: 'UTC',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }),
      'Name': name,
      'Email': email,
      'Contact': contact,
      'Service': service,
      'Status': 'New'
    };

    // Download existing Excel from MinIO (or get empty array)
    const { workbook, data: existingData } = await downloadExcelFromMinIO();

    // Add new lead to existing data
    existingData.push(leadData);

    // Create new workbook and worksheet
    const newWorksheet = XLSX.utils.json_to_sheet(existingData);
    
    // Set column widths for better readability
    newWorksheet['!cols'] = [
      { wch: 20 }, // Date/Time
      { wch: 25 }, // Name
      { wch: 30 }, // Email
      { wch: 18 }, // Contact
      { wch: 35 }, // Service
      { wch: 12 }  // Status
    ];

    // Create new workbook
    const newWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(newWorkbook, newWorksheet, 'Leads');

    // Upload to MinIO and get shareable link
    const downloadUrl = await uploadExcelToMinIO(newWorkbook);

    console.log(`✅ Lead saved to MinIO: ${name} - ${email} - ${service}`);
    console.log(`📎 Download Link: ${downloadUrl}`);

    res.status(200).json({
      success: true,
      message: 'Lead saved successfully',
      data: leadData,
      downloadUrl: downloadUrl,
      totalLeads: existingData.length
    });

  } catch (error) {
    console.error('❌ Error saving lead:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save lead',
      error: error.message
    });
  }
});

/**
 * GET /api/leads
 * Retrieve all leads from MinIO
 */
router.get('/leads', async (req, res) => {
  try {
    const { data: leads } = await downloadExcelFromMinIO();

    res.status(200).json({
      success: true,
      data: leads,
      count: leads.length
    });

  } catch (error) {
    console.error('❌ Error retrieving leads:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve leads',
      error: error.message
    });
  }
});

/**
 * GET /api/leads/download-link
 * Get shareable download link for Excel file
 */
router.get('/leads/download-link', async (req, res) => {
  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: EXCEL_FILE_KEY,
    });

    // Generate download link (valid for 7 days)
    const downloadUrl = await getSignedUrl(s3Client, command, { expiresIn: 604800 });

    res.status(200).json({
      success: true,
      downloadUrl: downloadUrl,
      expiresIn: '7 days',
      message: 'Share this link to download the latest leads Excel file'
    });

  } catch (error) {
    console.error('❌ Error generating download link:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate download link',
      error: error.message
    });
  }
});

module.exports = router;
