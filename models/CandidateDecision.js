const mongoose = require('mongoose');

const candidateDecisionSchema = new mongoose.Schema({
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
  decision: {
    type: String,
    enum: ['selected', 'rejected', 'pending'],
    required: true
  },
  // For selected candidates
  offerLetterUrl: {
    type: String,
    default: ''
  },
  offerDetails: {
    position: String,
    salary: String,
    startDate: Date,
    benefits: String,
    notes: String
  },
  // For rejected candidates
  rejectionReason: {
    type: String,
    enum: ['requirements-not-matching', 'location-not-suitable', 'resume-referred-other-roles', 'custom'],
    default: ''
  },
  customRejectionReason: {
    type: String,
    default: ''
  },
  rejectionFeedback: {
    type: String,
    default: ''
  },
  interviewFeedback: {
    rating: {
      type: Number,
      min: 1,
      max: 5,
      default: null
    },
    feedback: {
      type: String,
      default: ''
    },
    strengths: {
      type: String,
      default: ''
    },
    areasForImprovement: {
      type: String,
      default: ''
    },
    recommendation: {
      type: String,
      enum: ['pending', 'proceed', 'reject'],
      default: 'pending'
    }
  },
  decidedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  decidedAt: {
    type: Date,
    default: Date.now
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('CandidateDecision', candidateDecisionSchema);
