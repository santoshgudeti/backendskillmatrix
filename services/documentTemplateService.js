const mongoose = require('mongoose');

// Document Template Schema
const documentTemplateSchema = new mongoose.Schema({
  name: { type: String, required: true },
  subject: { type: String, required: true },
  content: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  isDefault: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const DocumentTemplate = mongoose.model('DocumentTemplate', documentTemplateSchema);

// Default templates
const defaultTemplates = {
  standard: {
    name: 'Standard Template',
    subject: 'Document Collection Request - {{companyName}}',
    content: `
      <div style="font-family: Arial, sans-serif; background:#f5f7fb; padding:24px;">
        <div style="max-width:640px; margin:0 auto; background:#ffffff; border:1px solid #e5e7eb; box-shadow:0 10px 24px rgba(0,0,0,0.06); border-radius:10px; overflow:hidden;">
          <div style="background:linear-gradient(90deg,#2563eb,#60a5fa); padding:18px 22px; color:#fff;">
            <div style="font-size:18px; font-weight:700;">{{companyName}}</div>
            <div style="opacity:0.9; font-size:12px;">Document Collection Request</div>
          </div>
          <div style="padding:22px; color:#111827;">
            <p style="margin:0 0 16px 0;">Dear <strong>{{candidateName}}</strong>,</p>
            <p style="margin:0 0 16px 0;">Congratulations on your selection! We are pleased to inform you that you have been selected for the position.</p>
            
            <div style="background:#fffbeb; border:1px solid #fbbf24; border-radius:8px; padding:16px; margin:16px 0;">
              <div style="font-weight:700; color:#92400e; margin-bottom:8px; display:flex; align-items:center;">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:8px;">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="8" x2="12" y2="12"></line>
                  <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
                Important Next Step
              </div>
              <p style="margin:0 0 12px 0;">As part of our onboarding process, we request you to submit the following documents:</p>
              <ul style="margin:0; padding-left:20px;">
                {{documentList}}
              </ul>
            </div>
            
            {{#if customMessage}}
              <div style="background:#f0f9ff; border:1px solid #7dd3fc; border-radius:8px; padding:16px; margin:16px 0;">
                <div style="font-weight:700; color:#0369a1; margin-bottom:8px;">Message from HR:</div>
                <p style="margin:0;">{{customMessage}}</p>
              </div>
            {{/if}}
            
            <div style="background:#f0fdf4; border:1px solid #86efac; border-radius:8px; padding:16px; margin:16px 0;">
              <div style="font-weight:700; color:#166534; margin-bottom:8px; display:flex; align-items:center;">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:8px;">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14 2 14 8 20 8"></polyline>
                  <line x1="16" y1="13" x2="8" y2="13"></line>
                  <line x1="16" y1="17" x2="8" y2="17"></line>
                  <polyline points="10 9 9 9 8 9"></polyline>
                </svg>
                Submission Instructions
              </div>
              <p style="margin:0 0 12px 0;">Please upload these documents using the link below:</p>
              <div style="text-align:center; margin: 16px 0;">
                <a href="{{uploadLink}}" 
                   style="background:#10b981; color:#fff; padding:12px 24px; border-radius:8px; text-decoration:none; font-weight:700; display:inline-block;">
                  Upload Documents
                </a>
              </div>
              <p style="margin:0; font-size:13px; color:#374151;">
                If you have any questions, please contact our HR team at {{hrEmail}}
              </p>
            </div>
            
            <p style="margin:16px 0 0 0;">We look forward to welcoming you to our team!</p>
            <p style="margin:16px 0 0 0;">Best regards,<br/><strong>HR Team</strong><br/>{{companyName}}</p>
          </div>
        </div>
      </div>
    `
  },
  formal: {
    name: 'Formal Template',
    subject: 'Official Document Submission Request - {{companyName}}',
    content: `
      <div style="font-family: Times New Roman, serif; background:#ffffff; padding:24px;">
        <div style="max-width:640px; margin:0 auto; border:1px solid #000;">
          <div style="background:#000; padding:18px 22px; color:#fff; text-align:center;">
            <div style="font-size:24px; font-weight:700;">{{companyName}}</div>
            <div style="font-size:14px;">Official Document Submission Request</div>
          </div>
          <div style="padding:22px; color:#000;">
            <p style="margin:0 0 16px 0;">Dear <strong>{{candidateName}}</strong>,</p>
            <p style="margin:0 0 16px 0;">We are pleased to inform you that you have been selected for the position at our organization.</p>
            
            <p style="margin:0 0 16px 0;"><strong>Required Documentation:</strong></p>
            <ul style="margin:0 0 16px 20px;">
              {{documentList}}
            </ul>
            
            {{#if customMessage}}
              <p style="margin:0 0 16px 0;"><strong>Additional Information:</strong><br/>{{customMessage}}</p>
            {{/if}}
            
            <p style="margin:0 0 16px 0;">Please submit the above documents at your earliest convenience using the following link:</p>
            <div style="text-align:center; margin: 16px 0;">
              <a href="{{uploadLink}}" 
                 style="background:#000; color:#fff; padding:12px 24px; text-decoration:none; font-weight:700; display:inline-block;">
                Submit Documents
              </a>
            </div>
            
            <p style="margin:16px 0 0 0;">Sincerely,<br/>{{companyName}}<br/>Human Resources Department</p>
          </div>
        </div>
      </div>
    `
  },
  friendly: {
    name: 'Friendly Template',
    subject: 'Welcome to the team! Document submission needed 🎉',
    content: `
      <div style="font-family: Arial, sans-serif; background:linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding:24px;">
        <div style="max-width:640px; margin:0 auto; background:#ffffff; border-radius:15px; overflow:hidden; box-shadow:0 10px 30px rgba(0,0,0,0.15);">
          <div style="background:linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding:25px; text-align:center; color:#fff;">
            <div style="font-size:28px; font-weight:700; margin-bottom:10px;">🎉 Welcome to the Team!</div>
            <div style="font-size:16px; opacity:0.9;">Just one more step to complete your onboarding</div>
          </div>
          <div style="padding:30px; color:#333;">
            <p style="margin:0 0 20px 0; font-size:18px;">Hi <strong>{{candidateName}}</strong>!</p>
            <p style="margin:0 0 20px 0; font-size:16px;">We're super excited to have you join us! 🎉 You've been selected for the {{position}} role, and we can't wait to work with you.</p>
            
            <div style="background:#e3f2fd; border-radius:10px; padding:20px; margin:20px 0;">
              <h3 style="margin:0 0 15px 0; color:#1976d2; text-align:center;">📋 Just Need These Quick Docs</h3>
              <ul style="margin:0; padding-left:20px;">
                {{documentList}}
              </ul>
            </div>
            
            {{#if customMessage}}
              <div style="background:#fff3e0; border-radius:10px; padding:20px; margin:20px 0;">
                <h3 style="margin:0 0 10px 0; color:#f57c00;">💬 Message from HR</h3>
                <p style="margin:0;">{{customMessage}}</p>
              </div>
            {{/if}}
            
            <div style="text-align:center; margin: 30px 0;">
              <a href="{{uploadLink}}" 
                 style="background:linear-gradient(135deg, #667eea 0%, #764ba2 100%); color:#fff; padding:15px 30px; border-radius:50px; text-decoration:none; font-weight:700; font-size:18px; display:inline-block; box-shadow:0 4px 15px rgba(0,0,0,0.2);">
                📤 Upload Your Documents
              </a>
            </div>
            
            <p style="margin:20px 0 0 0; font-size:14px; text-align:center; color:#666;">
              Having trouble? Reach out to us at {{hrEmail}}<br/>
              We're here to help! 😊
            </p>
          </div>
        </div>
      </div>
    `
  }
};

// Create default templates for a user if they don't exist
async function initializeUserTemplates(userId) {
  try {
    const existingTemplates = await DocumentTemplate.find({ userId });
    
    if (existingTemplates.length === 0) {
      // Create default templates for the user
      const templatesToCreate = Object.entries(defaultTemplates).map(([key, template]) => ({
        name: template.name,
        subject: template.subject,
        content: template.content,
        userId,
        isDefault: true
      }));
      
      await DocumentTemplate.insertMany(templatesToCreate);
    }
  } catch (error) {
    console.error('Error initializing user templates:', error);
  }
}

// Get all templates for a user
async function getUserTemplates(userId) {
  try {
    // Initialize default templates if user has none
    await initializeUserTemplates(userId);
    
    const templates = await DocumentTemplate.find({ userId }).sort({ createdAt: -1 });
    return templates;
  } catch (error) {
    console.error('Error fetching user templates:', error);
    throw error;
  }
}

// Get a specific template by ID
async function getTemplateById(templateId, userId) {
  try {
    const template = await DocumentTemplate.findOne({ _id: templateId, userId });
    return template;
  } catch (error) {
    console.error('Error fetching template:', error);
    throw error;
  }
}

// Create a new template
async function createTemplate(templateData, userId) {
  try {
    const template = new DocumentTemplate({
      ...templateData,
      userId
    });
    
    await template.save();
    return template;
  } catch (error) {
    console.error('Error creating template:', error);
    throw error;
  }
}

// Update a template
async function updateTemplate(templateId, templateData, userId) {
  try {
    const template = await DocumentTemplate.findOneAndUpdate(
      { _id: templateId, userId },
      { ...templateData, updatedAt: new Date() },
      { new: true }
    );
    
    return template;
  } catch (error) {
    console.error('Error updating template:', error);
    throw error;
  }
}

// Delete a template
async function deleteTemplate(templateId, userId) {
  try {
    const result = await DocumentTemplate.findOneAndDelete({ _id: templateId, userId });
    return result;
  } catch (error) {
    console.error('Error deleting template:', error);
    throw error;
  }
}

// Get default template by name
function getDefaultTemplate(templateName = 'standard') {
  return defaultTemplates[templateName] || defaultTemplates.standard;
}

module.exports = {
  DocumentTemplate,
  getUserTemplates,
  getTemplateById,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  getDefaultTemplate,
  initializeUserTemplates
};