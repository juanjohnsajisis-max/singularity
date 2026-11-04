// Electron main process for LNP Forge.
//
// The Next.js app is exported statically to `out/` (see next.config.mjs), so no
// server is needed. `next build` emits *absolute* asset URLs such as
// `/_next/static/...`; loading `out/index.html` straight off disk with
// `file://` would resolve those against the drive root (`file:///_next/...`),
// and the window would come up blank. We therefore serve `out/` ourselves over
// a private, privileged scheme: `lnpforge://app/<path>`.
const { app, BrowserWindow, dialog, protocol, shell } = require("electron");
const fs = require("fs");
const path = require("path");

const SCHEME = "lnpforge";
const APP_HOST = "app";
const OUT_DIR = path.join(__dirname, "..", "out");
const INDEX_FILE = path.join(OUT_DIR, "index.html");
const START_URL = `${SCHEME}://${APP_HOST}/index.html`;

// Content types matter: Chromium refuses stylesheets/scripts served as
// application/octet-stream, and Electron does not sniff extensions for us.
const MIME_TYPES = new Map(
  Object.entries({
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".map": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json",
  }),
);

protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: {
      standard: true, // gives us real origins → cookies, storage, relative URLs
      secure: true, // treated as a secure context
      supportFetchAPI: true, // the Next.js router fetches RSC payloads
      corsEnabled: true,
      stream: true,
    },
  },
]);

/** Map a URL path to a real file inside `out/`, guarding against traversal. */
function resolveAsset(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname || "/");
  } catch {
    return null;
  }

  const relative = decoded.replace(/\\/g, "/").replace(/^\/+/, "");
  const candidates = [];
  if (!relative) {
    candidates.push("index.html");
  } else {
    candidates.push(relative);
    if (relative.endsWith("/")) {
      candidates.push(`${relative}index.html`);
    } else if (!path.extname(relative)) {
      // `next build` writes /designer → out/designer.html
      candidates.push(`${relative}.html`, `${relative}/index.html`);
    }
  }

  for (const candidate of candidates) {
    const filePath = path.resolve(OUT_DIR, candidate);
    if (filePath !== OUT_DIR && !filePath.startsWith(OUT_DIR + path.sep)) continue;
    try {
      if (fs.statSync(filePath).isFile()) return filePath;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

function registerAppProtocol() {
  protocol.handle(SCHEME, async (request) => {
    const { pathname } = new URL(request.url);
    let filePath = resolveAsset(pathname);
    let status = 200;

    if (!filePath) {
      // Single-route static export: fall back to 404.html (or the app shell),
      // so client-side routes never render a hard failure page.
      filePath = resolveAsset("/404.html") || resolveAsset("/index.html");
      status = 404;
    }

    if (!filePath) {
      return new Response(`Nothing to serve for ${pathname} — is out/ built?`, {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    try {
      // fs (not net.fetch) so that files inside app.asar keep working.
      const body = await fs.promises.readFile(filePath);
      const type =
        MIME_TYPES.get(path.extname(filePath).toLowerCase()) ||
        "application/octet-stream";
      return new Response(new Uint8Array(body), {
        status,
        headers: { "content-type": type, "cache-control": "no-cache" },
      });
    } catch (err) {
      console.error(`[lnpforge] failed to read ${filePath}:`, err);
      return new Response(`Failed to read ${path.basename(filePath)}`, {
        status: 500,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: "#070a14",
    title: "LNP Forge",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Open external links (if any) in the system browser, not in the app shell.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  // Keep navigation inside the app shell.
  win.webContents.on("will-navigate", (event, url) => {
    const isInternal = url.startsWith(`${SCHEME}://${APP_HOST}/`);
    const isDevServer =
      Boolean(process.env.LNP_FORGE_URL) &&
      url.startsWith(process.env.LNP_FORGE_URL.replace(/\/+$/, ""));
    if (!isInternal && !isDevServer) {
      event.preventDefault();
      if (url.startsWith("http")) shell.openExternal(url);
    }
  });

  win.webContents.on("did-fail-load", (_event, code, description, url) => {
    console.error(`[lnpforge] load failed (${code} ${description}) for ${url}`);
    dialog.showErrorBox(
      "LNP Forge — could not load the app",
      `${description} (${code})\n\n${url}\n\n` +
        "If the build is missing, run:\n\n  npm run build\n\nor start with:\n\n  npm run electron:dev",
    );
  });

  const devServerUrl = process.env.LNP_FORGE_URL; // optional: point at `next dev`
  win.loadURL(devServerUrl || START_URL).catch((err) => {
    console.error("[lnpforge] loadURL failed:", err);
  });

  return win;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId("com.singularity.lnpforge");

  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    // The static export must exist before we can serve it.
    if (!process.env.LNP_FORGE_URL && !fs.existsSync(INDEX_FILE)) {
      dialog.showErrorBox(
        "LNP Forge — build missing",
        `Could not find:\n\n  ${INDEX_FILE}\n\n` +
          "Build the app first, then relaunch:\n\n  npm run build\n\n" +
          'or just use:\n\n  npm run electron:dev\n',
      );
      app.quit();
      return;
    }

    registerAppProtocol();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
