// Vercel Serverless Function: POST /api/send-email
import { setCorsHeaders } from "./relay/_redis.js";
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

    if (!to_email || !code) {
      return res.status(400).json({ error: "Missing recipient email or transfer code" });
    }

    const host = smtp_config?.host || process.env.SMTP_HOST || "smtp.gmail.com";
    const port = smtp_config?.port || process.env.SMTP_PORT || 587;
    const user = smtp_config?.user || process.env.SMTP_USER || "";
    const pass = smtp_config?.pass || process.env.SMTP_PASS || "";

    if (!user || !pass) {
      return res.status(400).json({
        error: "SMTP credentials not configured. Please enter your Gmail address and 16-character App Password in Settings or environment variables."
      });
    }

    const transporter = nodemailer.createTransport({
      host,
      port: Number(port),
      secure: Number(port) === 465,
      auth: { user, pass }
    });
    const fileDescription = manifest?.type === "files"
      ? `${manifest.filesCount || 1} encrypted file(s)`
      : "Encrypted confidential message";
    await transporter.sendMail({
      from: user,
      to: to_email,
      subject: `Jynx Transfer Ready: [${code}]`,
      text: [
        "Your encrypted Jynx transfer is ready.",
        "",
        `Transfer code: ${code}`,
        `Payload: ${fileDescription}`,
        share_url ? `Open Jynx: ${share_url}` : ""
      ].filter(Boolean).join("\n")
    });
    console.log(`[JYNX EMAIL] Sent transfer code ${code} to ${to_email} via ${host}:${port}`);

    return res.status(200).json({
      status: "SENT",
      recipient: to_email,
      code: code,
      dispatch: "SMTP",
      sender: user
    });
  } catch (err) {
    console.error("[JYNX EMAIL] Error:", err);
    return res.status(500).json({ error: err.message });
  }
}
