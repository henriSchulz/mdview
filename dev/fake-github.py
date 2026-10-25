#!/usr/bin/env python3
"""A GitHub of the rig's own (dev/rig.sh github): the device flow's two addresses and /user.
The code is confirmed "by the user" at the third asking; the app is given one repository, whose
address is REPO (a bare repository of the rig's). fake-github.py PORT REPO [NEW]

A repository made here (POST /user/repos) is NEW, an empty bare repository of the rig's, under
the name asked for — but "taken" is someone's already (422), "denied" is not allowed (403, as the
GitHub App answers without the permission), and one with "unreached" in its name is made but not
given to the app (GET /repos/… answers 404).

It stands in for the web app's server as well, as far as a project's pasteboard goes (dev/rig.sh
paste; the real one: web/app/paste, web/lib/paste.ts): /paste/<owner>/<repo>, read and written by
the token the sign-in here hands out."""
import json, sys, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

asked = 0
made = set()  # the repositories made here, by full name
boards = {}  # a pasteboard by its address: { text, rev, by }

class Handler(BaseHTTPRequestHandler):
    def reply(self, data, status=200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        global asked
        form = self.rfile.read(int(self.headers.get("Content-Length") or 0)).decode()
        if self.path == "/user/repos":
            said = json.loads(form or "{}")
            name = said.get("name", "")
            if self.headers.get("Authorization") != "Bearer ghu_fake":
                return self.reply({"message": "Bad credentials"}, 401)
            if name == "taken":
                return self.reply({"message": "Repository creation failed.", "errors": [{"resource": "Repository", "code": "custom", "field": "name", "message": "name already exists on this account"}]}, 422)
            if name == "denied":
                return self.reply({"message": "Resource not accessible by integration"}, 403)
            if not said.get("private") or said.get("auto_init"):
                return self.reply({"message": "only private and empty here"}, 400)
            made.add("octo/" + name)
            return self.reply({"full_name": "octo/" + name, "clone_url": sys.argv[3] if len(sys.argv) > 3 else "", "default_branch": "main", "private": True}, 201)
        if self.path == "/login/device/code":
            asked = 0
            return self.reply({"device_code": "dev-1", "user_code": "WDJB-MJHT", "verification_uri": "https://github.com/login/device", "interval": 1, "expires_in": 900})
        if "refresh_token" in form:
            return self.reply({"error": "bad_refresh_token", "error_description": "not here"})
        asked += 1
        if asked < 3:
            return self.reply({"error": "authorization_pending"})
        self.reply({"access_token": "ghu_fake", "expires_in": 28800, "refresh_token": "ghr_fake", "refresh_token_expires_in": 15897600})

    def do_PUT(self):
        said = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)).decode() or "{}")
        if not self.path.startswith("/paste/"):
            return self.reply({"message": "Not Found"}, 404)
        if self.headers.get("Authorization") != "Bearer ghu_fake":
            return self.reply({"error": "signin"}, 401)
        now = boards.get(self.path, {"text": "", "rev": 0, "by": ""})
        if now["rev"] != said.get("base"):
            return self.reply(now, 409)
        boards[self.path] = {"text": said["text"], "rev": now["rev"] + 1, "by": said.get("by", "")}
        self.reply({"rev": now["rev"] + 1})

    def do_GET(self):
        if self.path.startswith("/paste/"):
            if self.headers.get("Authorization") != "Bearer ghu_fake":
                return self.reply({"error": "signin"}, 401)
            at, _, asks = self.path.partition("?")
            rev = next((int(a[4:]) for a in asks.split("&") if a.startswith("rev=")), -1)
            for _ in range(40 if "wait=1" in asks else 0):  # (with wait: answered once it is another text, or after a while)
                if boards.get(at, {"rev": 0})["rev"] != rev:
                    break
                time.sleep(0.1)
            return self.reply(boards.get(at, {"text": "", "rev": 0, "by": ""}))
        if self.headers.get("Authorization") != "Bearer ghu_fake":
            return self.reply({"message": "Bad credentials"})
        if self.path == "/user":
            return self.reply({"login": "octo", "name": "Octo Cat", "id": 42})
        if self.path.startswith("/user/installations?"):
            return self.reply({"installations": [{"id": 1}]})
        if self.path.startswith("/repos/") and self.path[7:] in made and "unreached" not in self.path:
            return self.reply({"full_name": self.path[7:]})
        if self.path.startswith("/user/installations/1/repositories"):
            return self.reply({"repositories": [{"full_name": "octo/notes", "clone_url": sys.argv[2], "default_branch": "main", "private": True}]})
        self.reply({"message": "Not Found"})

    def log_message(self, *a):
        pass

ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), Handler).serve_forever()
