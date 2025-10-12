require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const disposableDomains = require('disposable-email-domains');

const app = express();
const PORT = process.env.PORT || 3000;
const MODE = process.env.MODE || 'SECURE';
const MAX_MESSAGE_LENGTH = 2000;
const RECAPTCHA_SECRET = process.env.RECAPTCHA_SECRET;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// utils
const isDisposableEmail = (email) => {
  const domain = email.split('@')[1]?.toLowerCase();
  return disposableDomains.includes(domain);
};

const validateEmailFormat = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

// middleware
app.use(express.json());

if (MODE === 'SECURE') {
  app.use(cors({ origin: ['https://xwalfie-smr.github.io', 'http://localhost:5500'] }));
  app.use(helmet());
  app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 50 }));
} else if (MODE === 'LAB') {
  app.use(cors());
}

// health
app.get('/healthz', (req, res) => res.send('OK'));

// contact endpoint
app.post('/api/contact', async (req, res) => {
  const { name, email, message, recaptchaToken } = req.body;
  const ip = req.ip;

  if (!name || !email || !message || !recaptchaToken) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  if (!validateEmailFormat(email) || isDisposableEmail(email)) {
    return res.status(400).json({ error: 'Invalid or disposable email' });
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: `Message too long (max ${MAX_MESSAGE_LENGTH})` });
  }

  // verify recaptcha
  try {
    const recaptchaRes = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `secret=${RECAPTCHA_SECRET}&response=${recaptchaToken}&remoteip=${ip}`
    });
    const recaptchaData = await recaptchaRes.json();
    if (!recaptchaData.success || recaptchaData.score < 0.5) {
      return res.status(400).json({ error: 'Failed recaptcha verification' });
    }
  } catch (err) {
    console.error('Recaptcha error:', err);
    return res.status(500).json({ error: 'Recaptcha verification failed' });
  }

  // run AI check
  try {
    const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content: 'You are an email filter AI. Respond ONLY with "ALLOW" or "DENY". Deny if the message looks like spam, gibberish, or test content.'
          },
          {
            role: 'user',
            content: JSON.stringify({ name, email, message })
          }
        ],
        temperature: 0
      })
    });

    const aiData = await aiRes.json();
    const aiReply = aiData.choices?.[0]?.message?.content?.trim().toUpperCase();

    if (aiReply !== 'ALLOW') {
      console.log('AI DENIED message:', { name, email, message });
      return res.status(422).json({ error: 'Message rejected by AI filter' });
    }
  } catch (err) {
    console.error('AI validation error:', err);
    return res.status(500).json({ error: 'AI validation failed' });
  }

  // send email via Resend
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
        html: `<p><strong>Name:</strong> ${name}</p>
               <p><strong>Email:</strong> ${email}</p>
               <p><strong>Message:</strong> ${message}</p>
               <hr><p>Sent from portfolio.</p>`
      })
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('Resend API error:', data);
      return res.status(500).json({ error: 'Failed to send email' });
    }

    return res.json({ success: true, emailSent: true });
  } catch (err) {
    console.error('Resend send error:', err);
    return res.status(500).json({ error: 'Email send failed' });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}, MODE=${MODE}`));