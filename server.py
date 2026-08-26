#!/usr/bin/env python3
"""
Jynx Web Relay Server & SQLite Database Engine
"""

import os
import sys
import time
import json
import base64
import sqlite3
import mimetypes
import smtplib
import socket
from email.message import EmailMessage
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

def load_dotenv(env_path):
    """Loads key-value pairs from a .env file into os.environ if present."""
    if not os.path.exists(env_path):
        return
    try:
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k = k.strip()
                v = v.strip().strip('"').strip("'")
                if k and k not in os.environ:
                    os.environ[k] = v
    except Exception as e:
        print(f"[JYNX ENV] Could not load .env: {e}")

load_dotenv(os.path.join(BASE_DIR, ".env"))

PORT = int(os.environ.get("PORT", 8099))
DB_FILE = os.path.join(BASE_DIR, "jynx_relay.db")

def get_smtp_credentials(client_config=None):
    """Extracts and resolves SMTP settings from client request or environment variables."""
    cfg = client_config or {}
    host = cfg.get("host") or os.environ.get("SMTP_HOST", "smtp.gmail.com")
    port = int(cfg.get("port") or os.environ.get("SMTP_PORT", 587))
    user = (cfg.get("user") or os.environ.get("SMTP_USER", "")).strip()
    password = (cfg.get("pass") or os.environ.get("SMTP_PASS", "")).strip()
    from_email = (cfg.get("from_email") or os.environ.get("SMTP_FROM", "")).strip() or user or "no-reply@jynx.dev"
    
    # Clean Gmail App Passwords (strip interstitial spaces if user copied "abcd efgh ijkl mnop")
    if "gmail.com" in host.lower() and password:
        password = password.replace(" ", "")

    return {
        "host": host,
        "port": port,
        "user": user,
        "pass": password,
        "from_email": from_email
    }

def dispatch_smtp_mail(to_email, subject, text_content, html_content, smtp_cfg):
    """Dispatches email via SMTP with full error handling and TLS/SSL support."""
    host = smtp_cfg["host"]
    port = smtp_cfg["port"]
    user = smtp_cfg["user"]
    password = smtp_cfg["pass"]
    from_email = smtp_cfg["from_email"]

    if not user or not password:
        raise ValueError(
            "SMTP credentials not configured. Please enter your Gmail address and 16-character App Password in Settings or .env file."
        )

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = from_email
    msg["To"] = to_email
    msg.set_content(text_content)
    if html_content:
        msg.add_alternative(html_content, subtype="html")

    try:
        if port == 465:
            with smtplib.SMTP_SSL(host, port, timeout=15) as server:
                server.login(user, password)
                server.send_message(msg)
        else:
            with smtplib.SMTP(host, port, timeout=15) as server:
                server.ehlo()
                server.starttls()
                server.ehlo()
                server.login(user, password)
                server.send_message(msg)
        return True
    except smtplib.SMTPAuthenticationError as e:
        raise ValueError(
            "Gmail/SMTP Authentication Error (535). Invalid username or password. "
            "For Gmail: Enable 2-Step Verification on your Google Account and generate a 16-character App Password at myaccount.google.com/apppasswords."
        ) from e
    except (smtplib.SMTPConnectError, socket.timeout, ConnectionRefusedError, OSError) as e:
        raise ValueError(f"Could not connect to SMTP server at {host}:{port}. Error: {str(e)}") from e
    except smtplib.SMTPException as e:
        raise ValueError(f"SMTP Protocol Error: {str(e)}") from e

