// Vercel Serverless Function: POST /api/send-email
import { redis, rateLimitKey, setCorsHeaders } from "./relay/_redis.js";
import nodemailer from "nodemailer";

export default async function handler(req, res) {
  setCorsHeaders(req, res, "POST, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { to_email, code, share_url, manifest, smtp_config } = req.body || {};
    const recipient = String(to_email || "").trim().toLowerCase();
    const clientIp = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
      .split(",")[0].trim().slice(0, 100);

    if (!recipient || !code) {
      return res.status(400).json({ error: "Missing recipient email or transfer code" });
    }
    if (recipient.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(recipient)) {
      return res.status(400).json({ error: "Enter a valid recipient email address." });
    }

    const [ipCount, recipientCount] = await Promise.all([
      redis.incr(rateLimitKey("ip", clientIp)),
      redis.incr(rateLimitKey("recipient", recipient))
    ]);
    if (ipCount === 1) await redis.expire(rateLimitKey("ip", clientIp), 600);
    if (recipientCount === 1) await redis.expire(rateLimitKey("recipient", recipient), 600);
    if (ipCount > 10 || recipientCount > 3) {
      return res.status(429).json({
        error: "Email notification limit reached. Please wait 10 minutes before trying again."
      });
    }

    const host = String(smtp_config?.host || process.env.SMTP_HOST || "smtp.gmail.com").trim();
    const port = Number(smtp_config?.port || process.env.SMTP_PORT || 587);
    const user = String(smtp_config?.user || process.env.SMTP_USER || "").trim();
    const pass = String(smtp_config?.pass || process.env.SMTP_PASS || "").replace(/\s/g, "");
    const configuredFrom = String(process.env.SMTP_FROM || "").trim();
    const fromAddress = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(configuredFrom) ? configuredFrom : user;
    const fromName = process.env.SMTP_FROM_NAME || "Jynx";

    if (!user || !pass || !Number.isInteger(port) || port < 1 || port > 65535) {
      return res.status(400).json({
        error: "SMTP credentials not configured. Please enter your Gmail address and 16-character App Password in Settings or environment variables."
      });
    }

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 30000
    });
    const fileDescription = manifest?.type === "files"
      ? `${manifest.filesCount || 1} encrypted file(s)`
      : "Encrypted confidential message";
    await transporter.sendMail({
      from: { name: fromName, address: fromAddress },
      to: recipient,
      subject: `Jynx Transfer Ready: [${code}]`,
      text: [
        "Your encrypted Jynx transfer is ready.",
        "",
        `Transfer code: ${code}`,
        `Payload: ${fileDescription}`,
        share_url ? `Open Jynx: ${share_url}` : ""
      ].filter(Boolean).join("\n")
    });
    console.log(`[JYNX EMAIL] Sent transfer code ${code} to ${recipient} via ${host}:${port}`);

    return res.status(200).json({
      status: "SENT",
      recipient,
      code: code,
      dispatch: "SMTP",
      sender: user
    });
  } catch (err) {
    console.error("[JYNX EMAIL] Error:", err);
    return res.status(500).json({ error: err.message });
  }
}
