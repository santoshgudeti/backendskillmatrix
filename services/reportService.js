const { createCanvas } = require('canvas');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { uploadToS3 } = require('./awsService');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const s3 = require('../config/aws');

async function generateScoreChart(scores) {
  const canvas = createCanvas(400, 200);
  const ctx = canvas.getContext('2d');
  
  // Simple bar chart - you can customize this
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  ctx.fillStyle = '#007bff';
  ctx.fillRect(50, 200 - scores.mcq * 2, 60, scores.mcq * 2);
  ctx.fillRect(150, 200 - scores.audio * 2, 60, scores.audio * 2);
  ctx.fillRect(250, 200 - scores.video * 2, 60, scores.video * 2);
  ctx.fillRect(350, 200 - scores.combined * 2, 60, scores.combined * 2);
  
  ctx.fillStyle = '#000000';
  ctx.font = '12px Arial';
  ctx.fillText('MCQ', 60, 190);
  ctx.fillText('Audio', 160, 190);
  ctx.fillText('Video', 260, 190);
  ctx.fillText('Overall', 360, 190);
  
  return canvas.toBuffer();
}

async function generateAssessmentReport(sessionId, userId) {
  try {
    // Fetch all required data
    const [session, testResult, voiceAnswers, recording] = await Promise.all([
      AssessmentSession.findById(sessionId)
        .populate('resumeId')
        .populate('jobDescriptionId'),
      TestResult.findOne({ assessmentSession: sessionId }),
      VoiceAnswer.find({ assessmentSession: sessionId }),
      Recording.findOne({ assessmentSession: sessionId })
    ]);

    if (!session || !testResult) {
      throw new Error('Assessment data not found');
    }

    // Create PDF document
    const doc = new PDFDocument();
    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    
    // Add header
    doc.fontSize(20).text('Candidate Assessment Report', { align: 'center' });
    doc.moveDown();
    
    // Candidate details
    doc.fontSize(14).text(`Candidate: ${session.candidateEmail}`);
    doc.text(`Job Title: ${session.jobTitle}`);
    doc.text(`Assessment Date: ${session.completedAt.toLocaleDateString()}`);
    doc.moveDown();
    
    // Scores summary
    doc.fontSize(16).text('Performance Summary', { underline: true });
    doc.text(`MCQ Score: ${testResult.score}/100`);
    doc.text(`Audio Score: ${testResult.audioScore}/100`);
    doc.text(`Video Score: ${testResult.videoScore}/100`);
    doc.text(`Combined Score: ${testResult.combinedScore}/100`);
    doc.moveDown();
    
    // Generate chart
    const chartBuffer = await generateScoreChart({
      mcq: testResult.score,
      audio: testResult.audioScore,
      video: testResult.videoScore,
      combined: testResult.combinedScore
    });
    
    doc.image(chartBuffer, 50, doc.y, { width: 400 });
    doc.moveDown(5);
    
    // MCQ Questions & Answers
    doc.fontSize(16).text('MCQ Assessment', { underline: true });
    session.questions.forEach((q, i) => {
      doc.fontSize(12).text(`Q${i+1}: ${q.question}`);
      doc.fontSize(10).text(`Candidate Answer: [Not stored - would need to add to schema]`);
      doc.text(`Correct Answer: ${q.correctAnswer}`);
      doc.moveDown();
    });
    
    // Voice Questions & Answers
    doc.addPage();
    doc.fontSize(16).text('Voice Assessment', { underline: true });
    voiceAnswers.forEach((answer, i) => {
      doc.fontSize(12).text(`Q${i+1}: ${answer.question}`);
      doc.fontSize(10).text(`Transcript: ${answer.answer || 'No answer provided'}`);
      if (answer.audioAnalysis?.grading) {
        doc.text(`Audio Score: ${answer.audioAnalysis.grading['Total Score']}/100`);
      }
      doc.moveDown();
    });
    
    // Video Analysis
    if (recording?.videoAnalysis) {
      doc.addPage();
      doc.fontSize(16).text('Video Analysis', { underline: true });
      doc.text(`Dominant Emotion: ${recording.videoAnalysis.emotions.dominant_emotion}`);
      doc.text(`Video Score: ${recording.videoAnalysis.video_score}/100`);
    }
    
    // Finalize PDF
    return new Promise((resolve, reject) => {
      doc.on('end', async () => {
        try {
          const pdfBuffer = Buffer.concat(buffers);
          const filename = `report_${sessionId}_${Date.now()}.pdf`;
          const s3Key = `reports/${filename}`;
          
          // Upload to S3
          await uploadToS3(pdfBuffer, s3Key, 'application/pdf');
          
          // Save report reference
          const report = new Report({
            assessmentSession: sessionId,
            s3Key,
            filename,
            user: userId
          });
          await report.save();
          
          resolve({
            s3Key,
            filename,
            reportId: report._id
          });
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

module.exports = {
  generateAssessmentReport,
  sendReportEmail
};