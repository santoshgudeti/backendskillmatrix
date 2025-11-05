const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

// Professional Offer Letter Templates
const getOfferLetterTemplate = (templateType = 'professional') => {
  const templates = {
    professional: {
      name: 'Professional Corporate',
      description: 'Clean, modern design suitable for corporate environments',
      generateHTML: (data) => generateProfessionalTemplate(data)
    },
    executive: {
      name: 'Executive Level',
      description: 'Premium design for senior positions',
      generateHTML: (data) => generateExecutiveTemplate(data)
    },
    startup: {
      name: 'Modern Startup',
      description: 'Contemporary design for tech companies',
      generateHTML: (data) => generateStartupTemplate(data)
    },
    formal: {
      name: 'Formal Traditional',
      description: 'Traditional formal letter format',
      generateHTML: (data) => generateFormalTemplate(data)
    }
  };
  
  return templates[templateType] || templates.professional;
};

// Professional Template
const generateProfessionalTemplate = (data) => {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Offer Letter - ${data.candidateName}</title>
  <style>
    @page { 
      size: A4; 
      margin: 0; 
    }
    
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      line-height: 1.6;
      color: #333;
      background: #fff;
    }
    
    .page {
      width: 210mm;
      min-height: 297mm;
      padding: 20mm;
      margin: 0 auto;
      background: white;
      box-shadow: 0 0 10px rgba(0,0,0,0.1);
    }
    
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 3px solid #2563eb;
      padding-bottom: 20px;
      margin-bottom: 30px;
    }
    
    .company-info h1 {
      color: #2563eb;
      font-size: 28px;
      font-weight: 700;
      margin-bottom: 5px;
    }
    
    .company-info p {
      color: #666;
      font-size: 14px;
    }
    
    .date {
      text-align: right;
      color: #666;
      font-size: 14px;
    }
    
    .candidate-info {
      margin-bottom: 30px;
      padding: 20px;
      background: #f8fafc;
      border-left: 4px solid #2563eb;
    }
    
    .candidate-info h3 {
      color: #2563eb;
      margin-bottom: 10px;
    }
    
    .subject {
      font-size: 18px;
      font-weight: 600;
      color: #2563eb;
      margin-bottom: 20px;
      text-align: center;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    
    .content {
      margin-bottom: 30px;
    }
    
    .content p {
      margin-bottom: 15px;
      text-align: justify;
    }
    
    .offer-details {
      background: #f0f9ff;
      border: 1px solid #bae6fd;
      border-radius: 8px;
      padding: 25px;
      margin: 25px 0;
    }
    
    .offer-details h3 {
      color: #0369a1;
      margin-bottom: 15px;
      font-size: 18px;
    }
    
    .detail-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 10px;
      padding: 8px 0;
      border-bottom: 1px dotted #cbd5e1;
    }
    
    .detail-row:last-child {
      border-bottom: none;
    }
    
    .detail-label {
      font-weight: 600;
      color: #475569;
    }
    
    .detail-value {
      color: #1e293b;
      font-weight: 500;
    }
    
    .salary-breakdown {
      margin: 30px 0;
    }
    
    .salary-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 15px;
    }
    
    .salary-table th,
    .salary-table td {
      border: 1px solid #d1d5db;
      padding: 12px;
      text-align: left;
    }
    
    .salary-table th {
      background: #f3f4f6;
      font-weight: 600;
      color: #374151;
    }
    
    .salary-table .total-row {
      background: #fef3c7;
      font-weight: 600;
    }
    
    .terms-section {
      margin: 30px 0;
    }
    
    .terms-section h3 {
      color: #dc2626;
      margin-bottom: 15px;
      font-size: 16px;
    }
    
    .terms-list {
      list-style: none;
      counter-reset: term-counter;
    }
    
    .terms-list li {
      counter-increment: term-counter;
      margin-bottom: 10px;
      padding-left: 30px;
      position: relative;
    }
    
    .terms-list li::before {
      content: counter(term-counter) ".";
      position: absolute;
      left: 0;
      font-weight: 600;
      color: #dc2626;
    }
    
    .signature-section {
      margin-top: 50px;
      display: flex;
      justify-content: space-between;
    }
    
    .signature-box {
      width: 45%;
      text-align: center;
    }
    
    .signature-line {
      border-top: 2px solid #374151;
      margin-top: 50px;
      padding-top: 10px;
    }
    
    .acceptance-section {
      margin-top: 40px;
      padding: 20px;
      background: #fef7cd;
      border-radius: 8px;
      border: 1px solid #fbbf24;
    }
    
    .acceptance-section h3 {
      color: #92400e;
      margin-bottom: 15px;
    }
    
    .footer {
      margin-top: 40px;
      text-align: center;
      font-size: 12px;
      color: #6b7280;
      border-top: 1px solid #e5e7eb;
      padding-top: 20px;
    }
    
    @media print {
      .page {
        box-shadow: none;
        margin: 0;
      }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div class="company-info">
        <h1>${data.companyName || 'Company Name'}</h1>
        <p>Human Resources Department</p>
        <p>${data.companyAddress || 'Company Address'}</p>
      </div>
      <div class="date">
        <strong>Date:</strong> ${new Date().toLocaleDateString('en-US', { 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric' 
        })}
      </div>
    </div>

    <div class="candidate-info">
      <h3>To:</h3>
      <p><strong>${data.candidateName}</strong></p>
      <p>${data.candidateEmail}</p>
      ${data.candidateAddress ? `<p>${data.candidateAddress}</p>` : ''}
    </div>

    <div class="subject">
      Offer of Employment
    </div>

    <div class="content">
      <p>Dear ${data.candidateName},</p>
      
      <p>We are pleased to extend this formal offer of employment to you for the position of <strong>${data.position}</strong> at ${data.companyName}. After careful consideration of your qualifications, experience, and performance during our interview process, we believe you will be a valuable addition to our team.</p>

      <div class="offer-details">
        <h3>Position Details</h3>
        <div class="detail-row">
          <span class="detail-label">Position Title:</span>
          <span class="detail-value">${data.position}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Department:</span>
          <span class="detail-value">${data.department || 'To be assigned'}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Start Date:</span>
          <span class="detail-value">${data.startDate}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Employment Type:</span>
          <span class="detail-value">${data.employmentType || 'Full-time'}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Reporting Manager:</span>
          <span class="detail-value">${data.reportingManager || 'To be assigned'}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Work Location:</span>
          <span class="detail-value">${data.workLocation || 'Office'}</span>
        </div>
      </div>

      ${data.salaryBreakdown ? generateSalaryBreakdown(data.salaryBreakdown) : ''}

      <p>Your annual gross salary will be <strong>${data.salary}</strong>, payable in monthly installments as per company payroll schedule. This package includes all statutory benefits as per applicable labor laws.</p>

      ${data.benefits ? `
      <div class="offer-details">
        <h3>Benefits & Perquisites</h3>
        <p>${data.benefits}</p>
      </div>
      ` : ''}

      <div class="terms-section">
        <h3>Terms and Conditions</h3>
        <ol class="terms-list">
          <li>This offer is contingent upon successful completion of background verification and reference checks.</li>
          <li>You will be subject to a probationary period of ${data.probationPeriod || '3 months'} from your start date.</li>
          <li>Your employment will be governed by the company's policies, procedures, and employee handbook.</li>
          <li>You agree to maintain confidentiality of all proprietary and confidential information.</li>
          <li>The notice period for resignation is ${data.noticePeriod || '30 days'} or payment in lieu thereof.</li>
          <li>This offer is valid until ${data.offerValidUntil || 'one week from the date of this letter'}.</li>
          ${data.additionalTerms ? data.additionalTerms.split('\n').map(term => `<li>${term}</li>`).join('') : ''}
        </ol>
      </div>

      <p>We are excited about the prospect of you joining our team and contributing to our continued success. Please confirm your acceptance of this offer by signing and returning this letter by the specified deadline.</p>

      <p>If you have any questions regarding this offer, please don't hesitate to contact me directly.</p>

      <p>We look forward to welcoming you to ${data.companyName}!</p>
    </div>

    <div class="signature-section">
      <div class="signature-box">
        <p><strong>Sincerely,</strong></p>
        <div class="signature-line">
          <p>${data.hrName || 'HR Manager'}</p>
          <p>${data.hrTitle || 'Human Resources'}</p>
          <p>${data.companyName}</p>
          <p>${data.hrEmail || ''}</p>
        </div>
      </div>
      
      <div class="signature-box">
        <p><strong>Accepted by:</strong></p>
        <div class="signature-line">
          <p>${data.candidateName}</p>
          <p>Date: _______________</p>
        </div>
      </div>
    </div>

    <div class="acceptance-section">
      <h3>Important Instructions</h3>
      <p>To accept this offer:</p>
      <ol>
        <li>Sign and date this letter in the space provided above</li>
        <li>Return the signed copy via email or in person</li>
        <li>Prepare necessary documents for joining formalities</li>
        <li>Contact HR for any clarifications</li>
      </ol>
    </div>

    <div class="footer">
      <p>This is a confidential document intended solely for ${data.candidateName}.</p>
      <p>© ${new Date().getFullYear()} ${data.companyName}. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;
};

