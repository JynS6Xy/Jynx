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
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse

PORT = int(os.environ.get("PORT", 8099))
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_FILE = os.path.join(BASE_DIR, "jynx_relay.db")

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
