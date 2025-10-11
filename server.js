require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;
const MODE = process.env.MODE || 'SECURE';

// utils
const validateEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const MAX_MESSAGE_LENGTH = 2000;

app.use(express.json());

// dual security toggle
if (MODE === 'SECURE') {
  console.log('Running in SECURE mode');
  app.use(cors({ origin: ['https://xwalfie-smr.github.io', 'http://localhost:5500'] })); // allow local dev
  app.use(helmet());
  app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));
} else if (MODE === 'LAB') {
  console.log('Running in LAB (vulnerable) mode');
  app.use(cors());
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

  if (!validateEmail(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: `Message too long (max ${MAX_MESSAGE_LENGTH} chars)` });
  }

  console.log(`New message:`, { name, email, message });

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from: 'Portfolio Contact <onboarding@resend.dev>',
        to: process.env.EMAIL_TO,
        subject: `New message from ${name}`,
        html: `
          <p><strong>Name:</strong> ${name}</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Message:</strong> ${message}</p>
          <hr>
          <p>This message was sent from your portfolio.</p>
        `
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Resend API error:', data);
      return res.status(500).json({ error: 'Failed to send email via Resend' });
    }

    return res.json({ success: true, emailSent: true });
  } catch (error) {
    console.error('Error sending email via Resend:', error);
    return res.status(500).json({ error: 'Resend API request failed' });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}, MODE=${MODE}`));