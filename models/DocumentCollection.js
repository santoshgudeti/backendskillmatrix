const mongoose = require('mongoose');

const documentCollectionSchema = new mongoose.Schema({
  candidateId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'AssessmentSession', 
    required: true 
  },
  assessmentSessionId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'AssessmentSession' 
  },
  requestedBy: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  documentTypes: [{
    type: String,
    enum: [
      'aadhaar', 
      'passport', 
      'voter-id', 
      'driving-license', 
      'address-proof', 
      'educational-certificates', 
      'experience-certificates', 
      'relieving-letters', 
      'salary-slips', 
      'form-16', 
      'photographs', 
      'bank-details', 
      'pan-card', 
      'medical-certificates', 
      'nda', 
      'background-verification', 
      'references', 
      'other'
    ]
  }],
  customMessage: String,
  template: {
    type: String,
    default: 'standard',
    enum: ['standard', 'formal', 'friendly']
  },
  status: {
    type: String,
    enum: ['requested', 'uploaded', 'verified', 'rejected'],
    default: 'requested'
  },
  documents: [{
    name: { type: String },
    s3Key: { type: String },
    type: { type: String },
    size: { type: Number },
    uploadedAt: { type: Date }
  }],
  requestedAt: { 
    type: Date, 
    default: Date.now 
  },
  uploadedAt: Date,
  verifiedAt: Date,
  verifiedBy: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  },
  verificationNotes: String,
  rejectedAt: Date,
  rejectedBy: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  },
  rejectionReason: String,
  candidateName: String,
  candidateEmail: String
}, { 
  timestamps: true 
});

module.exports = mongoose.model('DocumentCollection', documentCollectionSchema);