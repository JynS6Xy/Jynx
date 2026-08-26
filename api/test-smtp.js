import { setCorsHeaders } from "./relay/_redis.js";
import nodemailer from "nodemailer";

export default async function handler(req, res) {
  setCorsHeaders(req, res, "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { smtp_config } = req.body || {};
  const host = smtp_config?.host || process.env.SMTP_HOST || "smtp.gmail.com";
  const port = Number(smtp_config?.port || process.env.SMTP_PORT || 587);
  const user = smtp_config?.user || process.env.SMTP_USER || "";
  const pass = smtp_config?.pass || process.env.SMTP_PASS || "";
  if (!user || !pass) return res.status(400).json({ error: "SMTP credentials are required" });

  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass }
    });
    await transporter.verify();
    return res.status(200).json({ status: "READY", sender: user });
  } catch (err) {
    console.error("[JYNX EMAIL] SMTP verification failed:", err);
    return res.status(502).json({ error: "SMTP connection failed. Check the host, port, Gmail address, and App Password." });
  }
}
