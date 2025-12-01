// Simple test for email functionality only
require('dotenv').config();

const nodemailer = require('nodemailer');

// Create transporter with better error handling
const createTransporter = () => {
  // Verify required environment variables
  if (!process.env.SMTP_HOST) {
    throw new Error('SMTP_HOST is not configured in environment variables');
  }
  
  if (!process.env.SMTP_USER) {
    throw new Error('SMTP_USER is not configured in environment variables');
  }
  
  if (!process.env.SMTP_PASS) {
    throw new Error('SMTP_PASS is not configured in environment variables');
  }
  
  // Parse SMTP port as number
  const smtpPort = Number(process.env.SMTP_PORT) || 465;
  
  // Log configuration for debugging
  console.log('📧 SMTP Configuration:', {
    host: process.env.SMTP_HOST,
    port: smtpPort,
    secure: smtpPort === 465,
    user: process.env.SMTP_USER
  });
  
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    tls: {
      rejectUnauthorized: false
    },
    debug: true, // Enable debug output
    logger: true // Log information in Nodemailer
  });
};

async function testEmail() {
  try {
    console.log('Testing email functionality...');
    
    const transporter = createTransporter();
    
    // Verify connection
    await transporter.verify();
    console.log('✅ SMTP connection verified successfully');
    
    // Send test email
    const mailOptions = {
      from: `"Test" <${process.env.SMTP_USER}>`,
      to: 'santosh.g@cognitbotz.com',
      subject: 'Test Email from SkillMatrix',
      text: 'This is a test email to verify email functionality.'
    };
    
    const result = await transporter.sendMail(mailOptions);
    console.log('✅ Test email sent successfully:', result.messageId);
    
  } catch (error) {
    console.error('❌ Error in email test:', error);
  }
}

testEmail();