// Generate salary breakdown table
const generateSalaryBreakdown = (breakdown) => {
  if (!breakdown || !breakdown.earnings || !breakdown.deductions) return '';
  
  const earnings = breakdown.earnings || [];
  const deductions = breakdown.deductions || [];
  
  let earningsRows = earnings.map(item => 
    `<tr><td>${item.name}</td><td>₹${item.amount.toLocaleString('en-IN')}</td></tr>`
  ).join('');
  
  let deductionsRows = deductions.map(item => 
    `<tr><td>${item.name}</td><td>₹${item.amount.toLocaleString('en-IN')}</td></tr>`
  ).join('');
  
  const totalEarnings = earnings.reduce((sum, item) => sum + item.amount, 0);
  const totalDeductions = deductions.reduce((sum, item) => sum + item.amount, 0);
  const netSalary = totalEarnings - totalDeductions;
  
  return `
    <div class="salary-breakdown">
      <h3>Monthly Salary Breakdown</h3>
      <div style="display: flex; gap: 20px;">
        <div style="flex: 1;">
          <table class="salary-table">
            <thead>
              <tr><th>Earnings</th><th>Amount (₹)</th></tr>
            </thead>
            <tbody>
              ${earningsRows}
              <tr class="total-row">
                <td><strong>Total Earnings</strong></td>
                <td><strong>₹${totalEarnings.toLocaleString('en-IN')}</strong></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div style="flex: 1;">
          <table class="salary-table">
            <thead>
              <tr><th>Deductions</th><th>Amount (₹)</th></tr>
            </thead>
            <tbody>
              ${deductionsRows}
              <tr class="total-row">
                <td><strong>Total Deductions</strong></td>
                <td><strong>₹${totalDeductions.toLocaleString('en-IN')}</strong></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div style="margin-top: 15px; text-align: center; font-size: 16px; font-weight: 600; color: #059669;">
        <p>Net Monthly Salary: ₹${netSalary.toLocaleString('en-IN')}</p>
        <p>Annual Take Home: ₹${(netSalary * 12).toLocaleString('en-IN')}</p>
      </div>
    </div>
  `;
};

