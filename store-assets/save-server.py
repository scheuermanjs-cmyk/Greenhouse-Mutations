import http.server
import socketserver
import os

PORT = 8199
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # greenhouse-pwa/
OUT_DIR = os.path.join(ROOT, "store-assets")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        if self.path.startswith("/save/"):
            filename = os.path.basename(self.path[len("/save/"):])
            length = int(self.headers.get("Content-Length", 0))
            data = self.rfile.read(length)
            os.makedirs(OUT_DIR, exist_ok=True)
            out_path = os.path.join(OUT_DIR, filename)
            with open(out_path, "wb") as f:
                f.write(data)
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(("saved:" + out_path + ":" + str(len(data))).encode())
        else:
            self.send_response(404)
            self.end_headers()


with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print("save-server listening on", PORT)
    httpd.serve_forever()
