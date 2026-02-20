const { createServer } = require("http");
const next = require("next");

const port = parseInt(process.env.PORT || "3000", 10);
const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();

const DISALLOWED_METHODS = new Set(["TRACE", "TRACK"]);
const ALLOW_HEADER = "GET, HEAD, POST, PUT, DELETE, PATCH, OPTIONS";

app.prepare().then(() => {
  createServer((req, res) => {
    const method = (req.method || "").toUpperCase();

    if (DISALLOWED_METHODS.has(method)) {
      res.statusCode = 405;
      res.setHeader("Allow", ALLOW_HEADER);
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Method Not Allowed");
      return;
    }

    handle(req, res).catch((err) => {
      console.error("Unhandled error in request handler", err);
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Internal Server Error");
    });
  }).listen(port, (err) => {
    if (err) {
      console.error("Failed to start server", err);
      process.exit(1);
    }
    console.log(`> Ready on http://localhost:${port} (dev=${dev})`);
  });
});