// Executive Template (more premium design)
const generateExecutiveTemplate = (data) => {
  // Similar structure but with more premium styling
  return generateProfessionalTemplate(data).replace(
    'color: #2563eb',
    'color: #7c3aed'
  ).replace(
    'border-bottom: 3px solid #2563eb',
    'border-bottom: 3px solid #7c3aed'
  );
};

// Startup Template (modern, colorful)
const generateStartupTemplate = (data) => {
  return generateProfessionalTemplate(data).replace(
    'color: #2563eb',
    'color: #10b981'
  ).replace(
    'border-bottom: 3px solid #2563eb',
    'border-bottom: 3px solid #10b981'
  );
};

// Formal Template (traditional)
const generateFormalTemplate = (data) => {
  return generateProfessionalTemplate(data).replace(
    'color: #2563eb',
    'color: #374151'
  ).replace(
    'border-bottom: 3px solid #2563eb',
    'border-bottom: 2px solid #374151'
  );
};

// Generate PDF from HTML
const generatePDFFromHTML = async (htmlContent) => {
  const puppeteer = require('puppeteer');
  
  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
    
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '0mm',
        right: '0mm',
        bottom: '0mm',
        left: '0mm'
      }
    });
    
    await browser.close();
    return pdfBuffer;
    
  } catch (error) {
    console.error('Error generating PDF:', error);
    throw error;
  }
};

// Get available templates
const getAvailableTemplates = () => {
  return [
    { id: 'professional', name: 'Professional Corporate', description: 'Clean, modern design suitable for corporate environments' },
    { id: 'executive', name: 'Executive Level', description: 'Premium design for senior positions' },
    { id: 'startup', name: 'Modern Startup', description: 'Contemporary design for tech companies' },
    { id: 'formal', name: 'Formal Traditional', description: 'Traditional formal letter format' }
  ];
};

module.exports = {
  getOfferLetterTemplate,
  generatePDFFromHTML,
  getAvailableTemplates,
  generateProfessionalTemplate,
  generateExecutiveTemplate,
  generateStartupTemplate,
  generateFormalTemplate
};
