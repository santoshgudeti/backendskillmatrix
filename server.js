
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const cors = require('cors');
const axios = require('axios');
const FormData = require('form-data');
const bodyParser = require('body-parser');
const crypto = require('crypto'); // For hash calculation
const { Schema } = mongoose;
const os = require("os"); // Added for cross-platform temp dir
const http = require('http');
const { v4: uuidv4 } = require('uuid');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const dotenv = require("dotenv");
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const { body, validationResult } = require('express-validator');
const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const { exec } = require("child_process");
const { Upload } = require("@aws-sdk/lib-storage");
const { Readable } = require('stream');
const { Blob } = require('buffer');
const JSZip = require('jszip');

// Add new dependencies at the top
const PDFDocument = require('pdfkit');
const Chart = require('chart.js');
const { createCanvas } = require('canvas');
const htmlToPdf = require('html-pdf');
const sendConsentEmail = require('./services/sendConsentMail'); // Or wherever you place it
const { handleAutomaticJobPosting } = require('./services/externalJobPostingService');
const { MergedDocument, generateMergedPDF, getMergedDocuments } = require('./services/mergedPDFService');
const letterheadService = require('./services/letterheadService');
const industrialOfferLetterService = require('./services/industrialOfferLetterService');
const Letterhead = require('./models/Letterhead');

dotenv.config();
// Initialize Express app
const app = express();
const PORT = process.env.PORT;

// Create an HTTP server to support WebSockets
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Middleware
app.use(
  cors({
    origin: process.env.FRONTEND_URL,
    credentials: true, // needed for cookies, auth headers, etc.
  })
);




app.use(express.json());
app.use(cookieParser());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// In server.js - Replace the rate limiter setu
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));



mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));
// Schemas
// SendGrid configuration
// Replace current multer config with memory storage:
const memoryStorage = multer.memoryStorage();

const audioUpload = multer({
  storage: memoryStorage,
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype === 'audio/wav' ||
      file.mimetype === 'audio/x-wav' ||
      file.mimetype === 'audio/wave' ||
      file.originalname.match(/\.wav$/i)
    ) {
      cb(null, true);
    } else {
      cb(new Error('Only WAV audio files are allowed'), false);
    }
  },

}).single('audio');

const upload = multer({ storage: memoryStorage });
// User Model
const userSchema = new mongoose.Schema({
  fullName: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  mobileNumber: { type: String, required: true },
  companyName: { type: String, required: true },
  designation: { type: String, required: true },
  isEmailVerified: { type: Boolean, default: false },
  isAdmin: { type: Boolean, default: false },
  isApproved: { type: Boolean, default: false },
  // Removed isUnlimited field as it's redundant
  subscription: {
    plan: {
      type: String,
      enum: ['trial', 'free', 'paid', 'admin'],
      default: 'trial',
      required: true
    },
    startedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date },
    isActive: { type: Boolean, default: true },
    // Limits only exist for trial/free users
    limits: {
      jdUploads: { type: Number },
      resumeUploads: { type: Number },
      assessments: { type: Number }
    }
  },
  usage: {
    jdUploads: { type: Number, default: 0 },
    resumeUploads: { type: Number, default: 0 },
    assessments: { type: Number, default: 0 }
  },

}, { timestamps: true });

const User = mongoose.model('User', userSchema);




const ResumeSchema = new Schema({
  title: String,
  s3Key: { type: String, required: true }, // Make this required
  filename: { type: String, required: true },
  uploadedAt: { type: Date, default: Date.now },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  hash: { type: String, unique: true } // Add hash for deduplication
});

const JobDescriptionSchema = new Schema({
  title: String,
  s3Key: { type: String, required: true }, // Make this required
  filename: { type: String, required: true },
  uploadedAt: { type: Date, default: Date.now },
  hash: { type: String, unique: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true } // Added
});


const ApiResponseSchema = new Schema({
  resumeId: { type: Schema.Types.ObjectId, ref: 'Resume', required: true },
  jobDescriptionId: { type: Schema.Types.ObjectId, ref: 'JobDescription', required: true },
  matchingResult: Object,
  createdAt: { type: Date, default: Date.now },
  hash: { type: String, unique: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  candidateConsent: {
    allowedToShare: { type: Boolean, default: false },
    message: { type: String },
    respondedAt: { type: Date }
  }
});

const Resume = mongoose.model('Resume', ResumeSchema);
const JobDescription = mongoose.model('JobDescription', JobDescriptionSchema);
const ApiResponse = mongoose.model('ApiResponse', ApiResponseSchema);
// Add new VoiceAnswer schema
// Update the VoiceAnswerSchema in server.js
const VoiceAnswerSchema = new mongoose.Schema({
  questionId: { type: String, required: true },
  question: { type: String, required: true },
  audioPath: { type: String }, // Remove required - will be null for skipped questions
  durationSec: { type: Number }, // Add duration tracking
  answered: { type: Boolean, default: false }, // Track if attempted
  skipReason: { type: String }, // Reason for skipping processing
  valid: { type: Boolean, default: false }, // Track if valid response
  transcriptionPath: { type: String }, // Will store S3 key like "transcripts/answer_123.txt"
  answer: { type: String },
  audioAnalysis: {
    grading: Object,
    processedAt: Date,
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed'],
      default: 'pending'
    }
  },
  textEvaluation: {  // New field for text evaluation
    metrics: {
      Authentic: Number,
      Clarity: Number,
      Fluency: Number,
      Focused: Number,
      NoFillers: Number,
      Professionalism: Number,
      Relevance: Number,
      StructuredAnswers: Number,
      UniqueQualities: Number,
      total_average: Number,
      total_overall_score: Number

    },
    processedAt: Date,
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed', 'skipped'],
      default: 'pending'
    }
  },
  processingStatus: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'skipped'],
    default: 'pending'
  },
  assessmentSession: {
    type: Schema.Types.ObjectId,
    ref: 'AssessmentSession',
    required: true
  },
  createdAt: { type: Date, default: Date.now }
});

const VoiceAnswer = mongoose.model('VoiceAnswer', VoiceAnswerSchema);

// Define MongoDB schema and model
const recordingSchema = new mongoose.Schema({
  filename: String,
  videoPath: String,
  screenPath: String,
  assessmentSession: {
    type: Schema.Types.ObjectId,
    ref: 'AssessmentSession',
    required: true
  },
  videoAnalysis: {
    emotions: {
      dominant_emotion: String,
      emotion_distribution: mongoose.Schema.Types.Mixed,
      occurrence_count: Number,
      total_frames_processed: Number
    },
    video_score: Number,
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed'],
      default: 'pending'
    },
    startedAt: Date,
    completedAt: Date,
    error: String
  }
}, { timestamps: true });
const Recording = mongoose.model("Recording", recordingSchema);
// Update AssessmentSession schema
const AssessmentSessionSchema = new Schema({
  candidateEmail: { type: String, required: true },
  jobTitle: { type: String, required: true },
  testLink: { type: String, required: true },
  recording: { type: Schema.Types.ObjectId, ref: 'Recording' },
  testResult: { type: Schema.Types.ObjectId, ref: 'TestResult' },
  voiceAnswers: [{ type: Schema.Types.ObjectId, ref: 'VoiceAnswer' }],
  // Update AssessmentSession schema to store user answers
  questions: [{
    id: String,
    question: String,
    options: [String],
    correctAnswer: String,
    userAnswer: String // Add this field to store user's answer
  }],
  voiceQuestions: [{
    id: String,
    question: String
  }],
  resumeId: { type: Schema.Types.ObjectId, ref: 'Resume' },
  jobDescriptionId: { type: Schema.Types.ObjectId, ref: 'JobDescription' },
  currentPhase: {
    type: String,
    enum: ['mcq', 'voice', 'completed'],
    default: 'mcq'
  },
  startedAt: { type: Date, default: Date.now },
  completedAt: { type: Date },
  status: { type: String, enum: ['pending', 'in-progress', 'completed'], default: 'pending' },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true }, // Added

  reportStatus: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending'
  },
  reportGeneratedAt: Date

});

console.log("✅ MongoDB Schema and Model Initialized");
const AssessmentSession = mongoose.model('AssessmentSession', AssessmentSessionSchema);
// Enhanced TestResult schema
const TestResultSchema = new Schema({
  candidateEmail: { type: String, required: true, index: true },
  jobTitle: { type: String, required: true },
  score: { type: Number, required: true }, // MCQ score
  audioScore: { type: Number }, // Average audio score
  textScore: { type: Number }, // Text evaluation score
  videoScore: { type: Number }, // Add this new field for video score
  combinedScore: { type: Number }, // Combined overall score
  assessmentSession: { type: Schema.Types.ObjectId, ref: 'AssessmentSession', required: true },
  submittedAt: { type: Date, default: Date.now },
  status: { type: String, enum: ['pending', 'completed', 'expired'], default: 'pending' },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true } // Added

}, { timestamps: true });
const TestResult = mongoose.model('TestResult', TestResultSchema);

// Add near other schemas
const ReportSchema = new mongoose.Schema({
  assessmentSession: {
    type: Schema.Types.ObjectId,
    ref: 'AssessmentSession',
    required: true
  },
  s3Key: { type: String, required: true },
  filename: { type: String, required: true },
  generatedAt: { type: Date, default: Date.now },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });

const Report = mongoose.model('Report', ReportSchema);

// Scheduled Test Schema for new dual platform
const ScheduledTestSchema = new mongoose.Schema({
  candidateName: { type: String, required: true },
  candidateEmail: { type: String, required: true },
  scheduledDateTime: { type: Date, required: true },
  expiresAt: { type: Date, required: true }, // scheduledDateTime + 2 days
  resumeId: { type: Schema.Types.ObjectId, ref: 'Resume', required: true },
  jobDescriptionId: { type: Schema.Types.ObjectId, ref: 'JobDescription', required: true },
  testLink: { type: String, required: true, unique: true },
  token: { type: String, required: true, unique: true },
  status: {
    type: String,
    enum: ['scheduled', 'active', 'completed', 'expired', 'cancelled'],
    default: 'scheduled'
  },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  assessmentSession: { type: Schema.Types.ObjectId, ref: 'AssessmentSession' },
  questionsGenerated: { type: Boolean, default: false },
  reminderSent: { type: Boolean, default: false },
  activatedAt: { type: Date },
  completedAt: { type: Date }
}, { timestamps: true });

// Add indexes for efficient querying
ScheduledTestSchema.index({ scheduledDateTime: 1, status: 1 });
ScheduledTestSchema.index({ expiresAt: 1, status: 1 });
ScheduledTestSchema.index({ user: 1, status: 1 });

const ScheduledTest = mongoose.model('ScheduledTest', ScheduledTestSchema);

// Add new Interview schema
const InterviewSchema = new mongoose.Schema({
  scheduledTest: {
    type: Schema.Types.ObjectId,
    ref: 'ScheduledTest',
    required: true
  },
  candidateName: { type: String, required: true },
  candidateEmail: { type: String, required: true },
  jobTitle: { type: String, required: true },
  interviewDateTime: { type: Date, required: true },
  interviewPlatform: {
    type: String,
    enum: ['Google Meet', 'Microsoft Teams', 'Zoom', 'Google Calendar'],
    required: true
  },
  meetingLink: { type: String },
  status: {
    type: String,
    enum: ['not-scheduled', 'scheduled', 'completed', 'cancelled'],
    default: 'not-scheduled'
  },
  feedback: { type: String },
  feedbackSummary: { type: String },
  rating: { type: Number, min: 1, max: 5 },
  scheduledBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

const Interview = mongoose.model('Interview', InterviewSchema);

// Add new CandidateDecision schema
const CandidateDecisionSchema = new mongoose.Schema({
  candidateId: {
    type: Schema.Types.ObjectId,
    ref: 'Candidate'
  },
  assessmentSessionId: {
    type: Schema.Types.ObjectId,
    ref: 'AssessmentSession'
  },
  scheduledTest: {
    type: Schema.Types.ObjectId,
    ref: 'ScheduledTest'
  },
  interview: {
    type: Schema.Types.ObjectId,
    ref: 'Interview'
  },
  decision: {
    type: String,
    enum: ['selected', 'rejected', 'pending'],
    required: true
  },
  // For rejected candidates
  rejectionReason: {
    type: String,
    enum: ['requirements-not-matching', 'location-not-suitable', 'resume-referred-other-roles', 'custom']
  },
  customRejectionReason: { type: String },
  rejectionFeedback: { type: String },
  // For selected candidates  
  offerDetails: {
    position: String,
    salary: String,
    startDate: Date,
    benefits: String,
    notes: String
  },
  // Interview feedback
  interviewFeedback: {
    rating: { type: Number, min: 1, max: 5 },
    feedback: String,
    strengths: String,
    areasForImprovement: String,
    recommendation: {
      type: String,
      enum: ['pending', 'proceed', 'reject'],
      default: 'pending'
    }
  },
  // Status tracking
  offerLetterGenerated: { type: Boolean, default: false },
  rejectionLetterGenerated: { type: Boolean, default: false },
  offerLetterUrl: { type: String },
  rejectionLetterUrl: { type: String },
  emailSent: { type: Boolean, default: false },
  emailSentAt: { type: Date },
  decidedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  decidedAt: { type: Date, default: Date.now }
}, { timestamps: true });

const CandidateDecision = mongoose.model('CandidateDecision', CandidateDecisionSchema);

// ==============================
// ✅ NEW SCHEMAS
// ==============================
const jobPosterSchema = new mongoose.Schema({
  name: String,
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  isVerified: { type: Boolean, default: false },
}, { timestamps: true });
const jobPostSchema = new mongoose.Schema({
  title: String,
  companyName: String, // NEW FIELD ADDED
  location: String,
  experience: String,
  jobType: String,
  department: String,
  skillsRequired: [String],
  salaryRange: String,
  jobDescriptionFile: String,
  descriptionText: String,
  publicId: { type: String, unique: true },
  applications: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Application' }],
  createdAt: { type: Date, default: Date.now },
  postedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'JobPoster' },
});

const JobPoster = mongoose.model('JobPoster', jobPosterSchema);
const JobPost = mongoose.model('JobPost', jobPostSchema);
const applicationSchema = new mongoose.Schema({
  jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'JobPost', required: true },
  candidateName: { type: String, required: true },
  candidateEmail: { type: String, required: true },
  candidatePhone: String,
  resumeFile: String, // S3 key
  appliedAt: { type: Date, default: Date.now }
});

const Application = mongoose.model('Application', applicationSchema);



// Document Collection Model
const DocumentCollection = require('./models/DocumentCollection');

// ==============================

// Document Collection Routes

// ==============================


// Add near the top with other helper functions

const outputDir = path.join(os.tmpdir(), `whisper_${Date.now()}`);

// Create NodeMailer transporter using custom SMTP
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: true, // Use STARTTLS instead of direct TLS
  tls: {
    rejectUnauthorized: false // Allow self-signed certificates
  },
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});
// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET;

// Middleware to verify JWT
const authenticateJWT = (req, res, next) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ message: 'Access denied. No token provided.' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: 'Invalid token.' });
    req.user = user;
    next();
  });
};

// Middleware to check if user is admin
const isAdmin = (req, res, next) => {
  if (!req.user.isAdmin) return res.status(403).json({ message: 'Admin access required.' });
  next();
};
// Modify authenticateJobPoster middleware in server.js
function authenticateJobPoster(req, res, next) {
  const token = req.cookies?.jobToken || req.headers.authorization?.split(' ')[1];
  const adminToken = req.cookies?.token || req.headers.authorization?.split(' ')[1];

  // First try normal HR auth
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;
      return next();
    } catch (err) {
      // Continue to admin check
    }
  }

  // Then try admin auth
  if (adminToken) {
    try {
      const decoded = jwt.verify(adminToken, JWT_SECRET);
      if (decoded.isAdmin) {
        req.user = { isAdmin: true };
        return next();
      }
    } catch (err) {
      return res.status(403).json({ message: 'Invalid token' });
    }
  }

  return res.status(401).json({ message: 'Login required' });
}



