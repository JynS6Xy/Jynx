#!/usr/bin/env python3
"""
Jynx Web Relay Server & SQLite Database Engine
"""

import os
import sys
import time
import json
import base64
import socket
import sqlite3
import mimetypes
import smtplib
import ssl
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse

HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", 8099))
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_FILE = os.environ.get("DB_PATH", os.path.join(BASE_DIR, "jynx_relay.db"))
PAYLOADS_DIR = os.environ.get("PAYLOADS_DIR", os.path.join(os.path.dirname(DB_FILE), "payloads"))

os.makedirs(os.path.dirname(DB_FILE) if os.path.dirname(DB_FILE) else ".", exist_ok=True)
os.makedirs(PAYLOADS_DIR, exist_ok=True)

# Gmail SMTP Configuration via Environment Variables
SMTP_HOST = os.environ.get("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.environ.get("SMTP_PORT", 587))
SMTP_EMAIL = os.environ.get("SMTP_EMAIL", "jynx.6069@gmail.com")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "bcwm cyke njdu fvku")


class GmailSMTPSender:
    """Utility class to send transfer codes and download links via Gmail SMTP."""
    def __init__(self, host=SMTP_HOST, port=SMTP_PORT, email=SMTP_EMAIL, password=SMTP_PASSWORD):
        self.host = host
        self.port = port
        self.email = email
        self.password = password

    def is_configured(self):
        return bool(self.email and self.password)

    def send_transfer_email(self, recipient_email, code, note="", download_link=""):
        if not self.is_configured():
            return False, "SMTP is not configured. Please set SMTP_EMAIL and SMTP_PASSWORD environment variables."

        try:
            msg = MIMEMultipart("alternative")
            msg["Subject"] = f"🔑 Secure Jynx File Transfer Code: {code}"
            msg["From"] = f"Jynx Relay <{self.email}>"
            msg["To"] = recipient_email

            link_html = f'<p><a href="{download_link}" style="display:inline-block; padding:10px 20px; background:#00e5ff; color:#000; text-decoration:none; font-weight:bold; border-radius:4px;">Retrieve Transfer</a></p>' if download_link else ""
            note_html = f'<p><strong>Note:</strong> {note}</p>' if note else ""

            text_content = f"You received a secure file transfer code on Jynx:\n\nCode: {code}\n{f'Note: {note}' if note else ''}\n{f'Link: {download_link}' if download_link else ''}"
            
            html_content = f"""
            <html>
              <body style="font-family: Arial, sans-serif; background-color: #0b0f19; color: #e2e8f0; padding: 20px;">
                <div style="max-width: 500px; margin: 0 auto; background: #161e2e; border: 1px solid #2a364f; border-radius: 8px; padding: 24px;">
                  <h2 style="color: #00e5ff; margin-top: 0;">⚡ Jynx Secure Transfer</h2>
                  <p>Someone has shared an end-to-end encrypted transfer code with you:</p>
                  <div style="background: #0b0f19; border: 1px solid #00e5ff; padding: 12px; font-family: monospace; font-size: 20px; font-weight: bold; text-align: center; color: #00e5ff; letter-spacing: 2px; margin: 16px 0;">
                    {code}
                  </div>
                  {note_html}
                  {link_html}
                  <hr style="border: 0; border-top: 1px solid #2a364f; margin: 20px 0;">
                  <small style="color: #64748b;">This transfer is end-to-end encrypted using SPAKE2 & AES-256-GCM.</small>
                </div>
              </body>
            </html>
            """

            msg.attach(MIMEText(text_content, "plain"))
            msg.attach(MIMEText(html_content, "html"))

            context = ssl.create_default_context()
            with smtplib.SMTP(self.host, self.port) as server:
                server.starttls(context=context)
                server.login(self.email, self.password)
                server.sendmail(self.email, recipient_email, msg.as_string())

            return True, "Email sent successfully"
        except Exception as e:
            return False, f"Failed to send email: {str(e)}"


smtp_sender = GmailSMTPSender()

def get_lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

