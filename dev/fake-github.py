#!/usr/bin/env python3
"""A GitHub of the rig's own (dev/rig.sh github): the device flow's two addresses and /user.
The code is confirmed "by the user" at the third asking; the app is given one repository, whose
address is REPO (a bare repository of the rig's). fake-github.py PORT REPO"""
import json, sys
from http.server import BaseHTTPRequestHandler, HTTPServer

asked = 0

class Handler(BaseHTTPRequestHandler):
    def reply(self, data):
        body = json.dumps(data).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        global asked
        form = self.rfile.read(int(self.headers.get("Content-Length") or 0)).decode()
        if self.path == "/login/device/code":
            asked = 0
            return self.reply({"device_code": "dev-1", "user_code": "WDJB-MJHT", "verification_uri": "https://github.com/login/device", "interval": 1, "expires_in": 900})
        if "refresh_token" in form:
            return self.reply({"error": "bad_refresh_token", "error_description": "not here"})
        asked += 1
        if asked < 3:
            return self.reply({"error": "authorization_pending"})
        self.reply({"access_token": "ghu_fake", "expires_in": 28800, "refresh_token": "ghr_fake", "refresh_token_expires_in": 15897600})

    def do_GET(self):
        if self.headers.get("Authorization") != "Bearer ghu_fake":
            return self.reply({"message": "Bad credentials"})
        if self.path == "/user":
            return self.reply({"login": "octo", "name": "Octo Cat", "id": 42})
        if self.path.startswith("/user/installations?"):
            return self.reply({"installations": [{"id": 1}]})
        if self.path.startswith("/user/installations/1/repositories"):
            return self.reply({"repositories": [{"full_name": "octo/notes", "clone_url": sys.argv[2], "default_branch": "main", "private": True}]})
        self.reply({"message": "Not Found"})

    def log_message(self, *a):
        pass

HTTPServer(("127.0.0.1", int(sys.argv[1])), Handler).serve_forever()
