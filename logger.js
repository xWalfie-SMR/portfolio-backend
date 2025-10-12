const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const URL = process.env.PAPERTRAIL_URL;
const TOKEN = process.env.PAPERTRAIL_TOKEN;

async function sendLog(message, level = "info") {
  try {
    await fetch(URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${TOKEN}`,
      },
      body: JSON.stringify([{
        timestamp: new Date().toISOString(),
        message,
        level
      }])
    });
  } catch (err) {
    console.error("Failed to send log:", err);
  }
}

// hook console
["log", "warn", "error"].forEach(level => {
  const original = console[level];
  console[level] = (...args) => {
    original(...args);
    sendLog(args.join(" "), level);
  };
});

module.exports = sendLog;