require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;
const MODE = process.env.MODE || 'SECURE';

app.use(express.json());

// dual security toggle
if (MODE === 'SECURE') {
  console.log('Running in SECURE mode');
  app.use(cors({ origin: 'https://xwalfie-smr.github.io' })); // restrict CORS
  app.use(helmet()); // secure headers
  app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 })); // limit requests
} else if (MODE === 'LAB') {
  console.log('Running in LAB (vulnerable) mode');
  app.use(cors()); // allow all origins
  // no helmet
  // no rate limit
} else {
  console.log(`Running in UNKNOWN mode: ${MODE}`);
}

// health check route
app.get('/healthz', (req, res) => res.send('OK'));

app.post('/api/contact', async (req, res) => {
  const { name, email, message } = req.body;

  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  console.log(`📩 New message:`, { name, email, message });

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    await transporter.sendMail({
      from: `"Portfolio Contact" <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_TO,
      subject: `New message from ${name}`,
      text: `
        Name: ${name}
        Email: ${email}
        Message: ${message}`
    });

    return res.json({ success: true, emailSent: true });
  } catch (error) {
    console.error('Error sending email:', error);
    return res.status(500).json({ error: 'Failed to send email' });
  }
});


app.listen(PORT, () => console.log(`Server running on port ${PORT}, MODE=${MODE}`));
