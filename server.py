import http.server
import socketserver
import os

os.chdir("/Users/ihsanduru/bonerigging")

class MyHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # silent

PORT = 4000
with socketserver.TCPServer(("0.0.0.0", PORT), MyHandler) as httpd:
    print(f"Serving on http://localhost:{PORT}", flush=True)
    httpd.serve_forever()
