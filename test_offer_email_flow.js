require('dotenv').config();
const industrialOfferLetterService = require('./services/industrialOfferLetterService');
const { sendOfferLetterToBoth } = require('./services/fixedOfferEmailService');

// Mock offer letter data
const mockOfferData = {
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

// Mock offer letter object
const mockOfferLetter = {
  _id: 'test-offer-id',
  offerDetails: mockOfferData,
  s3Key: 'test/offer_letter.pdf'
};

// Mock company ID
const mockCompanyId = 'test-company-id';

async function testOfferEmailFlow() {
  try {
    console.log('Testing offer letter email flow...');
    
    // First test the sendOfferLetterToBoth function directly
    console.log('\n1. Testing sendOfferLetterToBoth function...');
    const emailResult = await sendOfferLetterToBoth(mockOfferData, mockOfferLetter.s3Key);
    console.log('✅ sendOfferLetterToBoth succeeded:', {
      candidateEmailSent: emailResult.candidateEmailSent,
      hrEmailSent: emailResult.hrEmailSent
    });
    
    // Now test the industrialOfferLetterService sendOfferLetterEmail method
    console.log('\n2. Testing industrialOfferLetterService.sendOfferLetterEmail...');
    
    // Mock the getOfferLetter method to return our mock offer letter
    const originalGetOfferLetter = industrialOfferLetterService.getOfferLetter;
    industrialOfferLetterService.getOfferLetter = async (offerLetterId, companyId) => {
      console.log('Mock getOfferLetter called with:', { offerLetterId, companyId });
      if (offerLetterId === 'test-offer-id' && companyId === mockCompanyId) {
        return mockOfferLetter;
      }
      return null;
    };
    
    // Mock the updateOfferLetter method
    const originalUpdateOfferLetter = industrialOfferLetterService.updateOfferLetter;
    industrialOfferLetterService.updateOfferLetter = async (offerLetterId, companyId, updateData) => {
      console.log('Mock updateOfferLetter called with:', { offerLetterId, companyId, updateData });
      return { ...mockOfferLetter, ...updateData };
    };
    
    try {
      const serviceResult = await industrialOfferLetterService.sendOfferLetterEmail('test-offer-id', mockCompanyId);
      console.log('✅ industrialOfferLetterService.sendOfferLetterEmail succeeded:', serviceResult);
    } finally {
      // Restore original methods
      industrialOfferLetterService.getOfferLetter = originalGetOfferLetter;
      industrialOfferLetterService.updateOfferLetter = originalUpdateOfferLetter;
    }
    
    console.log('\n🎉 All tests passed!');
    
  } catch (error) {
    console.error('❌ Error in test:', error);
  }
}

testOfferEmailFlow();