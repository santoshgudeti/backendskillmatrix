
require('dotenv').config(); // 👈 ensure environment vars are loaded
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: true, // use TLS
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  tls: {
    rejectUnauthorized: false
  }
});
const sendConsentEmail = async (email, apiResponseId) => {
  const link = `${process.env.BACKEND_URL}/api/consent/${apiResponseId}?allow=true`;

  const mailOptions = {
    from: `"SkillMatrix AI" <${process.env.SMTP_USER}>`,
    to: email,
    subject: "1-Click Consent to Share Your Profile",
    html: `
  <div style="font-family: Arial, sans-serif; max-width: 600px; color: #333;">
    <h2 style="color: #4f46e5;">Hi there!</h2>

    <p>
      We’re excited to let you know that your resume has been matched with a potential job opportunity on our <strong>SkillMatrix AI</strong> platform.
    </p>

    <p>
      With your permission, we would like to share your profile with hiring teams and recruiters across trusted partner platforms. By allowing access to your profile, you'll significantly increase your chances of being discovered for job openings aligned with your skills and experience.
    </p>

    <p>
      We value your privacy. Your profile will <strong>only be shared if you provide your consent</strong>. If you’re open to being considered for more opportunities, please click the button below:
    </p>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${link}" style="padding: 12px 25px; background: #4f46e5; color: white; text-decoration: none; border-radius: 8px; font-size: 16px;">
        ✅ Yes, I Consent to Share My Profile
      </a>
    </div>

    <p>
      If you did not submit your resume to our platform or wish not to share it, you can safely ignore this email — no action is needed.
    </p>

    <p style="margin-top: 30px;">Thank you,<br/><strong>SkillMatrix AI Team</strong></p>
  </div>
`

  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`📧 Consent email sent to: ${email}`);
  } catch (error) {
    console.error(`❌ Failed to send consent email to ${email}:`, error.message);
  }
};



module.exports = sendConsentEmail;
