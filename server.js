
require("dotenv").config();

const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

app.use(express.json());

app.get("/", (req, res) => {
  res.send("Chowoncampus server is running!");
});

// Meta uses this endpoint to verify your webhook.
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (
    mode === "subscribe" &&
    VERIFY_TOKEN &&
    token === VERIFY_TOKEN
  ) {
    console.log("WhatsApp webhook verified!");
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

// Meta sends incoming messages and delivery-status events here.
app.post("/webhook", (req, res) => {
  // Acknowledge promptly so Meta does not keep retrying.
  res.sendStatus(200);

  const body = req.body;

  if (body.object !== "whatsapp_business_account") {
    console.log("Received a non-WhatsApp webhook event.");
    return;
  }

  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};

      for (const message of value.messages || []) {
        console.log("\nNew WhatsApp message received!");
        console.log("Sender:", message.from);
        console.log("Message type:", message.type);

        if (message.type === "text") {
          console.log("Message:", message.text?.body);
        }
      }

      for (const status of value.statuses || []) {
        console.log(
          "Message status:",
          status.status,
          "| ID:",
          status.id
        );
      }
    }
  }
});

app.listen(PORT, () => {
  console.log(`Chowoncampus server running on port ${PORT}`);
});