class JynxDatabase:
    """
    Hybrid Database Engine:
    SQLite manages room codes, metadata, verification, and TTL indexes.
    Large payloads (up to 1GB+) are stored as streamed binaries on disk to conserve RAM.
    """
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
                    payload_path TEXT,
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
            cursor.execute("PRAGMA table_info(rooms)")
            columns = [col["name"] for col in cursor.fetchall()]
            if "payload_path" not in columns:
                cursor.execute("ALTER TABLE rooms ADD COLUMN payload_path TEXT")
            conn.commit()

    def create_room(self, code, manifest, verification, payload_bytes, mode="files", ttl_seconds=86400, max_downloads=10):
        code = code.strip().lower()
        now = int(time.time())
        expires_at = now + ttl_seconds
        manifest_str = json.dumps(manifest) if isinstance(manifest, dict) else str(manifest)

        file_path = os.path.join(PAYLOADS_DIR, f"{code}.bin")
        with open(file_path, "wb") as f:
            f.write(payload_bytes)

        payload_size = len(payload_bytes)

        with self.get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT OR REPLACE INTO rooms 
                (code, sender_id, manifest, verification, payload, payload_path, mode, created_at, expires_at, max_downloads, download_count)
                VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 0)
            """, (code, "sender_" + str(now), manifest_str, verification, file_path, mode, now, expires_at, max_downloads))
            cursor.execute("""
                INSERT INTO telemetry (event_type, bytes_transferred, timestamp)
                VALUES ('upload', ?, ?)
            """, (payload_size, now))
            conn.commit()
        return True

    def append_chunk_room(self, code, manifest, verification, chunk_bytes, is_first=False, is_last=False, mode="files", ttl_seconds=86400, max_downloads=10):
        code = code.strip().lower()
        now = int(time.time())
        expires_at = now + ttl_seconds
        manifest_str = json.dumps(manifest) if isinstance(manifest, dict) else str(manifest)

        file_path = os.path.join(PAYLOADS_DIR, f"{code}.bin")
        file_mode = "wb" if is_first else "ab"
        with open(file_path, file_mode) as f:
            f.write(chunk_bytes)

        chunk_size = len(chunk_bytes)

        with self.get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT OR REPLACE INTO rooms 
                (code, sender_id, manifest, verification, payload, payload_path, mode, created_at, expires_at, max_downloads, download_count)
                VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 0)
            """, (code, "sender_" + str(now), manifest_str, verification, file_path, mode, now, expires_at, max_downloads))
            cursor.execute("""
                INSERT INTO telemetry (event_type, bytes_transferred, timestamp)
                VALUES ('upload', ?, ?)
            """, (chunk_size, now))
            conn.commit()
        return True

    def get_room(self, code):
        code = code.strip().lower()
        now = int(time.time())
        self.cleanup_expired()
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

    def get_payload_file_or_bytes(self, code):
        """Returns tuple (file_path, raw_bytes, size) for chunked HTTP streaming."""
        code = code.strip().lower()
        now = int(time.time())
        with self.get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM rooms WHERE code = ? AND expires_at > ?", (code, now))
            row = cursor.fetchone()
            if not row:
                return None, None, 0

            new_count = row["download_count"] + 1
            cursor.execute("UPDATE rooms SET download_count = ? WHERE code = ?", (new_count, code))

            row_keys = row.keys()
            payload_path = row["payload_path"] if "payload_path" in row_keys else None
            payload_blob = row["payload"]
            size = 0

            if payload_path and os.path.exists(payload_path):
                size = os.path.getsize(payload_path)
            elif payload_blob:
                size = len(payload_blob)

            cursor.execute("""
                INSERT INTO telemetry (event_type, bytes_transferred, timestamp)
                VALUES ('download', ?, ?)
            """, (size, now))
            conn.commit()

            # If max downloads reached, queue cleanup
            if new_count >= row["max_downloads"]:
                cursor.execute("DELETE FROM rooms WHERE code = ?", (code,))
                conn.commit()
                if payload_path and os.path.exists(payload_path):
                    try:
                        os.remove(payload_path)
                    except OSError:
                        pass

            return payload_path, payload_blob, size

    def cleanup_expired(self):
        """Remove expired room entries and associated disk files."""
        now = int(time.time())
        with self.get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT code, payload_path FROM rooms WHERE expires_at <= ?", (now,))
            expired_rows = cursor.fetchall()
            for r in expired_rows:
                r_keys = r.keys()
                p_path = r["payload_path"] if "payload_path" in r_keys else None
                if p_path and os.path.exists(p_path):
                    try:
                        os.remove(p_path)
                    except OSError:
                        pass
            cursor.execute("DELETE FROM rooms WHERE expires_at <= ?", (now,))
            conn.commit()

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
                "database": "SQLite 3 + Hybrid Disk Storage (1GB+ Stream Optimized)",
                "smtp_status": "CONFIGURED" if smtp_sender.is_configured() else "NOT_CONFIGURED",
                "uptime_seconds": int(time.time() - SERVER_START_TIME),
                "lan_ip": get_lan_ip(),
                "status": "ONLINE"
            }
