import { setCorsHeaders } from "./relay/_redis.js";
import nodemailer from "nodemailer";

export default async function handler(req, res) {
  setCorsHeaders(req, res, "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { smtp_config } = req.body || {};
  const host = String(smtp_config?.host || process.env.SMTP_HOST || "smtp.gmail.com").trim();
  const port = Number(smtp_config?.port || process.env.SMTP_PORT || 587);
  const user = String(smtp_config?.user || process.env.SMTP_USER || "").trim();
  const pass = String(smtp_config?.pass || process.env.SMTP_PASS || "").replace(/\s/g, "");
  if (!user || !pass || !Number.isInteger(port) || port < 1 || port > 65535) {
    return res.status(400).json({ error: "Valid SMTP host, port, Gmail address, and App Password are required." });
  }

  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 30000
    });
    await transporter.verify();
    return res.status(200).json({
      status: "SUCCESS",
      message: `SMTP connection verified for ${user}`,
      sender: user
    });
  } catch (err) {
    console.error("[JYNX EMAIL] SMTP verification failed:", err);
    const detail = err?.responseCode === 535
      ? "Gmail rejected the credentials. Use a 16-character Google App Password, not your normal Gmail password."
      : `SMTP connection failed: ${err?.message || "check host, port, Gmail address, and App Password."}`;
    return res.status(502).json({ error: detail });
  }
}
