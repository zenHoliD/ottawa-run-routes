"""
Proxy server for Ottawa Run Routes.
Serves static files and forwards /api/directions/* to ORS,
injecting the API key server-side so it never reaches the browser.
"""
import json
import os
import urllib.request
import urllib.error
from http.server import HTTPServer, SimpleHTTPRequestHandler

ORS_KEY  = "eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImY2NDU4Y2ZhM2UwZTRhNzY5ZDUyN2U1NDAzNmRjYWE1IiwiaCI6Im11cm11cjY0In0="
ORS_BASE = "https://api.openrouteservice.org/v2"
PORT     = 8080


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # suppress request logs

    def do_POST(self):
        if not self.path.startswith("/api/directions/"):
            self.send_error(404)
            return

        profile = self.path[len("/api/directions/"):]
        length  = int(self.headers.get("Content-Length", 0))
        body    = self.rfile.read(length)

        url = f"{ORS_BASE}/directions/{profile}/geojson"
        req = urllib.request.Request(
            url,
            data=body,
            headers={
                "Authorization":  ORS_KEY,
                "Content-Type":   "application/json",
                "Accept":         "application/json",
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(req) as resp:
                data   = resp.read()
                status = resp.status
        except urllib.error.HTTPError as e:
            data   = e.read()
            status = e.code

        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    httpd = HTTPServer(("", PORT), Handler)
    print(f"Serving on http://localhost:{PORT}")
    httpd.serve_forever()
