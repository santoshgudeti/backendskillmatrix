const mongoose = require('mongoose');

const OfferLetterSchema = new mongoose.Schema({
  candidateId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Candidate',
    required: true
  },
  assessmentSessionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AssessmentSession',
    required: true
  },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  letterheadId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Letterhead',
    required: false
  },
  s3Key: {
    type: String,
    required: true
  },
  filename: {
    type: String,
    required: true
  },
  fileSize: {
    type: Number
  },
  candidateName: {
    type: String,
    required: true
  },
  candidateEmail: {
    type: String,
    required: true
  },
  position: {
    type: String,
    required: true
  },
  salary: {
    type: String
  },
  startDate: {
    type: Date
  },
  offerDetails: {
    type: mongoose.Schema.Types.Mixed
  },
  generatedAt: {
    type: Date,
    default: Date.now
  },
  status: {
    type: String,
    enum: ['draft', 'generated', 'sent', 'accepted', 'rejected'],
    default: 'draft'
  },
  signed: {
    type: Boolean,
    default: false
  },
  signedAt: {
    type: Date
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('OfferLetter', OfferLetterSchema);