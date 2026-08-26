// Vercel Serverless Function: POST /api/send-email
import nodemailer from "nodemailer";
import { setCorsHeaders } from "./relay/_redis.js";

export default async function handler(req, res) {
  setCorsHeaders(req, res, "POST, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { to_email, code, share_url } = req.body || {};

    if (!to_email || !code) {
      return res.status(400).json({ error: "Missing recipient email or code" });
    }

    const user = process.env.SMTP_USER || process.env.GMAIL_USER || "";
    const pass = process.env.SMTP_PASS || process.env.GMAIL_PASS || "";
    const host = process.env.SMTP_HOST || "smtp.gmail.com";
    const port = parseInt(process.env.SMTP_PORT || "587", 10);

    if (!user || !pass) {
      console.log(`[JYNX EMAIL MOCK] Sent transfer code '${code}' to ${to_email}`);
      return res.status(200).json({
        status: "SENT",
        recipient: to_email,
        dispatch: "MOCK_DISPATCH",
        note: "No SMTP_USER / SMTP_PASS configured in Vercel environment variables."
      });
    }

    const transporter = nodemailer.createTransport({
      host: host,
      port: port,
      secure: port === 465,
      auth: {
        user: user,
        pass: pass
      }
    });

    const info = await transporter.sendMail({
      from: `"Jynx Transfer" <${user}>`,
      to: to_email,
      subject: `Jynx Transfer Code: ${code}`,
      text: `Hello,\n\nYou have received a file/message transfer via Jynx.\n\nAuthentication Code: ${code}\nDirect Link: ${share_url || ""}\n\nEnter this code on Jynx (or click the direct link) to decrypt and receive your transfer.`,
      html: `
        <div style="font-family: monospace; padding: 20px; background: #121411; color: #ffffff; border: 1px solid #50fa7b;">
          <h2 style="color: #50fa7b; margin-top: 0;">Jynx Encrypted Transfer</h2>
          <p>You have received a secure file/message transfer.</p>
          <div style="background: #050605; border: 1px solid #4b4b4b; padding: 12px; margin: 16px 0;">
            <p style="margin: 0; font-size: 11px; color: #a4a4a4;">AUTHENTICATION CODE PHRASE:</p>
            <p style="margin: 6px 0 0 0; font-size: 18px; font-weight: bold; color: #50fa7b;">${code}</p>
          </div>
          ${share_url ? `<p><a href="${share_url}" style="color: #50fa7b;">Click here to open and decrypt transfer</a></p>` : ""}
          <p style="font-size: 11px; color: #a4a4a4; margin-bottom: 0;">End-to-End Encrypted via Jynx PAKE</p>
        </div>
      `
    });

    console.log(`[JYNX EMAIL] Message sent to ${to_email}: ${info.messageId}`);

    return res.status(200).json({
      status: "SENT",
      recipient: to_email,
      dispatch: "SMTP",
      messageId: info.messageId
    });
  } catch (err) {
    console.error("[JYNX EMAIL ERROR]", err);
    return res.status(500).json({ error: err.message });
  }
}