# PostgreSQL Configuration via Environment Variables
POSTGRES_URL = os.environ.get("POSTGRES_URL") or os.environ.get("DATABASE_URL")
POSTGRES_HOST = os.environ.get("POSTGRES_HOST", "localhost")
POSTGRES_PORT = int(os.environ.get("POSTGRES_PORT", 5432))
POSTGRES_DB = os.environ.get("POSTGRES_DB", "jynx_db")
POSTGRES_USER = os.environ.get("POSTGRES_USER", "postgres")
POSTGRES_PASSWORD = os.environ.get("POSTGRES_PASSWORD", "postgres")


class JynxPostgresDatabase:
    """
    PostgreSQL Storage Engine for high performance & scalability.
    Room metadata & indexing is managed in Postgres, with streamed disk payload storage for 1GB+ cap.
    """
    def __init__(self, dsn=None):
        import psycopg2
        import psycopg2.extras
        self.psycopg2 = psycopg2
        self.extras = psycopg2.extras
        self.dsn = dsn or POSTGRES_URL
        self.init_db()

    def get_conn(self):
        if self.dsn:
            return self.psycopg2.connect(self.dsn)
        return self.psycopg2.connect(
            host=POSTGRES_HOST,
            port=POSTGRES_PORT,
            dbname=POSTGRES_DB,
            user=POSTGRES_USER,
            password=POSTGRES_PASSWORD
        )

    def init_db(self):
        with self.get_conn() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS rooms (
                        code VARCHAR(128) PRIMARY KEY,
                        sender_id VARCHAR(128),
                        manifest TEXT,
                        verification TEXT,
                        payload BYTEA,
                        payload_path TEXT,
                        mode VARCHAR(64),
                        created_at BIGINT,
                        expires_at BIGINT,
                        max_downloads INTEGER DEFAULT 10,
                        download_count INTEGER DEFAULT 0
                    );
                """)
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS telemetry (
                        id SERIAL PRIMARY KEY,
                        event_type VARCHAR(64),
                        bytes_transferred BIGINT,
                        timestamp BIGINT
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

        file_path = os.path.join(PAYLOADS_DIR, f"{code}.bin")
        with open(file_path, "wb") as f:
            f.write(payload_bytes)

        payload_size = len(payload_bytes)

        with self.get_conn() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    INSERT INTO rooms 
                    (code, sender_id, manifest, verification, payload, payload_path, mode, created_at, expires_at, max_downloads, download_count)
                    VALUES (%s, %s, %s, %s, NULL, %s, %s, %s, %s, %s, 0)
                    ON CONFLICT (code) DO UPDATE SET
                        sender_id = EXCLUDED.sender_id,
                        manifest = EXCLUDED.manifest,
                        verification = EXCLUDED.verification,
                        payload_path = EXCLUDED.payload_path,
                        mode = EXCLUDED.mode,
                        created_at = EXCLUDED.created_at,
                        expires_at = EXCLUDED.expires_at,
                        max_downloads = EXCLUDED.max_downloads,
                        download_count = 0;
                """, (code, "sender_" + str(now), manifest_str, verification, file_path, mode, now, expires_at, max_downloads))
                cursor.execute("""
                    INSERT INTO telemetry (event_type, bytes_transferred, timestamp)
                    VALUES ('upload', %s, %s)
                """, (payload_size, now))
                conn.commit()
        return True

    def get_room(self, code):
        code = code.strip().lower()
        now = int(time.time())
        self.cleanup_expired()
        with self.get_conn() as conn:
            with conn.cursor(cursor_factory=self.extras.RealDictCursor) as cursor:
                cursor.execute("SELECT * FROM rooms WHERE code = %s AND expires_at > %s", (code, now))
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

    def get_payload_file_or_bytes(self, code):
        code = code.strip().lower()
        now = int(time.time())
        with self.get_conn() as conn:
            with conn.cursor(cursor_factory=self.extras.RealDictCursor) as cursor:
                cursor.execute("SELECT * FROM rooms WHERE code = %s AND expires_at > %s", (code, now))
                row = cursor.fetchone()
                if not row:
                    return None, None, 0

                new_count = row["download_count"] + 1
                cursor.execute("UPDATE rooms SET download_count = %s WHERE code = %s", (new_count, code))

                payload_path = row.get("payload_path")
                payload_blob = row.get("payload")
                size = 0

                if payload_path and os.path.exists(payload_path):
                    size = os.path.getsize(payload_path)
                elif payload_blob:
                    size = len(payload_blob)

                cursor.execute("""
                    INSERT INTO telemetry (event_type, bytes_transferred, timestamp)
                    VALUES ('download', %s, %s)
                """, (size, now))
                conn.commit()

                if new_count >= row["max_downloads"]:
                    cursor.execute("DELETE FROM rooms WHERE code = %s", (code,))
                    conn.commit()
                    if payload_path and os.path.exists(payload_path):
                        try:
                            os.remove(payload_path)
                        except OSError:
                            pass

                return payload_path, payload_blob, size

    def cleanup_expired(self):
        now = int(time.time())
        with self.get_conn() as conn:
            with conn.cursor(cursor_factory=self.extras.RealDictCursor) as cursor:
                cursor.execute("SELECT code, payload_path FROM rooms WHERE expires_at <= %s", (now,))
                expired_rows = cursor.fetchall()
                for r in expired_rows:
                    p_path = r.get("payload_path")
                    if p_path and os.path.exists(p_path):
                        try:
                            os.remove(p_path)
                        except OSError:
                            pass
                cursor.execute("DELETE FROM rooms WHERE expires_at <= %s", (now,))
                conn.commit()

    def get_stats(self):
        now = int(time.time())
        with self.get_conn() as conn:
            with conn.cursor(cursor_factory=self.extras.RealDictCursor) as cursor:
                cursor.execute("SELECT COUNT(*) as active_rooms FROM rooms WHERE expires_at > %s", (now,))
                active_rooms = cursor.fetchone()["active_rooms"]
                cursor.execute("SELECT SUM(bytes_transferred) as total_bytes, COUNT(*) as total_transfers FROM telemetry")
                t_row = cursor.fetchone()
                return {
                    "active_rooms": active_rooms,
                    "total_bytes": t_row["total_bytes"] or 0,
                    "total_transfers": t_row["total_transfers"] or 0,
                    "database": "PostgreSQL + Streamed Disk Storage (1GB+ Capable)",
                    "smtp_status": "CONFIGURED" if smtp_sender.is_configured() else "NOT_CONFIGURED",
                    "uptime_seconds": int(time.time() - SERVER_START_TIME),
                    "status": "ONLINE"
                }


