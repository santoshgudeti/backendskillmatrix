const { sendOfferLetterToBoth } = require('./services/fixedOfferEmailService');

// Test data
const testData = {
  candidateName: 'John Doe',
  candidateEmail: 'johndoe@example.com',
  position: 'Software Engineer',
  companyName: 'Test Company',
  salary: '800000',
  startDate: '2025-12-01',
  hrName: 'Jane Smith',
  hrEmail: 'santosh.g@cognitbotz.com',
  hrPhone: '+91 9876543210'
};

const testS3Key = 'test/offer_letter.pdf';

async function testEmailService() {
  try {
    console.log('Testing email service...');
    const result = await sendOfferLetterToBoth(testData, testS3Key);
    console.log('Email sent successfully:', result);
  } catch (error) {
    console.error('Error sending email:', error);
  }
}

testEmailService();