class JynxDatabase:
    def __init__(self, db_path=DB_FILE):
        self.db_path = db_path
        self.init_db()

    def get_conn(self):
        conn = sqlite3.connect(self.db_path, timeout=10.0)
        conn.row_factory = sqlite3.Row
        return conn

    def init_db(self):
        with self.get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS rooms (
                    code TEXT PRIMARY KEY,
                    sender_id TEXT,
                    manifest TEXT,
                    verification TEXT,
                    payload BLOB,
                    mode TEXT,
                    created_at INTEGER,
                    expires_at INTEGER,
                    max_downloads INTEGER DEFAULT 10,
                    download_count INTEGER DEFAULT 0
                );
            """)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS telemetry (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_type TEXT,
                    bytes_transferred INTEGER,
                    timestamp INTEGER
                );
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_rooms_expires ON rooms(expires_at);
            """)
            conn.commit()

    def create_room(self, code, manifest, verification, payload_bytes, mode="files", ttl_seconds=86400, max_downloads=10):
        code = code.strip().lower()
        now = int(time.time())
        expires_at = now + ttl_seconds
        manifest_str = json.dumps(manifest) if isinstance(manifest, dict) else str(manifest)

        MAX_PAYLOAD_BYTES = 52428800 # 50 MB
        if payload_bytes and len(payload_bytes) > MAX_PAYLOAD_BYTES:
            raise ValueError("Payload exceeds maximum size limit of 50 MB.")

        with self.get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT OR REPLACE INTO rooms 
                (code, sender_id, manifest, verification, payload, mode, created_at, expires_at, max_downloads, download_count)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
            """, (code, "sender_" + str(now), manifest_str, verification, payload_bytes, mode, now, expires_at, max_downloads))
            cursor.execute("""
                INSERT INTO telemetry (event_type, bytes_transferred, timestamp)
                VALUES ('upload', ?, ?)
            """, (len(payload_bytes) if payload_bytes else 0, now))
            conn.commit()
        return True

    def get_room(self, code):
        code = code.strip().lower()
        now = int(time.time())
        with self.get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM rooms WHERE code = ? AND expires_at > ?", (code, now))
            row = cursor.fetchone()
            if not row or row["download_count"] >= row["max_downloads"]:
                return None
            return {
                "code": row["code"],
                "sender_id": row["sender_id"],
                "manifest": json.loads(row["manifest"]),
                "verification": row["verification"],
                "mode": row["mode"],
                "created_at": row["created_at"],
                "expires_at": row["expires_at"],
                "download_count": row["download_count"]
            }

    def get_payload(self, code):
        code = code.strip().lower()
        now = int(time.time())
        with self.get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM rooms WHERE code = ? AND expires_at > ?", (code, now))
            row = cursor.fetchone()
            if not row:
                return None

            new_count = row["download_count"] + 1
            cursor.execute("UPDATE rooms SET download_count = ? WHERE code = ?", (new_count, code))
            payload = row["payload"]
            cursor.execute("""
                INSERT INTO telemetry (event_type, bytes_transferred, timestamp)
                VALUES ('download', ?, ?)
            """, (len(payload) if payload else 0, now))
            conn.commit()

            if new_count >= row["max_downloads"]:
                cursor.execute("DELETE FROM rooms WHERE code = ?", (code,))
                conn.commit()
            return payload

    def get_stats(self):
        now = int(time.time())
        with self.get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) as active_rooms FROM rooms WHERE expires_at > ?", (now,))
            active_rooms = cursor.fetchone()["active_rooms"]
            cursor.execute("SELECT SUM(bytes_transferred) as total_bytes, COUNT(*) as total_transfers FROM telemetry")
            t_row = cursor.fetchone()
            return {
                "active_rooms": active_rooms,
                "total_bytes": t_row["total_bytes"] or 0,
                "total_transfers": t_row["total_transfers"] or 0,
                "database": "SQLite 3 (Persistent Relational Storage)",
                "uptime_seconds": int(time.time() - SERVER_START_TIME),
                "status": "ONLINE"
            }

db = JynxDatabase()
SERVER_START_TIME = time.time()

class JynxHandler(BaseHTTPRequestHandler):
    def send_cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_cors()
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        # 1. API: Stats
        if path == "/api/relay/stats":
            data = json.dumps(db.get_stats()).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.send_cors()
            self.end_headers()
            self.wfile.write(data)
            return

        # 2. API: Room Lookup
        if path.startswith("/api/relay/room/"):
            code = path.split("/api/relay/room/")[1].strip().lower()
            room = db.get_room(code)
            if room:
                data = json.dumps(room).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
            else:
                data = json.dumps({"error": "Room not found or expired"}).encode("utf-8")
                self.send_response(404)
            self.send_header("Content-Length", str(len(data)))
            self.send_cors()
            self.end_headers()
            self.wfile.write(data)
            return

        # 3. API: Payload Download
        if path.startswith("/api/relay/payload/"):
            code = path.split("/api/relay/payload/")[1].strip().lower()
            payload = db.get_payload(code)
            if payload:
                self.send_response(200)
                self.send_header("Content-Type", "application/octet-stream")
                self.send_header("Content-Length", str(len(payload)))
                self.send_cors()
                self.end_headers()
                self.wfile.write(payload)
            else:
                data = json.dumps({"error": "Payload not found"}).encode("utf-8")
                self.send_response(404)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.send_cors()
                self.end_headers()
                self.wfile.write(data)
            return

        # 4. Static Files
        clean_path = path.lstrip("/")
        if not clean_path:
            clean_path = "index.html"
        
        file_path = os.path.join(BASE_DIR, clean_path.replace("/", os.sep))
        if os.path.exists(file_path) and os.path.isfile(file_path):
            ctype, _ = mimetypes.guess_type(file_path)
            if not ctype:
                ctype = "application/octet-stream"
            with open(file_path, "rb") as f:
                content = f.read()
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(content)))
            self.send_cors()
            self.end_headers()
            self.wfile.write(content)
        else:
            self.send_response(404)
            self.send_header("Content-Type", "text/plain")
            self.send_cors()
            self.end_headers()
            self.wfile.write(b"404 Not Found")

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/relay/upload":
            content_length = int(self.headers.get("Content-Length", 0))
            if content_length == 0:
                self.send_response(400)
                self.send_cors()
                self.end_headers()
                self.wfile.write(b'{"error": "Empty payload"}')
                return

            body = self.rfile.read(content_length)
            try:
                data = json.loads(body.decode("utf-8"))
                code = data.get("code")
                manifest = data.get("manifest", {})
                verification = data.get("verification", "")
                mode = data.get("mode", "files")
                payload_b64 = data.get("payload_b64", "")
                ttl = int(data.get("ttl", 86400))
                max_downloads = int(data.get("max_downloads", 10))

                payload_bytes = base64.b64decode(payload_b64)

                db.create_room(
                    code=code,
                    manifest=manifest,
                    verification=verification,
                    payload_bytes=payload_bytes,
                    mode=mode,
                    ttl_seconds=ttl,
                    max_downloads=max_downloads
                )

                resp = json.dumps({
                    "status": "STORED",
                    "code": code,
                    "bytes": len(payload_bytes),
                    "database": "SQLite",
                    "expires_in": ttl
                }).encode("utf-8")

                self.send_response(201)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(resp)))
                self.send_cors()
                self.end_headers()
                self.wfile.write(resp)
            except Exception as e:
                resp = json.dumps({"error": str(e)}).encode("utf-8")
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(resp)))
                self.send_cors()
                self.end_headers()
                self.wfile.write(resp)
            return

        if path == "/api/test-smtp":
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length) if content_length > 0 else b"{}"
            try:
                data = json.loads(body.decode("utf-8")) if body else {}
                client_smtp = data.get("smtp_config")
                smtp_cfg = get_smtp_credentials(client_smtp)

                if not smtp_cfg["user"] or not smtp_cfg["pass"]:
                    raise ValueError(
                        "Please enter both a Sender Gmail/Email and an App Password."
                    )

                # Test connection and authentication
                host = smtp_cfg["host"]
                port = smtp_cfg["port"]
                user = smtp_cfg["user"]
                password = smtp_cfg["pass"]

                if port == 465:
                    with smtplib.SMTP_SSL(host, port, timeout=10) as server:
                        server.login(user, password)
                else:
                    with smtplib.SMTP(host, port, timeout=10) as server:
                        server.ehlo()
                        server.starttls()
                        server.ehlo()
                        server.login(user, password)

                resp = json.dumps({
                    "status": "SUCCESS",
                    "message": f"Successfully authenticated with {host}:{port} as {user}!"
                }).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(resp)))
                self.send_cors()
                self.end_headers()
                self.wfile.write(resp)
            except Exception as e:
                resp = json.dumps({"error": str(e)}).encode("utf-8")
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(resp)))
                self.send_cors()
                self.end_headers()
                self.wfile.write(resp)
            return

        if path == "/api/send-email":
            content_length = int(self.headers.get("Content-Length", 0))
            if content_length == 0:
                self.send_response(400)
                self.send_cors()
                self.end_headers()
                self.wfile.write(b'{"error": "Empty body"}')
                return

            body = self.rfile.read(content_length)
            try:
                data = json.loads(body.decode("utf-8"))
                to_email = data.get("to_email", "").strip()
                code = data.get("code", "").strip()
                share_url = data.get("share_url", "").strip()
                manifest = data.get("manifest", {})
                client_smtp = data.get("smtp_config")

                if not to_email or not code:
                    self.send_response(400)
                    self.send_cors()
                    self.end_headers()
                    self.wfile.write(b'{"error": "Missing recipient email or transfer code"}')
                    return

                smtp_cfg = get_smtp_credentials(client_smtp)

                # Determine file description
                if isinstance(manifest, dict) and manifest.get("type") == "files":
                    files_count = manifest.get("filesCount", 1)
                    total_size = manifest.get("totalSize", 0)
                    files_list = manifest.get("files", [])
                    file_names = ", ".join([f.get("name", "") for f in files_list[:3]])
                    if len(files_list) > 3:
                        file_names += f" and {len(files_list) - 3} more"
                    transfer_info = f"Files ({files_count} item{'s' if files_count > 1 else ''}): {file_names}"
                else:
                    transfer_info = "Confidential Encrypted Message"

                subject = f"Jynx Transfer Ready: [{code}]"

                text_content = (
                    f"Hello,\n\n"
                    f"You have received an end-to-end encrypted transfer via Jynx.\n\n"
                    f"Transfer Details: {transfer_info}\n"
                    f"Authentication Code: {code}\n"
                    f"Direct Access Link: {share_url}\n\n"
                    f"How to receive:\n"
                    f"1. Open Jynx (or click the direct access link above)\n"
                    f"2. Enter authentication code: {code}\n"
                    f"3. Decrypt and receive your files directly in your browser.\n\n"
                    f"Secured with PAKE AES-256-GCM zero-knowledge encryption.\n"
                )

                html_content = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #0c0e0c; color: #ffffff; padding: 24px; }}
    .card {{ max-width: 520px; margin: 0 auto; background: #151815; border: 1px solid #333d33; border-radius: 8px; overflow: hidden; }}
    .header {{ background: #1a1e1a; padding: 20px 24px; border-bottom: 1px solid #333d33; }}
    .header h1 {{ margin: 0; font-size: 20px; color: #50fa7b; font-family: monospace; letter-spacing: 0.05em; }}
    .body {{ padding: 24px; }}
    .code-box {{ background: #050605; border: 1px dashed #50fa7b; border-radius: 6px; padding: 16px; text-align: center; margin: 20px 0; }}
    .code-label {{ font-size: 11px; text-transform: uppercase; color: #889988; letter-spacing: 0.1em; margin-bottom: 6px; font-family: monospace; }}
    .code-val {{ font-size: 22px; font-weight: bold; color: #50fa7b; font-family: monospace; letter-spacing: 0.08em; }}
    .btn {{ display: block; text-align: center; background: #50fa7b; color: #050605; font-weight: bold; text-decoration: none; padding: 14px 20px; border-radius: 4px; font-family: monospace; font-size: 14px; margin-top: 24px; }}
    .footer {{ font-size: 11px; color: #778877; padding: 16px 24px; border-top: 1px solid #222c22; line-height: 1.5; }}
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>JYNX // SECURE TRANSFER</h1>
    </div>
    <div class="body">
      <p style="margin-top:0; font-size:14px; color:#cccccc;">You have received an end-to-end encrypted transfer.</p>
      <div style="font-size:13px; color:#aaaaaa; margin-bottom:12px;"><strong>Payload:</strong> {transfer_info}</div>
      <div class="code-box">
        <div class="code-label">Authentication Code Phrase</div>
        <div class="code-val">{code}</div>
      </div>
      <a href="{share_url}" class="btn">RECEIVE & DECRYPT TRANSFER &rarr;</a>
    </div>
    <div class="footer">
      Protected with PAKE AES-256-GCM zero-knowledge encryption. Only recipients with this code can decrypt the payload.
    </div>
  </div>
</body>
</html>"""

                dispatch_smtp_mail(to_email, subject, text_content, html_content, smtp_cfg)

                resp = json.dumps({
                    "status": "SENT",
                    "recipient": to_email,
                    "code": code,
                    "dispatch": "SMTP",
                    "sender": smtp_cfg["from_email"]
                }).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(resp)))
                self.send_cors()
                self.end_headers()
                self.wfile.write(resp)
            except Exception as e:
                resp = json.dumps({"error": str(e)}).encode("utf-8")
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(resp)))
                self.send_cors()
                self.end_headers()
                self.wfile.write(resp)
            return

        self.send_response(404)
        self.send_cors()
        self.end_headers()

def run_server():
    server_address = ("127.0.0.1", PORT)
    httpd = ThreadingHTTPServer(server_address, JynxHandler)
    print(f"[JYNX DATABASE RELAY] Running on http://127.0.0.1:{PORT}/ with SQLite storage...")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()

if __name__ == "__main__":
    run_server()