const verifyOwnership = (model) => async (req, res, next) => {
  try {
    const id = req.params.resumeId || req.params.jobDescriptionId || req.params.sessionId || req.params.id;

    console.log(`Verifying ownership for ${model.modelName} ${id}`);

    const doc = await model.findById(id);

    if (!doc) {
      console.log('❌ Document not found in DB for ID:', id);
      return res.status(404).json({ error: 'Document not found' });
    }

    // Admins skip ownership
    if (req.user.isAdmin) {
      console.log('✅ Admin access granted');
      return next();
    }

    // Ownership check
    if (!doc.user || doc.user.toString() !== req.user.id) {
      console.log('❌ Ownership mismatch', {
        documentOwner: doc.user,
        requestingUser: req.user.id
      });
      return res.status(403).json({
        error: 'Access denied',
        details: {
          documentOwner: doc.user,
          requestingUser: req.user.id
        }
      });
    }

    console.log('✅ Ownership verified successfully');
    next();
  } catch (error) {
    console.error('Ownership verification error:', error);
    res.status(500).json({
      error: 'Server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
/* report generation */



const logoPath = path.join(__dirname, 'assets', 'SMlogo.png');

async function generateAssessmentReport(sessionId, userId) {
  try {
    await waitForScores(sessionId);

    const [session, testResult, voiceAnswers] = await Promise.all([
      AssessmentSession.findById(sessionId)
        .populate('resumeId')
        .populate('jobDescriptionId')
        .populate('user'),
      TestResult.findOne({ assessmentSession: sessionId }),
      VoiceAnswer.find({ assessmentSession: sessionId }),
    ]);

    if (!session || !testResult) throw new Error('Assessment data not found');

    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));

    const drawPageBackground = () => {
      const width = doc.page.width;
      const height = doc.page.height;

      const gradient = doc.linearGradient(0, 0, width, 0);
      gradient.stop(0, '#10b981').stop(1, '#3b82f6');
      doc.rect(0, 0, width, height).fill(gradient);

      doc.fillColor('white').roundedRect(40, 40, width - 80, height - 80, 10).fill();

      if (fs.existsSync(logoPath)) {
        doc.image(logoPath, width - 90, 50, { width: 40 });
      }
    };

    const drawSectionBox = (height = 300) => {
      const width = doc.page.width;
      const y = doc.y + 10;
      doc.fillColor('white').roundedRect(60, y, width - 120, height, 8).fill();
      doc.moveDown(1);
      return y;
    };

    drawPageBackground();
    doc.on('pageAdded', drawPageBackground);

    // Title
    doc.fontSize(24).fillColor('#0f172a').font('Helvetica-Bold')
      .text('SkillMatrix AI Assessment Report', 0, 100, { align: 'center' });

    // Candidate Info
    doc.moveDown(2);
    doc.fillColor('#1e293b').fontSize(14).text('Candidate Information', 60, doc.y, { underline: true });
    doc.moveDown(0.5);
    doc.font('Helvetica').fontSize(12).fillColor('#334155')
      .text(`Email: ${session.candidateEmail}`, 60)
      .text(`Position: ${session.jobTitle}`, 60)
      .text(`Assessment Date: ${session.completedAt.toLocaleDateString()}`, 60);

    // Performance Summary
    doc.addPage();
    const chartY = drawSectionBox(400); // increased height
    doc.fillColor('#1e293b').fontSize(14)
      .text('Performance Summary', 70, chartY + 10, { underline: true });

    const chartBuffer = await createScoreChart({
      mcq: testResult.score,
      audio: testResult.audioScore,
      text: testResult.textScore,
      video: testResult.videoScore,
      combined: testResult.combinedScore,
    });

    doc.image(chartBuffer, 110, chartY + 40, { fit: [400, 250] }); // moved down to avoid overlap

    doc.fontSize(12).fillColor('#475569')
      .text(`MCQ Score: ${testResult.score.toFixed(2)}/100`, 60, chartY + 280)
      .text(`Audio Score: ${testResult.audioScore.toFixed(2)}/100`, 60)
      .text(`Text Score: ${testResult.textScore?.toFixed(2) || 'N/A'}/100`, 60)
      .text(`Video Score: ${testResult.videoScore.toFixed(2)}/100`, 60)
      .text(`Combined Score: ${testResult.combinedScore.toFixed(2)}/100`, 60);

    // MCQ Section
    doc.addPage();
    const headingY = drawSectionBox(60);
    doc.fillColor('#1e293b').fontSize(14)
      .text('MCQ Assessment Details', 70, headingY + 15, { underline: true });
    doc.moveDown(1);


    session.questions.forEach((q, i) => {
      if (doc.y > 680) doc.addPage();
      const y = drawSectionBox(100);
      doc.fontSize(12).fillColor('#334155').font('Helvetica-Bold')
        .text(`Q${i + 1}: ${q.question}`, 80, y + 15);
      doc.font('Helvetica').fontSize(10).fillColor('#64748b')
        .text(`Candidate Answer: ${q.userAnswer || 'Not answered'}`, 100)
        .text(`Correct Answer: ${q.correctAnswer}`, 100);
      doc.moveDown(2);
    });

    // Voice Section
    doc.addPage();
    const voiceY = drawSectionBox(); // Use default height or specify
    doc.fillColor('#1e293b').fontSize(14)
      .text('Voice Assessment', 70, voiceY + 15, { underline: true });
    doc.moveDown(1);



    voiceAnswers.forEach((answer, i) => {
      if (doc.y > 600) doc.addPage();
      const audioScore = answer.audioAnalysis?.grading?.['Total Score'] ?? 0;
      const textScore = answer.textEvaluation?.metrics?.total_average ?? 0;
      const metrics = answer.textEvaluation?.metrics || {};

      const boxHeight = 160 + (Object.keys(metrics).length * 12);
      const y = drawSectionBox(boxHeight);
      const boxStartX = 80;

      doc.fontSize(12).fillColor('#334155').font('Helvetica-Bold')
        .text(`Q${i + 1}: ${answer.question}`, boxStartX, y + 15, {
          width: doc.page.width - 160,
          lineBreak: true,
        });

      doc.fontSize(10).font('Helvetica').fillColor('#64748b')
        .text(`Answer: ${answer.answer || 'No answer provided'}`, boxStartX + 20, doc.y, {
          width: doc.page.width - 160,
          lineBreak: true,
        })
        .text(`Audio Score: ${Number(audioScore).toFixed(2)}/100`, boxStartX + 20)
        .text(`Text Evaluation Score: ${Number(textScore).toFixed(2)}/100`, boxStartX + 20);

      if (metrics) {
        doc.moveDown(0.2);
        doc.font('Helvetica-Bold').text('Detailed Text Metrics:', boxStartX + 20, doc.y);
        doc.font('Helvetica');
        Object.entries(metrics).forEach(([key, value]) => {
          if (!['total_average', 'total_overall_score'].includes(key)) {
            const val = typeof value === 'number' ? value.toFixed(2) : value;
            doc.text(`• ${key}: ${val}`, boxStartX + 40, doc.y);
          }
        });
      }


      doc.moveDown(2);
    });

    return new Promise((resolve, reject) => {
      doc.on('end', async () => {
        try {
          const pdfBuffer = Buffer.concat(buffers);
          const filename = `report_${sessionId}_${Date.now()}.pdf`;
          const s3Key = `reports/${filename}`;
          await uploadToS3(pdfBuffer, s3Key, 'application/pdf');
          const report = new Report({ assessmentSession: sessionId, s3Key, filename, user: userId });
          await report.save();
          await sendReportToHR(sessionId, userId, s3Key);
          resolve({ s3Key, filename, reportId: report._id });
        } catch (err) {
          reject(err);
        }
      });
      doc.end();
    });

  } catch (error) {
    console.error('Report generation failed:', error);
    throw error;
  }
}




async function createScoreChart(scores) {
  const canvas = createCanvas(700, 400);
  const ctx = canvas.getContext('2d');
  const keys = Object.keys(scores);
  const values = Object.values(scores).map(val => Number(val.toFixed(2)));

  const barWidth = 60;
  const gap = 30;
  const startX = 50;
  const baseY = 350;

  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = 'bold 13px "DejaVu Sans"';


  keys.forEach((key, i) => {
    const x = startX + i * (barWidth + gap);
    const height = (values[i] / 100) * 250;

    ctx.fillStyle = '#3b82f6';
    ctx.fillRect(x, baseY - height, barWidth, height);

    ctx.fillStyle = '#1e293b';
    ctx.fillText(`${values[i]}`, x + 5, baseY - height - 10);
    ctx.fillText(key, x + 5, baseY + 20);
  });

  return canvas.toBuffer();
}


async function waitForScores(sessionId) {
  const maxAttempts = 30;
  let attempts = 0;

  while (attempts < maxAttempts) {
    const [testResult, recording, voiceAnswers] = await Promise.all([
      TestResult.findOne({ assessmentSession: sessionId }),
      Recording.findOne({ assessmentSession: sessionId }),
      VoiceAnswer.find({ assessmentSession: sessionId })
    ]);

    // Enhanced check for text evaluation completion
    const scoresReady = testResult &&
      testResult.audioScore !== undefined &&
      testResult.textScore !== undefined && // Ensure textScore is checked
      testResult.videoScore !== undefined &&
      testResult.combinedScore !== undefined;

    const processingComplete =
      (!recording || recording.videoAnalysis?.status === 'completed') &&
      voiceAnswers.every(a =>
        (a.processingStatus === 'completed' ||
          a.processingStatus === 'failed' ||
          a.processingStatus === 'skipped') &&
        (a.textEvaluation?.status === 'completed' ||
          a.textEvaluation?.status === 'failed' ||
          a.textEvaluation?.status === 'skipped')
      );

    if (scoresReady && processingComplete) {
      return;
    }

    attempts++;
    await new Promise(resolve => setTimeout(resolve, 2 * 60 * 1000)); // 5 minutes

  }

  throw new Error('Timeout waiting for scores to be calculated');
}

async function sendReportEmail(userEmail, reportUrl, candidateEmail, jobTitle) {
  const mailOptions = {
    from: `"SkillMatrix Reports" <${process.env.EMAIL_USER}>`,
    to: userEmail,
    subject: `Assessment Report for ${candidateEmail} - ${jobTitle}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2563eb;">Assessment Report Ready</h2>
        <p>The assessment report for candidate <strong>${candidateEmail}</strong> is now available.</p>
        <p>Position: <strong>${jobTitle}</strong></p>
        
        <div style="text-align: center; margin: 20px 0;">
          <a href="${reportUrl}" 
             style="background-color: #2563eb; color: white; padding: 10px 20px; 
                    text-decoration: none; border-radius: 5px; display: inline-block;">
            Download Full Report
          </a>
        </div>
        
        <p style="color: #6b7280; font-size: 12px;">
          This report contains confidential assessment data. Please handle appropriately.
        </p>
      </div>
    `
  };

  await transporter.sendMail(mailOptions);
}
/*end points */


app.get('/api/resumes/:resumeId', authenticateJWT, verifyOwnership(Resume), async (req, res) => {
  try {
    const { resumeId } = req.params;

    // More thorough validation
    if (!mongoose.Types.ObjectId.isValid(resumeId)) {
      return res.status(400).json({ error: 'Invalid resume ID format' });
    }

    const resume = await Resume.findById(resumeId);
    if (!resume) {
      return res.status(404).json({ error: 'Resume not found' });
    }

    if (!resume.s3Key) {
      return res.status(404).json({ error: 'Resume file not found in storage' });
    }

    const command = new GetObjectCommand({
      Bucket: process.env.MINIO_BUCKET_NAME,
      Key: resume.s3Key,
      ResponseContentDisposition: req.query.download
        ? `attachment; filename="${encodeURIComponent(resume.filename)}"`
        : 'inline'
    });

    const url = await getSignedUrl(s3, command); // 1 hour expiration

    res.json({
      success: true,
      url,
      filename: resume.filename,

    });

  } catch (error) {
    console.error('Error retrieving resume:', error);

    let errorMessage = 'Failed to retrieve resume';
    if (error.name === 'NoSuchKey') {
      errorMessage = 'Resume file not found in storage';
    } else if (error.name === 'AccessDenied') {
      errorMessage = 'Access to resume denied';
    }

    res.status(500).json({
      success: false,
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// 🔥 NEW: Bulk Resume Download Endpoint
app.post('/api/resumes/bulk-download', authenticateJWT, async (req, res) => {
  try {
    const { resumeIds, candidates } = req.body;

    console.log('🔥 [BULK DOWNLOAD API] Starting bulk resume download:', {
      userId: req.user.id,
      resumeCount: resumeIds?.length || 0,
      candidateCount: candidates?.length || 0,
      timestamp: new Date().toISOString()
    });

    // Validate input
    if (!resumeIds || !Array.isArray(resumeIds) || resumeIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or empty resume IDs provided'
      });
    }

    if (resumeIds.length > 50) {
      return res.status(400).json({
        success: false,
        error: 'Maximum 50 resumes can be downloaded at once'
      });
    }

    // Fetch resumes with ownership verification
    const resumes = await Resume.find({
      _id: { $in: resumeIds },
      user: req.user.id // Ensure user owns these resumes
    });

    console.log('📊 [BULK DOWNLOAD API] Found resumes:', {
      requested: resumeIds.length,
      found: resumes.length,
      missing: resumeIds.length - resumes.length
    });

    if (resumes.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No accessible resumes found'
      });
    }

    // Create ZIP file
    const zip = new JSZip();
    let successCount = 0;
    let failureCount = 0;
    const downloadResults = [];

    // Process each resume
    for (let i = 0; i < resumes.length; i++) {
      const resume = resumes[i];
      try {
        console.log(`📄 [BULK DOWNLOAD API] Processing resume ${i + 1}/${resumes.length}:`, {
          resumeId: resume._id,
          filename: resume.filename,
          s3Key: resume.s3Key
        });

        // Get file from S3
        const command = new GetObjectCommand({
          Bucket: process.env.MINIO_BUCKET_NAME,
          Key: resume.s3Key
        });

        const response = await s3.send(command);
        const buffer = await streamToBuffer(response.Body);

        // Find candidate info for better filename
        const candidateInfo = candidates?.find(c =>
          c.resumeId === resume._id.toString() ||
          c.resumeId === resume._id
        );

        // Create safe filename
        const safeName = candidateInfo?.name ?
          candidateInfo.name.replace(/[^a-zA-Z0-9]/g, '_') :
          `Candidate_${i + 1}`;

        const fileExt = resume.filename ?
          resume.filename.split('.').pop() || 'pdf' : 'pdf';

        const zipFilename = candidateInfo?.matchingPercentage ?
          `${safeName}_${candidateInfo.matchingPercentage}%.${fileExt}` :
          `${safeName}.${fileExt}`;

        // Add to ZIP
        zip.file(zipFilename, buffer);

        successCount++;
        downloadResults.push({
          resumeId: resume._id,
          filename: resume.filename,
          zipFilename,
          success: true,
          candidateName: candidateInfo?.name || 'Unknown',
          matchingPercentage: candidateInfo?.matchingPercentage || 0
        });

        console.log(`✅ [BULK DOWNLOAD API] Resume added to ZIP: ${zipFilename}`);

      } catch (error) {
        console.error(`❌ [BULK DOWNLOAD API] Failed to process resume ${resume._id}:`, error);
        failureCount++;
        downloadResults.push({
          resumeId: resume._id,
          filename: resume.filename,
          success: false,
          error: error.message,
          candidateName: candidates?.find(c => c.resumeId === resume._id.toString())?.name || 'Unknown'
        });
      }
    }

    if (successCount === 0) {
      return res.status(500).json({
        success: false,
        error: 'Failed to process any resumes',
        details: downloadResults
      });
    }

    // Generate ZIP buffer
    console.log('📦 [BULK DOWNLOAD API] Generating ZIP file...');
    const zipBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });

    console.log('✅ [BULK DOWNLOAD API] ZIP file generated:', {
      sizeBytes: zipBuffer.length,
      sizeMB: (zipBuffer.length / 1024 / 1024).toFixed(2)
    });

    // Upload ZIP to S3 for download
    const zipKey = `bulk-downloads/${req.user.id}/${Date.now()}_resumes.zip`;
    const zipUploadCommand = new PutObjectCommand({
      Bucket: process.env.MINIO_BUCKET_NAME,
      Key: zipKey,
      Body: zipBuffer,
      ContentType: 'application/zip',
      ContentDisposition: `attachment; filename="bulk_resumes_${new Date().toISOString().split('T')[0]}.zip"`
    });

    await s3.send(zipUploadCommand);

    // Generate signed download URL
    const downloadCommand = new GetObjectCommand({
      Bucket: process.env.MINIO_BUCKET_NAME,
      Key: zipKey,
      ResponseContentDisposition: `attachment; filename="bulk_resumes_${new Date().toISOString().split('T')[0]}.zip"`
    });

    const downloadUrl = await getSignedUrl(s3, downloadCommand, { expiresIn: 3600 }); // 1 hour

    console.log('🎉 [BULK DOWNLOAD API] Bulk download completed successfully:', {
      successCount,
      failureCount,
      totalRequested: resumeIds.length,
      zipSizeMB: (zipBuffer.length / 1024 / 1024).toFixed(2),
      downloadUrl: downloadUrl.substring(0, 100) + '...'
    });

    res.json({
      success: true,
      downloadUrl,
      summary: {
        total: resumeIds.length,
        successful: successCount,
        failed: failureCount,
        zipSizeMB: (zipBuffer.length / 1024 / 1024).toFixed(2)
      },
      results: downloadResults
    });

  } catch (error) {
    console.error('❌ [BULK DOWNLOAD API] Bulk download failed:', error);

    let errorMessage = 'Failed to create bulk download';
    if (error.message.includes('timeout')) {
      errorMessage = 'Download timeout - too many files or network issues';
    } else if (error.message.includes('NoSuchKey')) {
      errorMessage = 'Some resume files are missing from storage';
    } else if (error.message.includes('AccessDenied')) {
      errorMessage = 'Access denied to some resume files';
    }

    res.status(500).json({
      success: false,
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ===========================
// MERGED PDF ENDPOINTS
// ===========================

// Generate merged PDF (resume + report) for a specific assessment session
app.post('/api/merged-pdf/generate/:sessionId', authenticateJWT, verifyOwnership(AssessmentSession), async (req, res) => {
  try {
    const { sessionId } = req.params;

    console.log(`🔄 [MERGED PDF API] Generating merged PDF for session: ${sessionId}`);

    // Generate merged PDF using the service
    const result = await generateMergedPDF(sessionId, req.user.id);

    if (result.success) {
      // Generate signed URL for download
      const command = new GetObjectCommand({
        Bucket: process.env.MINIO_BUCKET_NAME,
        Key: result.s3Key,
        ResponseContentDisposition: req.query.download ? `attachment; filename="${result.filename}"` : `inline`
      });

      const downloadUrl = await getSignedUrl(s3, command, { expiresIn: 3600 }); // 1 hour

      console.log(`✅ [MERGED PDF API] Generated merged PDF: ${result.mergedDocumentId}`);

      res.json({
        success: true,
        message: result.existed ? 'Merged PDF already exists' : 'Merged PDF generated successfully',
        data: {
          ...result,
          downloadUrl
        }
      });
    } else {
      throw new Error('Failed to generate merged PDF');
    }

  } catch (error) {
    console.error(`❌ [MERGED PDF API] Error generating merged PDF for session ${req.params.sessionId}:`, error);

    let errorMessage = 'Failed to generate merged PDF';
    if (error.message.includes('Assessment session not found')) {
      errorMessage = 'Assessment session not found';
    } else if (error.message.includes('Resume not found')) {
      errorMessage = 'Resume not available for this session';
    } else if (error.message.includes('Assessment report not found')) {
      errorMessage = 'Assessment report not available for this session';
    }

    res.status(500).json({
      success: false,
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get merged documents for a user
app.get('/api/merged-pdf/list', authenticateJWT, async (req, res) => {
  try {
    const { page = 1, limit = 20, status = 'completed' } = req.query;

    console.log(`📋 [MERGED PDF API] Fetching merged documents for user: ${req.user.id}`);

    const result = await getMergedDocuments(req.user.id, {
      page: parseInt(page),
      limit: parseInt(limit),
      status
    });

    res.json({
      success: true,
      data: result.documents,
      pagination: result.pagination
    });

  } catch (error) {
    console.error(`❌ [MERGED PDF API] Error fetching merged documents:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch merged documents',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Download individual merged PDF
app.get('/api/merged-pdf/:mergedDocId', authenticateJWT, async (req, res) => {
  try {
    const { mergedDocId } = req.params;

    console.log(`📥 [MERGED PDF API] Downloading merged PDF: ${mergedDocId}`);

    // Find merged document with ownership verification
    const mergedDoc = await MergedDocument.findOne({
      _id: mergedDocId,
      user: req.user.id
    });

    if (!mergedDoc) {
      return res.status(404).json({
        success: false,
        error: 'Merged document not found or access denied'
      });
    }

    if (mergedDoc.status !== 'completed') {
      return res.status(400).json({
        success: false,
        error: `Merged document is not ready (status: ${mergedDoc.status})`
      });
    }

    // Generate signed URL for download
    const command = new GetObjectCommand({
      Bucket: process.env.MINIO_BUCKET_NAME,
      Key: mergedDoc.s3Key,
      ResponseContentDisposition: req.query.download
        ? `attachment; filename="${encodeURIComponent(mergedDoc.filename)}"`
        : 'inline'
    });

    const url = await getSignedUrl(s3, command, { expiresIn: 3600 }); // 1 hour

    res.json({
      success: true,
      url,
      filename: mergedDoc.filename,
      candidateEmail: mergedDoc.candidateEmail,
      jobTitle: mergedDoc.jobTitle,
      generatedAt: mergedDoc.generatedAt
    });

  } catch (error) {
    console.error(`❌ [MERGED PDF API] Error downloading merged PDF:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to download merged PDF',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Bulk download merged PDFs
app.post('/api/merged-pdf/bulk-download', authenticateJWT, async (req, res) => {
  try {
    const { assessmentSessionIds, candidates } = req.body;

    console.log('🔥 [MERGED PDF BULK] Starting bulk merged PDF download:', {
      userId: req.user.id,
      sessionCount: assessmentSessionIds?.length || 0,
      candidateCount: candidates?.length || 0,
      timestamp: new Date().toISOString()
    });

    // Validate input
    if (!assessmentSessionIds || !Array.isArray(assessmentSessionIds) || assessmentSessionIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or empty assessment session IDs provided'
      });
    }

    if (assessmentSessionIds.length > 25) {
      return res.status(400).json({
        success: false,
        error: 'Maximum 25 merged documents can be downloaded at once'
      });
    }

    // Fetch merged documents with ownership verification using assessment session IDs
    const mergedDocs = await MergedDocument.find({
      assessmentSession: { $in: assessmentSessionIds },
      user: req.user.id,
      status: 'completed'
    }).populate('assessmentSession', 'candidateEmail jobTitle completedAt');

    console.log('📊 [MERGED PDF BULK] Found merged documents:', {
      requested: assessmentSessionIds.length,
      found: mergedDocs.length,
      missing: assessmentSessionIds.length - mergedDocs.length
    });

    if (mergedDocs.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No accessible merged documents found'
      });
    }

    // Create ZIP file
    const zip = new JSZip();
    let successCount = 0;
    let failureCount = 0;
    const downloadResults = [];

    // Process each merged document
    for (let i = 0; i < mergedDocs.length; i++) {
      const mergedDoc = mergedDocs[i];
      try {
        console.log(`📄 [MERGED PDF BULK] Processing document ${i + 1}/${mergedDocs.length}:`, {
          documentId: mergedDoc._id,
          filename: mergedDoc.filename,
          s3Key: mergedDoc.s3Key
        });

        // Get file from S3
        const command = new GetObjectCommand({
          Bucket: process.env.MINIO_BUCKET_NAME,
          Key: mergedDoc.s3Key
        });

        const response = await s3.send(command);
        const buffer = await streamToBuffer(response.Body);

        // Create safe filename for ZIP
        const safeName = mergedDoc.candidateEmail ?
          mergedDoc.candidateEmail.replace(/[^a-zA-Z0-9@.]/g, '_') :
          `Candidate_${i + 1}`;

        const zipFilename = `${safeName}_merged_${mergedDoc.generatedAt.toISOString().split('T')[0]}.pdf`;

        // Add to ZIP
        zip.file(zipFilename, buffer);

        successCount++;
        downloadResults.push({
          documentId: mergedDoc._id,
          filename: mergedDoc.filename,
          zipFilename,
          success: true,
          candidateEmail: mergedDoc.candidateEmail,
          jobTitle: mergedDoc.jobTitle
        });

        console.log(`✅ [MERGED PDF BULK] Document added to ZIP: ${zipFilename}`);

      } catch (error) {
        console.error(`❌ [MERGED PDF BULK] Failed to process document ${mergedDoc._id}:`, error);
        failureCount++;
        downloadResults.push({
          documentId: mergedDoc._id,
          filename: mergedDoc.filename,
          success: false,
          error: error.message,
          candidateEmail: mergedDoc.candidateEmail
        });
      }
    }

    if (successCount === 0) {
      return res.status(500).json({
        success: false,
        error: 'Failed to process any merged documents',
        details: downloadResults
      });
    }

    // Generate ZIP buffer
    console.log('📦 [MERGED PDF BULK] Generating ZIP file...');
    const zipBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });

    console.log('✅ [MERGED PDF BULK] ZIP file generated:', {
      sizeBytes: zipBuffer.length,
      sizeMB: (zipBuffer.length / 1024 / 1024).toFixed(2)
    });

    // Upload ZIP to S3 for download
    const zipKey = `bulk-downloads/${req.user.id}/${Date.now()}_merged_pdfs.zip`;
    const zipUploadCommand = new PutObjectCommand({
      Bucket: process.env.MINIO_BUCKET_NAME,
      Key: zipKey,
      Body: zipBuffer,
      ContentType: 'application/zip',
      ContentDisposition: `attachment; filename="bulk_merged_pdfs_${new Date().toISOString().split('T')[0]}.zip"`
    });

    await s3.send(zipUploadCommand);

    // Generate signed download URL
    const downloadCommand = new GetObjectCommand({
      Bucket: process.env.MINIO_BUCKET_NAME,
      Key: zipKey,
      ResponseContentDisposition: `attachment; filename="bulk_merged_pdfs_${new Date().toISOString().split('T')[0]}.zip"`
    });

    const downloadUrl = await getSignedUrl(s3, downloadCommand, { expiresIn: 3600 }); // 1 hour

    console.log('🎉 [MERGED PDF BULK] Bulk download completed successfully:', {
      successCount,
      failureCount,
      totalRequested: assessmentSessionIds.length,
      zipSizeMB: (zipBuffer.length / 1024 / 1024).toFixed(2)
    });

    res.json({
      success: true,
      downloadUrl,
      summary: {
        total: assessmentSessionIds.length,
        successful: successCount,
        failed: failureCount,
        zipSizeMB: (zipBuffer.length / 1024 / 1024).toFixed(2)
      },
      results: downloadResults
    });

  } catch (error) {
    console.error('❌ [MERGED PDF BULK] Bulk download failed:', error);

    let errorMessage = 'Failed to create bulk merged PDF download';
    if (error.message.includes('timeout')) {
      errorMessage = 'Download timeout - too many files or network issues';
    } else if (error.message.includes('NoSuchKey')) {
      errorMessage = 'Some merged PDF files are missing from storage';
    } else if (error.message.includes('AccessDenied')) {
      errorMessage = 'Access denied to some merged PDF files';
    }

    res.status(500).json({
      success: false,
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Add this endpoint right after your JobDescription endpoint
app.get('/api/job-descriptions/:jobDescriptionId', authenticateJWT, verifyOwnership(JobDescription), async (req, res) => {

  try {
    const { jobDescriptionId } = req.params;
    const jobDescription = await JobDescription.findById(jobDescriptionId);

    if (!jobDescription) {
      return res.status(404).json({ error: 'Job description not found.' });
    }
    const command = new GetObjectCommand({
      Bucket: process.env.MINIO_BUCKET_NAME,
      Key: jobDescription.s3Key,
      ResponseContentDisposition: req.query.download
        ? `attachment; filename="${jobDescription.filename}"`
        : undefined
    });

    const url = await getSignedUrl(s3, command); // 5 minutes
    res.status(200).json({ url });
  } catch (error) {
    console.error('Error retrieving job description:', error.message);
    res.status(500).json({ error: 'Failed to retrieve job description.' });
  }
});

// Add these endpoints after your existing JD routes

// Get all JDs for current user
app.get('/api/job-descriptions', authenticateJWT, async (req, res) => {
  try {
    const jds = await JobDescription.find({ user: req.user.id })
      .sort({ uploadedAt: -1 })
      .select('title filename uploadedAt');

    res.status(200).json(jds);
  } catch (error) {
    console.error('Error fetching job descriptions:', error);
    res.status(500).json({ error: 'Failed to fetch job descriptions' });
  }
});

// Get JD content by ID
app.get('/api/job-descriptions/:id/content', authenticateJWT, verifyOwnership(JobDescription), async (req, res) => {
  try {
    const jd = await JobDescription.findById(req.params.id);
    if (!jd) {
      return res.status(404).json({ error: 'Job description not found' });
    }

    const command = new GetObjectCommand({
      Bucket: process.env.MINIO_BUCKET_NAME,
      Key: jd.s3Key
    });

    const url = await getSignedUrl(s3, command);
    const response = await axios.get(url, { responseType: 'arraybuffer' });

    res.status(200).send(response.data);
  } catch (error) {
    console.error('Error fetching JD content:', error);
    res.status(500).json({ error: 'Failed to fetch JD content' });
  }
});

// Update JD title
app.put('/api/job-descriptions/:id/title', authenticateJWT, verifyOwnership(JobDescription), async (req, res) => {
  try {
    const { title } = req.body;
    if (!title || typeof title !== 'string') {
      return res.status(400).json({ error: 'Valid title is required' });
    }

    const updatedJd = await JobDescription.findByIdAndUpdate(
      req.params.id,
      { title },
      { new: true }
    );

    res.status(200).json(updatedJd);
  } catch (error) {
    console.error('Error updating JD title:', error);
    res.status(500).json({ error: 'Failed to update JD title' });
  }
});

// Delete JD
app.delete('/api/job-descriptions/:id', authenticateJWT, verifyOwnership(JobDescription), async (req, res) => {
  try {
    await JobDescription.findByIdAndDelete(req.params.id);
    // Note: You may want to also delete from S3 in production
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error deleting JD:', error);
    res.status(500).json({ error: 'Failed to delete JD' });
  }
});

// ==============================
// ✅ SCHEDULED TEST PLATFORM APIs
// ==============================

// 🔥 ENHANCED: Create a new scheduled test with REAL-TIME processing
app.post('/api/schedule-test', authenticateJWT, upload.fields([{ name: 'resume' }, { name: 'job_description' }]), async (req, res) => {
  const startTime = Date.now();
  console.log('\n🚀 ===== SCHEDULED TEST CREATION STARTED =====');
  console.log('📊 Request Details:', {
    user: req.user.email,
    timestamp: new Date().toISOString(),
    body: { ...req.body, files: Object.keys(req.files || {}) }
  });

  try {
    const { candidateName, candidateEmail, scheduledDateTime } = req.body;
    const { files } = req;

    // ✅ STEP 1: Validate required fields
    console.log('\n📝 Step 1: Validating input fields...');
    if (!candidateName || !candidateEmail || !scheduledDateTime || !files?.resume || !files?.job_description) {
      console.error('❌ Validation failed: Missing required fields');
      return res.status(400).json({ error: 'All fields are required: candidateName, candidateEmail, scheduledDateTime, resume, job_description' });
    }

    const scheduledTime = new Date(scheduledDateTime);
    const now = new Date();

    if (scheduledTime <= now) {
      console.error('❌ Validation failed: Scheduled time is in the past');
      return res.status(400).json({ error: 'Scheduled time must be in the future' });
    }

    console.log('✅ Input validation passed:', {
      candidateName,
      candidateEmail,
      scheduledTime: scheduledTime.toISOString()
    });

    // Calculate expiration time (2 days after scheduled time)
    const expiresAt = new Date(scheduledTime.getTime() + (2 * 24 * 60 * 60 * 1000));

    // ✅ STEP 2: Process resume file
    console.log('\n📄 Step 2: Processing resume file...');
    const resumeFile = files.resume[0];
    const resumeHash = calculateHash(resumeFile.buffer);
    let resumeDoc = await Resume.findOne({ hash: resumeHash });

    if (!resumeDoc) {
      console.log('📤 Uploading new resume to S3...');
      const resumeS3Key = `resumes/${Date.now()}_${resumeFile.originalname}`;
      await uploadToS3(resumeFile.buffer, resumeS3Key, 'application/pdf');

      resumeDoc = new Resume({
        title: resumeFile.originalname,
        s3Key: resumeS3Key,
        filename: resumeFile.originalname,
        hash: resumeHash,
        user: req.user.id
      });
      await resumeDoc.save();
      console.log('✅ Resume uploaded and saved:', resumeDoc._id);
    } else {
      console.log('♻️ Using existing resume:', resumeDoc._id);
    }

    // ✅ STEP 3: Process job description file
    console.log('\n📋 Step 3: Processing job description file...');
    const jdFile = files.job_description[0];
    const jdHash = calculateHash(jdFile.buffer);
    let jdDoc = await JobDescription.findOne({ hash: jdHash });

    if (!jdDoc) {
      console.log('📤 Uploading new JD to S3...');
      const jdS3Key = `job_descriptions/${Date.now()}_${jdFile.originalname}`;
      await uploadToS3(jdFile.buffer, jdS3Key, 'application/pdf');

      jdDoc = new JobDescription({
        title: req.body.job_description_title || jdFile.originalname,
        s3Key: jdS3Key,
        filename: jdFile.originalname,
        hash: jdHash,
        user: req.user.id
      });
      await jdDoc.save();
      console.log('✅ Job description uploaded and saved:', jdDoc._id);
    } else {
      console.log('♻️ Using existing job description:', jdDoc._id);
    }

    // ✅ STEP 4: Create scheduled test entry
    console.log('\n🗓️ Step 4: Creating scheduled test entry...');
    const token = uuidv4();
    const testLink = `${process.env.FRONTEND_URL}/assessment/${token}`;

    const scheduledTest = new ScheduledTest({
      candidateName,
      candidateEmail,
      scheduledDateTime: scheduledTime,
      expiresAt,
      resumeId: resumeDoc._id,
      jobDescriptionId: jdDoc._id,
      testLink,
      token,
      user: req.user.id
    });

    await scheduledTest.save();
    console.log('✅ Scheduled test created:', scheduledTest._id);

    // ✅ STEP 5: Generate questions IMMEDIATELY
    console.log('\n🧠 Step 5: Generating questions immediately...');
    let questionsGenerated = false;
    let questionsError = null;

    try {
      await generateQuestionsForScheduledTest(scheduledTest._id);
      questionsGenerated = true;
      console.log('✅ Questions generated successfully!');
    } catch (error) {
      questionsError = error.message;
      console.error('❌ Question generation failed:', error);
      // Don't fail the entire process, log and continue
    }

    // ✅ STEP 6: Send confirmation email IMMEDIATELY
    console.log('\n📧 Step 6: Sending confirmation email...');
    let emailSent = false;
    let emailError = null;

    try {
      await sendScheduledTestConfirmationEmail(scheduledTest);
      emailSent = true;
      console.log('✅ Confirmation email sent successfully!');
    } catch (error) {
      emailError = error.message;
      console.error('❌ Email sending failed:', error);
      // Don't fail the entire process, log and continue
    }

    // ✅ STEP 7: Update test status based on operations
    if (questionsGenerated) {
      scheduledTest.questionsGenerated = true;
      await scheduledTest.save();
    }

    const totalTime = Date.now() - startTime;
    console.log('\n🎉 ===== SCHEDULED TEST CREATION COMPLETED =====');
    console.log('📊 Final Summary:', {
      testId: scheduledTest._id,
      questionsGenerated,
      emailSent,
      totalProcessingTime: `${totalTime}ms`,
      errors: { questionsError, emailError }
    });

    // Send comprehensive response with real-time feedback
    res.status(201).json({
      success: true,
      message: 'Test scheduled successfully with real-time processing',
      data: {
        scheduledTestId: scheduledTest._id,
        candidateName,
        candidateEmail,
        scheduledDateTime: scheduledTime,
        expiresAt,
        testLink,
        status: 'scheduled',
        // 🔥 REAL-TIME FEEDBACK:
        processing: {
          questionsGenerated,
          emailSent,
          processingTime: `${totalTime}ms`,
          timestamp: new Date().toISOString()
        },
        errors: questionsError || emailError ? { questionsError, emailError } : null
      }
    });

  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error('\n💥 ===== SCHEDULED TEST CREATION FAILED =====');
    console.error('❌ Error details:', {
      message: error.message,
      stack: error.stack,
      processingTime: `${totalTime}ms`
    });

    res.status(500).json({
      error: 'Failed to schedule test',
      details: error.message,
      processingTime: `${totalTime}ms`
    });
  }
});

// Get all scheduled tests for current user
app.get('/api/scheduled-tests', authenticateJWT, async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    let query = { user: req.user.id };
    if (status) {
      query.status = status;
    }

    const scheduledTests = await ScheduledTest.find(query)
      .populate('resumeId', 'title filename')
      .populate('jobDescriptionId', 'title filename')
      .populate('assessmentSession', 'status completedAt')
      .sort({ scheduledDateTime: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await ScheduledTest.countDocuments(query);

    res.status(200).json({
      success: true,
      data: scheduledTests,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('Error fetching scheduled tests:', error);
    res.status(500).json({ error: 'Failed to fetch scheduled tests' });
  }
});

// Get single scheduled test
app.get('/api/scheduled-tests/:id', authenticateJWT, async (req, res) => {
  try {
    const scheduledTest = await ScheduledTest.findOne({
      _id: req.params.id,
      user: req.user.id
    })
      .populate('resumeId')
      .populate('jobDescriptionId')
      .populate('assessmentSession');

    if (!scheduledTest) {
      return res.status(404).json({ error: 'Scheduled test not found' });
    }

    res.status(200).json({
      success: true,
      data: scheduledTest
    });

  } catch (error) {
    console.error('Error fetching scheduled test:', error);
    res.status(500).json({ error: 'Failed to fetch scheduled test' });
  }
});

// Get scheduled test by assessment session ID
app.get('/api/scheduled-tests/by-assessment-session/:assessmentSessionId', authenticateJWT, async (req, res) => {
  try {
    const { assessmentSessionId } = req.params;

    const scheduledTest = await ScheduledTest.findOne({
      assessmentSession: assessmentSessionId,
      user: req.user.id
    })
      .populate('resumeId')
      .populate('jobDescriptionId')
      .populate('assessmentSession');

    if (!scheduledTest) {
      return res.status(404).json({
        success: false,
        error: 'Scheduled test not found for this assessment session'
      });
    }

    res.status(200).json({
      success: true,
      data: scheduledTest
    });

  } catch (error) {
    console.error('Error fetching scheduled test by assessment session:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch scheduled test'
    });
  }
});

// Update scheduled test (only if not started yet)
app.put('/api/scheduled-tests/:id', authenticateJWT, async (req, res) => {
  try {
    const { candidateName, candidateEmail, scheduledDateTime } = req.body;
    const scheduledTest = await ScheduledTest.findOne({
      _id: req.params.id,
      user: req.user.id
    });

    if (!scheduledTest) {
      return res.status(404).json({ error: 'Scheduled test not found' });
    }

    if (scheduledTest.status !== 'scheduled') {
      return res.status(400).json({ error: 'Cannot update test that has already started or completed' });
    }

    const scheduledTime = new Date(scheduledDateTime);
    const now = new Date();

    if (scheduledTime <= now) {
      return res.status(400).json({ error: 'Scheduled time must be in the future' });
    }

    const expiresAt = new Date(scheduledTime.getTime() + (2 * 24 * 60 * 60 * 1000));

    scheduledTest.candidateName = candidateName || scheduledTest.candidateName;
    scheduledTest.candidateEmail = candidateEmail || scheduledTest.candidateEmail;
    scheduledTest.scheduledDateTime = scheduledTime;
    scheduledTest.expiresAt = expiresAt;

    await scheduledTest.save();

    res.status(200).json({
      success: true,
      message: 'Scheduled test updated successfully',
      data: scheduledTest
    });

  } catch (error) {
    console.error('Error updating scheduled test:', error);
    res.status(500).json({ error: 'Failed to update scheduled test' });
  }
});

// Cancel scheduled test
app.delete('/api/scheduled-tests/:id', authenticateJWT, async (req, res) => {
  try {
    const scheduledTest = await ScheduledTest.findOne({
      _id: req.params.id,
      user: req.user.id
    });

    if (!scheduledTest) {
      return res.status(404).json({ error: 'Scheduled test not found' });
    }

    if (scheduledTest.status === 'completed') {
      return res.status(400).json({ error: 'Cannot cancel completed test' });
    }

    scheduledTest.status = 'cancelled';
    await scheduledTest.save();

    res.status(200).json({
      success: true,
      message: 'Scheduled test cancelled successfully'
    });

  } catch (error) {
    console.error('Error cancelling scheduled test:', error);
    res.status(500).json({ error: 'Failed to cancel scheduled test' });
  }
});

// Validate scheduled assessment token
app.get('/api/validate-scheduled-assessment/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const scheduledTest = await ScheduledTest.findOne({ token });

    if (!scheduledTest) {
      return res.status(404).json({
        valid: false,
        error: 'Assessment link not found',
        code: 'INVALID_TOKEN'
      });
    }

    const now = new Date();

    // Check if test has already been completed
    if (scheduledTest.status === 'completed') {
      return res.status(410).json({
        valid: false,
        error: 'This assessment has already been completed successfully.',
        code: 'ALREADY_COMPLETED'
      });
    }

    // Check if test has expired
    if (now > scheduledTest.expiresAt) {
      scheduledTest.status = 'expired';
      await scheduledTest.save();

      return res.status(410).json({
        valid: false,
        error: 'Assessment link has expired',
        code: 'EXPIRED'
      });
    }

    // Check if it's time to start the test
    if (now < scheduledTest.scheduledDateTime) {
      return res.status(403).json({
        valid: false,
        error: `Assessment will be available from ${scheduledTest.scheduledDateTime.toLocaleString()}`,
        code: 'NOT_YET_ACTIVE',
        scheduledTime: scheduledTest.scheduledDateTime
      });
    }

    // Check if cancelled
    if (scheduledTest.status === 'cancelled') {
      return res.status(410).json({
        valid: false,
        error: 'Assessment has been cancelled',
        code: 'CANCELLED'
      });
    }

    // Activate the test if it's scheduled
    if (scheduledTest.status === 'scheduled') {
      scheduledTest.status = 'active';
      scheduledTest.activatedAt = now;
      await scheduledTest.save();
    }

    res.status(200).json({
      valid: true,
      message: 'Assessment link is valid',
      data: {
        candidateName: scheduledTest.candidateName,
        candidateEmail: scheduledTest.candidateEmail,
        expiresAt: scheduledTest.expiresAt,
        type: 'scheduled'
      }
    });

  } catch (error) {
    console.error('Error validating scheduled assessment:', error);
    res.status(500).json({
      valid: false,
      error: 'Server error during validation'
    });
  }
});

// ==============================
// ✅ END SCHEDULED TEST PLATFORM APIs
// ==============================

app.get('/api/recommendations/candidates', authenticateJWT, async (req, res) => {
  try {
    // ✅ Final logic — fetch all candidates who gave consent
    const query = {
      'candidateConsent.allowedToShare': true
    };

    const sharedResponses = await ApiResponse.find(query)
      .populate('resumeId', 'title filename')
      .populate('jobDescriptionId', 'title filename')
      .sort({ createdAt: -1 });

    const testScores = await TestResult.find();
    const sessions = await AssessmentSession.find()
      .populate({
        path: 'recording',
        select: 'videoPath screenPath videoAnalysis -_id'
      })
      .populate('testResult')
      .populate({
        path: 'voiceAnswers',
        select: 'question audioPath answer -_id'
      });

    const enrichedResponses = sharedResponses.map(candidate => {
      const email = candidate.matchingResult?.[0]?.["Resume Data"]?.email;
      const testScore = testScores.find(ts => ts.candidateEmail === email);
      const session = sessions.find(s => s.candidateEmail === email);

      return {
        ...candidate.toObject(),
        testScore: testScore || null,
        assessmentSession: session || null
      };
    });

    res.status(200).json(enrichedResponses);
  } catch (error) {
    console.error('Error fetching recommended candidates:', error.message);
    res.status(500).json({ error: 'Failed to fetch recommended candidates.' });
  }
});

app.get('/api/candidate-filtering', authenticateJWT, async (req, res) => {
  try {
    // Step 1: Fetch base candidate responses
    const responses = await ApiResponse.find({ user: req.user.id })
      .populate('resumeId', 'title filename')
      .populate('jobDescriptionId', 'title filename')
      .sort({ createdAt: -1 });

    // Step 2: Fetch related test scores and assessment sessions with proper population
    const testScores = await TestResult.find();
    const sessions = await AssessmentSession.find()
      .populate({
        path: 'recording',
        select: 'videoPath screenPath videoAnalysis -_id'
      })
      .populate('testResult')
      .populate({
        path: 'voiceAnswers',
        select: 'question audioPath answer -_id'
      });

    // Step 3: Enrich responses by matching candidate email
    const enrichedResponses = responses.map(candidate => {
      const email = candidate.matchingResult?.[0]?.["Resume Data"]?.email;

      const testScore = testScores.find(ts => ts.candidateEmail === email);
      const session = sessions.find(s => s.candidateEmail === email);

      return {
        ...candidate.toObject(),
        testScore: testScore || null,
        assessmentSession: session || null
      };
    });

    res.status(200).json(enrichedResponses);
  } catch (error) {
    console.error('Error fetching candidate filtering data:', error.message);
    res.status(500).json({ error: 'Failed to fetch candidate filtering data.' });
  }
});

// Add this new endpoint while keeping all existing endpoints
app.get('/api/candidates/segmented', authenticateJWT, async (req, res) => {
  try {
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Fetch responses with proper population
    const responses = await ApiResponse.find({ user: req.user.id })
      .populate('resumeId', 'title filename')
      .populate('jobDescriptionId', 'title filename')
      .sort({ createdAt: -1 });

    const testScores = await TestResult.find();
    const sessions = await AssessmentSession.find()
      .populate({
        path: 'recording',
        select: 'videoPath screenPath videoAnalysis -_id'
      })
      .populate('testResult')
      .populate({
        path: 'voiceAnswers',
        select: 'question audioPath answer -_id'
      });

    // Enrich all responses first
    const enrichedResponses = responses.map(candidate => {
      const email = candidate.matchingResult?.[0]?.["Resume Data"]?.email;
      const testScore = testScores.find(ts => ts.candidateEmail === email);
      const session = sessions.find(s => s.candidateEmail === email);

      return {
        ...candidate.toObject(),
        testScore: testScore || null,
        assessmentSession: session || null
      };
    });

    // Segment the enriched responses
    const recent = enrichedResponses.filter(candidate =>
      new Date(candidate.createdAt) >= oneWeekAgo
    );

    const history = enrichedResponses.filter(candidate =>
      new Date(candidate.createdAt) < oneWeekAgo
    );

    res.status(200).json({
      recent,
      history
    });

  } catch (error) {
    console.error('Error fetching segmented candidates:', error.message);
    res.status(500).json({ error: 'Failed to fetch segmented candidates.' });
  }
});

app.get('/api/consent/:apiResponseId', async (req, res) => {
  const { apiResponseId } = req.params;
  const { allow } = req.query;

  try {
    if (allow !== 'true') {
      return res.status(400).send('❌ Invalid or missing consent flag.');
    }

    const updated = await ApiResponse.findByIdAndUpdate(
      apiResponseId,
      { candidateConsent: { allowedToShare: true, respondedAt: new Date() } },
      { new: true }
    );

    if (!updated) return res.status(404).send('❌ Consent not found');

    res.send(`
      <html>
        <head>
          <title>Consent Submitted</title>
          <style>
            body {
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              background: linear-gradient(135deg, #4f46e5, #6ee7b7);
              color: white;
              height: 100vh;
              margin: 0;
              display: flex;
              align-items: center;
              justify-content: center;
              flex-direction: column;
              animation: fadeIn 1s ease-in;
            }

            .card {
              background: rgba(255, 255, 255, 0.1);
              border-radius: 16px;
              padding: 30px 40px;
              box-shadow: 0 8px 20px rgba(0,0,0,0.25);
              text-align: center;
              backdrop-filter: blur(10px);
              max-width: 500px;
            }

            h1 {
              margin-top: 0;
              font-size: 2.5rem;
              margin-bottom: 20px;
            }

            p {
              font-size: 1.1rem;
              line-height: 1.6;
              margin-bottom: 30px;
            }

            .checkmark {
              font-size: 4rem;
              margin-bottom: 20px;
              color: #10b981;
              animation: popIn 0.5s ease-out;
            }

            @keyframes fadeIn {
              from { opacity: 0; }
              to { opacity: 1; }
            }

            @keyframes popIn {
              0% { transform: scale(0); }
              70% { transform: scale(1.2); }
              100% { transform: scale(1); }
            }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="checkmark">✓</div>
            <h1>Thank You!</h1>
            <p>Your consent has been recorded successfully. The HR team will now be able to view your profile details.</p>
            <p>You can now close this window.</p>
          </div>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('Consent update error:', error);
    res.status(500).send('❌ Server error while updating consent.');
  }
});

// ✅ FILE: server.js (or routes file)
app.get('/api/recommendations/candidates', authenticateJWT, async (req, res) => {
  try {
    // ✅ Final logic — fetch all candidates who gave consent
    const query = {
      'candidateConsent.allowedToShare': true
    };

    const sharedResponses = await ApiResponse.find(query)
      .populate('resumeId', 'title filename')
      .populate('jobDescriptionId', 'title filename')
      .sort({ createdAt: -1 });

    const testScores = await TestResult.find();
    const sessions = await AssessmentSession.find()
      .populate('recording')
      .populate('testResult');

    const enriched = sharedResponses.map(candidate => {
      const email = candidate.matchingResult?.[0]?.["Resume Data"]?.email;
      const testScore = testScores.find(ts => ts.candidateEmail === email);
      const session = sessions.find(s => s.candidateEmail === email);

      return {
        ...candidate.toObject(),
        testScore: testScore || null,
        assessmentSession: session || null
      };
    });

    res.status(200).json(enriched);
  } catch (error) {
    console.error('Error fetching recommended candidates:', error);
    res.status(500).json({ error: 'Failed to fetch recommended candidates.' });
  }
});




// WebSocket connection handler
io.on('connection', (socket) => {
  console.log('WebSocket client connected.');
  socket.on('disconnect', () => {
    console.log('WebSocket client disconnected.');
  });
});

// Emit event on new ApiResponse creation
const emitApiResponseUpdate = (newResponse) => {
  io.emit('apiResponseUpdated', newResponse);
};
// Add this near the top with other utility functions
const calculateHash = (buffer) => {
  return crypto.createHash('sha256').update(buffer).digest('hex');
};


/* relared to the subscription */
// Subscription check middleware
// Updated checkSubscription middleware
// Enhanced checkSubscription middleware
const checkSubscription = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);

    // Admins bypass all checks
    if (user.isAdmin) return next();

    // Check if subscription exists and is active
    if (!user.subscription || !user.subscription.isActive) {
      return res.status(403).json({
        message: 'Subscription inactive. Please contact admin.'
      });
    }

    // Check if subscription expired
    if (user.subscription.expiresAt && new Date() > user.subscription.expiresAt) {
      // Automatically downgrade to trial if paid subscription expires
      if (user.subscription.plan === 'paid') {
        await downgradeToTrial(user._id);
      }
      return res.status(403).json({
        message: 'Subscription expired. Please renew your plan.'
      });
    }

    next();
  } catch (error) {
    console.error('Subscription check error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Helper function to downgrade to trial
async function downgradeToTrial(userId) {
  const now = new Date();
  await User.findByIdAndUpdate(userId, {
    $unset: {
      isUnlimited: ""
    },
    subscription: {
      plan: 'trial',
      startedAt: now,
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000), // 1 day
      isActive: true,
      limits: {
        jdUploads: 1,
        resumeUploads: 5,
        assessments: 1
      }
    },
    trialStart: now,
    trialEnd: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    usage: {
      jdUploads: 0,
      resumeUploads: 0,
      assessments: 0
    }
  });
}
// Updated usage limit middleware

// Enhanced checkUsageLimits middleware
// Enhanced checkUsageLimits middleware
const checkUsageLimits = (type) => async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);

    // Skip all checks for admin
    if (user.isAdmin) return next();

    // Skip checks for paid users without limits
    if (user.subscription.plan === 'paid' && !user.subscription.limits) {
      return next();
    }

    // Check if subscription exists and is active
    if (!user.subscription || !user.subscription.isActive) {
      return res.status(403).json({
        message: 'Subscription inactive. Please contact admin.'
      });
    }

    // Check if expired
    if (user.subscription.expiresAt && new Date() > user.subscription.expiresAt) {
      return res.status(403).json({
        message: 'Subscription expired. Please renew your plan.'
      });
    }

    // Check usage against limits
    if (user.subscription.limits && user.usage[type] >= user.subscription.limits[type]) {
      return res.status(403).json({
        message: `You've reached your ${type} limit for your current plan.`
      });
    }

    next();
  } catch (error) {
    console.error('Usage limit check error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Helper function for trial limits
const getTrialLimit = (type) => {
  const trialLimits = {
    jdUploads: 1,
    resumeUploads: 10,
    assessments: 1
  };
  return trialLimits[type] || 0;
};

// 🔥 NEW: JD Validation Endpoint
app.post('/api/validate-jd', authenticateJWT, upload.single('job_description'), async (req, res) => {
  try {
    console.log('📥 JD Validation Request Received:', {
      userId: req.user?.id,
      timestamp: new Date().toISOString(),
      hasFile: !!req.file,
      fileName: req.file?.originalname,
      fileSize: req.file?.size,
      mimeType: req.file?.mimetype
    });

    // Check if file is provided
    if (!req.file) {
      console.log('❌ JD Validation Failed: No file provided');
      return res.status(400).json({
        success: false,
        error: 'Job description file is required.'
      });
    }

    // Check file type (should be PDF)
    if (req.file.mimetype !== 'application/pdf') {
      console.log('❌ JD Validation Failed: Invalid file type', {
        receivedType: req.file.mimetype,
        expectedType: 'application/pdf'
      });
      return res.status(400).json({
        success: false,
        error: 'Only PDF files are allowed for job descriptions.'
      });
    }

    // Check file size (25MB limit)
    if (req.file.size > 25 * 1024 * 1024) {
      console.log('❌ JD Validation Failed: File too large', {
        fileSize: req.file.size,
        maxSize: 25 * 1024 * 1024
      });
      return res.status(400).json({
        success: false,
        error: 'File size should be less than 25MB.'
      });
    }

    // Log environment variable
    console.log('🔧 Environment Variables Check:', {
      jdValidatorUrl: process.env.JD_VALIDATOR,
      hasJdValidator: !!process.env.JD_VALIDATOR
    });

    if (!process.env.JD_VALIDATOR) {
      console.log('❌ JD_VALIDATOR environment variable not set');
      return res.status(500).json({
        success: false,
        error: 'JD validation service not configured'
      });
    }

    console.log('🔄 Calling JD Validator API:', {
      apiUrl: process.env.JD_VALIDATOR,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      mimeType: req.file.mimetype
    });

    // Call JD Validator API
    const formData = new FormData();
    formData.append('job_description', req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype
    });

    console.log('📦 FormData prepared with job description file');

    console.log('📤 Sending request to JD_VALIDATOR API...');

    const validatorResponse = await axios.post(
      process.env.JD_VALIDATOR,
      formData,
      { headers: formData.getHeaders() }
    );

    console.log('📥 Received response from JD_VALIDATOR API:', {
      status: validatorResponse.status,
      statusText: validatorResponse.statusText,
      hasData: !!validatorResponse.data,
      dataKeys: validatorResponse.data ? Object.keys(validatorResponse.data) : [],
      // Fixed: Access the correct nested structure with proper null checks
      isValid: validatorResponse.data?.data?.validation?.isValid,
      suitabilityScore: validatorResponse.data?.data?.validation?.suitabilityScore,
      fullDataStructure: process.env.NODE_ENV === 'development' ? validatorResponse.data : 'hidden in production'
    });

    // Check if the response has the expected structure
    console.log('🔍 Checking response structure:', {
      hasData: !!validatorResponse.data,
      hasSuccess: validatorResponse.data?.success,
      hasNestedData: !!(validatorResponse.data && validatorResponse.data.data),
      nestedDataKeys: (validatorResponse.data && validatorResponse.data.data) ? Object.keys(validatorResponse.data.data) : [],
      fullResponse: process.env.NODE_ENV === 'development' ? validatorResponse.data : 'hidden in production'
    });

    if (!validatorResponse.data) {
      console.log('❌ JD_VALIDATOR API returned no data');
      return res.status(500).json({
        success: false,
        error: 'No data received from JD validation service'
      });
    }

    if (!validatorResponse.data.success) {
      console.log('❌ JD_VALIDATOR API returned error:', validatorResponse.data);
      return res.status(500).json({
        success: false,
        error: 'Invalid response from JD validation service',
        details: validatorResponse.data
      });
    }

    if (!validatorResponse.data.data) {
      console.log('❌ JD_VALIDATOR API returned no validation data:', validatorResponse.data);
      return res.status(500).json({
        success: false,
        error: 'No validation data received from JD validation service',
        details: validatorResponse.data
      });
    }

    // Return validation result with the correct structure
    const responsePayload = {
      success: true,
      data: validatorResponse.data.data // Extract the actual data object
    };

    console.log('✅ JD Validation Successful, sending response:', {
      isValid: responsePayload.data?.validation?.isValid,
      suitabilityScore: responsePayload.data?.validation?.suitabilityScore,
      hasValidation: !!(responsePayload.data && responsePayload.data.validation),
      validationKeys: (responsePayload.data && responsePayload.data.validation) ? Object.keys(responsePayload.data.validation) : []
    });

    res.status(200).json(responsePayload);
  } catch (error) {
    console.error('❌ JD Validation Error:', {
      message: error.message,
      stack: error.stack,
      code: error.code,
      responseStatus: error.response?.status,
      responseStatusText: error.response?.statusText,
      responseData: error.response?.data
    });

    // Handle specific error cases
    if (error.response) {
      // The request was made and the server responded with a status code
      console.log('📡 Error response from JD_VALIDATOR API:', {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data
      });

      return res.status(error.response.status).json({
        success: false,
        error: error.response.data?.error || 'JD validation failed',
        details: process.env.NODE_ENV === 'development' ? error.response.data : undefined
      });
    } else if (error.request) {
      // The request was made but no response was received
      console.log('⏰ No response received from JD_VALIDATOR API');

      return res.status(500).json({
        success: false,
        error: 'No response from JD validation service'
      });
    } else {
      // Something happened in setting up the request
      console.log('🔧 Error setting up request to JD_VALIDATOR API');

      return res.status(500).json({
        success: false,
        error: 'Failed to validate job description',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
});

app.post('/api/submit', authenticateJWT, checkSubscription, checkUsageLimits('jdUploads'), checkUsageLimits('resumeUploads'), upload.fields([{ name: 'resumes' }, { name: 'job_description' }]), async (req, res) => {
  let duplicateCount = 0;
  try {
    const { files } = req;

    if (!files || !files.resumes || !files.job_description) {
      return res.status(400).json({ error: 'Resumes and job descriptions are required.' });
    }

    const results = [];

    // Process job descriptions
    for (const jobDescription of files.job_description) {
      const jdHash = calculateHash(jobDescription.buffer);

      let jobDescDoc = await JobDescription.findOne({ hash: jdHash });
      if (!jobDescDoc) {
        // Upload to S3
        const jdS3Params = {
          Bucket: process.env.MINIO_BUCKET_NAME,
          Key: `job_descriptions/${Date.now()}_${jobDescription.originalname}`,
          Body: jobDescription.buffer,
          ContentType: 'application/pdf'
        };
        await s3.send(new PutObjectCommand(jdS3Params));

        jobDescDoc = new JobDescription({
          title: jobDescription.originalname,
          s3Key: jdS3Params.Key, // Store the S3 key
          filename: jobDescription.originalname,
          hash: jdHash,
          user: req.user.id
        });
        await jobDescDoc.save();
      }

      // Process resumes
      for (const resume of files.resumes) {
        const resumeHash = calculateHash(resume.buffer);

        let resumeDoc = await Resume.findOne({ hash: resumeHash });
        if (!resumeDoc) {
          // Upload to S3
          const resumeS3Params = {
            Bucket: process.env.MINIO_BUCKET_NAME,
            Key: `resumes/${Date.now()}_${resume.originalname}`,
            Body: resume.buffer,
            ContentType: 'application/pdf'
          };
          await s3.send(new PutObjectCommand(resumeS3Params));

          resumeDoc = new Resume({
            title: resume.originalname,
            s3Key: resumeS3Params.Key, // Store the S3 key
            filename: resume.originalname,
            hash: resumeHash,
            user: req.user.id
          });
          await resumeDoc.save();
        }

        const existingResponse = await ApiResponse.findOne({ hash: `${resumeHash}-${jdHash}` });
        if (existingResponse) {
          console.log(`Duplicate found for Resume: ${resume.originalname} and Job Description: ${jobDescription.originalname}. Skipping.`);
          duplicateCount++; // Increment duplicate counter
          continue;
        }

        const formData = new FormData();
        formData.append('resumes', resume.buffer, resume.originalname);
        formData.append('job_description', jobDescription.buffer, jobDescription.originalname);

        try {
          const apiResponse = await axios.post(
            process.env.RESUME_JD_MATCHING,
            formData,
            { headers: formData.getHeaders() }
          );

          if (apiResponse.data && apiResponse.data['POST Response']) {
            const savedResponse = new ApiResponse({
              resumeId: resumeDoc._id,
              jobDescriptionId: jobDescDoc._id,
              matchingResult: apiResponse.data['POST Response'],
              hash: `${resumeHash}-${jdHash}`,
              user: req.user.id
            });
            await savedResponse.save();  // <-- Candidate consent is default false

            // ✅ SEND CANDIDATE EMAIL HERE (with link to give consent)
            const extractedEmail = apiResponse.data['POST Response']?.[0]?.["Resume Data"]?.email;

            if (extractedEmail) {
              await sendConsentEmail(extractedEmail, savedResponse._id);
              console.log(`📨 Sending consent email to: ${extractedEmail}`);

            } else {
              console.warn(`⚠️ No email found in API response for ${resume.originalname}`);
            }


            emitApiResponseUpdate(savedResponse);


            results.push({
              resumeId: resumeDoc._id,
              jobDescriptionId: jobDescDoc._id,
              matchingResult: apiResponse.data['POST Response'],
            });
          }
        } catch (error) {
          console.error(`Error with external API for ${resume.originalname}:`, error.message);
        }
      }
    }
    // Update usage
    await User.findByIdAndUpdate(req.user.id, {
      $inc: {
        'usage.jdUploads': files.job_description.length,
        'usage.resumeUploads': files.resumes.length
      }
    });

    // Automatically create job post in external system (non-blocking)
    if (files.job_description && files.job_description.length > 0) {
      const jobDescriptionFile = files.job_description[0];
      // Run in background without blocking the response
      setImmediate(async () => {
        try {
          console.log('🔄 Starting automatic job posting in background...');
          const jobPostResult = await handleAutomaticJobPosting(
            jobDescriptionFile.buffer,
            jobDescriptionFile.originalname,
            req.user.email
          );

          if (jobPostResult.success) {
            console.log(`✅ Automatic job post created: ${jobPostResult.publicUrl}`);
          } else {
            console.log(`⚠️ Automatic job post not created: ${jobPostResult.reason || jobPostResult.error}`);
          }
        } catch (error) {
          console.error('❌ Error in automatic job posting background process:', error.message);
        }
      });
    }

    console.log(`Total duplicates found: ${duplicateCount}`); // Log the total number of duplicates
    res.status(200).json({ message: 'Files processed and stored successfully.', results, duplicateCount });
  } catch (error) {
    console.error('Upload Error:', {
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    res.status(500).json({
      error: 'File processing failed',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});
/*
  This is related to the test platfrom
*/

// Add this to your startup checks:
function ensureCleanTempDir() {
  const tempDir = os.tmpdir();
  fs.readdirSync(tempDir).forEach(file => {
    if (file.startsWith('whisper_')) {
      try {
        fs.rmSync(path.join(tempDir, file), { recursive: true, force: true });
      } catch (e) {
        console.error('Failed to clean temp file:', file, e);
      }
    }
  });
}

const evaluateTextResponse = async (question, answer) => {
  try {
    const response = await axios.post(process.env.TEXT_EVALUATION_API_URL, {
      question,
      answer
    });

    return response.data;
  } catch (error) {
    console.error('Text evaluation failed:', error);
    throw error;
  }
};


async function calculateAndStoreScores(sessionId) {
  try {
    const [answers, recording, testResult] = await Promise.all([
      VoiceAnswer.find({ assessmentSession: sessionId }),
      Recording.findOne({ assessmentSession: sessionId }),
      TestResult.findOne({ assessmentSession: sessionId })
    ]);

    // Get all questions (including skipped ones)
    const session = await AssessmentSession.findById(sessionId);
    const totalQuestions = session.voiceQuestions.length;

    // Filter out skipped/invalid answers
    const validAnswers = answers.filter(a => a.valid &&
      a.processingStatus === 'completed' &&
      a.audioAnalysis?.status === 'completed');

    // Audio scores (0 for invalid/skipped)
    const audioScores = session.voiceQuestions.map(q => {
      const answer = answers.find(a => a.questionId === q.id);
      return answer?.audioAnalysis?.grading?.['Total Score'] || 0;
    });

    // Text scores (0 for invalid/skipped)
    const textScores = session.voiceQuestions.map(q => {
      const answer = answers.find(a => a.questionId === q.id);
      return answer?.textEvaluation?.metrics?.total_average || 0;
    });

    // Calculate averages (include 0 for skipped questions)
    const audioAverage = audioScores.reduce((a, b) => a + b, 0) / totalQuestions;
    const textAverage = textScores.reduce((a, b) => a + b, 0) / totalQuestions;
    const videoScore = recording?.videoAnalysis?.video_score || 0;
    const mcqScore = testResult.score || 0;

    // Final combined score calculation (same weights as before)
    const voiceComponent = (audioAverage * 0.1) + (textAverage * 0.8) + (videoScore * 0.1);
    const combinedScore = Math.round((mcqScore * 0.4) + (voiceComponent * 0.6));

    // Update TestResult
    await TestResult.findOneAndUpdate(
      { assessmentSession: sessionId },
      {
        audioScore: audioAverage,
        textScore: textAverage,
        videoScore,
        combinedScore,
        questionsAttempted: validAnswers.length,
        totalQuestions
      },
      { new: true }
    );

    return combinedScore;
  } catch (error) {
    console.error('Error calculating scores:', error);
    return null;
  }
}




// Update the analyzeAudio function to handle WAV files
const analyzeAudio = async (s3Keys) => {
  try {
    const form = new FormData();

    for (const key of s3Keys) {
      const { stream } = await getS3ReadStream(key);
      form.append('audios', stream, {
        filename: path.basename(key),
        contentType: 'audio/wav'
      });
    }

    const response = await axios.post(process.env.AUDIO_EVALUATION_API_URL, form, {
      headers: form.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });

    return response.data;
  } catch (error) {
    console.error('Audio analysis failed:', error);
    throw error;
  }
};



async function calculateAndStoreAudioScore(sessionId) {
  try {
    // Get all completed voice answers for this session
    const answers = await VoiceAnswer.find({
      assessmentSession: sessionId,
      'audioAnalysis.status': 'completed',
      'audioAnalysis.grading.Total Score': { $exists: true }
    });

    if (answers.length === 0) return null;

    // Include ALL answers in calculation, even those with zero scores
    const audioScores = answers.map(a => a.audioAnalysis.grading['Total Score'] || 0);
    const average = audioScores.reduce((sum, score) => sum + score, 0) / answers.length;

    // Update TestResult
    await TestResult.findOneAndUpdate(
      { assessmentSession: sessionId },
      { audioScore: average },
      { new: true }
    );

    return average;
  } catch (error) {
    console.error('Error calculating audio score:', error);
    return null;
  }
}
// Add this to server.js initialization
async function checkPendingScores() {
  try {
    const sessions = await AssessmentSession.find({
      status: 'completed',
      $or: [
        { 'testResult.audioScore': { $exists: false } },
        { 'testResult.videoScore': { $exists: false } },
        { 'testResult.combinedScore': { $exists: false } }
      ]
    }).populate('voiceAnswers');

    for (const session of sessions) {
      if (session.voiceAnswers?.some(a => a.audioAnalysis?.status === 'completed')) {
        await calculateAndStoreAudioScore(session._id);
      }

      // Check for video score
      await calculateAndStoreVideoScore(session._id);
      await calculateAndStoreScores(session._id);
    }
  } catch (error) {
    console.error('Background score check failed:', error);
  }
}
// Enhanced S3 stream handling with SSL support
async function getS3ReadStream(s3Key) {
  try {
    const command = new GetObjectCommand({
      Bucket: process.env.MINIO_BUCKET_NAME,
      Key: s3Key
    });

    const response = await s3.send(command);

    if (!response.Body) {
      throw new Error('No body in S3 response');
    }

    return {
      stream: response.Body,
      contentLength: response.ContentLength,
      contentType: response.ContentType || 'application/octet-stream'
    };
  } catch (error) {
    console.error('Error getting S3 read stream:', {
      error: error.message,
      s3Key,
      endpoint: process.env.MINIO_ENDPOINT,
      secure: process.env.MINIO_SECURE
    });
    throw error;
  }
}
async function getSignedUrlForS3(key) {
  const command = new GetObjectCommand({
    Bucket: process.env.MINIO_BUCKET_NAME,
    Key: key
  });
  return getSignedUrl(s3, command); // 1 hour
}
// Enhanced processTranscription with proper temp file handling
// Enhanced audio validation with better silence detection
async function validateAudio(audioBuffer) {
  try {
    const MIN_AUDIO_LENGTH = 2000; // 2 seconds minimum
    const SILENCE_THRESHOLD = 0.01; // More sensitive threshold

    // Check buffer size first
    if (!audioBuffer || audioBuffer.length < MIN_AUDIO_LENGTH) {
      return { valid: false, reason: 'Audio too short' };
    }

    // Advanced silence detection using Web Audio API (if available)
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const buffer = await audioContext.decodeAudioData(audioBuffer.buffer.slice(0));

      // Calculate RMS (Root Mean Square) for better silence detection
      let sum = 0;
      const channelData = buffer.getChannelData(0);
      const sampleSize = Math.min(channelData.length, 44100); // Check first second

      for (let i = 0; i < sampleSize; i++) {
        sum += channelData[i] * channelData[i];
      }

      const rms = Math.sqrt(sum / sampleSize);

      return {
        valid: rms > SILENCE_THRESHOLD,
        reason: rms > SILENCE_THRESHOLD ? '' : 'No speech detected (silent audio)'
      };
    } catch (webAudioError) {
      // Fallback to simpler validation if Web Audio API fails
      const view = new DataView(audioBuffer.buffer);
      let sum = 0;
      const sampleSize = Math.min(audioBuffer.length, 44100 * 2); // Check first second (16-bit samples)

      for (let i = 0; i < sampleSize; i += 2) {
        const sample = view.getInt16(i, true);
        sum += sample * sample;
      }

      const rms = Math.sqrt(sum / (sampleSize / 2)) / 32768;
      return {
        valid: rms > SILENCE_THRESHOLD,
        reason: rms > SILENCE_THRESHOLD ? '' : 'No speech detected (silent audio)'
      };
    }
  } catch (error) {
    return { valid: false, reason: 'Audio validation error' };
  }
}

// Enhanced processTranscription with silent audio handling
async function processTranscription(answerId) {
  try {
    const answer = await VoiceAnswer.findById(answerId);
    if (!answer) {
      throw new Error('Voice answer not found');
    }

    // Skip if answer was marked as skipped or invalid
    if (answer.processingStatus === 'skipped' || !answer.valid) {
      console.log(`Skipping transcription for answer ${answerId}`);
      return;
    }

    // Validate audio path exists
    if (!answer.audioPath) {
      await VoiceAnswer.findByIdAndUpdate(answerId, {
        processingStatus: 'failed',
        skipReason: 'Missing audio file',
        $set: {
          'audioAnalysis.status': 'failed',
          'textEvaluation.status': 'failed'
        }
      });
      return;
    }

    // Get audio stream from S3
    let audioBuffer;
    try {
      const { stream: audioStream } = await getS3ReadStream(answer.audioPath);
      audioBuffer = await streamToBuffer(audioStream);

      // Check if audio buffer is empty or too small
      if (!audioBuffer || audioBuffer.length < 1024) {
        throw new Error('Audio file is too small or empty');
      }
    } catch (streamError) {
      await VoiceAnswer.findByIdAndUpdate(answerId, {
        processingStatus: 'failed',
        skipReason: 'Failed to load audio file',
        $set: {
          'audioAnalysis.status': 'failed',
          'textEvaluation.status': 'failed'
        }
      });
      return;
    }

    // Enhanced audio validation
    const validation = await validateAudio(audioBuffer);
    if (!validation.valid) {
      const isSilentAudio = validation.reason.includes('silent');

      await VoiceAnswer.findByIdAndUpdate(answerId, {
        processingStatus: isSilentAudio ? 'completed' : 'failed',
        answer: isSilentAudio ? '[SILENT_AUDIO]' : undefined,
        skipReason: validation.reason,
        $set: {
          'audioAnalysis.status': isSilentAudio ? 'completed' : 'failed',
          'textEvaluation.status': isSilentAudio ? 'skipped' : 'failed',
          'textEvaluation.skipReason': isSilentAudio ? 'Silent audio - no speech detected' : undefined
        }
      });

      console.log(`Audio validation ${isSilentAudio ? 'completed (silent)' : 'failed'} for answer ${answerId}`);
      return;
    }

    // Create form data for Flask service
    const form = new FormData();
    form.append('audio', audioBuffer, {
      filename: `answer_${answerId}.wav`,
      contentType: 'audio/wav'
    });

    // Call Whisper service with timeout
    let response;
    try {
      response = await axios.post(
        `${process.env.WHISPER_API_URL}/transcribe`,
        form,
        {
          headers: form.getHeaders(),

          maxContentLength: Infinity,
          maxBodyLength: Infinity
        }
      );
    } catch (apiError) {
      throw new Error(`Transcription API failed: ${apiError.message}`);
    }

    // Handle empty or invalid response
    if (!response.data || typeof response.data.text !== 'string') {
      throw new Error('Invalid transcription response format');
    }

    const rawText = response.data.text;
    const cleanedText = cleanTranscriptionText(rawText);

    // Handle silent/empty results
    if (!cleanedText || cleanedText.trim().length === 0) {
      await VoiceAnswer.findByIdAndUpdate(answerId, {
        processingStatus: 'completed',
        answer: '[SILENT_AUDIO]',
        transcriptionPath: null,
        $set: {
          'textEvaluation.status': 'skipped',
          'textEvaluation.skipReason': 'Empty transcription result - no speech detected'
        }
      });
      console.log(`Silent audio processed for answer ${answerId}`);
      return;
    }

    // Upload transcription to S3 if we have valid text
    const transcriptionKey = `transcripts/${answerId}.txt`;
    await uploadToS3(Buffer.from(cleanedText), transcriptionKey, 'text/plain');

    // Update database with successful transcription
    const updatedAnswer = await VoiceAnswer.findByIdAndUpdate(
      answerId,
      {
        transcriptionPath: transcriptionKey,
        answer: cleanedText,
        processingStatus: 'completed',
        $set: {
          'audioAnalysis.status': 'completed'
        }
      },
      { new: true }
    );

    console.log(`✅ Transcription completed for answer ${answerId}`);

    // Evaluate text response if we have a question and valid text
    if (updatedAnswer.question && cleanedText && cleanedText !== '[SILENT_AUDIO]') {
      try {
        await VoiceAnswer.findByIdAndUpdate(answerId, {
          'textEvaluation.status': 'processing'
        });

        const evaluation = await evaluateTextResponse(
          updatedAnswer.question,
          cleanedText
        );

        await VoiceAnswer.findByIdAndUpdate(answerId, {
          textEvaluation: {
            metrics: evaluation,
            processedAt: new Date(),
            status: 'completed'
          }
        });

        await calculateAndStoreScores(updatedAnswer.assessmentSession);
      } catch (evalError) {
        console.error('Text evaluation failed:', evalError);
        await VoiceAnswer.findByIdAndUpdate(answerId, {
          'textEvaluation.status': 'failed',
          'textEvaluation.skipReason': evalError.message.substring(0, 200)
        });
      }
    }

  } catch (error) {
    console.error(`Transcription failed for answer ${answerId}:`, error);
    await VoiceAnswer.findByIdAndUpdate(answerId, {
      processingStatus: 'failed',
      skipReason: error.message.substring(0, 200),
      $set: {
        'audioAnalysis.status': 'failed',
        'textEvaluation.status': 'failed'
      }
    });
  }
}

// Enhanced text cleaning function
function cleanTranscriptionText(rawText) {
  if (!rawText) return '';

  // Handle Whisper's silent/empty indicators
  const silentIndicators = ['[silence]', '[empty]', '[no speech]', '...'];
  if (silentIndicators.some(indicator => rawText.toLowerCase().includes(indicator))) {
    return '';
  }

  // Split into lines and filter out metadata
  const lines = rawText.split('\n').filter(line => {
    return !line.includes('Detecting language') &&
      !line.includes('Detected language') &&
      line.trim() !== '';
  });

  // Remove timestamps and special characters
  const cleanedLines = lines.map(line => {
    return line
      .replace(/\[\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}\.\d{3}\]/g, '')
      .replace(/\[.*?\]/g, '')
      .replace(/^\s+|\s+$/g, '')
      .replace(/\s+/g, ' ');
  });

  // Join and final clean
  let result = cleanedLines.join(' ').trim();

  // Final check for empty content
  if (result === '' || result.length < 2) {
    return '';
  }

  return result;
}



// New helper function for background tasks
async function processBackgroundTasks(recording) {
  try {
    await Recording.findByIdAndUpdate(recording._id, {
      'videoAnalysis.status': 'processing'
    });

    // Get video stream from S3
    const { stream: videoStream } = await getS3ReadStream(recording.videoPath);

    // Create form with stream
    const form = new FormData();
    form.append('video', videoStream, {
      filename: `interview_${recording._id}.webm`,
      contentType: 'video/webm'
    });

    // Process with API
    const response = await axios.post(process.env.VIDEO_EVALUATION_API_URL, form, {
      headers: form.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });

    // Upload results to S3
    const analysisKey = `analysis/${recording._id}_emotions.json`;
    await uploadToS3(
      Buffer.from(JSON.stringify(response.data)),
      analysisKey,
      'application/json'
    );

    // Update recording
    await Recording.findByIdAndUpdate(recording._id, {
      videoAnalysis: {
        emotions: response.data,
        processedAt: new Date(),
        status: 'completed',
        s3Key: analysisKey
      }
    });

    // Calculate scores
    await calculateAndStoreVideoScore(recording.assessmentSession);
    await calculateAndStoreScores(recording.assessmentSession);

  } catch (error) {
    console.error('Background processing error:', error);
    await Recording.findByIdAndUpdate(recording._id, {
      'videoAnalysis.status': 'failed'
    });
  }
}
// ==============================
// ✅ SCHEDULED TEST PROCESSING & AUTOMATION
// ==============================

// Function to activate scheduled tests when their time arrives
async function activateScheduledTests() {
  try {
    const now = new Date();

    // Find tests that should be activated
    const testsToActivate = await ScheduledTest.find({
      status: 'scheduled',
      scheduledDateTime: { $lte: now },
      expiresAt: { $gte: now }
    }).populate('resumeId').populate('jobDescriptionId').populate('user');

    console.log(`Found ${testsToActivate.length} tests to activate`);

    for (const scheduledTest of testsToActivate) {
      try {
        // Generate questions for the scheduled test
        if (!scheduledTest.questionsGenerated) {
          await generateQuestionsForScheduledTest(scheduledTest._id);
        }

        // 🔥 ENHANCED: Create assessment session only if it doesn't exist
        let session;
        if (scheduledTest.assessmentSession) {
          console.log(`📝 Using existing AssessmentSession: ${scheduledTest.assessmentSession}`);
          session = await AssessmentSession.findById(scheduledTest.assessmentSession);
          if (!session) {
            console.log('⚠️ AssessmentSession not found, creating new one...');
            session = new AssessmentSession({
              user: scheduledTest.user,
              candidateEmail: scheduledTest.candidateEmail,
              jobTitle: `Assessment for ${scheduledTest.candidateName}`,
              testLink: scheduledTest.testLink,
              status: 'pending',
              resumeId: scheduledTest.resumeId,
              jobDescriptionId: scheduledTest.jobDescriptionId
            });
            await session.save();
          }
        } else {
          console.log('🆕 Creating new AssessmentSession for activation...');
          session = new AssessmentSession({
            user: scheduledTest.user,
            candidateEmail: scheduledTest.candidateEmail,
            jobTitle: `Assessment for ${scheduledTest.candidateName}`,
            testLink: scheduledTest.testLink,
            status: 'pending',
            resumeId: scheduledTest.resumeId,
            jobDescriptionId: scheduledTest.jobDescriptionId
          });
          await session.save();
        }

        // Update scheduled test
        scheduledTest.status = 'active';
        scheduledTest.activatedAt = now;
        scheduledTest.assessmentSession = session._id;
        await scheduledTest.save();

        // Send assessment email to candidate
        await sendScheduledAssessmentEmail(scheduledTest);

        console.log(`✅ Activated scheduled test: ${scheduledTest._id}`);

      } catch (error) {
        console.error(`Failed to activate scheduled test ${scheduledTest._id}:`, error);

        // Mark as failed
        scheduledTest.status = 'failed';
        await scheduledTest.save();
      }
    }

  } catch (error) {
    console.error('Error in activateScheduledTests:', error);
  }
}

// Function to expire old scheduled tests
async function expireScheduledTests() {
  try {
    const now = new Date();

    // Find tests that should be expired
    const result = await ScheduledTest.updateMany(
      {
        status: { $in: ['scheduled', 'active'] },
        expiresAt: { $lt: now }
      },
      {
        $set: { status: 'expired' }
      }
    );

    if (result.modifiedCount > 0) {
      console.log(`Expired ${result.modifiedCount} scheduled tests`);
    }

  } catch (error) {
    console.error('Error in expireScheduledTests:', error);
  }
}

// Enhanced function to generate questions for scheduled test
async function generateQuestionsForScheduledTest(scheduledTestId) {
  try {
    console.log(`\n🧠 Generating questions for scheduled test: ${scheduledTestId}`);

    const scheduledTest = await ScheduledTest.findById(scheduledTestId)
      .populate('resumeId')
      .populate('jobDescriptionId')
      .populate('user');

    if (!scheduledTest) {
      throw new Error('Scheduled test not found');
    }

    console.log('📋 Found scheduled test:', {
      candidate: scheduledTest.candidateName,
      email: scheduledTest.candidateEmail,
      hasAssessmentSession: !!scheduledTest.assessmentSession
    });

    // Generate MCQ questions (skip matching for scheduled tests)
    console.log('🔄 Calling MCQ generation API...');
    const mcqResponse = await axios.post(`${process.env.BACKEND_URL}/api/generate-questions`, {
      resumeId: scheduledTest.resumeId._id,
      jobDescriptionId: scheduledTest.jobDescriptionId._id,
      skipMatching: true
    });

    if (!mcqResponse.data.success) {
      throw new Error('MCQ generation failed');
    }
    console.log(`✅ Generated ${mcqResponse.data.questions.length} MCQ questions`);

    // Generate voice questions
    console.log('🔄 Calling Voice questions generation API...');
    const voiceResponse = await axios.post(`${process.env.BACKEND_URL}/api/generate-voice-questions`, {
      jobDescriptionId: scheduledTest.jobDescriptionId._id
    });

    if (!voiceResponse.data.success) {
      throw new Error('Voice question generation failed');
    }
    console.log(`✅ Generated ${voiceResponse.data.questions.length} Voice questions`);

    // 🔥 ENHANCED: Create AssessmentSession immediately if it doesn't exist
    let assessmentSession;
    if (scheduledTest.assessmentSession) {
      console.log('📝 Updating existing AssessmentSession...');
      assessmentSession = await AssessmentSession.findByIdAndUpdate(
        scheduledTest.assessmentSession,
        {
          questions: mcqResponse.data.questions,
          voiceQuestions: voiceResponse.data.questions
        },
        { new: true }
      );
    } else {
      console.log('🆕 Creating new AssessmentSession immediately...');
      assessmentSession = new AssessmentSession({
        user: scheduledTest.user,
        candidateEmail: scheduledTest.candidateEmail,
        jobTitle: `Assessment for ${scheduledTest.candidateName}`,
        testLink: scheduledTest.testLink,
        status: 'pending',
        resumeId: scheduledTest.resumeId,
        jobDescriptionId: scheduledTest.jobDescriptionId,
        questions: mcqResponse.data.questions,
        voiceQuestions: voiceResponse.data.questions
      });
      await assessmentSession.save();
      console.log('✅ AssessmentSession created:', assessmentSession._id);

      // Link the assessment session to the scheduled test
      scheduledTest.assessmentSession = assessmentSession._id;
    }

    // Mark questions as generated
    scheduledTest.questionsGenerated = true;
    await scheduledTest.save();

    console.log(`✅ Generated questions for scheduled test: ${scheduledTestId}`);
    console.log('📊 Summary:', {
      mcqQuestions: mcqResponse.data.questions.length,
      voiceQuestions: voiceResponse.data.questions.length,
      assessmentSessionId: assessmentSession._id,
      questionsStored: true
    });

    return {
      success: true,
      mcqQuestions: mcqResponse.data.questions.length,
      voiceQuestions: voiceResponse.data.questions.length,
      assessmentSessionId: assessmentSession._id
    };

  } catch (error) {
    console.error(`❌ Failed to generate questions for scheduled test ${scheduledTestId}:`, error);
    throw error;
  }
}

// Function to send scheduled assessment email
async function sendScheduledAssessmentEmail(scheduledTest) {
  try {
    const mailOptions = {
      from: `"SkillMatrix Assessment" <${process.env.EMAIL_USER}>`,
      to: scheduledTest.candidateEmail,
      subject: `Your Scheduled Assessment is Now Available`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2563eb;">Assessment Ready - ${scheduledTest.candidateName}</h2>
          <p>Your scheduled assessment is now available and ready to be taken.</p>
          
          <div style="background-color: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="margin-top: 0;">Assessment Details:</h3>
            <p><strong>Candidate:</strong> ${scheduledTest.candidateName}</p>
            <p><strong>Scheduled Time:</strong> ${scheduledTest.scheduledDateTime.toLocaleString()}</p>
            <p><strong>Expires:</strong> ${scheduledTest.expiresAt.toLocaleString()}</p>
          </div>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${scheduledTest.testLink}" 
               style="background-color: #2563eb; color: white; padding: 15px 30px; 
                      text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">
              Start Assessment
            </a>
          </div>
          
          <div style="background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 15px; margin: 20px 0;">
            <p style="margin: 0; color: #dc2626;"><strong>Important:</strong></p>
            <ul style="margin: 5px 0; color: #dc2626;">
              <li>This link expires on ${scheduledTest.expiresAt.toLocaleString()}</li>
              <li>Complete the assessment in one session</li>
              <li>Ensure stable internet connection</li>
              <li>Use a quiet environment with good lighting</li>
            </ul>
          </div>
          
          <p style="color: #6b7280; font-size: 12px; margin-top: 30px;">
            This is an automated message. Please do not reply to this email.
          </p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ Sent assessment email to: ${scheduledTest.candidateEmail}`);

  } catch (error) {
    console.error('❌ Failed to send scheduled assessment email:', error);
    throw error;
  }
}

// 🔥 ENHANCED: Function to send IMMEDIATE confirmation email with detailed logging
async function sendScheduledTestConfirmationEmail(scheduledTest) {
  const emailStartTime = Date.now();
  console.log('\n📧 ===== EMAIL SENDING STARTED =====');
  console.log('📧 Email Details:', {
    to: scheduledTest.candidateEmail,
    candidate: scheduledTest.candidateName,
    testId: scheduledTest._id
  });

  try {
    console.log('📧 Preparing email content...');

    const mailOptions = {
      from: `"SkillMatrix Assessment" <${process.env.EMAIL_USER}>`,
      to: scheduledTest.candidateEmail,
      subject: `✅ Assessment Scheduled Successfully - ${scheduledTest.candidateName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #10b981; margin: 0;">✅ Assessment Scheduled Successfully!</h1>
          </div>
          
          <p style="font-size: 16px; color: #374151;">Dear <strong>${scheduledTest.candidateName}</strong>,</p>
          <p style="color: #374151;">Great news! Your assessment has been successfully scheduled and all systems are ready. Here are your details:</p>
          
          <div style="background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%); padding: 25px; border-radius: 12px; margin: 25px 0; border-left: 5px solid #10b981; box-shadow: 0 2px 10px rgba(16, 185, 129, 0.1);">
            <h3 style="margin-top: 0; color: #0c4a6e; display: flex; align-items: center;">
              <span style="margin-right: 10px;">📋</span> Assessment Details
            </h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr style="border-bottom: 1px solid #e5e7eb;">
                <td style="padding: 8px 0; font-weight: bold; color: #374151;">Candidate:</td>
                <td style="padding: 8px 0; color: #1f2937;">${scheduledTest.candidateName}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e5e7eb;">
                <td style="padding: 8px 0; font-weight: bold; color: #374151;">Email:</td>
                <td style="padding: 8px 0; color: #1f2937;">${scheduledTest.candidateEmail}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e5e7eb;">
                <td style="padding: 8px 0; font-weight: bold; color: #374151;">Scheduled Time:</td>
                <td style="padding: 8px 0; color: #1f2937; font-weight: bold;">${scheduledTest.scheduledDateTime.toLocaleString()}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e5e7eb;">
                <td style="padding: 8px 0; font-weight: bold; color: #374151;">Expires:</td>
                <td style="padding: 8px 0; color: #dc2626; font-weight: bold;">${scheduledTest.expiresAt.toLocaleString()}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #374151;">Test ID:</td>
                <td style="padding: 8px 0; color: #6b7280; font-family: monospace; font-size: 14px;">${scheduledTest._id}</td>
              </tr>
            </table>
          </div>
          
          <div style="background-color: #fef3c7; padding: 20px; border-radius: 10px; margin: 25px 0; border-left: 4px solid #f59e0b;">
            <h4 style="margin-top: 0; color: #92400e; display: flex; align-items: center;">
              <span style="margin-right: 8px;">⏰</span> Important Timing Information
            </h4>
            <ul style="margin: 10px 0; color: #92400e; line-height: 1.6;">
              <li>Your assessment will be <strong>available from ${scheduledTest.scheduledDateTime.toLocaleString()}</strong></li>
              <li>You have <strong>48 hours</strong> from the scheduled time to complete it</li>
              <li>The link will <strong>expire on ${scheduledTest.expiresAt.toLocaleString()}</strong></li>
              <li>You will receive another email when the assessment becomes active</li>
            </ul>
          </div>
          
          <div style="background-color: #f8fafc; padding: 20px; border-radius: 10px; margin: 25px 0; border-left: 4px solid #3b82f6;">
            <h4 style="margin-top: 0; color: #1e40af; display: flex; align-items: center;">
              <span style="margin-right: 8px;">🔍</span> What to Expect
            </h4>
            <ul style="margin: 10px 0; color: #374151; line-height: 1.6;">
              <li><strong>Multiple choice questions</strong> - Technical and behavioral</li>
              <li><strong>Voice interview questions</strong> - Speak your answers clearly</li>
              <li><strong>Video and audio recording</strong> - Camera and microphone required</li>
              <li><strong>Estimated duration:</strong> 30-45 minutes</li>
              <li><strong>System requirements:</strong> Modern browser, stable internet</li>
            </ul>
          </div>

          <div style="background-color: #dcfce7; padding: 20px; border-radius: 10px; margin: 25px 0; border-left: 4px solid #22c55e;">
            <h4 style="margin-top: 0; color: #166534; display: flex; align-items: center;">
              <span style="margin-right: 8px;">✅</span> System Status
            </h4>
            <p style="margin: 5px 0; color: #166534;">✓ Questions have been generated and are ready</p>
            <p style="margin: 5px 0; color: #166534;">✓ Assessment link has been created and verified</p>
            <p style="margin: 5px 0; color: #166534;">✓ Email confirmation sent successfully</p>
            <p style="margin: 5px 0; color: #166534;">✓ All systems are go for your scheduled time!</p>
          </div>
          
          <div style="text-align: center; margin: 30px 0;">
            <p style="color: #6b7280; font-size: 14px; margin-bottom: 15px;">
              📧 You will receive your assessment link via email when the scheduled time arrives
            </p>
            <div style="background-color: #f3f4f6; padding: 15px; border-radius: 8px; display: inline-block;">
              <p style="margin: 0; color: #374151; font-family: monospace; font-size: 12px; word-break: break-all;">
                Assessment Link Preview:<br/>
                <span style="color: #2563eb;">${scheduledTest.testLink}</span>
              </p>
            </div>
          </div>
          
          <div style="border-top: 2px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
            <p style="color: #6b7280; font-size: 12px; text-align: center; margin: 0;">
              This is an automated confirmation message from SkillMatrix AI.<br/>
              Please do not reply to this email. For support, contact your HR representative.
            </p>
          </div>
        </div>
      `
    };

    console.log('📧 Attempting to send email via SMTP...');
    console.log('📧 SMTP Config:', {
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      user: process.env.SMTP_USER ? '***configured***' : 'NOT_SET'
    });

    const emailResult = await transporter.sendMail(mailOptions);

    const emailTime = Date.now() - emailStartTime;
    console.log('\n✅ ===== EMAIL SENT SUCCESSFULLY =====');
    console.log('📧 Email Result:', {
      messageId: emailResult.messageId,
      to: scheduledTest.candidateEmail,
      processingTime: `${emailTime}ms`,
      timestamp: new Date().toISOString()
    });

    return {
      success: true,
      messageId: emailResult.messageId,
      processingTime: emailTime
    };

  } catch (error) {
    const emailTime = Date.now() - emailStartTime;
    console.error('\n❌ ===== EMAIL SENDING FAILED =====');
    console.error('📧 Email Error:', {
      message: error.message,
      code: error.code,
      to: scheduledTest.candidateEmail,
      processingTime: `${emailTime}ms`,
      timestamp: new Date().toISOString()
    });

    throw new Error(`Email sending failed: ${error.message}`);
  }
}

// Function to send reminder emails (optional feature)
async function sendReminderEmails() {
  try {
    const reminderTime = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

    const testsNeedingReminder = await ScheduledTest.find({
      status: 'scheduled',
      reminderSent: false,
      scheduledDateTime: {
        $gte: new Date(),
        $lte: reminderTime
      }
    });

    for (const test of testsNeedingReminder) {
      try {
        const mailOptions = {
          from: `"SkillMatrix Assessment" <${process.env.EMAIL_USER}>`,
          to: test.candidateEmail,
          subject: 'Reminder: Your Assessment Starts Soon',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #f59e0b;">Assessment Reminder</h2>
              <p>This is a friendly reminder that your assessment is scheduled to start in approximately 1 hour.</p>
              
              <p><strong>Assessment Time:</strong> ${test.scheduledDateTime.toLocaleString()}</p>
              <p><strong>Candidate:</strong> ${test.candidateName}</p>
              
              <p>Please ensure you're ready and have:</p>
              <ul>
                <li>Stable internet connection</li>
                <li>Quiet environment</li>
                <li>Good lighting for video recording</li>
                <li>Camera and microphone access enabled</li>
              </ul>
              
              <p>You'll receive another email with the assessment link when it becomes available.</p>
            </div>
          `
        };

        await transporter.sendMail(mailOptions);

        test.reminderSent = true;
        await test.save();

        console.log(`Sent reminder email to: ${test.candidateEmail}`);

      } catch (error) {
        console.error(`Failed to send reminder to ${test.candidateEmail}:`, error);
      }
    }

  } catch (error) {
    console.error('Error in sendReminderEmails:', error);
  }
}

// Combined scheduled test processor
async function processScheduledTests() {
  console.log('🔄 Processing scheduled tests...');

  try {
    await Promise.all([
      activateScheduledTests(),
      expireScheduledTests(),
      sendReminderEmails()
    ]);
  } catch (error) {
    console.error('Error in processScheduledTests:', error);
  }
}

// Set up scheduled processing (runs every 5 minutes)
setInterval(processScheduledTests, 5 * 60 * 1000); // Every 5 minutes
processScheduledTests(); // Run on startup

console.log('✅ Scheduled test automation system initialized');

// ==============================
// ✅ END SCHEDULED TEST PROCESSING
// ==============================

// Update the interval to use the new function
setInterval(checkPendingScores, 3600000); // Every hour
checkPendingScores(); // Run on startup

// Helper function to analyze video files
async function analyzeVideoFile(file) {
  try {
    const form = new FormData();
    const fileStream = Readable.from(file.buffer);

    form.append('video', fileStream, {
      filename: file.originalname,
      contentType: file.mimetype,
      knownLength: file.size
    });

    const response = await axios.post(process.env.VIDEO_EVALUATION_API_URL, form, {
      headers: {
        ...form.getHeaders(),
        'Content-Length': form.getLengthSync()
      },
      maxBodyLength: Infinity,
    });

    if (!response.data?.emotion_results) {
      throw new Error('Invalid API response format - missing emotion_results');
    }

    // Return the parsed data structure
    return {
      emotion_results: response.data.emotion_results,
      video_score: response.data.video_score || 75.0
    };
  } catch (error) {
    console.error('Video analysis failed:', error);
    throw error;
  }
}
async function calculateAndStoreVideoScore(sessionId) {
  try {
    const recording = await Recording.findOne({
      assessmentSession: sessionId,
      'videoAnalysis.status': 'completed'
    });

    if (!recording || !recording.videoAnalysis.video_score) {
      console.error('No completed recording or video score found');
      return null;
    }

    const videoScore = recording.videoAnalysis.video_score;

    // Update TestResult with the video score
    await TestResult.findOneAndUpdate(
      { assessmentSession: sessionId },
      { $set: { videoScore } },
      { upsert: true, new: true }
    );

    console.log(`✅ Saved video score: ${videoScore} for session: ${sessionId}`);
    return videoScore;
  } catch (error) {
    console.error('Error calculating video score:', error);
    return null;
  }
}

const s3 = new S3Client({
  region: process.env.MINIO_REGION || 'us-east-1',
  endpoint: process.env.MINIO_SECURE === 'true' || process.env.MINIO_SECURE === 'True'
    ? `https://${process.env.MINIO_ENDPOINT}`
    : `http://${process.env.MINIO_ENDPOINT}`,
  credentials: {
    accessKeyId: process.env.MINIO_ACCESS_KEY,
    secretAccessKey: process.env.MINIO_SECRET_KEY
  },
  forcePathStyle: true, // Required for MinIO
  s3BucketEndpoint: false,
  // SSL/TLS configuration for secure connections
  tls: process.env.MINIO_SECURE === 'true' || process.env.MINIO_SECURE === 'True',
  // Additional security options
  maxAttempts: 3,
  retryMode: 'standard'
});

// Make s3 instance globally accessible
global.s3 = s3;

// Test MinIO connection on startup
const testMinIOConnection = async () => {
  try {
    console.log('🔧 Testing MinIO connection...');
    console.log(`📡 Endpoint: ${process.env.MINIO_SECURE === 'true' || process.env.MINIO_SECURE === 'True' ? 'https://' : 'http://'}${process.env.MINIO_ENDPOINT}`);
    console.log(`🔒 Secure: ${process.env.MINIO_SECURE}`);
    console.log(`🪣 Bucket: ${process.env.MINIO_BUCKET_NAME}`);

    // Test connection by listing bucket contents (this will fail gracefully if bucket doesn't exist)
    const command = new GetObjectCommand({
      Bucket: process.env.MINIO_BUCKET_NAME,
      Key: 'test-connection' // This file doesn't need to exist
    });

    try {
      await s3.send(command);
    } catch (error) {
      // Expected error for non-existent key, but connection is working
      if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
        console.log('✅ MinIO connection successful (secure connection established)');
        return true;
      }
      throw error;
    }
  } catch (error) {
    console.error('❌ MinIO connection failed:', {
      message: error.message,
      code: error.code,
      endpoint: process.env.MINIO_ENDPOINT,
      secure: process.env.MINIO_SECURE
    });
    console.error('⚠️  Please check your MinIO configuration and ensure the server is running');
    return false;
  }
};

// Enhanced stream to buffer with timeout
async function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const timer = setTimeout(() => {
      stream.destroy();
      reject(new Error(`Stream timeout after ${process.env.WHISPER_TIMEOUT || 60000}ms`));
    }, process.env.WISPER_TIMEOUT || 60000);

    stream.on('data', chunk => chunks.push(chunk));
    stream.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
    stream.on('end', () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks));
    });
  });
}


// ✅ AFTER — UPDATED uploadToS3 for folder structure in single bucket
async function uploadToS3(fileData, key, contentType, bucket = process.env.MINIO_BUCKET_NAME) {
  try {
    if (!fileData) throw new Error('No file data provided');

    const body = fileData instanceof Buffer ? Readable.from(fileData) : fileData;

    const upload = new Upload({
      client: s3,
      params: {
        Bucket: bucket, // 🔄 Always skillmatrixaws (default)
        Key: key, // 🔄 Example: job_descriptions/JD_filename.pdf
        Body: body,
        ContentType: contentType
      },
      queueSize: 4,
      partSize: 1024 * 1024 * 5,
      leavePartsOnError: false
    });

    upload.on('httpUploadProgress', progress => {
      console.log(`Upload progress: ${progress.loaded}/${progress.total}`);
    });

    const result = await upload.done();
    console.log(`✅ S3 Upload Success: ${key} to bucket ${bucket}`);
    return result;
  } catch (error) {
    console.error('S3 Upload Error:', {
      message: error.message,
      stack: error.stack,
      key,
      contentType,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}


/* endpoints related to the test evaluation an test platfrom */



// Updated generate-questions endpoint with direct S3 streaming

// Updated generate-questions endpoint with direct S3 streaming
app.post('/api/generate-questions', async (req, res) => {
  try {
    console.log('Request body:', req.body);

    const { resumeId, jobDescriptionId, skipMatching = false } = req.body;

    // Validate input
    if (!resumeId || !jobDescriptionId) {
      return res.status(400).json({
        success: false,
        error: 'Both resumeId and jobDescriptionId are required'
      });
    }

    if (!mongoose.Types.ObjectId.isValid(resumeId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid resumeId format'
      });
    }

    if (!mongoose.Types.ObjectId.isValid(jobDescriptionId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid jobDescriptionId format'
      });
    }

    // Fetch file references from database
    const [resume, jd] = await Promise.all([
      Resume.findById(resumeId),
      JobDescription.findById(jobDescriptionId)
    ]);

    if (!resume || !resume.s3Key) {
      return res.status(404).json({
        success: false,
        error: 'Resume not found or has no file'
      });
    }
    if (!jd || !jd.s3Key) {
      return res.status(404).json({
        success: false,
        error: 'Job description not found or has no file'
      });
    }

    // For scheduled tests, skip resume-JD matching and go directly to question generation
    if (skipMatching) {
      console.log('Skipping resume-JD matching for scheduled test...');

      // Get readable streams directly from S3 for question generation only
      const [resumeStream, jdStream] = await Promise.all([
        getS3ReadStream(resume.s3Key),
        getS3ReadStream(jd.s3Key)
      ]);

      // Create form data with direct S3 streams for MCQ generation only
      const form = new FormData();
      form.append('resumes', resumeStream.stream, {
        filename: resume.filename || 'resume.pdf',
        contentType: 'application/pdf',
        knownLength: resumeStream.contentLength
      });
      form.append('job_description', jdStream.stream, {
        filename: jd.filename || 'job_description.pdf',
        contentType: 'application/pdf',
        knownLength: jdStream.contentLength
      });

      console.log('Streaming files directly from S3 to question generation API (scheduled test)...');

      const headers = {
        ...form.getHeaders(),
        'Content-Length': form.getLengthSync()
      };

      // Call question generation API directly (skip matching)
      const response = await axios.post(process.env.MCQ_GENERATION_API, form, {
        headers,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });

      // Parse and return questions
      const apiResponse = response.data;
      let questions = [];

      if (apiResponse && apiResponse['POST Response'] && apiResponse['POST Response'][0]) {
        const mcqData = apiResponse['POST Response'][0]['MCQ with answers'];
        if (mcqData && mcqData.questions) {
          questions = mcqData.questions;
        }
      }

      if (questions.length === 0) {
        throw new Error('No valid questions found in API response');
      }

      const formattedQuestions = questions.map((q, index) => ({
        id: `q-${index}-${Date.now()}`,
        question: q.question,
        options: q.options,
        correctAnswer: q.answer
      }));

      return res.json({
        success: true,
        questions: formattedQuestions,
        resumeTitle: resume.title,
        jdTitle: jd.title,
        generatedAt: new Date().toISOString(),
        type: 'scheduled'
      });
    }

    // Original flow for immediate tests (with resume-JD matching)
    // Get readable streams directly from S3
    const [resumeStream, jdStream] = await Promise.all([
      getS3ReadStream(resume.s3Key),
      getS3ReadStream(jd.s3Key)
    ]);

    // Create form data with direct S3 streams
    const form = new FormData();
    form.append('resumes', resumeStream.stream, {
      filename: resume.filename || 'resume.pdf',
      contentType: 'application/pdf',
      knownLength: resumeStream.contentLength
    });
    form.append('job_description', jdStream.stream, {
      filename: jd.filename || 'job_description.pdf',
      contentType: 'application/pdf',
      knownLength: jdStream.contentLength
    });

    console.log('Streaming files directly from S3 to question generation API...');

    // Get headers with synchronous length since we have knownLength
    const headers = {
      ...form.getHeaders(),
      'Content-Length': form.getLengthSync()
    };

    // Call question generation API with proper headers
    const response = await axios.post(process.env.MCQ_GENERATION_API, form, {
      headers,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,

    });

    // Parse the API response correctly
    const apiResponse = response.data;
    let questions = [];

    // Handle the specific response format we're seeing
    if (apiResponse && apiResponse['POST Response'] && apiResponse['POST Response'][0]) {
      const mcqData = apiResponse['POST Response'][0]['MCQ with answers'];
      if (mcqData && mcqData.questions) {
        questions = mcqData.questions;
      }
    }

    if (questions.length === 0) {
      throw new Error('No valid questions found in API response');
    }

    // Transform questions to match our format
    const formattedQuestions = questions.map((q, index) => ({
      id: `q-${index}-${Date.now()}`,
      question: q.question,
      options: q.options,
      correctAnswer: q.answer
    }));

    res.json({
      success: true,
      questions: formattedQuestions,
      resumeTitle: resume.title,
      jdTitle: jd.title,
      generatedAt: new Date().toISOString(),
      type: 'immediate'
    });

  } catch (error) {
    console.error('Question generation failed:', error);

    let errorMessage = 'Failed to generate questions';
    if (error.code === 'ECONNABORTED') {
      errorMessage = 'Question generation timed out';
    } else if (error.message.includes('No valid questions')) {
      errorMessage = 'The question API returned an unexpected format';
    } else if (error.response?.data?.message) {
      errorMessage = error.response.data.message;
    }

    res.status(500).json({
      success: false,
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});
app.post('/api/generate-voice-questions', async (req, res) => {
  try {
    const { jobDescriptionId } = req.body;

    if (!jobDescriptionId) {
      return res.status(400).json({
        success: false,
        error: 'jobDescriptionId is required'
      });
    }

    const jd = await JobDescription.findById(jobDescriptionId);
    if (!jd || !jd.s3Key) {
      return res.status(404).json({
        success: false,
        error: 'Job description not found or has no file'
      });
    }

    // Get stream directly from S3
    const jdStream = await getS3ReadStream(jd.s3Key);

    const form = new FormData();
    form.append('job_description', jdStream.stream, {
      filename: jd.filename || 'job_description.pdf',
      contentType: jdStream.contentType || 'application/pdf',
      knownLength: jdStream.contentLength
    });

    console.log('Streaming JD directly from S3 to voice question API...');

    const headers = {
      ...form.getHeaders(),
      'Content-Length': form.getLengthSync(),
      'Accept': 'application/json'
    };

    const response = await axios.post(process.env.VOICE_GENERATION_API, form, {
      headers,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });

    // Validate API response structure
    if (!response.data ||
      !response.data['POST Response'] ||
      !response.data['POST Response'][0] ||
      !response.data['POST Response'][0]['Questions'] ||
      !response.data['POST Response'][0]['Questions'].questions) {
      throw new Error('Invalid response structure from voice question API');
    }

    const apiQuestions = response.data['POST Response'][0]['Questions'].questions;

    if (!Array.isArray(apiQuestions)) {
      throw new Error('Questions should be an array');
    }

    // Transform questions to match our format
    const formattedQuestions = apiQuestions.map((q, index) => ({
      id: `v-${index}-${Date.now()}`,
      question: q.question || `Voice question ${index + 1}`
    }));

    if (formattedQuestions.length === 0) {
      throw new Error('No valid questions generated');
    }

    res.json({
      success: true,
      questions: formattedQuestions,
      jdTitle: jd.title,
      generatedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Voice question generation failed:', error);

    let errorMessage = 'Failed to generate voice questions';
    let errorDetails = null;

    if (error.response) {
      // The request was made and the server responded with a status code
      console.error('API response error:', error.response.status, error.response.data);
      errorMessage = `Voice question API responded with ${error.response.status}`;
      errorDetails = error.response.data?.message || error.response.data;
    } else if (error.request) {
      // The request was made but no response was received
      console.error('No response received:', error.request);
      errorMessage = 'No response from voice question API';
    } else {
      // Something happened in setting up the request
      console.error('Request setup error:', error.message);
      errorMessage = error.message;
    }

    res.status(500).json({
      success: false,
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? errorDetails : undefined
    });
  }
});

// Add this new endpoint after the existing question generation endpoints
app.post('/api/create-custom-assessment', authenticateJWT, async (req, res) => {
  try {
    const {
      candidateEmail,
      jobTitle,
      resumeId,
      jobDescriptionId,
      customMcqQuestions,
      customVoiceQuestions
    } = req.body;

    // Validate input
    if (!candidateEmail || !jobTitle || !resumeId || !jobDescriptionId) {
      return res.status(400).json({
        success: false,
        error: 'All required fields must be provided'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(candidateEmail)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email format'
      });
    }

    // Validate custom MCQ questions format
    if (!customMcqQuestions || !Array.isArray(customMcqQuestions)) {
      return res.status(400).json({
        success: false,
        error: 'Custom MCQ questions array is required'
      });
    }

    // Validate exactly 10 MCQ questions
    if (customMcqQuestions.length !== 10) {
      return res.status(400).json({
        success: false,
        error: 'Exactly 10 MCQ questions are required'
      });
    }

    // Validate each MCQ question
    for (let i = 0; i < customMcqQuestions.length; i++) {
      const q = customMcqQuestions[i];
      if (!q.question || !q.options || !Array.isArray(q.options) || q.options.length !== 4 || !q.correctAnswer) {
        return res.status(400).json({
          success: false,
          error: `Invalid MCQ question format at index ${i}. Each MCQ must have exactly 4 options.`
        });
      }
    }

    // Validate custom voice questions format
    if (!customVoiceQuestions || !Array.isArray(customVoiceQuestions)) {
      return res.status(400).json({
        success: false,
        error: 'Custom voice questions array is required'
      });
    }

    // Validate exactly 5 voice questions
    if (customVoiceQuestions.length !== 5) {
      return res.status(400).json({
        success: false,
        error: 'Exactly 5 voice questions are required'
      });
    }

    // Validate each voice question
    for (let i = 0; i < customVoiceQuestions.length; i++) {
      const q = customVoiceQuestions[i];
      if (!q.question) {
        return res.status(400).json({
          success: false,
          error: `Invalid voice question format at index ${i}`
        });
      }
    }

    // Verify resume and JD exist
    const [resume, jd] = await Promise.all([
      Resume.findById(resumeId),
      JobDescription.findById(jobDescriptionId)
    ]);

    if (!resume || !resume.s3Key) {
      return res.status(404).json({ error: 'Resume not found in S3' });
    }
    if (!jd || !jd.s3Key) {
      return res.status(404).json({ error: 'Job description not found in S3' });
    }

    // Transform custom MCQ questions to match our format
    const formattedMcqQuestions = customMcqQuestions.map((q, index) => ({
      id: `cq-${index}-${Date.now()}`,
      question: q.question,
      options: q.options,
      correctAnswer: q.correctAnswer
    }));

    // Transform custom voice questions to match our format
    const formattedVoiceQuestions = customVoiceQuestions.map((q, index) => ({
      id: `cv-${index}-${Date.now()}`,
      question: q.question
    }));

    // Create session with custom questions
    const token = require('crypto').randomBytes(20).toString('hex');
    const testLink = `${process.env.FRONTEND_URL}/assessment/${token}`;

    const session = new AssessmentSession({
      user: req.user.id,
      candidateEmail,
      jobTitle,
      testLink,
      status: 'pending',
      questions: formattedMcqQuestions,
      voiceQuestions: formattedVoiceQuestions,
      resumeId,
      jobDescriptionId
    });
    await session.save();

    // Increment assessment count
    await User.findByIdAndUpdate(req.user.id, {
      $inc: { 'usage.assessments': 1 }
    });

    // Email options
    const mailOptions = {
      from: `"Assessment System" <${process.env.EMAIL_USER}>`,
      to: candidateEmail,
      subject: `Your Custom Assessment for ${jobTitle}`,
      text: `Please complete your custom assessment at: ${testLink}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #f8f9fa; padding: 20px; text-align: center; }
            .content { padding: 20px; }
            .button { 
              display: inline-block; 
              padding: 10px 20px; 
              background-color: #007bff; 
              color: white !important; 
              text-decoration: none; 
              border-radius: 5px; 
              margin: 20px 0;
            }
            .footer { margin-top: 20px; font-size: 12px; color: #6c757d; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h2>Custom Assessment Invitation</h2>
            </div>
            <div class="content">
              <p>Hello,</p>
              <p>You've been invited to complete a custom assessment for the position of <strong>${jobTitle}</strong>.</p>
              
              <a href="${testLink}" class="button">Start Custom Assessment</a>
              
              <p>Or copy and paste this link into your browser:</p>
              <p><code>${testLink}</code></p>
              
              <p><strong>Note:</strong> This custom assessment includes:</p>
              <ul>
                <li>${formattedMcqQuestions.length} Multiple Choice Questions</li>
                <li>${formattedVoiceQuestions.length} Voice Interview Questions</li>
                <li>System verification</li>
                <li>Video interview recording</li>
              </ul>
              <p>Your screen and camera will be recorded during the assessment.</p>
              
              <p>This link will expire in 24 hours.</p>
            </div>
            <div class="footer">
              <p>If you didn't request this assessment, please ignore this email.</p>
            </div>
          </div>
        </body>
        </html>
      `
    };

    // Send email
    try {
      await transporter.sendMail(mailOptions);
      console.log(`Custom assessment email sent to ${candidateEmail}`);

      res.status(200).json({
        success: true,
        message: 'Custom assessment created and email sent successfully!',
        sessionId: session._id,
        testLink
      });
    } catch (emailError) {
      console.error('Email sending failed:', emailError);

      // Delete the session if email fails
      await AssessmentSession.findByIdAndDelete(session._id);
      await User.findByIdAndUpdate(req.user.id, {
        $inc: { 'usage.assessments': -1 }
      });

      res.status(500).json({
        success: false,
        error: 'Failed to send assessment email',
        details: process.env.NODE_ENV === 'development' ? emailError.message : undefined
      });
    }
  } catch (error) {
    console.error('Error in create-custom-assessment:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create custom assessment',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});


// Test link generator //
// Updated send-test-link endpoint with NodeMailer
app.post('/api/send-test-link', authenticateJWT, checkSubscription, checkUsageLimits('assessments'), async (req, res) => {
  const { candidateEmail, jobTitle, resumeId, jobDescriptionId, questions, voiceQuestions } = req.body;

  // Enhanced validation
  if (!questions || !Array.isArray(questions)) {
    return res.status(400).json({ error: 'Questions array is required' });
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(candidateEmail)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  try {
    // Verify resume and JD exist
    const [resume, jd] = await Promise.all([
      Resume.findById(resumeId),
      JobDescription.findById(jobDescriptionId)
    ]);

    if (!resume || !resume.s3Key) {
      return res.status(404).json({ error: 'Resume not found in S3' });
    }
    if (!jd || !jd.s3Key) {
      return res.status(404).json({ error: 'Job description not found in S3' });
    }

    const token = require('crypto').randomBytes(20).toString('hex');
    const testLink = `${process.env.FRONTEND_URL}/assessment/${token}`;

    // Create session
    const session = new AssessmentSession({
      user: req.user.id,
      candidateEmail,
      jobTitle,
      testLink,
      status: 'pending',
      questions,
      voiceQuestions,
      resumeId,
      jobDescriptionId
    });
    await session.save();

    // Increment assessment count
    await User.findByIdAndUpdate(req.user.id, {
      $inc: { 'usage.assessments': 1 }
    });




    // Email options
    const mailOptions = {
      from: `"Assessment System" <${process.env.EMAIL_USER}>`,
      to: candidateEmail,
      subject: `Your Assessment for ${jobTitle}`,
      text: `Please complete your assessment at: ${testLink}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #f8f9fa; padding: 20px; text-align: center; }
            .content { padding: 20px; }
            .button { 
              display: inline-block; 
              padding: 10px 20px; 
              background-color: #007bff; 
              color: white !important; 
              text-decoration: none; 
              border-radius: 5px; 
              margin: 20px 0;
            }
            .footer { margin-top: 20px; font-size: 12px; color: #6c757d; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h2>Assessment Invitation</h2>
            </div>
            <div class="content">
              <p>Hello,</p>
              <p>You've been invited to complete an assessment for the position of <strong>${jobTitle}</strong>.</p>
              
              <a href="${testLink}" class="button">Start Assessment</a>
              
              <p>Or copy and paste this link into your browser:</p>
              <p><code>${testLink}</code></p>
              
              <p><strong>Note:</strong> This assessment includes:</p>
              <ul>
                <li>System verification</li>
                <li>Video interview recording</li>
                <li>MCQ test</li>
              </ul>
              <p>Your screen and camera will be recorded during the assessment.</p>
              
              <p>This link will expire in 24 hours.</p>
            </div>
            <div class="footer">
              <p>If you didn't request this assessment, please ignore this email.</p>
            </div>
          </div>
        </body>
        </html>
      `
    };

    // Send email with detailed error handling
    try {
      await transporter.sendMail(mailOptions);
      console.log(`Email sent to ${candidateEmail}`);

      res.status(200).json({
        success: true,
        message: 'Assessment link sent successfully!',
        sessionId: session._id,
        testLink // Return the link for debugging
      });
    } catch (emailError) {
      console.error('Email sending failed:', emailError);

      // Delete the session if email fails
      await AssessmentSession.findByIdAndDelete(session._id);
      await User.findByIdAndUpdate(req.user.id, {
        $inc: { 'usage.assessments': 1 }
      });
      // Extract detailed error message
      let errorMessage = 'Failed to send assessment email';
      if (emailError.response) {
        errorMessage = emailError.response;
      }

      res.status(500).json({
        success: false,
        error: errorMessage,
        details: process.env.NODE_ENV === 'development' ? emailError : undefined
      });
    }
  } catch (error) {
    console.error('Error in send-test-link:', error);
    res.status(500).json({
      error: 'Failed to create assessment session',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});


// New endpoint to start assessment recording
app.post('/api/start-assessment-recording', async (req, res) => {
  const { token } = req.body;

  try {
    const session = await AssessmentSession.findOneAndUpdate(
      { testLink: `${process.env.FRONTEND_URL}/assessment/${token}` },
      { status: 'in-progress', startedAt: new Date() },
      { new: true }
    );

    if (!session) {
      return res.status(404).json({ error: 'Assessment session not found.' });
    }

    res.status(200).json(session);
  } catch (error) {
    console.error('Error starting assessment:', error);
    res.status(500).json({ error: 'Failed to start assessment.' });
  }
});


// Updated complete-assessment endpoint
// Enhanced complete-assessment endpoint
app.post('/api/complete-assessment', async (req, res) => {
  const { token, score, recordingId, answers } = req.body;
  // Validate input
  if (!token || score === undefined) {
    return res.status(400).json({
      error: 'Token and score are required',
      code: 'INVALID_INPUT'
    });
  }

  try {
    // 1. Find and validate session with transaction
    const session = await AssessmentSession.findOneAndUpdate(
      {
        testLink: `${process.env.FRONTEND_URL}/assessment/${token}`,
        status: 'in-progress'
      },
      { $set: { status: 'completing' } }, // Temporary lock status
      { new: true }
    );

    if (!session) {
      return res.status(410).json({
        error: 'Assessment already completed, expired, or not found',
        code: 'SESSION_INVALID'
      });
    }


    // 2. Update questions with user answers if provided
    if (answers && Array.isArray(answers)) {
      const updatedQuestions = session.questions.map(q => {
        const answer = answers.find(a => a.id === q.id);
        return answer ? { ...q, userAnswer: answer.userAnswer } : q;
      });

      session.questions = updatedQuestions;


      await AssessmentSession.findByIdAndUpdate(session._id, {
        $set: { questions: updatedQuestions }
      });
    }
    // 2. Update the recording with session reference if not already set
    if (recordingId) {
      await Recording.findByIdAndUpdate(recordingId, {
        assessmentSession: session._id
      });
    }

    // 2. Create test result with atomic operations
    const testResult = await TestResult.findOneAndUpdate(
      {
        assessmentSession: session._id,
        status: { $ne: 'completed' } // Prevent duplicates
      },
      {
        candidateEmail: session.candidateEmail,
        jobTitle: session.jobTitle,
        score: Math.max(0, Math.min(100, score)), // Ensure score is 0-100
        status: 'completed',
        submittedAt: new Date(),
        recording: recordingId
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true
      }
    );

    // 3. Finalize session update
    await AssessmentSession.findByIdAndUpdate(session._id, {
      $set: {
        status: 'completed',
        completedAt: new Date(),
        testResult: testResult._id
      }
    });

    // 4. Find and update the corresponding ScheduledTest if this is a scheduled assessment
    const scheduledTest = await ScheduledTest.findOne({ assessmentSession: session._id });
    if (scheduledTest) {
      scheduledTest.status = 'completed';
      scheduledTest.completedAt = new Date();
      await scheduledTest.save();
      console.log(`✅ Scheduled test ${scheduledTest._id} marked as completed`);
    }

    // 5. Expire any related pending attempts
    await TestResult.updateMany(
      {
        candidateEmail: session.candidateEmail,
        jobTitle: session.jobTitle,
        status: 'pending',
        _id: { $ne: testResult._id }
      },
      { $set: { status: 'expired' } }
    );

    // 6. Successful response
    res.status(200).json({
      success: true,
      message: 'Assessment submitted successfully',
      data: {
        score: testResult.score,
        completedAt: testResult.submittedAt,
        recordingId: testResult.recording
      },
      metadata: {
        warning: 'This assessment link is now invalid',
        retakeAllowed: false
      }
    });


  } catch (error) {
    console.error('Assessment completion error:', error);

    // Revert any partial changes
    await AssessmentSession.updateOne(
      { testLink: `${process.env.FRONTEND_URL}/assessment/${token}` },
      { $set: { status: 'in-progress' } }
    );

    res.status(500).json({
      error: 'Failed to complete assessment',
      code: 'SERVER_ERROR',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Add this new endpoint to your server.js
app.patch('/api/update-answer/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { questionId, userAnswer } = req.body;

    // Atomic update of the specific question answer
    const result = await AssessmentSession.updateOne(
      {
        testLink: `${process.env.FRONTEND_URL}/assessment/${token}`,
        'questions.id': questionId
      },
      {
        $set: { 'questions.$.userAnswer': userAnswer }
      }
    );

    if (result.nModified === 0) {
      return res.status(404).json({ error: 'Question or session not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating answer:', error);
    res.status(500).json({ error: 'Failed to update answer' });
  }
});

// Add near other endpoints
app.post('/api/generate-report/:sessionId', authenticateJWT, verifyOwnership(AssessmentSession), async (req, res) => {
  try {
    const { sessionId } = req.params;

    // Generate and store report
    const report = await generateAssessmentReport(sessionId, req.user.id);

    // Get signed URL for download
    const command = new GetObjectCommand({
      Bucket: process.env.MINIO_BUCKET_NAME,
      Key: report.s3Key
    });
    const downloadUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });

    // Send email notification
    const session = await AssessmentSession.findById(sessionId);
    await sendReportEmail(
      req.user.email,
      downloadUrl,
      session.candidateEmail,
      session.jobTitle
    );

    res.json({
      success: true,
      message: 'Report generated and sent successfully',
      downloadUrl,
      reportId: report.reportId
    });
  } catch (error) {
    console.error('Report generation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate report',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});
// Add this middleware to check assessment validity
// Enhanced validation endpoint to handle both immediate and scheduled tests
app.get('/api/validate-assessment/:token', async (req, res) => {
  try {
    const { token } = req.params;

    // First check if it's a scheduled test
    const scheduledTest = await ScheduledTest.findOne({ token });
    if (scheduledTest) {
      // Use the scheduled test validation logic
      const now = new Date();

      // Check if test has already been completed
      if (scheduledTest.status === 'completed') {
        return res.status(410).json({
          valid: false,
          error: 'This assessment has already been completed successfully.',
          status: 'completed'
        });
      }

      if (now > scheduledTest.expiresAt) {
        scheduledTest.status = 'expired';
        await scheduledTest.save();

        return res.status(410).json({
          valid: false,
          error: 'Assessment link has expired',
          status: 'expired'
        });
      }

      if (now < scheduledTest.scheduledDateTime) {
        return res.status(403).json({
          valid: false,
          error: `Assessment will be available from ${scheduledTest.scheduledDateTime.toLocaleString()}`,
          status: 'not-yet-active',
          scheduledTime: scheduledTest.scheduledDateTime
        });
      }

      if (scheduledTest.status === 'cancelled') {
        return res.status(410).json({
          valid: false,
          error: 'Assessment has been cancelled',
          status: 'cancelled'
        });
      }

      // Activate the test if it's scheduled
      if (scheduledTest.status === 'scheduled') {
        scheduledTest.status = 'active';
        scheduledTest.activatedAt = now;
        await scheduledTest.save();
      }

      return res.json({
        valid: true,
        session: {
          candidateEmail: scheduledTest.candidateEmail,
          type: 'scheduled'
        }
      });
    }

    // If not scheduled, check for immediate assessment
    const session = await AssessmentSession.findOne({
      testLink: `${process.env.FRONTEND_URL}/assessment/${token}`
    }).populate('testResult');

    if (!session) {
      return res.status(404).json({
        valid: false,
        error: 'Assessment not found',
        status: 'not-found'
      });
    }

    // Check if assessment has already been completed
    if (session.status === 'completed' || session.testResult?.status === 'completed') {
      return res.status(410).json({
        valid: false,
        error: 'This assessment has already been completed successfully.',
        status: 'completed'
      });
    }

    // Check expiration (24 hours)
    const hoursSinceCreation = (new Date() - session.createdAt) / (1000 * 60 * 60);
    if (hoursSinceCreation > 24) {
      await AssessmentSession.findByIdAndUpdate(session._id, { status: 'expired' });
      return res.status(410).json({
        valid: false,
        error: 'This assessment link has expired',
        status: 'expired'
      });
    }

    res.json({
      valid: true,
      session: {
        ...session.toObject(),
        type: 'immediate'
      }
    });
  } catch (error) {
    console.error('Validation error:', error);
    res.status(500).json({
      valid: false,
      error: 'Validation failed',
      status: 'error'
    });
  }
});
// Add to server.js
app.get('/api/assessment-questions/:token', async (req, res) => {
  try {
    const session = await AssessmentSession.findOne({
      testLink: `${process.env.FRONTEND_URL}/assessment/${req.params.token}`
    }).select('questions voiceQuestions');

    if (!session) {
      return res.status(404).json({ error: 'Assessment session not found' });
    }

    res.json({
      questions: session.questions,
      voiceQuestions: session.voiceQuestions
    });
  } catch (error) {
    console.error('Error fetching questions:', error);
    res.status(500).json({ error: 'Failed to fetch assessment questions' });
  }
});
// Submit Test Score
app.post('/api/submit-score', async (req, res) => {
  const { token, score } = req.body;

  // Find the test result by token
  const testResult = await TestResult.findOne({ testLink: `${process.env.FRONTEND_URL}/quiz/${token}` });

  if (!testResult) {
    return res.status(404).json({ error: 'Test link not found.' });
  }

  if (testResult.expired) {
    return res.status(400).json({ error: 'Test link has expired.' });
  }

  // Update the test result with the score
  testResult.score = score;
  testResult.submittedAt = new Date();
  testResult.expired = true;
  await testResult.save();

  res.status(200).json({ message: 'Test score submitted successfully!' });
});
app.get('/api/recording/:id/play', async (req, res) => {
  try {
    const recording = await Recording.findById(req.params.id);
    if (!recording) {
      return res.status(404).json({ error: 'Recording not found' });
    }

    const command = new GetObjectCommand({
      Bucket: process.env.MINIO_BUCKET_NAME,
      Key: recording.videoPath
    });

    const url = await getSignedUrl(s3, command);
    res.json({ url });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get recording' });
  }
});

// Similar endpoint for screen recording and audio answers

// Endpoint to serve video recordings by key
app.get('/api/video/:videoKey', authenticateJWT, async (req, res) => {
  try {
    const { videoKey } = req.params;

    // Validate video key format - more flexible pattern
    if (!videoKey || !videoKey.match(/^session_[a-f0-9]+_(camera|screen)_[0-9]+\.webm$/)) {
      console.log('Invalid video key format:', videoKey);
      return res.status(400).json({ error: 'Invalid video key format' });
    }

    // Construct the full S3 key
    const s3Key = `video/${videoKey}`;

    // Generate signed URL
    const command = new GetObjectCommand({
      Bucket: process.env.MINIO_BUCKET_NAME,
      Key: s3Key
    });

    const url = await getSignedUrl(s3, command, { expiresIn: 3600 }); // 1 hour expiry

    res.json({ url });
  } catch (error) {
    console.error('Error serving video:', error);
    res.status(500).json({ error: 'Failed to serve video' });
  }
});

// Endpoint to serve screen recordings by key
app.get('/api/screen/:screenKey', authenticateJWT, async (req, res) => {
  try {
    const { screenKey } = req.params;

    // Validate screen key format - more flexible pattern
    if (!screenKey || !screenKey.match(/^session_[a-f0-9]+_(camera|screen)_[0-9]+\.webm$/)) {
      console.log('Invalid screen key format:', screenKey);
      return res.status(400).json({ error: 'Invalid screen key format' });
    }

    // Construct the full S3 key
    const s3Key = `video/${screenKey}`;

    // Generate signed URL
    const command = new GetObjectCommand({
      Bucket: process.env.MINIO_BUCKET_NAME,
      Key: s3Key
    });

    const url = await getSignedUrl(s3, command, { expiresIn: 3600 }); // 1 hour expiry

    res.json({ url });
  } catch (error) {
    console.error('Error serving screen recording:', error);
  }
});

// Endpoint to get video by video key
app.get('/api/video/:videoKey', authenticateJWT, async (req, res) => {
  try {
    const { videoKey } = req.params;

    // Security check - ensure the video belongs to a recording associated with the user
    const recording = await Recording.findOne({
      videoPath: { $regex: videoKey + '$' },
      assessmentSession: { $in: await AssessmentSession.find({ user: req.user.id }).distinct('_id') }
    });

    if (!recording) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const command = new GetObjectCommand({
      Bucket: process.env.MINIO_BUCKET_NAME,
      Key: recording.videoPath
    });

    const url = await getSignedUrl(s3, command, { expiresIn: 3600 }); // 1 hour expiration
    res.json({ url });
  } catch (error) {
    console.error('Error retrieving video:', error);
    res.status(500).json({ error: 'Failed to retrieve video' });
  }
});

// Endpoint to download video by video key
app.get('/api/video/:videoKey/download', authenticateJWT, async (req, res) => {
  try {
    const { videoKey } = req.params;

    // Security check - ensure the video belongs to a recording associated with the user
    const recording = await Recording.findOne({
      videoPath: { $regex: videoKey + '$' },
      assessmentSession: { $in: await AssessmentSession.find({ user: req.user.id }).distinct('_id') }
    });

    if (!recording) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const command = new GetObjectCommand({
      Bucket: process.env.MINIO_BUCKET_NAME,
      Key: recording.videoPath,
      ResponseContentDisposition: `attachment; filename="${videoKey}"`
    });

    const url = await getSignedUrl(s3, command, { expiresIn: 3600 }); // 1 hour expiration
    res.json({ url });
  } catch (error) {
    console.error('Error downloading video:', error);
    res.status(500).json({ error: 'Failed to download video' });
  }
});

// Endpoint to get screen recording by screen key
app.get('/api/screen/:screenKey', authenticateJWT, async (req, res) => {
  try {
    const { screenKey } = req.params;

    // Security check - ensure the screen recording belongs to a recording associated with the user
    const recording = await Recording.findOne({
      screenPath: { $regex: screenKey + '$' },
      assessmentSession: { $in: await AssessmentSession.find({ user: req.user.id }).distinct('_id') }
    });

    if (!recording) {
      return res.status(404).json({ error: 'Screen recording not found' });
    }

    const command = new GetObjectCommand({
      Bucket: process.env.MINIO_BUCKET_NAME,
      Key: recording.screenPath
    });

    const url = await getSignedUrl(s3, command, { expiresIn: 3600 }); // 1 hour expiration
    res.json({ url });
  } catch (error) {
    console.error('Error retrieving screen recording:', error);
    res.status(500).json({ error: 'Failed to retrieve screen recording' });
  }
});

// Endpoint to download screen recording by screen key
app.get('/api/screen/:screenKey/download', authenticateJWT, async (req, res) => {
  try {
    const { screenKey } = req.params;

    // Security check - ensure the screen recording belongs to a recording associated with the user
    const recording = await Recording.findOne({
      screenPath: { $regex: screenKey + '$' },
      assessmentSession: { $in: await AssessmentSession.find({ user: req.user.id }).distinct('_id') }
    });

    if (!recording) {
      return res.status(404).json({ error: 'Screen recording not found' });
    }

    const command = new GetObjectCommand({
      Bucket: process.env.MINIO_BUCKET_NAME,
      Key: recording.screenPath,
      ResponseContentDisposition: `attachment; filename="${screenKey}"`
    });

    const url = await getSignedUrl(s3, command, { expiresIn: 3600 }); // 1 hour expiration
    res.json({ url });
  } catch (error) {
    console.error('Error downloading screen recording:', error);
    res.status(500).json({ error: 'Failed to download screen recording' });
  }
});

// Endpoint to get audio by audio key
app.get('/api/audio/:audioKey', authenticateJWT, async (req, res) => {
  try {
    const { audioKey } = req.params;

    // Security check - ensure the audio belongs to a voice answer associated with the user
    const voiceAnswer = await VoiceAnswer.findOne({
      audioPath: { $regex: audioKey + '$' },
      assessmentSession: { $in: await AssessmentSession.find({ user: req.user.id }).distinct('_id') }
    });

    if (!voiceAnswer) {
      return res.status(404).json({ error: 'Audio not found' });
    }

    const command = new GetObjectCommand({
      Bucket: process.env.MINIO_BUCKET_NAME,
      Key: voiceAnswer.audioPath
    });

    const url = await getSignedUrl(s3, command, { expiresIn: 3600 }); // 1 hour expiration
    res.json({ url });
  } catch (error) {
    console.error('Error retrieving audio:', error);
    res.status(500).json({ error: 'Failed to retrieve audio' });
  }
});

// Endpoint to download audio by audio key
app.get('/api/audio/:audioKey/download', authenticateJWT, async (req, res) => {
  try {
    const { audioKey } = req.params;

    // Security check - ensure the audio belongs to a voice answer associated with the user
    const voiceAnswer = await VoiceAnswer.findOne({
      audioPath: { $regex: audioKey + '$' },
      assessmentSession: { $in: await AssessmentSession.find({ user: req.user.id }).distinct('_id') }
    });

    if (!voiceAnswer) {
      return res.status(404).json({ error: 'Audio not found' });
    }

    const command = new GetObjectCommand({
      Bucket: process.env.MINIO_BUCKET_NAME,
      Key: voiceAnswer.audioPath,
      ResponseContentDisposition: `attachment; filename="${audioKey}"`
    });

    const url = await getSignedUrl(s3, command, { expiresIn: 3600 }); // 1 hour expiration
    res.json({ url });
  } catch (error) {
    console.error('Error downloading audio:', error);
    res.status(500).json({ error: 'Failed to download audio' });
  }
});

// Fetch Test Results
// Updated test-results endpoint
app.get('/api/test-results', authenticateJWT, async (req, res) => {
  try {

    const query = { user: req.user.id };
    if (req.user.isAdmin) {
      delete query.user; // Admins see all results
    }

    const testScores = await TestResult.find(query)
      .populate('assessmentSession')
      .sort({ createdAt: -1 });
    res.status(200).json(testScores);
  } catch (error) {
    console.error('Error fetching test results:', error);
    res.status(500).json({ error: 'Failed to fetch test results.' });
  }
});


// Start voice assessment phase
app.post('/api/start-voice-assessment', async (req, res) => {
  try {
    const { token } = req.body;

    const session = await AssessmentSession.findOneAndUpdate(
      { testLink: `${process.env.FRONTEND_URL}/assessment/${token}` },
      { $set: { currentPhase: 'voice' } },
      { new: true }
    );

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.status(200).json(session);
  } catch (error) {
    console.error('Error starting voice assessment:', error);
    res.status(500).json({ error: 'Failed to start voice assessment' });
  }
});

app.post('/api/submit-voice-answer', (req, res) => {
  audioUpload(req, res, async (err) => {
    try {
      const { token, questionId, question, skipped, durationSec } = req.body;

      // Error handling for upload
      if (err) {
        return res.status(400).json({ error: err.message });
      }

      if (!req.file && !skipped) {
        return res.status(400).json({ error: 'No audio file uploaded' });
      }

      // Add these new endpoints after the existing recording endpoints

      // Find session
      const session = await AssessmentSession.findOne({
        testLink: `${process.env.FRONTEND_URL}/assessment/${token}`
      });

      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      // Handle skipped questions
      if (skipped) {
        const voiceAnswer = new VoiceAnswer({
          questionId,
          question,
          answered: false,
          valid: false,
          skipReason: 'timeout',
          processingStatus: 'skipped',
          assessmentSession: session._id,
          durationSec: durationSec || 0
        });

        await voiceAnswer.save();
        return res.status(200).json({
          success: true,
          answerId: voiceAnswer._id,
          skipped: true
        });
      }

      // Validate audio before upload
      const validation = await validateAudio(req.file.buffer);
      const s3Key = `audio/answer_${Date.now()}_${questionId}.wav`;

      // Create voice answer document first
      const voiceAnswer = new VoiceAnswer({
        questionId,
        question,
        audioPath: validation.valid ? s3Key : null,
        durationSec: req.file.buffer.length / (16000 * 2),
        answered: true,
        valid: validation.valid,
        processingStatus: validation.valid ? 'pending' : 'skipped',
        skipReason: validation.reason,
        assessmentSession: session._id
      });

      await voiceAnswer.save();

      // Only proceed with upload and processing if audio is valid
      if (validation.valid) {
        try {
          // Create a fresh stream from the buffer
          const audioStream = Readable.from(req.file.buffer);

          // Upload to S3 with explicit WAV MIME type
          await uploadToS3(audioStream, s3Key, 'audio/wav');

          // Start transcription in background
          processTranscription(voiceAnswer._id).catch(transcriptionError => {
            console.error('Transcription processing failed:', transcriptionError);
          });
        } catch (uploadError) {
          console.error('Audio upload failed:', uploadError);
          // Update status if upload fails
          await VoiceAnswer.findByIdAndUpdate(voiceAnswer._id, {
            processingStatus: 'failed',
            skipReason: 'upload_failed'
          });
          throw uploadError;
        }
      }

      session.voiceAnswers.push(voiceAnswer._id);
      await session.save();

      // Trigger audio analysis in background
      setTimeout(async () => {
        try {
          // Update status to processing
          await VoiceAnswer.findByIdAndUpdate(voiceAnswer._id, {
            'audioAnalysis.status': 'processing'
          });

          // Analyze audio
          const gradingResult = await analyzeAudio([voiceAnswer.audioPath]);

          // Save analysis results
          await VoiceAnswer.findByIdAndUpdate(voiceAnswer._id, {
            audioAnalysis: {
              grading: gradingResult,
              processedAt: new Date(),
              status: 'completed'
            },
            processingStatus: 'completed'
          });

          // Calculate average score for all answers in this session
          const completedAnswers = await VoiceAnswer.find({
            assessmentSession: session._id,
            'audioAnalysis.status': 'completed',
            'audioAnalysis.grading.Total Score': { $exists: true }
          });

          if (completedAnswers.length > 0) {
            const totalScore = completedAnswers.reduce((sum, answer) => {
              return sum + (answer.audioAnalysis.grading['Total Score'] || 0);
            }, 0);
            const averageScore = totalScore / completedAnswers.length;

            // Update TestResult with the average audio score
            await TestResult.findOneAndUpdate(
              { assessmentSession: session._id },
              { audioScore: averageScore },
              { new: true }
            );
          }
        } catch (error) {
          await VoiceAnswer.findByIdAndUpdate(voiceAnswer._id, {
            'audioAnalysis.status': 'failed'
          });
          console.error('Audio analysis error:', error);
        }
      }, 0);

      res.status(200).json({
        success: true,
        answerId: voiceAnswer._id,
        valid: validation.valid,
        reason: validation.reason,
        format: 'wav'
      });

    } catch (error) {
      // Cleanup any leftover files
      if (req.file?.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }

      console.error('Voice answer submission error:', error);
      res.status(500).json({
        error: 'Failed to submit voice answer',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });
});

app.get('/api/recording/:id/analysis', async (req, res) => {
  try {
    const recording = await Recording.findById(req.params.id);
    if (!recording) {
      return res.status(404).json({ error: 'Recording not found' });
    }
    res.json(recording.videoAnalysis);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get analysis' });
  }
});

app.get('/api/voice-answer/:id/analysis', async (req, res) => {
  try {
    const answer = await VoiceAnswer.findById(req.params.id);
    if (!answer) {
      return res.status(404).json({ error: 'Answer not found' });
    }
    res.json(answer.audioAnalysis);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get analysis' });
  }
});

// Update the complete-voice-assessment endpoint
app.post('/api/complete-voice-assessment', async (req, res) => {
  const { token, recordingId } = req.body;

  try {
    const session = await AssessmentSession.findOneAndUpdate(
      { testLink: `${process.env.FRONTEND_URL}/assessment/${token}` },
      {
        $set: {
          currentPhase: 'completed',
          status: 'completed',
          completedAt: new Date(),
          recording: recordingId // Store recording reference
        }
      },
      { new: true }
    );

    // Ensure the recording references the session
    if (recordingId) {
      await Recording.findByIdAndUpdate(recordingId, {
        assessmentSession: session._id
      });
    }

    // Find and update the corresponding ScheduledTest if this is a scheduled assessment
    const scheduledTest = await ScheduledTest.findOne({ assessmentSession: session._id });
    if (scheduledTest) {
      scheduledTest.status = 'completed';
      scheduledTest.completedAt = new Date();
      await scheduledTest.save();
      console.log(`✅ Scheduled test ${scheduledTest._id} marked as completed`);
    }

    // Non-blocking processing
    processAssessmentCompletion(session._id, session.user)
      .catch(err => console.error('Background processing error:', err));

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error completing voice assessment:', error);
    res.status(500).json({ error: 'Failed to complete assessment' });
  }
});


async function processAssessmentCompletion(sessionId, userId) {
  try {
    // 1. Atomic status check and update
    const session = await AssessmentSession.findOneAndUpdate(
      {
        _id: sessionId,
        reportStatus: { $in: ['pending', 'failed'] } // Only process if not already completed/processing
      },
      { $set: { reportStatus: 'processing' } },
      { new: true }
    );

    if (!session) {
      console.log('Report already being processed or completed for session:', sessionId);
      return;
    }

    // 2. Generate report (existing logic)
    await calculateAndStoreScores(sessionId);
    const report = await generateAssessmentReport(sessionId, userId);

    // 3. Mark as completed
    await AssessmentSession.findByIdAndUpdate(sessionId, {
      reportStatus: 'completed',
      reportGeneratedAt: new Date()
    });

    console.log('Successfully processed assessment:', sessionId);

    // 4. AUTO-GENERATE MERGED PDF
    // Trigger merged PDF generation automatically after report completion
    try {
      console.log(`🔄 [AUTO MERGED PDF] Automatically generating merged PDF for session: ${sessionId}`);

      // Generate merged PDF in background (don't block the response)
      generateMergedPDF(sessionId, userId).then((mergedResult) => {
        if (mergedResult.success) {
          console.log(`✅ [AUTO MERGED PDF] Successfully generated merged PDF: ${mergedResult.mergedDocumentId}`);
        } else {
          console.log(`ℹ️ [AUTO MERGED PDF] Merged PDF already existed: ${mergedResult.mergedDocumentId}`);
        }
      }).catch((mergedError) => {
        console.error(`❌ [AUTO MERGED PDF] Failed to auto-generate merged PDF for session ${sessionId}:`, mergedError.message);
        // Don't throw - this shouldn't fail the main report process
      });

    } catch (autoMergeError) {
      console.error(`❌ [AUTO MERGED PDF] Error in auto-merge trigger for session ${sessionId}:`, autoMergeError.message);
      // Don't throw - this shouldn't fail the main report process
    }

    return report;
  } catch (error) {
    // 4. Handle failures
    await AssessmentSession.findByIdAndUpdate(sessionId, {
      reportStatus: 'failed'
    });
    console.error('Failed to process assessment:', error);
    throw error;
  }
}
async function sendReportToHR(sessionId, userId, s3Key) {
  try {
    // Get session and user details
    const [session, user] = await Promise.all([
      AssessmentSession.findById(sessionId),
      User.findById(userId)
    ]);

    if (!session || !user) {
      throw new Error('Session or user not found');
    }

    // Generate signed URL for report
    const command = new GetObjectCommand({
      Bucket: process.env.MINIO_BUCKET_NAME,
      Key: s3Key
    });
    const downloadUrl = await getSignedUrl(s3, command, { expiresIn: 604800 }); // 7 days

    // Send email
    const mailOptions = {
      from: `"SkillMatrix Reports" <${process.env.EMAIL_USER}>`,
      to: user.email,
      subject: `Assessment Report for ${session.candidateEmail} - ${session.jobTitle}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2563eb;">Assessment Report Ready</h2>
          <p>The assessment report for candidate <strong>${session.candidateEmail}</strong> is now available.</p>
          <p>Position: <strong>${session.jobTitle}</strong></p>
          
          <div style="text-align: center; margin: 20px 0;">
            <a href="${downloadUrl}" 
               style="background-color: #2563eb; color: white; padding: 10px 20px; 
                      text-decoration: none; border-radius: 5px; display: inline-block;">
              Download Full Report
            </a>
          </div>
          
          <p style="color: #6b7280; font-size: 12px;">
            This report contains confidential assessment data. Please handle appropriately.
          </p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
  } catch (error) {
    console.error('Error sending report to HR:', error);
    throw error;
  }
}

// File upload endpoint (supports both camera and screen recordings)
// File upload endpoint (supports both camera and screen recordings)
// Stream-based upload endpoint for recordings
app.post("/upload", upload.fields([{ name: "cameraFile" }, { name: "screenFile" }]), async (req, res) => {
  console.log("📥 File upload request received");

  try {
    if (!req.files || !req.files.cameraFile || !req.files.screenFile) {
      return res.status(400).json({ error: "Both camera and screen files are required" });
    }

    const { assessmentToken } = req.body;
    const session = await AssessmentSession.findOne({
      testLink: `${process.env.FRONTEND_URL}/assessment/${assessmentToken}`
    });

    if (!session) {
      return res.status(404).json({ error: 'Assessment session not found' });
    }

    // 1. Create recording with "processing" status
    const recording = new Recording({
      filename: req.files.cameraFile[0].originalname,
      assessmentSession: session._id,
      videoAnalysis: {
        status: 'processing',
        startedAt: new Date()
      }
    });
    await recording.save();
    session.recording = recording._id;
    await session.save();

    // 2. Process videos
    try {
      // Generate S3 keys first
      const timestamp = Date.now();
      const cameraKey = `video/session_${recording._id}_camera_${timestamp}.webm`;
      const screenKey = `video/session_${recording._id}_screen_${timestamp}.webm`;

      // Process camera video and upload to S3 in parallel
      const [videoAnalysis] = await Promise.all([
        analyzeVideoFile(req.files.cameraFile[0]),
        uploadToS3(Readable.from(req.files.cameraFile[0].buffer), cameraKey, 'video/webm'),
        uploadToS3(Readable.from(req.files.screenFile[0].buffer), screenKey, 'video/webm')
      ]);

      console.log("Video Analysis Results:", videoAnalysis);

      // Update recording with all results
      const updateData = {
        videoPath: cameraKey,
        screenPath: screenKey,
        'videoAnalysis.emotions': videoAnalysis.emotion_results,
        'videoAnalysis.video_score': videoAnalysis.video_score,
        'videoAnalysis.status': 'completed',
        'videoAnalysis.completedAt': new Date()
      };

      const updatedRecording = await Recording.findByIdAndUpdate(
        recording._id,
        { $set: updateData },
        { new: true }
      );

      console.log("✅ Updated Recording:", updatedRecording);

      // Verify the data was saved
      const dbRecording = await Recording.findById(recording._id);
      console.log("Database Verification:", {
        emotions: dbRecording.videoAnalysis.emotions,
        video_score: dbRecording.videoAnalysis.video_score,
        status: dbRecording.videoAnalysis.status
      });

      // Calculate scores
      await calculateAndStoreVideoScore(session._id);
      await calculateAndStoreScores(session._id);

      res.status(200).json({
        success: true,
        recordingId: recording._id,
        message: "Processing completed successfully",
        videoScore: videoAnalysis.video_score
      });

    } catch (processingError) {
      console.error('Video processing failed:', processingError);
      await Recording.findByIdAndUpdate(recording._id, {
        'videoAnalysis.status': 'failed',
        'videoAnalysis.error': processingError.message,
        'videoAnalysis.completedAt': new Date()
      });
      res.status(500).json({
        success: false,
        error: "Video processing failed",
        details: processingError.message
      });
    }

  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({
      success: false,
      error: "File processing failed",
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// Get all voice answers for a specific assessment session
app.get('/api/assessment-session/:sessionId/voice-answers', authenticateJWT, async (req, res) => {
  try {

    const session = await AssessmentSession.findOne({
      _id: req.params.sessionId,
      user: req.user.id
    });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const answers = await VoiceAnswer.find({
      assessmentSession: req.params.sessionId

    }).sort({ createdAt: 1 }); // Sort by creation time

    res.json(answers);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch voice answers' });
  }
});

// Get assessment session details by ID
app.get('/api/assessment-session/:sessionId', authenticateJWT, async (req, res) => {
  try {
    const session = await AssessmentSession.findById(req.params.sessionId)
      .populate('resumeId')
      .populate('jobDescriptionId')
      .populate('testResult')
      .populate('voiceAnswers')
      .populate('recording');

    if (!session) {
      return res.status(404).json({ error: 'Assessment session not found' });
    }

    // Security check - ensure the session belongs to the authenticated user
    if (session.user.toString() !== req.user.id && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json({
      success: true,
      data: session
    });
  } catch (error) {
    console.error('Error fetching assessment session:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch assessment session'
    });
  }
});

// Get Combined score of all the test scores

app.get('/api/assessment-session/:sessionId/full-results', authenticateJWT, async (req, res) => {
  try {
    const session = await AssessmentSession.findOne({
      _id: req.params.sessionId,
      user: req.user.id
    }).populate('testResult').populate('voiceAnswers');

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Calculate average if not already set
    if (!session.testResult.audioScore) {
      await calculateAndStoreAudioScore(session._id);
      await session.populate('testResult');
    }

    res.json({
      mcqScore: session.testResult.score,
      audioScore: session.testResult.audioScore,
      combinedScore: (session.testResult.score + session.testResult.audioScore) / 2,
      voiceAnswers: session.voiceAnswers
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get results' });
  }
});
app.post('/api/evaluate-answers/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const answers = await VoiceAnswer.find({
      assessmentSession: sessionId,
      answer: { $exists: true, $ne: null },
      'textEvaluation.status': { $ne: 'completed' }
    });

    // Process answers in parallel with rate limiting
    const processingPromises = answers.map(answer =>
      processVoiceAnswer(answer._id)
    );

    await Promise.all(processingPromises);

    res.json({
      success: true,
      message: `Evaluation started for ${answers.length} answers`
    });
  } catch (error) {
    console.error('Error triggering evaluation:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to start evaluation'
    });
  }
});


/*----------------------------------------------------------------------------------------------------------------------------------------------------    */



/*login functionalities*/

// Routes

// Register a new user

const blockedDomains = process.env.BLOCKED_DOMAINS ? process.env.BLOCKED_DOMAINS.split(',') : [];

// Login
// Login with approval check
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: 'Invalid email or password.' });

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) return res.status(400).json({ message: 'Invalid email or password.' });

    // Skip approval check for admin
    if (!user.isAdmin) {
      if (!user.isEmailVerified) {
        return res.status(400).json({ message: 'Please verify your email first.' });
      }

      if (!user.isApproved) {
        return res.status(400).json({ message: 'Your account is pending admin approval.' });
      }

      if (!user.isUnlimited && user.trialEnd < new Date()) {
        return res.status(400).json({ message: 'Trial expired. Contact admin.' });
      }
    }

    const token = jwt.sign(
      {
        id: user._id,
        isAdmin: user.isAdmin,
        email: user.email
      },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict'
    });

    res.status(200).json({
      message: 'Login successful.',
      user: {
        id: user._id,
        email: user.email,
        fullName: user.fullName,
        isAdmin: user.isAdmin
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error.' });
  }
});

// Register a new user with admin approval flow
// Updated Register Endpoint with proper error handling and responses
app.post('/register', [
  body('fullName').notEmpty().withMessage('Full name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('mobileNumber').notEmpty().withMessage('Mobile number is required'),
  body('companyName').notEmpty().withMessage('Company name is required'),
  body('designation').notEmpty().withMessage('Designation is required'),
],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array().map(err => err.msg)
        });
      }

      const { fullName, email, password, mobileNumber, companyName, designation } = req.body;
      const emailDomain = email.split('@')[1];
      const blockedDomains = process.env.BLOCKED_DOMAINS ? process.env.BLOCKED_DOMAINS.split(',') : [];

      if (blockedDomains.includes(emailDomain)) {
        return res.status(400).json({
          success: false,
          message: 'Personal email domains are not allowed. Please use your company email.'
        });
      }

      // Check if user already exists
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'User with this email already exists. Please login or use a different email.'
        });
      }

      // Hash password and create user
      const hashedPassword = await bcrypt.hash(password, 10);
      const user = new User({
        fullName,
        email,
        password: hashedPassword,
        mobileNumber,
        companyName,
        designation,
        trialEnd: new Date(Date.now() + 24 * 60 * 60 * 1000), // 1-day trial
        subscription: {
          plan: 'trial',
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 1-day trial
          isActive: true,
          limits: {
            jdUploads: 1,
            resumeUploads: 10,
            assessments: 1
          }
        }
      });

      await user.save();

      // Generate verification token
      const verificationToken = jwt.sign({ email }, JWT_SECRET, { expiresIn: '1h' });
      const verificationLink = `${process.env.BACKEND_URL}/verify-email?token=${verificationToken}`;



      // Send verification email to user
      try {
        await transporter.sendMail({
          from: `"SkillMatrix AI" <${process.env.EMAIL_USER}>`,
          to: email,
          subject: 'Verify Your Email - SkillMatrix AI',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #2563eb;">Welcome to SkillMatrix AI, ${fullName}!</h2>
              <p>Thank you for registering. Please verify your email address to continue:</p>
              <div style="text-align: center; margin: 20px 0;">
                <a href="${verificationLink}" 
                   style="background-color: #2563eb; color: white; padding: 10px 20px; 
                          text-decoration: none; border-radius: 5px; display: inline-block;">
                  Verify Email
                </a>
              </div>
              <p>After verification, your account will be reviewed by our admin team.</p>
              <p>You'll receive another email once your account is approved.</p>
              <p style="font-size: 12px; color: #6b7280;">
                If you didn't request this, please ignore this email.
              </p>
            </div>
          `
        });
        console.log(`Verification email sent to ${email}`);
      } catch (emailError) {
        console.error('Failed to send verification email:', emailError);
        // Don't fail the registration if email fails
      }

      // Send admin notification
      try {
        const adminEmail = process.env.ADMIN_EMAIL || 'skillmatrixai@gmail.com';
        const adminDashboardLink = `${process.env.FRONTEND_URL}/dashboard/admin`;

        await transporter.sendMail({
          from: `"SkillMatrix AI" <${process.env.EMAIL_USER}>`,
          to: adminEmail,
          subject: 'New User Registration Needs Approval',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #2563eb;">New User Registration</h2>
              <p>A new user has registered and needs approval:</p>
              <ul style="list-style: none; padding: 0;">
                <li><strong>Name:</strong> ${fullName}</li>
                <li><strong>Email:</strong> ${email}</li>
                <li><strong>Company:</strong> ${companyName}</li>
                <li><strong>Designation:</strong> ${designation}</li>
                <li><strong>Mobile:</strong> ${mobileNumber}</li>
              </ul>
              <div style="text-align: center; margin: 20px 0;">
                <a href="${adminDashboardLink}" 
                   style="background-color: #2563eb; color: white; padding: 10px 20px; 
                          text-decoration: none; border-radius: 5px; display: inline-block;">
                  View in Admin Dashboard
                </a>
              </div>
              <p>Please review and approve this user within 24 hours.</p>
            </div>
          `
        });
      } catch (adminEmailError) {
        console.error('Failed to send admin notification:', adminEmailError);
      }

      // Successful response
      return res.status(201).json({
        success: true,
        message: 'Registration successful! Please check your email to verify your account. You will be notified once admin approves your registration.'
      });

    } catch (error) {
      console.error('Registration error:', error);
      return res.status(500).json({
        success: false,
        message: 'An error occurred during registration. Please try again later.'
      });
    }
  }
);

// Password Reset Token Model (add near other schemas)
const PasswordResetTokenSchema = new mongoose.Schema({
  email: { type: String, required: true },
  token: { type: String, required: true, unique: true },
  expiresAt: { type: Date, default: () => new Date(Date.now() + 15 * 60 * 1000) } // 15 mins expiry
}, { timestamps: true });

PasswordResetTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // Auto-delete expired tokens
const PasswordResetToken = mongoose.model('PasswordResetToken', PasswordResetTokenSchema);

// Generate secure token (add to helper functions)
const generateResetToken = () => crypto.randomBytes(32).toString('hex');

// 1. Request Password Reset
app.post('/api/forgot-password',
  body('email').isEmail().normalizeEmail(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Invalid email' });
    }

    const { email } = req.body;

    try {
      const user = await User.findOne({ email });
      if (!user) {
        return res.status(404).json({ error: 'Email not found' });
      }

      // Delete any existing tokens
      await PasswordResetToken.deleteMany({ email });

      // Generate and save new token
      const token = generateResetToken();
      await PasswordResetToken.create({ email, token });

      // Send email
      const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${token}&email=${encodeURIComponent(email)}`;

      await transporter.sendMail({
        from: `"ATS Support" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: 'Password Reset Request',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #2563eb;">Password Reset</h2>
            <p>You requested a password reset. Click below to proceed:</p>
            <a href="${resetLink}" 
               style="background-color: #2563eb; color: white; padding: 10px 20px; 
                      text-decoration: none; border-radius: 5px; display: inline-block;">
              Reset Password
            </a>
            <p style="color: #6b7280; font-size: 12px; margin-top: 20px;">
              This link expires in 15 minutes. If you didn't request this, please ignore this email.
            </p>
          </div>
        `
      });

      res.json({ success: true });
    } catch (error) {
      console.error('Password reset error:', error);
      res.status(500).json({ error: 'Failed to process request' });
    }
  }
);

// 2. Verify Token & Reset Password
app.post('/api/reset-password',
  [
    body('token').notEmpty(),
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 6 }),
    body('confirmPassword').custom((value, { req }) => value === req.body.password)
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { token, email, password } = req.body;

    try {
      // Verify token
      const resetToken = await PasswordResetToken.findOne({ token, email });
      if (!resetToken || resetToken.expiresAt < new Date()) {
        return res.status(400).json({ error: 'Invalid or expired token' });
      }

      // Update password
      const hashedPassword = await bcrypt.hash(password, 10);
      await User.updateOne({ email }, { password: hashedPassword });

      // Cleanup
      await PasswordResetToken.deleteOne({ _id: resetToken._id });

      res.json({ success: true });
    } catch (error) {
      console.error('Password reset error:', error);
      res.status(500).json({ error: 'Failed to reset password' });
    }
  }
);

// Updated Verify Email Endpoint
app.get('/verify-email', async (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res.status(400).render('verifyError', {
      errorMessage: 'Verification token is missing.'
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    const user = await User.findOneAndUpdate(
      { email: decoded.email },
      { isEmailVerified: true },
      { new: true }
    );

    if (!user) {
      return res.status(400).render('verifyError', {
        errorMessage: 'Invalid token or user not found.'
      });
    }

    return res.render('verifySuccess');

  } catch (error) {
    console.error('Email verification error:', error);

    let msg = 'Email verification failed.';
    if (error.name === 'TokenExpiredError') {
      msg = 'Verification link has expired. Please request a new one.';
    } else if (error.name === 'JsonWebTokenError') {
      msg = 'Invalid verification token.';
    }

    return res.status(400).render('verifyError', { errorMessage: msg });
  }
});

// Admin dashboard (protected route)
app.get('/admin', authenticateJWT, isAdmin, async (req, res) => {
  try {
    const users = await User.find({}).select('-password');
    res.status(200).json({ users });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error.' });
  }
});
app.put('/admin/update-subscription/:userId', authenticateJWT, isAdmin, async (req, res) => {
  try {
    const { plan, months } = req.body;
    const userId = req.params.userId;
    const now = new Date();

    const updateData = {
      subscription: {
        plan,
        startedAt: now,
        isActive: true
      },
      usage: { jdUploads: 0, resumeUploads: 0, assessments: 0 } // Reset usage
    };

    switch (plan) {
      case 'trial':
        updateData.subscription.expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        updateData.subscription.limits = {
          jdUploads: 1,
          resumeUploads: 5,
          assessments: 1
        };
        break;

      case 'free':
        updateData.subscription.expiresAt = null; // Never expires
        updateData.subscription.limits = {
          jdUploads: 10,
          resumeUploads: 50,
          assessments: 5
        };
        break;

      case 'paid':
        if (!months) return res.status(400).json({ error: 'Months required' });
        updateData.subscription.expiresAt = new Date(now.getTime() + months * 30 * 24 * 60 * 60 * 1000);
        updateData.subscription.$unset = { limits: "" }; // No limits for paid
        break;
    }

    const user = await User.findByIdAndUpdate(
      userId,
      {
        ...updateData,
        $unset: {
          trialStart: "",
          trialEnd: "",
          isUnlimited: ""
        }
      },
      { new: true }
    );

    res.status(200).json({ success: true, user });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to update subscription',
      error: error.message
    });
  }
});
// Admin approve user endpoint
app.post('/admin/approve-user/:userId', authenticateJWT, isAdmin, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.userId,
      {
        isApproved: true,
        trialStart: new Date(),
        trialEnd: new Date(Date.now() + 24 * 60 * 60 * 1000) // 1-day trial
      },
      { new: true }
    );

    if (!user) return res.status(404).json({ message: 'User not found.' });

    // Send approval email to user
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: user.email,
      subject: 'Your Account Has Been Approved - SkillMatrix AI',
      html: `
        <p>Dear ${user.fullName},</p>
        <p>Your account has been approved by the admin team. You can now login and start using SkillMatrix AI.</p>
        <p>You have a 1-day trial period. After that, please contact the admin to extend your access.</p>
        <a href="${process.env.FRONTEND_URL}/login">Login Now</a>
        <p>Thank you for choosing SkillMatrix AI!</p>
      `
    });

    res.status(200).json({
      message: 'User approved successfully.',
      user: {
        id: user._id,
        email: user.email,
        fullName: user.fullName
      }
    });
  } catch (error) {
    console.error('Approval error:', error);
    res.status(500).json({ message: 'Failed to approve user.' });
  }
});

// Get pending users for admin
app.get('/admin/pending-users', authenticateJWT, isAdmin, async (req, res) => {
  try {
    const users = await User.find({
      isEmailVerified: true,
      isApproved: false,
      isAdmin: false
    }).select('-password');

    res.status(200).json(users);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to fetch pending users.' });
  }
});

// Admin Dashboard Routes
app.get('/admin/dashboard', authenticateJWT, isAdmin, async (req, res) => {
  try {
    const users = await User.find({}).select('-password');
    const pendingUsers = await User.find({
      isEmailVerified: true,
      isApproved: false,
      isAdmin: false
    }).select('-password');

    const stats = {
      totalUsers: users.length,
      pendingApproval: pendingUsers.length,
      activeUsers: users.filter(u => u.isApproved).length,
      adminUsers: users.filter(u => u.isAdmin).length
    };

    res.status(200).json({
      success: true,
      users,
      pendingUsers,
      stats
    });
  } catch (error) {
    console.error('Admin dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to load admin dashboard data'
    });
  }
});

// Get user by ID
app.get('/admin/users/:id', authenticateJWT, isAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    res.status(200).json({
      success: true,
      user
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user'
    });
  }
});

// Update user details
app.put('/admin/update-user/:userId', authenticateJWT, isAdmin, async (req, res) => {
  const { userId } = req.params;
  const { fullName, email, mobileNumber, companyName, designation, trialEnd, isUnlimited } = req.body;

  try {
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found.' });

    if (fullName) user.fullName = fullName;
    if (email) user.email = email;
    if (mobileNumber) user.mobileNumber = mobileNumber;
    if (companyName) user.companyName = companyName;
    if (designation) user.designation = designation;
    if (trialEnd) user.trialEnd = trialEnd;
    if (isUnlimited !== undefined) user.isUnlimited = isUnlimited;

    await user.save();
    res.status(200).json({ message: 'User updated successfully.', user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error.' });
  }
});

// Delete user
app.delete('/admin/delete-user/:userId', authenticateJWT, isAdmin, async (req, res) => {
  const { userId } = req.params;

  try {
    const user = await User.findByIdAndDelete(userId);
    if (!user) return res.status(404).json({ message: 'User not found.' });

    res.status(200).json({ message: 'User deleted successfully.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error.' });
  }
});

// Extend trial period
app.put('/admin/extend-trial/:userId', authenticateJWT, isAdmin, async (req, res) => {
  const { userId } = req.params;
  const { days } = req.body;

  try {
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found.' });

    const newTrialEnd = new Date(user.trialEnd);
    newTrialEnd.setDate(newTrialEnd.getDate() + days); // Extend trial by 'days'
    user.trialEnd = newTrialEnd;

    await user.save();
    res.status(200).json({ message: 'Trial extended successfully.', user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error.' });
  }
});
// User profile (protected route)
app.get('/user', authenticateJWT, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    res.status(200).json({ user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error.' });
  }
});

// Register
app.post('/jobportal/register', async (req, res) => {
  const { name, email, password } = req.body;
  const blocked = ['gmail.com', 'yahoo.com', 'hotmail.com'];
  const domain = email.split('@')[1];
  if (blocked.includes(domain)) {
    return res.status(400).json({ message: 'Only company emails allowed.' });
  }
  const existing = await JobPoster.findOne({ email });
  if (existing) return res.status(400).json({ message: 'Email already registered.' });

  const hashedPassword = await bcrypt.hash(password, 10);
  const newUser = await JobPoster.create({ name, email, password: hashedPassword });

  const token = jwt.sign({ id: newUser._id }, JWT_SECRET, { expiresIn: '1h' });
  const verifyLink = `${process.env.BACKEND_URL}/jobportal/verify?token=${token}`;

  await transporter.sendMail({
    to: email,
    from: `"SkillMatrix Jobs" <${process.env.EMAIL_USER}>`,
    subject: 'Verify your email for Job Posting',
    html: `<p>Please verify your email: <a href="${verifyLink}">Verify Now</a></p>`
  });
  res.status(200).json({ message: 'Verification email sent.' });
});

// Verify
app.get('/jobportal/verify', async (req, res) => {
  try {
    const { token } = req.query;
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await JobPoster.findById(decoded.id);
    if (!user) return res.render('verifyError', { errorMessage: 'Invalid user.' });
    user.isVerified = true;
    await user.save();
    res.render('verifySuccess');
  } catch (e) {
    res.render('verifyError', { errorMessage: 'Invalid or expired token.' });
  }
});

// Login
app.post('/jobportal/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await JobPoster.findOne({ email });
  if (!user) return res.status(400).json({ message: 'Invalid credentials.' });
  if (!user.isVerified) return res.status(400).json({ message: 'Please verify your email.' });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(400).json({ message: 'Invalid credentials.' });
  const token = jwt.sign({ _id: user._id, email: user.email }, JWT_SECRET);

  res.cookie('jobToken', token, {
    httpOnly: true,
    sameSite: 'Strict',
    secure: process.env.NODE_ENV === 'production'
  });
  res.status(200).json({ message: 'Login successful' });
});
// Get job by publicId
app.get('/public/job/:publicId', async (req, res) => {
  try {
    const job = await JobPost.findOne({ publicId: req.params.publicId })
      .populate('postedBy', 'name email');

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json(job);
  } catch (error) {
    console.error('Error fetching public job:', error);
    res.status(500).json({ error: 'Failed to fetch job details' });
  }
});
// ✅ Job Posting Route
app.post('/jobportal/post', authenticateJobPoster, upload.single('jobDescription'), async (req, res) => {
  try {
    console.log('Received data:', req.body); // Add this for debugging
    const {
      title,
      companyName, // NEW FIELD
      location,
      experience,
      jobType,
      department,
      skillsRequired,
      salaryRange,
      descriptionText
    } = req.body;

    let s3Key = '';
    const file = req.file;

    if (file) {
      const safeTitle = title.replace(/\s+/g, '_');
      const fileName = `JD_${safeTitle}_${Date.now()}_${uuidv4()}${path.extname(file.originalname)}`;
      const folderPrefix = process.env.MINIO_JD_FOLDER || 'jobposting-jd-files';
      const key = `${folderPrefix}/${fileName}`;
      const result = await uploadToS3(file.buffer, key, file.mimetype);
      s3Key = result?.Key || key;
    }

    const job = new JobPost({
      title,
      companyName, // NEW FIELD
      location,
      experience,
      jobType,
      department,
      skillsRequired: skillsRequired?.split(',').map(skill => skill.trim()) || [],
      salaryRange,
      descriptionText,
      jobDescriptionFile: s3Key,
      postedBy: req.user._id
    });

    await job.save();
    return res.status(201).json({ message: 'Job posted successfully!', jobId: job._id });
  } catch (err) {
    console.error('Error in Job Posting:', err);
    return res.status(500).json({ message: 'Failed to post job' });
  }
});

// ✅ View JD File via Signed URL
// Updated view-jd endpoint to handle resume downloads

app.get('/jobportal/myjobs', authenticateJobPoster, async (req, res) => {
  try {
    const jobs = await JobPost.find({ postedBy: req.user._id }).sort({ createdAt: -1 });
    res.status(200).json({ jobs });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch jobs' });
  }
});

// ✅ NEW ENDPOINT: JobPoster Profile Fetch
app.get('/jobportal/profile', authenticateJobPoster, async (req, res) => {
  try {
    const jobPoster = await JobPoster.findById(req.user._id).select('-password');
    if (!jobPoster) return res.status(404).json({ message: 'Job poster not found' });
    res.status(200).json({ user: jobPoster });
  } catch (err) {
    console.error('Error fetching job poster profile:', err);
    res.status(500).json({ message: 'Failed to fetch profile' });
  }
});

// Generate public URL (add after job posting)
app.post('/jobportal/generate-public-url/:jobId', authenticateJobPoster, async (req, res) => {
  try {
    const job = await JobPost.findById(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    job.publicId = `job-${uuidv4().split('-')[0]}`;
    await job.save();

    res.json({
      publicUrl: `${process.env.FRONTEND_URL}/jobs/${job.publicId}`
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate URL' });
  }
});
// Public JD View Endpoint
// Public JD View Endpoint
app.get('/public/view-jd/:jobId', async (req, res) => {
  try {
    const job = await JobPost.findById(req.params.jobId);
    if (!job || !job.jobDescriptionFile) {
      return res.status(404).json({ error: 'Job description file not found' });
    }

    const filename = `JobDescription_${job.title.replace(/\s+/g, '_')}${path.extname(job.jobDescriptionFile)}`;
    const signedUrl = await getSignedUrlForS3(job.jobDescriptionFile);

    res.status(200).json({
      success: true,
      url: signedUrl,
      filename
    });
  } catch (error) {
    console.error('Error viewing JD file:', error);
    res.status(500).json({ error: 'Failed to generate file URL' });
  }
});

// HR JD View Endpoint (authenticated)
app.get('/jobportal/view-jd/:jobId', authenticateJobPoster, async (req, res) => {
  try {
    const job = await JobPost.findById(req.params.jobId);
    if (!job || !job.jobDescriptionFile) {
      return res.status(404).json({ error: 'Job description file not found' });
    }

    const filename = `JobDescription_${job.title.replace(/\s+/g, '_')}${path.extname(job.jobDescriptionFile)}`;
    const signedUrl = await getSignedUrlForS3(job.jobDescriptionFile);

    res.status(200).json({
      success: true,
      url: signedUrl,
      filename
    });
  } catch (error) {
    console.error('Error viewing JD file:', error);
    res.status(500).json({ error: 'Failed to generate file URL' });
  }
});

// Resume View Endpoint
app.get('/jobportal/view-resume/:applicationId', authenticateJobPoster, async (req, res) => {
  try {
    const application = await Application.findById(req.params.applicationId);
    if (!application || !application.resumeFile) {
      return res.status(404).json({ error: 'Resume not found' });
    }

    const filename = `Resume_${application.candidateName.replace(/\s+/g, '_')}${path.extname(application.resumeFile)}`;
    const signedUrl = await getSignedUrlForS3(application.resumeFile);

    res.status(200).json({
      success: true,
      url: signedUrl,
      filename
    });
  } catch (error) {
    console.error('Error viewing resume:', error);
    res.status(500).json({ error: 'Failed to generate resume URL' });
  }
});
const downloadResume = async (applicationId, candidateName) => {
  try {
    const res = await axiosInstance.get(`/jobportal/view-resume/${applicationId}`, {
      headers: { Authorization: `Bearer ${sessionStorage.getItem('jobToken')}` }
    });

    if (res.data?.url) {
      const link = document.createElement('a');
      link.href = res.data.url;
      link.download = `${candidateName.replace(/\s+/g, '_')}_Resume${path.extname(res.data.filename)}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  } catch (err) {
    toast.error('Failed to download resume');
    console.error(err);
  }
};



// Candidate application
app.post('/public/apply/:jobId', upload.single('resume'), async (req, res) => {
  try {
    const job = await JobPost.findById(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    let resumeKey = '';
    if (req.file) {
      const fileName = `resume_${Date.now()}_${req.file.originalname}`;
      resumeKey = `applications/${fileName}`;
      await uploadToS3(req.file.buffer, resumeKey, req.file.mimetype);
    }

    const application = await Application.create({
      jobId: job._id,
      candidateName: req.body.name,
      candidateEmail: req.body.email,
      candidatePhone: req.body.phone,
      resumeFile: resumeKey
    });

    job.applications.push(application._id);
    await job.save();

    // TODO: Send email notification to HR
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Application failed' });
  }
});

// Get applications for HR
app.get('/jobportal/applications/:jobId', authenticateJobPoster, async (req, res) => {
  try {
    const applications = await Application.find({ jobId: req.params.jobId });
    res.json(applications);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch applications' });
  }
});


// Admin related JobPost detail access 
// Get all job posters (HR users)
app.get('/admin/jobposters', authenticateJWT, isAdmin, async (req, res) => {
  try {
    const posters = await JobPoster.find({});
    const postersWithCount = await Promise.all(posters.map(async poster => {
      const count = await JobPost.countDocuments({ postedBy: poster._id });
      return { ...poster.toObject(), jobCount: count };
    }));
    res.json(postersWithCount);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch job posters' });
  }
});

// Get jobs by HR user (admin version)
app.get('/jobportal/admin/jobs/:hrId', authenticateJWT, isAdmin, async (req, res) => {
  try {
    const jobs = await JobPost.find({ postedBy: req.params.hrId });
    res.json(jobs);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch jobs' });
  }
});

// Get applications for job (admin version)
app.get('/jobportal/admin/applications/:jobId', authenticateJWT, isAdmin, async (req, res) => {
  try {
    const applications = await Application.find({ jobId: req.params.jobId });
    res.json(applications);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch applications' });
  }
});

// ==============================
// ✅ JOB POST SUBMISSION
// ==============================



// ==========================
// Save admin details on startup

// Save admin details on startup with enhanced error handling
// Updated saveAdmin function
const saveAdmin = async () => {
  try {
    const adminEmail = process.env.ADMIN_EMAIL || 'skillmatrixai@gmail.com';
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin@123';

    const adminData = {
      fullName: process.env.ADMIN_FULLNAME || 'Admin User',
      email: adminEmail,
      password: await bcrypt.hash(adminPassword, 10),
      mobileNumber: process.env.ADMIN_MOBILE || '0000000000',
      companyName: process.env.ADMIN_COMPANY || 'SkillMatrix AI',
      designation: process.env.ADMIN_DESIGNATION || 'Admin',
      isEmailVerified: true,
      isAdmin: true,
      isApproved: true,
      // Admin has no subscription limits at all
      subscription: {
        plan: 'admin',
        isActive: true,
        // No limits object for admin
        startedAt: new Date()
      },
      // Clear all trial fields for admin
      $unset: {
        trialStart: "",
        trialEnd: "",
        isUnlimited: ""
      }
    };

    const existingAdmin = await User.findOne({ email: adminEmail });
    if (existingAdmin) {
      await User.findOneAndUpdate(
        { email: adminEmail },
        adminData,
        { new: true }
      );
      console.log('Admin user updated');
    } else {
      await User.create(adminData);
      console.log('Admin user created');
    }
  } catch (error) {
    console.error('Failed to setup admin user:', error);
  }
};

app.post('/logout', (req, res) => {
  res.clearCookie('token', { path: '/' });
  res.clearCookie('refreshToken', { path: '/' });
  res.status(200).json({ message: 'Logged out successfully' });
});

// ==============================
// 🔧 DEBUG ENDPOINTS FOR SCHEDULED TESTS
// ==============================

// Manual trigger for scheduled test processing
app.post('/api/debug/trigger-scheduled-processing', async (req, res) => {
  try {
    console.log('🔧 Manual trigger: Processing scheduled tests...');

    // Run the processing function manually
    await processScheduledTests();

    res.json({ success: true, message: 'Scheduled test processing triggered' });
  } catch (error) {
    console.error('Manual processing error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get scheduled test details with recordings and voice answers
app.get('/api/scheduled-tests/:id/details', authenticateJWT, async (req, res) => {
  try {
    const test = await ScheduledTest.findById(req.params.id)
      .populate('resumeId')
      .populate('jobDescriptionId');

    if (!test) {
      return res.status(404).json({ error: 'Test not found' });
    }

    // Security check - ensure the test belongs to the authenticated user
    if (test.user.toString() !== req.user.id && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Populate assessment session with recording and voice answers
    let session = null;
    if (test.assessmentSession) {
      session = await AssessmentSession.findById(test.assessmentSession)
        .populate({
          path: 'recording',
          select: 'videoPath screenPath videoAnalysis'
        })
        .populate('voiceAnswers'); // Populate voice answers

      // Debug logging
      console.log('Assessment Session Details:', {
        id: session._id,
        voiceAnswersCount: session.voiceAnswers ? session.voiceAnswers.length : 0,
        voiceAnswers: session.voiceAnswers
      });
    }

    // Get test results
    const testResult = session ? await TestResult.findOne({
      assessmentSession: session._id
    }) : null;

    // Prepare response data
    const responseData = {
      success: true,
      data: {
        _id: test._id,
        candidateName: test.candidateName,
        candidateEmail: test.candidateEmail,
        scheduledDateTime: test.scheduledDateTime,
        activatedAt: test.activatedAt,
        completedAt: test.completedAt,
        expiresAt: test.expiresAt,
        testStatus: test.status,
        questionsGenerated: test.questionsGenerated,
        assessmentSessionId: test.assessmentSession,
        resume: test.resumeId ? {
          id: test.resumeId._id,
          title: test.resumeId.title,
          filename: test.resumeId.filename
        } : null,
        jobDescription: test.jobDescriptionId ? {
          id: test.jobDescriptionId._id,
          title: test.jobDescriptionId.title,
          filename: test.jobDescriptionId.filename
        } : null,
        recordings: session && session.recording ? {
          videoPath: session.recording.videoPath,
          screenPath: session.recording.screenPath,
          videoAnalysis: session.recording.videoAnalysis
        } : null,
        voiceAnswers: session ? session.voiceAnswers : [],
        testResults: testResult ? {
          mcqScore: testResult.score,
          audioScore: testResult.audioScore,
          textScore: testResult.textScore,
          videoScore: testResult.videoScore,
          combinedScore: testResult.combinedScore,
          status: testResult.status,
          submittedAt: testResult.submittedAt
        } : null
      }
    };

    // Debug logging
    console.log('Scheduled Test Details Response:', {
      id: test._id,
      status: test.status,
      hasAssessmentSession: !!test.assessmentSession,
      voiceAnswersCount: responseData.data.voiceAnswers.length,
      hasVoiceAnswers: responseData.data.voiceAnswers.length > 0
    });

    res.json(responseData);
  } catch (error) {
    console.error('Error fetching scheduled test details:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch test details',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Check specific test status
app.get('/api/debug/scheduled-test/:id', async (req, res) => {
  try {
    const test = await ScheduledTest.findById(req.params.id)
      .populate('resumeId')
      .populate('jobDescriptionId');

    if (!test) {
      return res.status(404).json({ error: 'Test not found' });
    }

    const now = new Date();
    const shouldBeActive = now >= test.scheduledDateTime && now <= test.expiresAt;

    res.json({
      test: test,
      currentTime: now.toISOString(),
      shouldBeActive: shouldBeActive,
      timeDiff: now - test.scheduledDateTime,
      scheduledTime: test.scheduledDateTime.toISOString(),
      expiresTime: test.expiresAt.toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update interview status (for external scheduling workflow)
app.put('/api/interviews/update-status', authenticateJWT, async (req, res) => {
  try {
    const { assessmentSessionId, candidateId, status, platform } = req.body;

    console.log('🔄 Updating interview status:', {
      assessmentSessionId,
      candidateId,
      status,
      platform,
      timestamp: new Date().toISOString()
    });

    // 🔥 FIX: Find interview by ScheduledTest reference since Interview schema doesn't have assessmentSessionId
    const sessionId = assessmentSessionId || candidateId;

    // First find the ScheduledTest for this session
    const scheduledTest = await ScheduledTest.findOne({ assessmentSession: sessionId });
    if (!scheduledTest) {
      console.log('❌ ScheduledTest not found for session:', sessionId);
      return res.status(404).json({
        success: false,
        error: 'No scheduled test found for this assessment session'
      });
    }

    // Find interview by ScheduledTest reference
    const interview = await Interview.findOne({ scheduledTest: scheduledTest._id });

    if (!interview) {
      console.log('❌ Interview not found for ScheduledTest:', scheduledTest._id);
      return res.status(404).json({
        success: false,
        error: 'Interview not found for this assessment session'
      });
    }

    // Update interview status and platform
    interview.status = status;
    if (platform) {
      interview.interviewPlatform = platform;
    }
    interview.updatedAt = new Date();

    await interview.save();

    console.log('✅ Interview status updated successfully:', {
      interviewId: interview._id,
      newStatus: status,
      platform: interview.interviewPlatform
    });

    res.status(200).json({
      success: true,
      message: 'Interview status updated successfully',
      data: interview
    });

  } catch (error) {
    console.error('❌ Error updating interview status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update interview status'
    });
  }
});

// Ensure an interview exists for a given assessment session (auto-create minimal records)
app.post('/api/interviews/ensure-by-session', authenticateJWT, async (req, res) => {
  try {
    const { assessmentSessionId, candidateId } = req.body;
    if (!assessmentSessionId && !candidateId) {
      return res.status(400).json({ success: false, error: 'assessmentSessionId or candidateId is required' });
    }

    const sessionId = assessmentSessionId || candidateId;
    console.log('🔍 Ensuring interview for session:', sessionId);

    const session = await AssessmentSession.findById(sessionId).populate('resumeId');
    if (!session) {
      return res.status(404).json({ success: false, error: 'Assessment session not found' });
    }

    // 🔥 ENHANCED FIX: First check for existing interview by ScheduledTest reference
    // Since Interview schema doesn't have candidateId/assessmentSessionId, we need to find via ScheduledTest
    let scheduledTest = await ScheduledTest.findOne({ assessmentSession: sessionId });

    if (scheduledTest) {
      // Check if interview already exists for this scheduled test
      const existingInterview = await Interview.findOne({ scheduledTest: scheduledTest._id });
      if (existingInterview) {
        console.log('✅ Found existing interview via ScheduledTest:', existingInterview._id, 'Status:', existingInterview.status);
        return res.json({ success: true, data: existingInterview, existed: true });
      }
    }

    console.log('🔄 No existing interview found, creating new one with schema-compliant approach...');

    const candidateName = session.resumeId?.name || session.candidateEmail || 'Candidate';
    const candidateEmail = session.candidateEmail;
    const jobTitle = session.jobTitle || 'Position';
    const interviewDateTime = new Date();
    const interviewPlatform = 'Google Calendar';
    const meetingLink = `https://calendar.google.com/calendar/render?action=TEMPLATE&add=${encodeURIComponent(candidateEmail)}&text=${encodeURIComponent(`Interview - ${jobTitle}`)}`;

    // Create or find ScheduledTest first (required by Interview schema)
    if (!scheduledTest) {
      // Use atomic operation to prevent duplicate scheduled tests
      try {
        scheduledTest = await ScheduledTest.findOneAndUpdate(
          { assessmentSession: sessionId }, // Find criteria
          {
            candidateName,
            candidateEmail,
            jobTitle,
            status: 'completed',
            assessmentSession: sessionId,
            scheduledDateTime: new Date(),
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            user: req.user.id,
            token: `auto-${sessionId}-${Date.now()}`,
            testLink: `auto-generated-${sessionId}`,
            resumeId: session.resumeId?._id,
            jobDescriptionId: session.jobDescriptionId
          },
          {
            upsert: true, // Create if doesn't exist
            new: true,    // Return the new document
            setDefaultsOnInsert: true // Apply defaults on insert
          }
        );
        console.log('📅 Created/found scheduled test with atomic operation:', scheduledTest._id);
      } catch (scheduledTestError) {
        console.error('❌ Error creating scheduled test:', scheduledTestError);
        // If scheduled test creation fails, try to find existing one
        scheduledTest = await ScheduledTest.findOne({ assessmentSession: sessionId });
        if (!scheduledTest) {
          return res.status(500).json({ success: false, error: 'Failed to create required scheduled test' });
        }
      }
    }

    // 🔥 ENHANCED FIX: Use atomic findOneAndUpdate with proper schema fields only
    try {
      // Double-check for existing interview after ScheduledTest creation
      let interview = await Interview.findOne({ scheduledTest: scheduledTest._id });
      if (interview) {
        console.log('✅ Found existing interview after ScheduledTest creation:', interview._id);
        return res.json({ success: true, data: interview, existed: true });
      }

      // Create interview with schema-compliant fields only
      interview = await Interview.findOneAndUpdate(
        {
          scheduledTest: scheduledTest._id // Use only schema-compliant query
        },
        {
          // Only use fields that exist in InterviewSchema
          scheduledTest: scheduledTest._id,
          candidateName,
          candidateEmail,
          jobTitle,
          interviewDateTime,
          interviewPlatform,
          meetingLink,
          scheduledBy: req.user.id,
          status: 'not-scheduled', // 🔥 FIX: Start with 'not-scheduled' status
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          upsert: true, // Create if doesn't exist
          new: true,    // Return the new document
          setDefaultsOnInsert: true // Apply defaults on insert
        }
      );

      const isNewInterview = !interview.createdAt || (new Date() - interview.createdAt) < 1000;
      console.log(isNewInterview ? '✅ Created new interview with atomic operation:' : '✅ Found existing interview during atomic operation:', interview._id, 'Status:', interview.status);

      return res.status(isNewInterview ? 201 : 200).json({
        success: true,
        data: interview,
        created: isNewInterview,
        existed: !isNewInterview
      });

    } catch (interviewError) {
      console.error('❌ Error in atomic interview creation:', interviewError);

      // Final fallback: try to find any existing interview by ScheduledTest
      const existingInterview = await Interview.findOne({ scheduledTest: scheduledTest._id });

      if (existingInterview) {
        console.log('🔄 Fallback: Found existing interview after error:', existingInterview._id);
        return res.json({ success: true, data: existingInterview, existed: true });
      }

      throw interviewError; // Re-throw if no existing interview found
    }

  } catch (error) {
    console.error('❌ Error ensuring interview:', error);
    return res.status(500).json({ success: false, error: 'Failed to ensure interview' });
  }
});

// Force activation of a specific test
app.post('/api/debug/activate-test/:id', async (req, res) => {
  try {
    const testId = req.params.id;
    console.log(`🔧 Manual activation for test: ${testId}`);

    const test = await ScheduledTest.findById(testId)
      .populate('resumeId')
      .populate('jobDescriptionId')
      .populate('user')
      .populate('assessmentSession');

    if (!test) {
      return res.status(404).json({ error: 'Test not found' });
    }

    console.log('📊 Test Status:', {
      status: test.status,
      questionsGenerated: test.questionsGenerated,
      hasAssessmentSession: !!test.assessmentSession,
      candidateName: test.candidateName,
      assessmentSessionId: test.assessmentSession?._id
    });

    // 🔥 ENHANCED FIX: Always force question generation if no assessment session exists
    if (!test.assessmentSession) {
      console.log('⚠️ No AssessmentSession found - forcing creation...');

      try {
        console.log('🔄 Forcing question generation and session creation...');
        const result = await generateQuestionsForScheduledTest(testId);
        console.log('✅ Question generation result:', result);

        // Reload test to get updated data
        const updatedTest = await ScheduledTest.findById(testId)
          .populate('assessmentSession');

        // Ensure test is marked as active
        if (updatedTest.status !== 'active') {
          updatedTest.status = 'active';
          updatedTest.activatedAt = new Date();
          await updatedTest.save();
          console.log('✅ Test status updated to active');
        }

        res.json({
          success: true,
          message: 'Test manually fixed - AssessmentSession created with questions',
          test: updatedTest,
          questionGeneration: result,
          fixed: 'AssessmentSession was missing and has been created'
        });

      } catch (genError) {
        console.error('❌ Question generation failed:', genError);
        res.status(500).json({
          error: 'Failed to generate questions',
          details: genError.message
        });
      }
    } else {
      // Assessment session exists, just return current state
      console.log('✅ AssessmentSession already exists');
      res.json({
        success: true,
        message: 'Test is already properly configured',
        test: test,
        status: 'already_fixed'
      });
    }

  } catch (error) {
    console.error('Manual activation error:', error);
    res.status(500).json({ error: error.message });
  }
});



// Schedule Interview for a candidate
app.post('/api/interviews/schedule', authenticateJWT, async (req, res) => {
  try {
    const { scheduledTestId, candidateName, candidateEmail, jobTitle, interviewDateTime, interviewPlatform } = req.body;

    // Validate required fields
    if (!scheduledTestId || !candidateName || !candidateEmail || !jobTitle || !interviewDateTime || !interviewPlatform) {
      return res.status(400).json({
        success: false,
        error: 'All fields are required'
      });
    }

    // Validate interview platform
    const validPlatforms = ['Google Meet', 'Microsoft Teams', 'Zoom', 'Google Calendar'];
    if (!validPlatforms.includes(interviewPlatform)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid interview platform'
      });
    }

    // Check if scheduled test exists
    const scheduledTest = await ScheduledTest.findById(scheduledTestId);
    if (!scheduledTest) {
      return res.status(404).json({
        success: false,
        error: 'Scheduled test not found'
      });
    }

    // Check if interview already exists for this scheduled test
    const existingInterview = await Interview.findOne({ scheduledTest: scheduledTestId });
    if (existingInterview) {
      return res.status(400).json({
        success: false,
        error: 'Interview already scheduled for this candidate'
      });
    }

    // Create meeting link based on platform
    let meetingLink = '';
    switch (interviewPlatform) {
      case 'Google Meet':
        meetingLink = `https://meet.google.com/new?add=${encodeURIComponent(candidateEmail)}&text=${encodeURIComponent(`Interview - ${jobTitle}`)}`;
        break;
      case 'Microsoft Teams':
        meetingLink = `https://outlook.office.com/calendar/0/deeplink/compose?to=${encodeURIComponent(candidateEmail)}&subject=${encodeURIComponent(`Interview - ${jobTitle}`)}`;
        break;
      case 'Zoom':
        meetingLink = `https://zoom.us/schedule?email=${encodeURIComponent(candidateEmail)}&topic=${encodeURIComponent(`Interview - ${jobTitle}`)}`;
        break;
      case 'Google Calendar':
        meetingLink = `https://calendar.google.com/calendar/render?action=TEMPLATE&add=${encodeURIComponent(candidateEmail)}&text=${encodeURIComponent(`Interview - ${jobTitle}`)}`;
        break;
    }

    // Create interview
    const interview = new Interview({
      scheduledTest: scheduledTestId,
      candidateName,
      candidateEmail,
      jobTitle,
      interviewDateTime: new Date(interviewDateTime),
      interviewPlatform,
      meetingLink,
      scheduledBy: req.user.id
    });

    await interview.save();

    res.status(201).json({
      success: true,
      message: 'Interview scheduled successfully',
      data: interview
    });

  } catch (error) {
    console.error('Error scheduling interview:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to schedule interview'
    });
  }
});

// Get interview details for a scheduled test
app.get('/api/interviews/scheduled-test/:scheduledTestId', authenticateJWT, async (req, res) => {
  try {
    const { scheduledTestId } = req.params;

    // Check if scheduled test exists
    const scheduledTest = await ScheduledTest.findById(scheduledTestId);
    if (!scheduledTest) {
      return res.status(404).json({
        success: false,
        error: 'Scheduled test not found'
      });
    }

    // Get interview for this scheduled test
    const interview = await Interview.findOne({ scheduledTest: scheduledTestId })
      .populate('scheduledBy', 'fullName email');

    res.status(200).json({
      success: true,
      data: interview
    });

  } catch (error) {
    console.error('Error fetching interview:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch interview'
    });
  }
});

// Submit interview feedback
app.post('/api/interviews/feedback', authenticateJWT, async (req, res) => {
  try {
    const { candidateId, assessmentSessionId, rating, feedback, strengths, areasForImprovement, recommendation } = req.body;

    // Validate required fields
    if (!candidateId || !assessmentSessionId || !rating || !feedback) {
      return res.status(400).json({
        success: false,
        error: 'Candidate ID, assessment session ID, rating, and feedback are required'
      });
    }

    // 🔥 FIX: Find interview by ScheduledTest reference since Interview schema doesn't have assessmentSessionId
    const sessionId = assessmentSessionId || candidateId;

    // First find the ScheduledTest for this session
    const scheduledTest = await ScheduledTest.findOne({ assessmentSession: sessionId });
    if (!scheduledTest) {
      return res.status(400).json({
        success: false,
        error: 'No scheduled test found for this assessment session. Please schedule an interview before submitting feedback.'
      });
    }

    // Find interview by ScheduledTest reference
    let interview = await Interview.findOne({ scheduledTest: scheduledTest._id });
    if (!interview) {
      return res.status(400).json({
        success: false,
        error: 'No interview found for this assessment session. Please schedule an interview before submitting feedback.'
      });
    }

    // Update interview with feedback
    interview.feedback = feedback;
    interview.rating = rating;
    interview.status = 'completed';
    interview.feedbackSubmittedAt = new Date();
    interview.updatedAt = new Date();

    // Add additional feedback fields
    interview.feedbackDetails = {
      strengths,
      areasForImprovement,
      recommendation
    };

    await interview.save();

    res.status(200).json({
      success: true,
      message: 'Interview feedback submitted successfully',
      data: interview
    });

  } catch (error) {
    console.error('Error submitting interview feedback:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to submit interview feedback'
    });
  }
});

// ==============================
// ✅ OFFER LETTER FUNCTIONALITY
// ==============================

const { sendSelectionEmail, generateOfferLetter, sendOfferLetter, getRequiredDocuments } = require('./services/offerLetterService');

// Update interview feedback and status
app.put('/api/interviews/:id', authenticateJWT, async (req, res) => {
  try {
    const { id } = req.params;
    const { feedback, feedbackSummary, rating, status } = req.body;

    // Find interview
    const interview = await Interview.findById(id);
    if (!interview) {
      return res.status(404).json({
        success: false,
        error: 'Interview not found'
      });
    }

    // Update interview
    if (feedback !== undefined) interview.feedback = feedback;
    if (feedbackSummary !== undefined) interview.feedbackSummary = feedbackSummary;
    if (rating !== undefined) interview.rating = rating;
    if (status !== undefined) interview.status = status;

    interview.updatedAt = new Date();

    await interview.save();

    res.status(200).json({
      success: true,
      message: 'Interview updated successfully',
      data: interview
    });

  } catch (error) {
    console.error('Error updating interview:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update interview'
    });
  }
});

// Make candidate decision (select/reject)
app.post('/api/candidate-decisions', authenticateJWT, async (req, res) => {
  try {
    const { scheduledTestId, interviewId, decision, rejectionReason, customRejectionReason } = req.body;

    // Validate required fields
    if (!scheduledTestId || !decision) {
      return res.status(400).json({
        success: false,
        error: 'Scheduled test ID and decision are required'
      });
    }

    // Validate decision
    const validDecisions = ['selected', 'rejected'];
    if (!validDecisions.includes(decision)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid decision'
      });
    }

    // Validate rejection reason if decision is rejected
    if (decision === 'rejected') {
      const validRejectionReasons = ['Requirements not matching', 'Location requirement not matching', 'Resume referred for other roles', 'Other'];
      if (rejectionReason && !validRejectionReasons.includes(rejectionReason)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid rejection reason'
        });
      }
    }

    // Check if scheduled test exists
    const scheduledTest = await ScheduledTest.findById(scheduledTestId);
    if (!scheduledTest) {
      return res.status(404).json({
        success: false,
        error: 'Scheduled test not found'
      });
    }

    // Check if interview exists (if provided)
    if (interviewId) {
      const interview = await Interview.findById(interviewId);
      if (!interview) {
        return res.status(404).json({
          success: false,
          error: 'Interview not found'
        });
      }
    }

    // Check if decision already exists for this scheduled test
    const existingDecision = await CandidateDecision.findOne({ scheduledTest: scheduledTestId });
    if (existingDecision) {
      return res.status(400).json({
        success: false,
        error: 'Decision already made for this candidate'
      });
    }

    // Create candidate decision
    const candidateDecision = new CandidateDecision({
      scheduledTest: scheduledTestId,
      interview: interviewId || null,
      decision,
      rejectionReason: decision === 'rejected' ? rejectionReason : undefined,
      customRejectionReason: decision === 'rejected' ? customRejectionReason : undefined,
      decidedBy: req.user.id
    });

    await candidateDecision.save();

    // If candidate is selected, generate offer letter
    if (decision === 'selected') {
      // In a real implementation, you would generate the offer letter here
      // For now, we'll just set a flag
      candidateDecision.offerLetterGenerated = true;
      await candidateDecision.save();

      // Send notification email to candidate (implementation would go here)
    }

    // If candidate is rejected, generate rejection letter
    if (decision === 'rejected') {
      // In a real implementation, you would generate the rejection letter here
      // For now, we'll just set a flag
      candidateDecision.rejectionLetterGenerated = true;
      await candidateDecision.save();

      // Send notification email to candidate (implementation would go here)
    }

    res.status(201).json({
      success: true,
      message: `Candidate ${decision} successfully`,
      data: candidateDecision
    });

  } catch (error) {
    console.error('Error making candidate decision:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to make candidate decision'
    });
  }
});

// Get candidate decision for a scheduled test
app.get('/api/candidate-decisions/scheduled-test/:scheduledTestId', authenticateJWT, async (req, res) => {
  try {
    const { scheduledTestId } = req.params;

    // Check if scheduled test exists
    const scheduledTest = await ScheduledTest.findById(scheduledTestId);
    if (!scheduledTest) {
      return res.status(404).json({
        success: false,
        error: 'Scheduled test not found'
      });
    }

    // Get decision for this scheduled test
    const decision = await CandidateDecision.findOne({ scheduledTest: scheduledTestId })
      .populate('decidedBy', 'fullName email')
      .populate('interview');

    res.status(200).json({
      success: true,
      data: decision
    });

  } catch (error) {
    console.error('Error fetching candidate decision:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch candidate decision'
    });
  }
});

// Get candidate decision by ID
app.get('/api/candidate-decisions/:id', authenticateJWT, async (req, res) => {
  try {
    const { id } = req.params;

    // Get decision by ID
    const decision = await CandidateDecision.findById(id)
      .populate('scheduledTest')
      .populate('interview')
      .populate('decidedBy', 'fullName email');

    if (!decision) {
      return res.status(404).json({
        success: false,
        error: 'Candidate decision not found'
      });
    }

    res.status(200).json({
      success: true,
      data: decision
    });

  } catch (error) {
    console.error('Error fetching candidate decision:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch candidate decision'
    });
  }
});

// Generate offer letter
app.post('/api/offer-letter/generate', authenticateJWT, async (req, res) => {
  try {
    const { candidateDecisionId, offerDetails } = req.body;

    // Get candidate decision
    const candidateDecision = await CandidateDecision.findById(candidateDecisionId)
      .populate('scheduledTest')
      .populate('interview');

    if (!candidateDecision) {
      return res.status(404).json({
        success: false,
        error: 'Candidate decision not found'
      });
    }

    // Check if candidate was selected
    if (candidateDecision.decision !== 'selected') {
      return res.status(400).json({
        success: false,
        error: 'Offer letter can only be generated for selected candidates'
      });
    }

    // Create offer letter content
    const offerLetterContent = `
      <html>
        <head>
          <title>Job Offer Letter</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 40px; }
            .header { text-align: center; margin-bottom: 30px; }
            .content { line-height: 1.6; }
            .signature { margin-top: 50px; }
            .footer { margin-top: 30px; font-size: 12px; color: #666; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>Job Offer Letter</h1>
          </div>
          
          <div class="content">
            <p>Date: ${new Date().toLocaleDateString()}</p>
            
            <p>Dear ${candidateDecision.scheduledTest.candidateName},</p>
            
            <p>We are pleased to extend an offer for the position of <strong>${offerDetails.jobRole || candidateDecision.scheduledTest.jobTitle}</strong> at our organization.</p>
            
            <h2>Offer Details:</h2>
            <ul>
              <li><strong>Position:</strong> ${offerDetails.jobRole || candidateDecision.scheduledTest.jobTitle}</li>
              <li><strong>Start Date:</strong> ${offerDetails.startDate || 'To be determined'}</li>
              <li><strong>Salary:</strong> ${offerDetails.salary || 'As per company policy'}</li>
              <li><strong>Benefits:</strong> ${offerDetails.benefits || 'As per company policy'}</li>
            </ul>
            
            <p>This offer is based on your successful completion of our interview process and is contingent upon the successful completion of any remaining requirements.</p>
            
            <p>We believe your skills and experience will be a valuable addition to our team, and we look forward to working with you.</p>
            
            <p>Please confirm your acceptance of this offer by signing and returning this letter by ${offerDetails.responseDeadline || 'the date specified in our communication'}.</p>
            
            <div class="signature">
              <p>Sincerely,</p>
              <p>___________________________<br>
              ${req.user.fullName}<br>
              HR Department</p>
            </div>
          </div>
          
          <div class="footer">
            <p>This offer letter is confidential and intended solely for the recipient.</p>
          </div>
        </body>
      </html>
    `;

    // Convert HTML to PDF
    const pdfBuffer = await new Promise((resolve, reject) => {
      htmlToPdf.create(offerLetterContent, { format: 'Letter' }).toBuffer((err, buffer) => {
        if (err) reject(err);
        else resolve(buffer);
      });
    });

    // Upload to S3
    const filename = `offer_letter_${candidateDecisionId}_${Date.now()}.pdf`;
    const s3Key = `offer-letters/${filename}`;
    await uploadToS3(pdfBuffer, s3Key, 'application/pdf');

    // Generate signed URL
    const command = new GetObjectCommand({
      Bucket: process.env.MINIO_BUCKET_NAME,
      Key: s3Key
    });
    const offerLetterUrl = await getSignedUrl(s3, command, { expiresIn: 604800 }); // 7 days

    // Update candidate decision with offer letter details
    candidateDecision.offerLetterGenerated = true;
    candidateDecision.offerLetterUrl = s3Key;
    await candidateDecision.save();

    res.status(200).json({
      success: true,
      message: 'Offer letter generated successfully',
      data: {
        offerLetterUrl: s3Key,
        downloadUrl: offerLetterUrl,
        filename
      }
    });

  } catch (error) {
    console.error('Error generating offer letter:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate offer letter'
    });
  }
});

// Generate rejection report
app.post('/api/rejection-report/generate', authenticateJWT, async (req, res) => {
  try {
    const { candidateDecisionId } = req.body;

    // Get candidate decision
    const candidateDecision = await CandidateDecision.findById(candidateDecisionId)
      .populate('scheduledTest')
      .populate('interview');

    if (!candidateDecision) {
      return res.status(404).json({
        success: false,
        error: 'Candidate decision not found'
      });
    }

    // Check if candidate was rejected
    if (candidateDecision.decision !== 'rejected') {
      return res.status(400).json({
        success: false,
        error: 'Rejection report can only be generated for rejected candidates'
      });
    }

    // Create rejection report content
    const rejectionReason = candidateDecision.rejectionReason === 'Other'
      ? candidateDecision.customRejectionReason
      : candidateDecision.rejectionReason;

    const rejectionReportContent = `
      <html>
        <head>
          <title>Rejection Report</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 40px; }
            .header { text-align: center; margin-bottom: 30px; }
            .content { line-height: 1.6; }
            .footer { margin-top: 30px; font-size: 12px; color: #666; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>Rejection Report</h1>
          </div>
          
          <div class="content">
            <p>Date: ${new Date().toLocaleDateString()}</p>
            
            <p>Dear ${candidateDecision.scheduledTest.candidateName},</p>
            
            <p>Thank you for your interest in the position of <strong>${candidateDecision.scheduledTest.jobTitle}</strong> at our organization. We appreciate the time and effort you invested in our recruitment process.</p>
            
            <p>After careful consideration, we have decided not to proceed with your application at this time.</p>
            
            <h2>Feedback:</h2>
            <p>${rejectionReason || 'We appreciate your interest in our organization, but we have decided to move forward with other candidates whose qualifications more closely align with our current requirements.'}</p>
            
            <p>We encourage you to apply for future positions that may be a better match for your skills and experience.</p>
            
            <p>We wish you the best in your job search and future professional endeavors.</p>
            
            <div style="margin-top: 30px;">
              <p>Sincerely,</p>
              <p>${req.user.fullName}<br>
              HR Department</p>
            </div>
          </div>
          
          <div class="footer">
            <p>This rejection report is confidential and intended solely for the recipient.</p>
          </div>
        </body>
      </html>
    `;

    // Convert HTML to PDF
    const pdfBuffer = await new Promise((resolve, reject) => {
      htmlToPdf.create(rejectionReportContent, { format: 'Letter' }).toBuffer((err, buffer) => {
        if (err) reject(err);
        else resolve(buffer);
      });
    });

    // Upload to S3
    const filename = `rejection_report_${candidateDecisionId}_${Date.now()}.pdf`;
    const s3Key = `rejection-reports/${filename}`;
    await uploadToS3(pdfBuffer, s3Key, 'application/pdf');

    // Generate signed URL
    const command = new GetObjectCommand({
      Bucket: process.env.MINIO_BUCKET_NAME,
      Key: s3Key
    });
    const rejectionReportUrl = await getSignedUrl(s3, command, { expiresIn: 604800 }); // 7 days

    // Update candidate decision with rejection report details
    candidateDecision.rejectionLetterGenerated = true;
    candidateDecision.rejectionLetterUrl = s3Key;
    await candidateDecision.save();

    res.status(200).json({
      success: true,
      message: 'Rejection report generated successfully',
      data: {
        rejectionReportUrl: s3Key,
        downloadUrl: rejectionReportUrl,
        filename
      }
    });

  } catch (error) {
    console.error('Error generating rejection report:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate rejection report'
    });
  }
});

// Send offer letter
app.post('/api/offer-letter/send', authenticateJWT, async (req, res) => {
  try {
    const { candidateDecisionId, offerDetails } = req.body;

    // Get candidate decision
    const candidateDecision = await CandidateDecision.findById(candidateDecisionId)
      .populate('scheduledTest');

    if (!candidateDecision) {
      return res.status(404).json({
        success: false,
        error: 'Candidate decision not found'
      });
    }

    // Check if candidate was selected
    if (candidateDecision.decision !== 'selected') {
      return res.status(400).json({
        success: false,
        error: 'Offer letter can only be sent for selected candidates'
      });
    }

    // Check if offer letter was generated
    if (!candidateDecision.offerLetterGenerated || !candidateDecision.offerLetterUrl) {
      return res.status(400).json({
        success: false,
        error: 'Offer letter must be generated before sending'
      });
    }

    // Use the improved email service
    const { sendOfferLetterToBoth } = require('./services/fixedOfferEmailService');
    
    // Prepare offer data for the improved service
    const offerDataForEmail = {
      candidateName: candidateDecision.scheduledTest.candidateName,
      candidateEmail: candidateDecision.scheduledTest.candidateEmail,
      position: offerDetails.jobRole || candidateDecision.scheduledTest.jobTitle,
      salary: offerDetails.salary || 'As discussed',
      startDate: offerDetails.startDate || 'To be decided',
      companyName: req.user.companyName || 'Company',
      hrEmail: req.user.email,
      department: offerDetails.department || '',
      benefits: offerDetails.benefits || '',
      hrName: req.user.fullName || 'HR Team'
    };

    const emailResult = await sendOfferLetterToBoth(offerDataForEmail, candidateDecision.offerLetterUrl);

    res.status(200).json({
      success: true,
      message: 'Offer letter sent successfully to candidate and HR',
      emailResult
    });

  } catch (error) {
    console.error('Error sending offer letter:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send offer letter'
    });
  }
});


// Send rejection report
app.post('/api/rejection-report/send', authenticateJWT, async (req, res) => {
  try {
    const { candidateDecisionId } = req.body;

    // Get candidate decision
    const candidateDecision = await CandidateDecision.findById(candidateDecisionId)
      .populate('scheduledTest');

    if (!candidateDecision) {
      return res.status(404).json({
        success: false,
        error: 'Candidate decision not found'
      });
    }

    // Check if candidate was rejected
    if (candidateDecision.decision !== 'rejected') {
      return res.status(400).json({
        success: false,
        error: 'Rejection report can only be sent for rejected candidates'
      });
    }

    // Check if rejection report was generated
    if (!candidateDecision.rejectionLetterGenerated || !candidateDecision.rejectionLetterUrl) {
      return res.status(400).json({
        success: false,
        error: 'Rejection report must be generated before sending'
      });
    }

    // Get signed URL for rejection report
    const command = new GetObjectCommand({
      Bucket: process.env.MINIO_BUCKET_NAME,
      Key: candidateDecision.rejectionLetterUrl
    });
    const rejectionReportUrl = await getSignedUrl(s3, command, { expiresIn: 604800 }); // 7 days

    // Get rejection reason
    const rejectionReason = candidateDecision.rejectionReason === 'Other'
      ? candidateDecision.customRejectionReason
      : candidateDecision.rejectionReason;

    // Send email to candidate
    const mailOptions = {
      from: `"HR Department" <${process.env.EMAIL_USER}>`,
      to: candidateDecision.scheduledTest.candidateEmail,
      subject: `Application Update - ${candidateDecision.scheduledTest.jobTitle}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2563eb;">Application Update</h2>
          <p>Dear ${candidateDecision.scheduledTest.candidateName},</p>
          <p>Thank you for your interest in the position of <strong>${candidateDecision.scheduledTest.jobTitle}</strong>.</p>
          <p>After careful consideration, we have decided not to proceed with your application at this time.</p>
          <p><strong>Feedback:</strong> ${rejectionReason || 'We appreciate your interest in our organization, but we have decided to move forward with other candidates whose qualifications more closely align with our current requirements.'}</p>
          <p>We encourage you to apply for future positions that may be a better match for your skills and experience.</p>
          <p>We wish you the best in your job search and future professional endeavors.</p>
          <p>Best regards,<br/>${req.user.fullName}<br/>HR Department</p>
          <p style="color: #6b7280; font-size: 12px; margin-top: 30px;">
            This is an automated message. Please do not reply to this email.
          </p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);

    res.status(200).json({
      success: true,
      message: 'Rejection report sent successfully to candidate'
    });

  } catch (error) {
    console.error('Error sending rejection report:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send rejection report'
    });
  }
});

// Submit or update interview feedback
app.post('/api/interviews/feedback', authenticateJWT, async (req, res) => {
  try {
    const { candidateId, assessmentSessionId, rating, feedback, strengths, areasForImprovement, recommendation } = req.body;

    const sessionId = assessmentSessionId || candidateId;
    const assessment = await AssessmentSession.findById(sessionId);
    if (!assessment) {
      return res.status(404).json({ success: false, error: 'Assessment session not found' });
    }

    // Upsert interview by assessmentSessionId
    let interview = await Interview.findOne({ assessmentSessionId: sessionId });
    if (!interview) {
      interview = new Interview({
        candidateId: candidateId || sessionId,
        assessmentSessionId: sessionId,
        status: 'completed',
        createdBy: req.user.id,
      });
    }

    interview.status = 'completed';
    interview.feedback = feedback || interview.feedback;
    interview.feedbackSummary = feedback || interview.feedbackSummary;
    interview.rating = typeof rating === 'number' ? rating : interview.rating;
    interview.updatedAt = new Date();

    // Store structured fields if present
    interview.structuredFeedback = {
      strengths: strengths || interview?.structuredFeedback?.strengths,
      areasForImprovement: areasForImprovement || interview?.structuredFeedback?.areasForImprovement,
      recommendation: recommendation || interview?.structuredFeedback?.recommendation,
    };

    await interview.save();

    return res.status(200).json({ success: true, interviewId: interview._id });
  } catch (error) {
    console.error('Error saving interview feedback:', error);
    return res.status(500).json({ success: false, error: 'Failed to save interview feedback' });
  }
});

// ==============================
// ✅ END DEBUG ENDPOINTS
// ==============================

// ==============================
// INTERVIEW WORKFLOW ENDPOINTS
// ==============================

// Get candidate details for interview workflow
app.get('/api/candidates/:candidateId/details', authenticateJWT, async (req, res) => {
  try {
    const { candidateId } = req.params;
    const { assessmentSessionId } = req.query;

    console.log('Fetching candidate details for:', { candidateId, assessmentSessionId });

    // Get assessment session data (since candidateId is actually the assessment session ID)
    const assessment = await AssessmentSession.findById(assessmentSessionId || candidateId)
      .populate('resumeId')
      .populate('jobDescriptionId')
      .populate('testResult');

    if (!assessment) {
      return res.status(404).json({
        success: false,
        error: 'Assessment session not found'
      });
    }

    // Create candidate data from assessment with enhanced name parsing
    const candidate = {
      _id: assessment._id,
      name: (() => {
        // Enhanced name parsing logic - consistent with frontend
        let displayName = 'Unknown Candidate';

        // Priority: 1. Check if resumeId.name exists and is not an email
        if (assessment.resumeId?.name && typeof assessment.resumeId.name === 'string' && assessment.resumeId.name.trim()) {
          const nameValue = assessment.resumeId.name.trim();
          // If name is not in email format, use it directly
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(nameValue)) {
            displayName = nameValue;
          } else {
            // If name field contains email, parse it for display
            const emailParts = nameValue.split('@')[0].replace(/[._-]/g, ' ');
            const prettyName = emailParts
              .split(' ')
              .filter(Boolean)
              .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
              .join(' ')
              .trim();
            displayName = prettyName || 'Candidate';
          }
        }
        // Priority: 2. If no proper name, use candidateEmail for parsing
        else if (assessment.candidateEmail && typeof assessment.candidateEmail === 'string' && assessment.candidateEmail.includes('@')) {
          const emailParts = assessment.candidateEmail.split('@')[0].replace(/[._-]/g, ' ');
          const prettyName = emailParts
            .split(' ')
            .filter(Boolean)
            .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
            .join(' ')
            .trim();
          displayName = prettyName || 'Candidate';
        }

        return displayName;
      })(),
      email: assessment.candidateEmail,
      mobile_number: assessment.resumeId?.mobile_number,
      experience: assessment.resumeId?.experience || assessment.resumeId?.total_experience,
      skills: assessment.resumeId?.skills || [],
      resume: assessment.resumeId
    };

    res.status(200).json({
      success: true,
      candidate,
      assessment
    });

  } catch (error) {
    console.error('Error fetching candidate details:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch candidate details'
    });
  }
});

// Schedule interview
app.post('/api/interviews/schedule', authenticateJWT, async (req, res) => {
  try {
    const { candidateId, assessmentSessionId, platform, date, time, duration, notes } = req.body;

    // Create interview record
    const interview = new Interview({
      candidateId,
      assessmentSessionId,
      platform,
      scheduledDate: new Date(`${date}T${time}:00`),
      duration,
      notes,
      status: 'scheduled',
      createdBy: req.user.id,
      createdAt: new Date()
    });

    await interview.save();

    // Get assessment session data
    const assessment = await AssessmentSession.findById(assessmentSessionId || candidateId)
      .populate('resumeId');

    if (!assessment) {
      return res.status(404).json({
        success: false,
        error: 'Assessment session not found'
      });
    }

    // Create candidate data from assessment with consistent name parsing
    const candidate = {
      _id: assessment._id,
      name: (() => {
        // Enhanced name parsing logic - consistent with other endpoints
        let displayName = 'Unknown Candidate';

        // Priority: 1. Check if resumeId.name exists and is not an email
        if (assessment.resumeId?.name && typeof assessment.resumeId.name === 'string' && assessment.resumeId.name.trim()) {
          const nameValue = assessment.resumeId.name.trim();
          // If name is not in email format, use it directly
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(nameValue)) {
            displayName = nameValue;
          } else {
            // If name field contains email, parse it for display
            const emailParts = nameValue.split('@')[0].replace(/[._-]/g, ' ');
            const prettyName = emailParts
              .split(' ')
              .filter(Boolean)
              .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
              .join(' ')
              .trim();
            displayName = prettyName || 'Candidate';
          }
        }
        // Priority: 2. If no proper name, use candidateEmail for parsing
        else if (assessment.candidateEmail && typeof assessment.candidateEmail === 'string' && assessment.candidateEmail.includes('@')) {
          const emailParts = assessment.candidateEmail.split('@')[0].replace(/[._-]/g, ' ');
          const prettyName = emailParts
            .split(' ')
            .filter(Boolean)
            .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
            .join(' ')
            .trim();
          displayName = prettyName || 'Candidate';
        }

        return displayName;
      })(),
      email: assessment.candidateEmail
    };

    // Send interview invite
    const { sendInterviewInvite } = require('./services/interviewService');
    await sendInterviewInvite({
      candidateEmail: candidate.email,
      candidateName: candidate.name,
      platform,
      date,
      time,
      duration,
      notes,
      jobTitle: assessment?.jobTitle || 'Position'
    });

    res.status(200).json({
      success: true,
      interviewId: interview._id,
      message: 'Interview scheduled successfully'
    });

  } catch (error) {
    console.error('Error scheduling interview:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to schedule interview'
    });
  }
});

app.post('/api/candidates/select', authenticateJWT, async (req, res) => {
  try {
    const { candidateId, assessmentSessionId, offerData, offerHtml, interviewFeedback } = req.body;
    // Validate required fields to prevent sending without details
    if (!offerData || !offerData.position || !offerData.salary || !offerData.startDate) {
      return res.status(400).json({
        success: false,
        error: 'Position, salary, and start date are required to generate an offer letter.'
      });
    }

    // Get assessment session data
    const assessment = await AssessmentSession.findById(assessmentSessionId || candidateId)
      .populate('resumeId')
      .populate('jobDescriptionId');

    if (!assessment) {
      return res.status(404).json({
        success: false,
        error: 'Assessment session not found'
      });
    }

    // Get user data for company info
    const user = await User.findById(req.user.id);

    // Create candidate data from assessment
    const candidate = {
      _id: assessment._id, // Use assessment session ID as candidate ID
      name: assessment.resumeId?.name || assessment.candidateEmail?.split('@')[0]?.replace(/[._-]/g, ' ') || 'Candidate',
      email: assessment.candidateEmail
    };

    // Generate PDF either from provided HTML (preferred) or from professional template
    // Use the new PDF generation with letterhead merging
    const { generatePDFFromHTMLWithLetterhead } = require('./services/offerLetterService');
    let pdfBuffer;
    if (offerHtml && offerHtml.trim()) {
      pdfBuffer = await generatePDFFromHTMLWithLetterhead(offerHtml, req.user.id);
    } else {
      // Generate from template and then merge with letterhead
      const { generateProfessionalTemplate } = require('./services/offerLetterService');
      const templateHtml = generateProfessionalTemplate({
        candidateName: candidate.name,
        candidateEmail: candidate.email,
        position: offerData.position || assessment.jobTitle,
        salary: offerData.salary,
        startDate: offerData.startDate,
        benefits: offerData.benefits,
        notes: offerData.notes,
        companyName: user.companyName,
        hrName: user.fullName,
        hrEmail: user.email,
        assessmentScore: assessment.testResult?.combinedScore || 'N/A',
        interviewRating: interviewFeedback?.rating || 'N/A'
      });
      pdfBuffer = await generatePDFFromHTMLWithLetterhead(templateHtml, req.user.id);
    }

    // Upload the resulting PDF to S3
    const fileName = `offer_letter_${(candidate.name || candidate.email).replace(/\s+/g, '_')}_${Date.now()}.pdf`;
    const s3Key = `offer-letters/${fileName}`;
    await uploadToS3(pdfBuffer, s3Key, 'application/pdf');
    const command = new GetObjectCommand({
      Bucket: process.env.MINIO_BUCKET_NAME,
      Key: s3Key
    });
    const offerLetterUrl = await getSignedUrl(s3, command, { expiresIn: 604800 });
    
    // Send offer letter email to both candidate and HR using the improved service
    const candidateEmail = candidate.email || assessment.candidateEmail || offerData?.candidateEmail;
    if (!candidateEmail) {
      console.warn('No candidate email available to send offer letter');
      return res.status(400).json({ success: false, error: 'Candidate email is missing. Please add email and try again.' });
    }
    
    let candidateEmailSent = false;
    let hrEmailSent = false;
    let emailErrors = [];
    
    try {
      // Use the improved email service with better error handling
      const { sendOfferLetterToBoth } = require('./services/fixedOfferEmailService');
      console.log(`[MAIL] Preparing candidate offer send to ${candidateEmail}`);
      console.log(`[MAIL] Offer data:`, {
        candidateName: candidate.name,
        position: offerData.position || assessment.jobTitle,
        salary: offerData.salary,
        startDate: offerData.startDate,
        companyName: offerData?.companyName || user.companyName,
        hrEmail: user.email
      });
      
      // Prepare offer data for the improved service
      const offerDataForEmail = {
        candidateName: candidate.name,
        candidateEmail: candidateEmail,
        position: offerData.position || assessment.jobTitle,
        salary: offerData.salary,
        startDate: offerData.startDate,
        companyName: offerData?.companyName || user.companyName,
        hrEmail: user.email,
        department: offerData.department || '',
        benefits: offerData.benefits || '',
        hrName: user.fullName || 'HR Team'
      };
      
      const emailResult = await sendOfferLetterToBoth(offerDataForEmail, s3Key);
      
      candidateEmailSent = emailResult.candidateEmailSent;
      hrEmailSent = emailResult.hrEmailSent;
      
      console.log(`[MAIL] Candidate offer sent successfully to ${candidateEmail}`, emailResult.candidateMessageId || 'OK');
      console.log(`[MAIL] HR offer copy sent successfully to ${user.email}`, emailResult.hrMessageId || 'OK');
    } catch (e) {
      const errorMsg = `Failed to send offer letters: ${e?.message || e}`;
      console.error(`[MAIL] ERROR: ${errorMsg}`);
      console.error(`[MAIL] ERROR DETAILS:`, e);
      emailErrors.push(errorMsg);
    }

    // If neither email was sent, return an error
    if (!candidateEmailSent && !hrEmailSent) {
      return res.status(500).json({
        success: false,
        error: 'Failed to send offer letters to both candidate and HR. Please check email configuration.',
        emailErrors
      });
    }

    // If only one email was sent, log a warning but continue
    if (!candidateEmailSent) {
      console.warn('Warning: Candidate email failed but HR email sent successfully');
    }
    
    if (!hrEmailSent) {
      console.warn('Warning: HR email failed but candidate email sent successfully');
    }

    // Resolve or create ScheduledTest to satisfy schema
    let scheduledTestDoc = await ScheduledTest.findOne({ assessmentSession: assessment._id });
    if (!scheduledTestDoc) {
      scheduledTestDoc = new ScheduledTest({
        candidateName: candidate.name || assessment.resumeId?.name || 'Candidate',
        candidateEmail: candidate.email || assessment.candidateEmail,
        jobTitle: offerData.position || assessment.jobTitle || 'Position',
        status: 'completed',
        assessmentSession: assessment._id,
        scheduledDateTime: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        user: req.user.id,
        // Required fields for ScheduledTest schema
        token: `${String(assessment._id)}-${Date.now()}`,
        testLink: `${process.env.PUBLIC_WEB_BASE_URL || 'https://app.skillmatrix.local'}/assessment/test/${String(assessment._id)}-${Date.now()}`,
        jobDescriptionId: assessment.jobDescriptionId ? assessment.jobDescriptionId._id || assessment.jobDescriptionId : undefined,
        resumeId: assessment.resumeId ? assessment.resumeId._id || assessment.resumeId : undefined
      });
      await scheduledTestDoc.save();
    }

    // Create candidate decision record
    const candidateDecision = new CandidateDecision({
      scheduledTest: scheduledTestDoc._id,
      candidateId,
      assessmentSessionId,
      decision: 'selected',
      offerLetterUrl: s3Key,
      offerDetails: offerData,
      interviewFeedback: interviewFeedback,
      decidedBy: req.user.id,
      decidedAt: new Date()
    });

    await candidateDecision.save();

    res.status(200).json({
      success: true,
      message: 'Candidate selected successfully. Offer letter generated and sent.',
      data: candidateDecision
    });

  } catch (error) {
    console.error('Error selecting candidate:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to select candidate'
    });
  }
});

// Generate Offer Draft (auto-filled HTML from template)
app.post('/api/offers/draft', authenticateJWT, async (req, res) => {
  try {
    const { candidateId, assessmentSessionId, template, offerData } = req.body;
    const assessment = await AssessmentSession.findById(assessmentSessionId || candidateId)
      .populate('resumeId');
    if (!assessment) {
      return res.status(404).json({ success: false, error: 'Assessment session not found' });
    }

    // Load offer letter templates
    const { getOfferLetterTemplate, generateProfessionalTemplate, generateExecutiveTemplate, generateStartupTemplate, generateFormalTemplate } = require('./services/offerLetterService');

    // Define templates object
    const templates = {
      professional: generateProfessionalTemplate,
      executive: generateExecutiveTemplate,
      startup: generateStartupTemplate,
      formal: generateFormalTemplate
    };

    const user = await User.findById(req.user.id);
    const candidateName = offerData?.candidateName || assessment.resumeId?.name || assessment.candidateEmail || 'Candidate';
    const jobTitle = offerData?.position || assessment.jobTitle || 'Position';
    const companyName = offerData?.companyName || user?.companyName || 'Your Company';
    const today = new Date().toLocaleDateString();

    const offerTemplate = templates[template];
    if (!offerTemplate) {
      return res.status(400).json({ success: false, error: 'Invalid template' });
    }

    // Pass all offerData fields to the template
    const offerHtml = offerTemplate({
      // Basic template fields
      candidateName,
      jobTitle,
      companyName,
      today,

      // Candidate Details
      candidateEmail: offerData?.candidateEmail || assessment.candidateEmail || '',
      candidateAddress: offerData?.candidateAddress || '',
      candidatePhone: offerData?.candidatePhone || '',

      // Position Details
      position: offerData?.position || jobTitle,
      department: offerData?.department || '',
      employmentType: offerData?.employmentType || 'Full-time',
      reportingManager: offerData?.reportingManager || '',
      workLocation: offerData?.workLocation || 'Office',

      // Salary & Benefits
      salary: offerData?.salary || '',
      currency: offerData?.currency || 'INR',
      salaryFrequency: offerData?.salaryFrequency || 'per annum',
      benefits: offerData?.benefits || '',

      // Dates & Terms
      startDate: offerData?.startDate || '',
      endDate: offerData?.endDate || '',
      probationPeriod: offerData?.probationPeriod || '3 months',
      noticePeriod: offerData?.noticePeriod || '30 days',
      workingHours: offerData?.workingHours || '9 AM to 6 PM',
      workingDays: offerData?.workingDays || 'Monday to Friday',

      // Company Details
      companyAddress: offerData?.companyAddress || '',
      companyPhone: offerData?.companyPhone || '',
      companyEmail: offerData?.companyEmail || user?.email || '',
      companyWebsite: offerData?.companyWebsite || '',

      // HR Details
      hrName: offerData?.hrName || user?.fullName || '',
      hrTitle: offerData?.hrTitle || 'HR Manager',
      hrEmail: offerData?.hrEmail || user?.email || '',
      hrPhone: offerData?.hrPhone || '',

      // Additional Terms
      additionalTerms: offerData?.additionalTerms || '',
      specialConditions: offerData?.specialConditions || '',
      notes: offerData?.notes || '',

      // Interview Details
      interviewDate: offerData?.interviewDate || '',
      interviewFeedback: offerData?.interviewFeedback || ''
    });

    res.status(200).json({
      success: true,
      offerHtml
    });

  } catch (error) {
    console.error('Error generating offer draft:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate offer draft'
    });
  }
});

// Document Collection Endpoints
app.post('/api/candidates/:candidateId/request-documents', authenticateJWT, async (req, res) => {
  try {
    const { candidateId } = req.params;
    const { assessmentSessionId, documentTypes, customMessage, template } = req.body;

    // Get assessment session data
    const assessment = await AssessmentSession.findById(assessmentSessionId || candidateId)
      .populate('resumeId');

    if (!assessment) {
      return res.status(404).json({
        success: false,
        error: 'Assessment session not found'
      });
    }

    // Get user data for company info
    const user = await User.findById(req.user.id);

    // Create candidate data from assessment
    const candidate = {
      name: assessment.resumeId?.name || assessment.candidateEmail,
      email: assessment.candidateEmail
    };

    // Send document collection email to candidate
    const { sendDocumentCollectionEmail } = require('./services/interviewService');

    await sendDocumentCollectionEmail({
      candidateName: candidate.name,
      candidateEmail: candidate.email,
      companyName: user.companyName,
      documentTypes,
      customMessage,
      template,
      templateId: template, // If template is a string ID, use it
      userId: req.user.id
    });

    // If template is a user-defined template ID, validate it
    let templateToUse = template;
    if (template && !['standard', 'formal', 'friendly'].includes(template)) {
      // This is likely a user-defined template ID
      try {
        const { getTemplateById } = require('./services/documentTemplateService');
        const userTemplate = await getTemplateById(template, req.user.id);
        if (!userTemplate) {
          templateToUse = 'standard'; // Fallback to standard if template not found
        }
      } catch (error) {
        console.error('Error validating user template:', error);
        templateToUse = 'standard'; // Fallback to standard if validation fails
      }
    }

    // Create document collection record
    const documentCollection = new DocumentCollection({
      candidateId,
      assessmentSessionId,
      requestedBy: req.user.id,
      documentTypes,
      customMessage,
      template: templateToUse,
      status: 'requested',
      requestedAt: new Date()
    });

    await documentCollection.save();

    res.status(200).json({
      success: true,
      message: 'Document collection request sent successfully',
      data: documentCollection
    });

  } catch (error) {
    console.error('Error requesting documents:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to request documents'
    });
  }
});

// Get user templates for document collection
app.get('/api/document-collection/templates', authenticateJWT, async (req, res) => {
  try {
    const { getUserTemplates } = require('./services/documentTemplateService');
    const templates = await getUserTemplates(req.user.id);

    res.status(200).json({
      success: true,
      data: templates
    });
  } catch (error) {
    console.error('Error fetching templates:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch templates'
    });
  }
});

// Create a new document collection template
app.post('/api/document-collection/templates', authenticateJWT, async (req, res) => {
  try {
    const { createTemplate } = require('./services/documentTemplateService');
    const templateData = req.body;

    // Add user ID to template data
    templateData.userId = req.user.id;

    const template = await createTemplate(templateData);

    res.status(201).json({
      success: true,
      message: 'Template created successfully',
      data: template
    });
  } catch (error) {
    console.error('Error creating template:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create template'
    });
  }
});

// Update a document collection template
app.put('/api/document-collection/templates/:templateId', authenticateJWT, async (req, res) => {
  try {
    const { updateTemplate } = require('./services/documentTemplateService');
    const { templateId } = req.params;
    const templateData = req.body;

    const template = await updateTemplate(templateId, templateData, req.user.id);

    if (!template) {
      return res.status(404).json({
        success: false,
        error: 'Template not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Template updated successfully',
      data: template
    });
  } catch (error) {
    console.error('Error updating template:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update template'
    });
  }
});

// Delete a document collection template
app.delete('/api/document-collection/templates/:templateId', authenticateJWT, async (req, res) => {
  try {
    const { deleteTemplate } = require('./services/documentTemplateService');
    const { templateId } = req.params;

    const result = await deleteTemplate(templateId, req.user.id);

    if (!result) {
      return res.status(404).json({
        success: false,
        error: 'Template not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Template deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting template:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete template'
    });
  }
});

// Schedule periodic cleanup of old letterheads (once per day)
setInterval(async () => {
  try {
    console.log('🕒 [SCHEDULED TASK] Running periodic letterhead cleanup');

    // Get all companies with letterheads
    const companies = await User.find({}, '_id');

    let totalDeleted = 0;
    for (const company of companies) {
      try {
        const { cleanupOldLetterheads } = require('./services/letterheadService');
        const result = await cleanupOldLetterheads(company._id, 30); // Cleanup letterheads older than 30 days
        totalDeleted += result.deleted;
      } catch (companyError) {
        console.error(`❌ [SCHEDULED TASK] Error cleaning up letterheads for company ${company._id}:`, companyError);
      }
    }

    console.log('✅ [SCHEDULED TASK] Letterhead cleanup completed:', { totalDeleted });
  } catch (error) {
    console.error('❌ [SCHEDULED TASK] Error in periodic letterhead cleanup:', error);
  }
}, 24 * 60 * 60 * 1000); // Run once per day

// Cleanup old letterheads endpoint
app.post('/api/letterhead/cleanup', authenticateJWT, async (req, res) => {
  try {
    const { daysOld } = req.body || {};
    const days = daysOld && Number.isInteger(daysOld) ? daysOld : 30;

    const { cleanupOldLetterheads } = require('./services/letterheadService');
    const result = await cleanupOldLetterheads(req.user.id, days);

    res.status(200).json({
      success: true,
      message: `Cleanup completed. ${result.deleted} old letterheads removed.`,
      data: result
    });
  } catch (error) {
    console.error('Error cleaning up letterheads:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to cleanup letterheads'
    });
  }
});

// Endpoint to upload documents
app.post('/api/candidates/:candidateId/upload-documents', authenticateJWT, upload.array('documents'), async (req, res) => {
  try {
    const { candidateId } = req.params;
    const { documentCollectionId } = req.body;
    const files = req.files;

    if (!files || files.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No documents uploaded'
      });
    }

    // Upload documents to S3
    const uploadedDocuments = [];
    for (const file of files) {
      const s3Key = `candidate-documents/${candidateId}/${Date.now()}_${file.originalname}`;
      await uploadToS3(file.buffer, s3Key, file.mimetype);

      uploadedDocuments.push({
        name: file.originalname,
        s3Key,
        type: file.mimetype,
        size: file.size,
        uploadedAt: new Date()
      });
    }

    // Update document collection record
    const documentCollection = await DocumentCollection.findById(documentCollectionId);
    if (documentCollection) {
      documentCollection.documents = uploadedDocuments;
      documentCollection.status = 'uploaded';
      documentCollection.uploadedAt = new Date();
      await documentCollection.save();
    }

    res.status(200).json({
      success: true,
      message: 'Documents uploaded successfully',
      data: {
        documentCollectionId,
        documents: uploadedDocuments
      }
    });

  } catch (error) {
    console.error('Error uploading documents:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to upload documents'
    });
  }
});

// Endpoint to get document collection status
app.get('/api/candidates/:candidateId/document-collection/:documentCollectionId', authenticateJWT, async (req, res) => {
  try {
    const { candidateId, documentCollectionId } = req.params;

    const documentCollection = await DocumentCollection.findById(documentCollectionId);
    if (!documentCollection) {
      return res.status(404).json({
        success: false,
        error: 'Document collection not found'
      });
    }

    res.status(200).json({
      success: true,
      data: documentCollection
    });

  } catch (error) {
    console.error('Error fetching document collection:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch document collection'
    });
  }
});

// Letterhead upload endpoint
app.post('/api/letterhead/upload', authenticateJWT, letterheadService.getUploadMiddleware(), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No letterhead file uploaded'
      });
    }

    const letterhead = await letterheadService.uploadLetterhead(req.file, req.user.id);

    res.status(200).json({
      success: true,
      message: 'Letterhead uploaded successfully',
      data: {
        ...letterhead,
        id: letterhead._id || letterhead.id
      }
    });
  } catch (error) {
    console.error('Error uploading letterhead:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to upload letterhead'
    });
  }
});

// Get active letterhead for company
app.get('/api/letterhead/active', authenticateJWT, async (req, res) => {
  try {
    const letterhead = await letterheadService.getActiveLetterhead(req.user.id);

    if (!letterhead) {
      return res.status(404).json({
        success: false,
        error: 'No active letterhead found'
      });
    }

    res.status(200).json({
      success: true,
      data: letterhead
    });
  } catch (error) {
    console.error('Error getting active letterhead:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get active letterhead'
    });
  }
});

// Generate letterhead preview URL
app.get('/api/letterhead/preview/:letterheadId', authenticateJWT, async (req, res) => {
  try {
    const { letterheadId } = req.params;

    // First try to find by _id
    let letterhead = await Letterhead.findOne({
      _id: letterheadId,
      companyId: req.user.id
    });

    // If not found by _id, try to find by s3Key (for preview functionality)
    if (!letterhead) {
      letterhead = await Letterhead.findOne({
        s3Key: letterheadId,
        companyId: req.user.id
      });
    }

    if (!letterhead) {
      return res.status(404).json({
        success: false,
        error: 'Letterhead not found'
      });
    }

    const previewUrl = await letterheadService.generatePreviewUrl(letterhead.s3Key);

    res.status(200).json({
      success: true,
      url: previewUrl,
      data: {
        id: letterhead._id,
        s3Key: letterhead.s3Key,
        originalName: letterhead.originalName,
        uploadedAt: letterhead.uploadedAt
      }
    });
  } catch (error) {
    console.error('Error generating letterhead preview:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate letterhead preview'
    });
  }
});

// ==============================
// INDUSTRIAL-GRADE OFFER LETTER ENDPOINTS
// ==============================

// Generate industrial-grade offer letter with letterhead merging
app.post('/api/industrial-offers/generate', authenticateJWT, async (req, res) => {
  try {
    const { offerData } = req.body;

    if (!offerData) {
      return res.status(400).json({
        success: false,
        error: 'offerData is required'
      });
    }

    // Validate required fields
    if (!offerData.candidateName || !offerData.candidateEmail || !offerData.position) {
      return res.status(400).json({
        success: false,
        error: 'candidateName, candidateEmail, and position are required'
      });
    }

    const result = await industrialOfferLetterService.generateOfferLetter(offerData, req.user.id);

    res.status(200).json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('Error generating industrial offer letter:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to generate offer letter'
    });
  }
});

// Get offer letter details
app.get('/api/industrial-offers/:offerLetterId', authenticateJWT, async (req, res) => {
  try {
    const { offerLetterId } = req.params;

    const offerLetter = await industrialOfferLetterService.getOfferLetter(offerLetterId, req.user.id);

    res.status(200).json({
      success: true,
      data: offerLetter
    });

  } catch (error) {
    console.error('Error retrieving offer letter:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to retrieve offer letter'
    });
  }
});

// Get all offer letters for company with pagination
app.get('/api/industrial-offers', authenticateJWT, async (req, res) => {
  try {
    const { page, limit, status } = req.query;

    const result = await industrialOfferLetterService.getOfferLetters(req.user.id, {
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      status
    });

    res.status(200).json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('Error retrieving offer letters:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to retrieve offer letters'
    });
  }
});

// Generate download URL for offer letter
app.get('/api/industrial-offers/:offerLetterId/download-url', authenticateJWT, async (req, res) => {
  try {
    const { offerLetterId } = req.params;

    // Verify the offer letter belongs to the user's company
    const offerLetter = await industrialOfferLetterService.getOfferLetter(offerLetterId, req.user.id);

    const downloadUrl = await industrialOfferLetterService.generateDownloadUrl(offerLetter.s3Key);

    res.status(200).json({
      success: true,
      url: downloadUrl
    });

  } catch (error) {
    console.error('Error generating download URL:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to generate download URL'
    });
  }
});

// Update offer letter status
app.patch('/api/industrial-offers/:offerLetterId', authenticateJWT, async (req, res) => {
  try {
    const { offerLetterId } = req.params;
    const { updateData } = req.body;

    const updatedOfferLetter = await industrialOfferLetterService.updateOfferLetter(
      offerLetterId,
      req.user.id,
      updateData
    );

    res.status(200).json({
      success: true,
      data: updatedOfferLetter
    });

  } catch (error) {
    console.error('Error updating offer letter:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update offer letter'
    });
  }
});

// Delete offer letter (soft delete)
app.delete('/api/industrial-offers/:offerLetterId', authenticateJWT, async (req, res) => {
  try {
    const { offerLetterId } = req.params;

    await industrialOfferLetterService.deleteOfferLetter(offerLetterId, req.user.id);

    res.status(200).json({
      success: true,
      message: 'Offer letter deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting offer letter:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete offer letter'
    });
  }
});

// Send offer letter email to candidate and HR
app.post('/api/industrial-offers/:offerLetterId/send-email', authenticateJWT, async (req, res) => {
  try {
    const { offerLetterId } = req.params;

    console.log('📧 [API] Sending offer letter email for:', offerLetterId);

    const emailResult = await industrialOfferLetterService.sendOfferLetterEmail(offerLetterId, req.user.id);

    res.status(200).json({
      success: true,
      message: 'Offer letter sent successfully to candidate and HR',
      data: emailResult
    });

  } catch (error) {
    console.error('❌ [API] Error sending offer letter email:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to send offer letter email'
    });
  }
});

// ==============================

// Finalize edited HTML -> PDF + email (optional alternative to /api/candidates/select)
app.post('/api/offers/finalize', authenticateJWT, async (req, res) => {
  try {
    const { candidateId, assessmentSessionId, editedHtml, offerData } = req.body;
    if (!editedHtml) {
      return res.status(400).json({ success: false, error: 'editedHtml is required' });
    }

    const assessment = await AssessmentSession.findById(assessmentSessionId || candidateId)
      .populate('resumeId');
    if (!assessment) {
      return res.status(404).json({ success: false, error: 'Assessment session not found' });
    }
    const user = await User.findById(req.user.id);
    const candidateName = assessment.resumeId?.name || assessment.candidateEmail || 'Candidate';

    // naive sanitization (replace with sanitize-html in production)
    const safeHtml = String(editedHtml).replace(/<script[\s\S]*?<\/script>/gi, '');

    // Helpers to format values and fill placeholders
    const formatDate = (dateStr) => {
      if (!dateStr) return '';
      try {
        return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
      } catch {
        return String(dateStr);
      }
    };

    const formatSalary = (amount, currency = (offerData?.currency || 'INR')) => {
      if (amount === undefined || amount === null || amount === '') return '';
      const n = Number(amount);
      const formatted = isNaN(n) ? String(amount) : n.toLocaleString('en-IN');
      const symbol = currency === 'INR' ? '₹' : (currency === 'USD' ? '$' : currency);
      return `${symbol}${formatted}`;
    };

    const buildCandidateFullBlock = () => {
      const parts = [
        candidateName,
        offerData?.candidateEmail,
        offerData?.candidateAddress
      ].filter(Boolean);
      return parts.join('<br/>');
    };

    const buildSalarySection = () => {
      const salaryFmt = formatSalary(offerData?.salary);
      return {
        earningsRows: '',        // optional: generate rows if you have breakdown
        deductionsRows: '',      // optional: generate rows if you have breakdown
        totalEarnings: salaryFmt,
        totalDeductions: '0',
        netSalary: salaryFmt,
        annualTakeHome: salaryFmt,
        salaryInWords: ''        // optional: add number-to-words later
      };
    };

    const fillTemplate = (html, map) =>
      Object.entries(map).reduce((acc, [k, v]) => acc.replace(new RegExp(`\\{{2}${k}\\}{2}`, 'g'), v ?? ''), html);

    // Reuse the same helpers here (formatDate, formatSalary, buildCandidateFullBlock, buildSalarySection, fillTemplate)
    const filledHtml = fillTemplate(safeHtml, {
      candidateFullBlock: (() => {
        const parts = [
          (offerData?.candidateName || candidateName),
          offerData?.candidateEmail,
          offerData?.candidateAddress
        ].filter(Boolean);
        return parts.join('<br/>');
      })(),
      startDate: formatDate(offerData?.startDate),
      interviewDate: formatDate(offerData?.interviewDate),
      salary: formatSalary(offerData?.salary),
      termsBlock: '',
      salaryMatrix: '',
      ...buildSalarySection()
    });

    // Use filledHtml for PDF
    const pdfBuffer = await new Promise((resolve, reject) => {
      htmlToPdf.create(filledHtml, { format: 'A4', border: '10mm' }).toBuffer((err, buffer) => {
        if (err) return reject(err);
        resolve(buffer);
      });
    });

    const fileName = `offer_letter_${(candidateName || 'candidate').replace(/\s+/g, '_')}_${Date.now()}.pdf`;
    const s3Key = `offer-letters/${fileName}`;

    // After:
    await uploadToS3(pdfBuffer, s3Key, 'application/pdf');

    // Add this pre-sign block (same style as sendReportToHR):
    const command = new GetObjectCommand({
      Bucket: process.env.MINIO_BUCKET_NAME,
      Key: s3Key
    });
    const offerLetterUrl = await getSignedUrl(s3, command, { expiresIn: 604800 }); // 7 days

    // Import both senders for clarity
    const { sendOfferLetter, sendOfferLetterToHR } = require('./services/interviewService');

    // Send to Candidate
    await sendOfferLetter({
      candidateName,
      candidateEmail: assessment.candidateEmail || offerData?.candidateEmail, // fallback added
      position: offerData?.position || assessment.jobTitle,
      salary: offerData?.salary,
      startDate: offerData?.startDate,
      companyName: offerData?.companyName || user?.companyName
    }, offerLetterUrl);

    // Send to HR
    await sendOfferLetterToHR({
      hrEmail: user.email,
      companyName: offerData?.companyName || user?.companyName,
      candidateName,
      position: offerData?.position || assessment.jobTitle,
      salary: offerData?.salary,
      startDate: offerData?.startDate,
      assessmentScore: assessment.testResult?.combinedScore || 'N/A',
      interviewRating: 'N/A'
    }, offerLetterUrl);

    return res.json({ success: true, s3Key });
  } catch (error) {
    console.error('Error finalizing offer:', error);
    return res.status(500).json({ success: false, error: 'Failed to finalize offer' });
  }
});

// Generate offer letter preview (PDF with letterhead)
app.post('/api/offers/preview', authenticateJWT, async (req, res) => {
  try {
    const { offerHtml, hasLetterhead, letterheadUrl } = req.body;

    if (!offerHtml) {
      return res.status(400).json({ success: false, error: 'offerHtml is required' });
    }

    // Use the offerLetterService to generate PDF with letterhead
    const { generatePDFFromHTMLWithLetterhead } = require('./services/offerLetterService');

    let pdfBuffer;

    if (hasLetterhead && letterheadUrl) {
      // Generate PDF with letterhead merging
      pdfBuffer = await generatePDFFromHTMLWithLetterhead(offerHtml, req.user.id);
    } else {
      // Generate PDF without letterhead
      const { generatePDFFromHTML } = require('./services/offerLetterService');
      pdfBuffer = await generatePDFFromHTML(offerHtml);
    }

    // Send PDF as response
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="offer_preview.pdf"');
    res.send(pdfBuffer);

  } catch (error) {
    console.error('Error generating offer preview:', error);
    res.status(500).json({ success: false, error: 'Failed to generate offer preview' });
  }
});


// Send professional rejection email
async function sendProfessionalRejectionEmail(data) {
  try {
    const { candidateName, candidateEmail, reason, customReason, feedback, jobTitle, interviewFeedback } = data;

    // Get rejection reason text
    let rejectionReasonText = '';
    switch (reason) {
      case 'requirements-not-matching':
        rejectionReasonText = 'The position requirements did not align with your current qualifications';
        break;
      case 'location-not-suitable':
        rejectionReasonText = 'The location requirements do not match your preferences';
        break;
      case 'resume-referred-other-roles':
        rejectionReasonText = 'We will keep your resume on file for future opportunities that may be a better fit';
        break;
      case 'custom':
        rejectionReasonText = customReason || 'We have decided to move forward with other candidates';
        break;
      default:
        rejectionReasonText = 'We have decided to move forward with other candidates';
    }

    // Create professional rejection email content
    const emailContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
          <h2 style="color: #333; margin: 0;">Thank You for Your Interest</h2>
        </div>
        
        <p>Dear ${candidateName},</p>
        
        <p>Thank you for your interest in the ${jobTitle} position and for taking the time to participate in our interview process. We appreciate the effort you put into your application and assessment.</p>
        
        <p>After careful consideration, we have decided not to move forward with your application at this time. ${rejectionReasonText}.</p>
        
        ${interviewFeedback ? `
        <div style="background-color: #fff3cd; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <h3 style="color: #856404; margin-top: 0;">Interview Feedback</h3>
          <p style="margin: 5px 0;"><strong>Overall Rating:</strong> ${interviewFeedback.rating}/5</p>
          ${interviewFeedback.feedback ? `<p style="margin: 5px 0;"><strong>Feedback:</strong> ${interviewFeedback.feedback}</p>` : ''}
          ${interviewFeedback.strengths ? `<p style="margin: 5px 0;"><strong>Strengths:</strong> ${interviewFeedback.strengths}</p>` : ''}
          ${interviewFeedback.areasForImprovement ? `<p style="margin: 5px 0;"><strong>Areas for Improvement:</strong> ${interviewFeedback.areasForImprovement}</p>` : ''}
        </div>
        ` : ''}
        
        ${feedback ? `
        <p><strong>Additional Feedback:</strong> ${feedback}</p>
        ` : ''}
        
        <p>We encourage you to continue pursuing opportunities that align with your career goals. We will keep your information on file and may reach out if future positions become available that might be a better fit.</p>
        
        <p>Thank you again for your interest in joining our team.</p>
        
        <div style="margin-top: 30px;">
          <p>Best regards,<br>
          The HR Team</p>
        </div>
      </div>
    `;

    // Send email using nodemailer
    const mailOptions = {
      from: `"SkillMatrix HR Team" <${process.env.SMTP_USER}>`,
      to: candidateEmail,
      subject: `Update on Your Application for ${jobTitle}`,
      html: emailContent
    };

    console.log(`📧 Sending rejection email to: ${candidateEmail}`);
    await transporter.sendMail(mailOptions);
    console.log(`✅ Professional rejection email sent successfully to ${candidateEmail}`);

  } catch (error) {
    console.error('Error sending rejection email:', error);
    throw error;
  }
}

// Reject candidate
app.post('/api/candidates/reject', authenticateJWT, async (req, res) => {
  try {
    const { candidateId, assessmentSessionId, rejectionData, interviewFeedback } = req.body;

    // Get assessment session data
    const assessment = await AssessmentSession.findById(assessmentSessionId || candidateId)
      .populate('resumeId');

    if (!assessment) {
      return res.status(404).json({
        success: false,
        error: 'Assessment session not found'
      });
    }

    // Create candidate data from assessment
    const candidate = {
      _id: assessment._id,
      name: assessment.resumeId?.name || assessment.candidateEmail,
      email: assessment.candidateEmail
    };

    // Generate professional rejection email
    await sendProfessionalRejectionEmail({
      candidateName: candidate.name,
      candidateEmail: candidate.email,
      reason: rejectionData.reason,
      customReason: rejectionData.customReason,
      feedback: rejectionData.feedback,
      jobTitle: assessment.jobTitle,
      interviewFeedback: interviewFeedback
    });

    // Create candidate decision record
    const candidateDecision = new CandidateDecision({
      candidateId,
      assessmentSessionId,
      decision: 'rejected',
      rejectionReason: rejectionData.reason,
      customRejectionReason: rejectionData.customReason,
      rejectionFeedback: rejectionData.feedback,
      interviewFeedback: interviewFeedback,
      emailSent: true,
      emailSentAt: new Date(),
      rejectionLetterGenerated: true,
      decidedBy: req.user.id,
      decidedAt: new Date()
    });

    await candidateDecision.save();

    res.status(200).json({
      success: true,
      message: 'Candidate rejected and notification sent'
    });

  } catch (error) {
    console.error('Error rejecting candidate:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to reject candidate'
    });
  }
});

// Send interview invitation email to candidate and HR
app.post('/api/interviews/send-invitation', authenticateJWT, async (req, res) => {
  try {
    const { sendInterviewInvitation } = require('./services/interviewEmailService');
    const result = await sendInterviewInvitation(
      req.body.candidateId,
      req.body.assessmentSessionId,
      req.body.interviewDetails,
      req.user.id
    );
    res.status(200).json(result);
  } catch (error) {
    console.error('Error sending interview invitation:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send interview invitation'
    });
  }
});

// Get all candidate decisions for the current user
app.get('/api/candidate-decisions', authenticateJWT, async (req, res) => {
  try {
    const decisions = await CandidateDecision.find({ decidedBy: req.user.id })
      .populate('scheduledTest')
      .populate('interview')
      .sort({ decidedAt: -1 });

    res.status(200).json(decisions);
  } catch (error) {
    console.error('Error fetching candidate decisions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch candidate decisions'
    });
  }
});

// ==============================

// Document Collection Routes
const documentCollectionRoutes = require('./routes/documentCollectionRoutes');
app.use('/api/document-collection', authenticateJWT, documentCollectionRoutes);

// Lead Capture Routes (No authentication required)
const leadRoutes = require('./routes/leadRoutes');
app.use('/api', leadRoutes.router); // Use the router property

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: process.env.npm_package_version || '1.0.0'
  });
});

app.set('trust proxy', true); // or a specific number if you're behind multiple proxies
// Start Server
server.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`);

  // Test MinIO connection on startup
  await testMinIOConnection();

  // Initialize Excel file for leads if it doesn't exist
  try {
    await leadRoutes.initializeExcelFile();
    console.log('✅ Lead Excel file initialization completed');
  } catch (error) {
    console.error('❌ Failed to initialize lead Excel file:', error);
  }

  // Save admin details on server start
  saveAdmin();
  ensureCleanTempDir();
});