def init_database():
    """Initializes PostgreSQL if configured or available; falls back to SQLite."""
    use_postgres = bool(POSTGRES_URL or os.environ.get("POSTGRES_HOST") or os.environ.get("USE_POSTGRES"))
    if use_postgres:
        try:
            db_inst = JynxPostgresDatabase()
            print("[DATABASE] Successfully initialized PostgreSQL backend.")
            return db_inst
        except Exception as e:
            print(f"[DATABASE WARNING] PostgreSQL connection failed ({e}). Falling back to SQLite engine.")
    return JynxDatabase()


db = init_database()
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

        # 3. API: Chunk-Streamed Payload Download (Optimized for 1GB+)
        if path.startswith("/api/relay/payload/"):
            code = path.split("/api/relay/payload/")[1].strip().lower()
            payload_path, payload_blob, size = db.get_payload_file_or_bytes(code)

            if payload_path and os.path.exists(payload_path):
                self.send_response(200)
                self.send_header("Content-Type", "application/octet-stream")
                self.send_header("Content-Length", str(size))
                self.send_cors()
                self.end_headers()
                
                with open(payload_path, "rb") as f:
                    while True:
                        chunk = f.read(65536)
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                return

            elif payload_blob:
                self.send_response(200)
                self.send_header("Content-Type", "application/octet-stream")
                self.send_header("Content-Length", str(len(payload_blob)))
                self.send_cors()
                self.end_headers()
                self.wfile.write(payload_blob)
                return
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
                    "database": "SQLite + Stream Disk Storage",
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

        # 1.1 API: Chunked Stream Upload (Optimized for 1GB+ payloads)
        if path == "/api/relay/upload-chunk":
            content_length = int(self.headers.get("Content-Length", 0))
            if content_length == 0:
                self.send_response(400)
                self.send_cors()
                self.end_headers()
                self.wfile.write(b'{"error": "Empty payload chunk"}')
                return

            body = self.rfile.read(content_length)
            try:
                data = json.loads(body.decode("utf-8"))
                code = data.get("code")
                manifest = data.get("manifest", {})
                verification = data.get("verification", "")
                mode = data.get("mode", "files")
                chunk_b64 = data.get("chunk_b64", "")
                is_first = bool(data.get("is_first", False))
                is_last = bool(data.get("is_last", False))
                ttl = int(data.get("ttl", 86400))
                max_downloads = int(data.get("max_downloads", 10))

                chunk_bytes = base64.b64decode(chunk_b64)

                db.append_chunk_room(
                    code=code,
                    manifest=manifest,
                    verification=verification,
                    chunk_bytes=chunk_bytes,
                    is_first=is_first,
                    is_last=is_last,
                    mode=mode,
                    ttl_seconds=ttl,
                    max_downloads=max_downloads
                )

                resp = json.dumps({
                    "status": "CHUNK_STORED",
                    "code": code,
                    "bytes": len(chunk_bytes),
                    "is_last": is_last
                }).encode("utf-8")

                self.send_response(200)
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

        # 2. API: Send Email Notification via Gmail SMTP
        if path == "/api/relay/send-email":
            content_length = int(self.headers.get("Content-Length", 0))
            if content_length == 0:
                self.send_response(400)
                self.send_cors()
                self.end_headers()
                self.wfile.write(b'{"error": "Empty request body"}')
                return

            body = self.rfile.read(content_length)
            try:
                data = json.loads(body.decode("utf-8"))
                to_email = data.get("to_email")
                code = data.get("code")
                note = data.get("note", "")
                download_link = data.get("download_link", "")

                if not to_email or not code:
                    resp = json.dumps({"error": "Missing required fields 'to_email' or 'code'"}).encode("utf-8")
                    self.send_response(400)
                else:
                    success, msg = smtp_sender.send_transfer_email(
                        recipient_email=to_email,
                        code=code,
                        note=note,
                        download_link=download_link
                    )
                    resp = json.dumps({"success": success, "message": msg}).encode("utf-8")
                    self.send_response(200)

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

        self.send_response(404)
        self.send_cors()
        self.end_headers()


def run_server():
    server_address = (HOST, PORT)
    httpd = ThreadingHTTPServer(server_address, JynxHandler)
    print(f"[JYNX HYBRID RELAY] Running on http://{HOST}:{PORT}/")
    print(f"  ├── Storage: SQLite 3 + Streamed Disk Storage (1GB+ Capable)")
    print(f"  └── Gmail SMTP: {'CONFIGURED' if smtp_sender.is_configured() else 'NOT CONFIGURABLE (Set SMTP_EMAIL & SMTP_PASSWORD)'}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()

if __name__ == "__main__":
    run_server()
