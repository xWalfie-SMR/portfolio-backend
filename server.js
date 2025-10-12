require("dotenv").config();
require("./logger");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));
const disposableDomains = require("disposable-email-domains");

const app = express();
const PORT = process.env.PORT || 3000;
const MODE = process.env.MODE || "SECURE";
const MAX_MESSAGE_LENGTH = 2000;
const RECAPTCHA_SECRET = process.env.RECAPTCHA_SECRET;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
let recaptchaEnabled = true;

// utils
const isDisposableEmail = (email) => {
  const domain = email.split("@")[1]?.toLowerCase();
  return disposableDomains.includes(domain);
};

const validateEmailFormat = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

// middleware
app.use(express.json());

if (MODE === "SECURE") {
  app.use(
    cors({
      origin: [
        "https://xwalfie-smr.github.io",
        "http://localhost:5500",
        "http://127.0.0.1:5500",
      ],
      credentials: true
    })
  );
  app.use(helmet());
  app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 50 }));
} else if (MODE === "LAB") {
  app.use(cors());
}

// health
app.get("/healthz", (req, res) => res.send("OK"));

// contact endpoint
app.post("/api/contact", async (req, res) => {
  const { name, email, message, recaptchaToken } = req.body;
  const ip = req.ip;

  if (!name || !email || !message || !recaptchaToken) {
    return res.status(400).json({ error: "Missing fields" });
  }

  if (!validateEmailFormat(email) || isDisposableEmail(email)) {
    return res.status(400).json({ error: "Invalid or disposable email" });
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    return res
      .status(400)
      .json({ error: `Message too long (max ${MAX_MESSAGE_LENGTH})` });
  }

  // verify recaptcha
  if (recaptchaEnabled && MODE === "SECURE") {
    console.log("=== Recaptcha Debug Start ===");
    console.log("Token received:", recaptchaToken);

    try {
      const recaptchaRes = await fetch(
        "https://www.google.com/recaptcha/api/siteverify",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `secret=${RECAPTCHA_SECRET}&response=${recaptchaToken}&remoteip=${ip}`,
        }
      );

      const recaptchaData = await recaptchaRes.json();
      console.log(
        "Recaptcha raw response:",
        JSON.stringify(recaptchaData, null, 2)
      );

      if (!recaptchaData.success) {
        console.error("Recaptcha failed:", recaptchaData["error-codes"]);
      }
    } catch (err) {
      console.error("Recaptcha fetch error:", err);
    }

    console.log("=== Recaptcha Debug End ===");
  } else if (MODE === "LAB") {
    console.warn("Recaptcha skipped in LAB mode");
  } else {
    console.warn("Recaptcha skipped (disabled)");
  }

  // fetch the AI model and rule from gists
  const fetchAIConfig = async () => {
    try {
      const [modelRes, ruleRes] = await Promise.all([
        fetch(
          "https://gist.githubusercontent.com/xWalfie-SMR/1327853aabcc09f0fee60df8e207a022/raw"
        ),
        fetch(
          "https://gist.githubusercontent.com/xWalfie-SMR/68705f0921756cd1d078c686f1e41eb6/raw"
        ),
      ]);

      const model = (await modelRes.text()).trim();
      const rule = (await ruleRes.text()).trim();

      return { model, rule };
    } catch (err) {
      console.error("Failed to fetch AI config:", err);
      return null;
    }
  };

  // run AI check
  const aiConfig = await fetchAIConfig();
  if (!aiConfig)
    return res.status(500).json({ error: "Failed to load AI config" });

  try {
    const aiRes = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: aiConfig.model,
          messages: [
            { role: "system", content: aiConfig.rule },
            { role: "user", content: JSON.stringify({ name, email, message }) },
          ],
        }),
      }
    );

    const aiData = await aiRes.json();
    console.log("AI Filter Response:", aiData);

    let aiAnswer;
    try {
      let content = aiData.choices?.[0]?.message?.content?.trim() || "{}";
      content = content.replace(/^```json\s*|```$/g, "").trim();
      aiAnswer = JSON.parse(content);
    } catch (err) {
      console.error("Failed to parse AI JSON:", err, aiData);
      return res.status(500).json({ error: "AI validation failed" });
    }

    console.log(`AI decision: ${aiAnswer.decision}`, { name, email, message, reason: aiAnswer.reason });

    // unified JSON response
    const jsonResponse = {
      aiDecision: aiAnswer.decision,
      aiReason: aiAnswer.reason,
      success: aiAnswer.decision === "ALLOW",
      emailSent: false,
    };

    // only send email if allowed
    if (aiAnswer.decision === "ALLOW") {
      try {
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          },
          body: JSON.stringify({
            from: "Portfolio Contact <onboarding@resend.dev>",
            to: process.env.EMAIL_TO,
            subject: `New message from ${name}`,
            html: `<p><strong>Name:</strong> ${name}</p>
                   <p><strong>Email:</strong> ${email}</p>
                   <p><strong>Message:</strong> ${message}</p>
                   <hr><p>Sent from portfolio.</p>`,
          }),
        });

        const data = await response.json();
        if (!response.ok) {
          console.error("Resend API error:", data);
          jsonResponse.success = false;
          jsonResponse.emailSent = false;
        } else {
          jsonResponse.emailSent = true;
        }
      } catch (err) {
        console.error("Resend send error:", err);
        jsonResponse.success = false;
      }
    }

    // send unified response
    return res.json(jsonResponse);

  } catch (err) {
    console.error("AI filter error:", err);
    return res.status(500).json({ error: "AI filter failed" });
  }
});

// toggle recaptcha endpoint
app.post("/api/toggle-recaptcha", (req, res) => {
  recaptchaEnabled = !recaptchaEnabled;
  res.json({ recaptchaEnabled });
});

// start server
app.listen(PORT, () =>
  console.log(`Server running on port ${PORT}, MODE=${MODE}`)
);