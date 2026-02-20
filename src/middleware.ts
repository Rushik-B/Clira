import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

const SELF = "'self'";
const isProd = process.env.NODE_ENV === "production";

// Routes that don't require authentication
const PUBLIC_PATHS = [
  "/signin",
  "/api/auth",
  "/api/cron",
  "/api/gmail-push",
  "/api/whatsapp/webhook", // WhatsApp webhook must be public (called by Meta)
  "/api/twilio/webhook", // Twilio webhook must be public (called by Twilio)
  "/api/telegram/webhook", // Telegram webhook/poller compatibility endpoint
  "/privacy",
  "/terms",
  "/_next",
  "/favicon.ico",
  "/robots.txt",
  "/sitemap.xml",
  // Static assets in public folder
  "/intro-images",
  "/intro-videos",
  "/ui-inspo",
];

// Static file extensions that are always public
const PUBLIC_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp", ".mp4", ".webm", ".woff", ".woff2"];

// Check if a path is public (doesn't require auth)
function isPublicPath(pathname: string): boolean {
  // Check path prefixes
  if (PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(path + "/"))) {
    return true;
  }
  // Check static file extensions
  if (PUBLIC_EXTENSIONS.some((ext) => pathname.endsWith(ext))) {
    return true;
  }
  return false;
}

const generateNonce = () => crypto.randomUUID().replace(/-/g, "");

function buildCsp(nonce: string) {
  // Development / non-production: relax CSP so Next.js dev runtime can execute
  if (!isProd) {
    const connectSrc = `${SELF} ws: wss:`;

    const scriptSrc = [SELF, "'unsafe-inline'", "'unsafe-eval'"].join(" ");
    const styleSrc = [SELF, "'unsafe-inline'"].join(" ");
    const fontSrc = ["'self'", "data: https:"].join(" ");

    return [
      `default-src ${SELF}`,
      "frame-ancestors 'none'",
      `base-uri ${SELF}`,
      "object-src 'none'",
      `form-action ${SELF}`,
      "img-src 'self' data: blob: https://lh3.googleusercontent.com https://*.googleusercontent.com",
      "media-src 'self' blob:",
      `script-src ${scriptSrc}`,
      `style-src ${styleSrc}`,
      `font-src ${fontSrc}`,
      `connect-src ${connectSrc}`,
    ].join("; ");
  }

  // Production: strict CSP with nonce + strict-dynamic for scanners
  const connectSrc = SELF;

  const scriptSrc = [
    SELF,
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    "'wasm-unsafe-eval'",
  ].join(" ");

  const styleSrc = [SELF, `'nonce-${nonce}'`].join(" ");

  const fontSrc = ["'self'", "data:"].join(" ");

  return [
    `default-src ${SELF}`,
    "frame-ancestors 'none'",
    `base-uri ${SELF}`,
    "object-src 'none'",
    `form-action ${SELF}`,
    "img-src 'self' data: blob: https://lh3.googleusercontent.com https://*.googleusercontent.com",
    "media-src 'self' blob:",
    `script-src ${scriptSrc}`,
    `style-src ${styleSrc}`,
    `font-src ${fontSrc}`,
    `connect-src ${connectSrc}`,
  ].join("; ");
}

function buildSecurityHeaders(nonce: string) {
  return {
    "Content-Security-Policy": buildCsp(nonce),
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
  } as const;
}

export default async function middleware(request: NextRequest) {
  // Block TRACE and TRACK methods to prevent proxy disclosure / XST attacks
  const method = request.method.toUpperCase();
  if (method === "TRACE" || method === "TRACK") {
    return new NextResponse("Method Not Allowed", {
      status: 405,
      headers: { "Allow": "GET, HEAD, POST, PUT, DELETE, PATCH, OPTIONS" },
    });
  }

  // In production, enforce HTTPS by redirecting HTTP requests
  // Skip for localhost (local Docker without a TLS-terminating proxy)
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
  const isLocalhost = host.startsWith("localhost") || host.startsWith("127.0.0.1");

  if (isProd && !isLocalhost) {
    const forwardedProto = request.headers.get("x-forwarded-proto");
    const protocol =
      forwardedProto ?? request.nextUrl.protocol.replace(":", "");

    // Redirect HTTP to HTTPS
    if (protocol === "http") {
      const newUrl = new URL(request.url);
      newUrl.protocol = "https:";
      if (host) {
        const hostname = host.split(":")[0];
        newUrl.hostname = hostname;
        newUrl.port = ""; // Use default HTTPS port (443)
      }
      return NextResponse.redirect(newUrl, 301);
    }
  }

  const { pathname } = request.nextUrl;

  // Check authentication for protected routes (server-side)
  if (!isPublicPath(pathname)) {
    const token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET,
    });

    // Redirect unauthenticated users to landing page or signin
    if (!token) {
      const landingPageUrl = process.env.NEXT_PUBLIC_LANDING_PAGE_URL;
      
      // For API routes, return 401 instead of redirect
      if (pathname.startsWith("/api/")) {
        return NextResponse.json(
          { error: "Unauthorized" },
          { status: 401 }
        );
      }
      
      // For page routes, redirect to landing page (or signin as fallback)
      if (landingPageUrl) {
        return NextResponse.redirect(new URL(landingPageUrl, request.url));
      }
      return NextResponse.redirect(new URL("/signin", request.url));
    }
  }

  const nonce = generateNonce();
  const responseHeaders = buildSecurityHeaders(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  Object.entries(responseHeaders).forEach(([key, value]) => {
    response.headers.set(key, value);
  });

  // NextAuth OAuth uses a short-lived state cookie during redirects.
  // If an intermediary (e.g. CDN/proxy) caches `/api/auth/*` redirects or pages,
  // the cached `state` in the redirect URL can diverge from the client's cookie,
  // producing "state mismatch" errors.
  if (pathname.startsWith("/api/auth")) {
    response.headers.set(
      "Cache-Control",
      "no-store, no-cache, max-age=0, must-revalidate, proxy-revalidate"
    );
    response.headers.set("Pragma", "no-cache");
    response.headers.set("Expires", "0");
    response.headers.set("CDN-Cache-Control", "no-store");
    response.headers.set("Vary", "Cookie");
  }

  // Add HSTS header in production (skip localhost — no TLS termination locally)
  if (isProd && !isLocalhost) {
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains; preload",
    );
  }

  return response;
}

export const config = {
  matcher: "/:path*",
};
