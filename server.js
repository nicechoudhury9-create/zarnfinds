const http = require("node:http");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const rootDir = __dirname;
const dataDir = path.join(rootDir, "data");
const uploadsDir = path.join(rootDir, "uploads");
const catalogPath = path.join(dataDir, "catalog.json");
const port = Number(process.env.PORT || 3000);
const adminPassword = process.env.ADMIN_PASSWORD || process.env.ADMIN_TOKEN || "zarn123@@";
const adminCookieName = "zaar_admin_session";
const adminSessionHours = Number(process.env.ADMIN_SESSION_HOURS || 8);
const adminSessionMs = adminSessionHours * 60 * 60 * 1000;
const adminSessions = new Map();
const maxJsonBytes = 8 * 1024 * 1024;
const maxImageBytes = 5 * 1024 * 1024;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf"
};

function sendJson(res, statusCode, payload, extraHeaders) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...(extraHeaders || {})
  });
  res.end(body);
}

function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { error: message });
}

function parseCookies(cookieHeader) {
  return String(cookieHeader || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const separator = part.indexOf("=");
      if (separator === -1) {
        return cookies;
      }
      const name = part.slice(0, separator);
      const value = part.slice(separator + 1);
      cookies[name] = decodeURIComponent(value);
      return cookies;
    }, {});
}

function adminSessionCookie(value, maxAgeSeconds) {
  return `${adminCookieName}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
}

function clearExpiredSessions() {
  const now = Date.now();
  for (const [sessionId, session] of adminSessions) {
    if (session.expiresAt <= now) {
      adminSessions.delete(sessionId);
    }
  }
}

function getAdminSessionId(req) {
  const cookies = parseCookies(req.headers.cookie);
  return cookies[adminCookieName];
}

function hasAdminSession(req) {
  clearExpiredSessions();
  const sessionId = getAdminSessionId(req);
  if (!sessionId) {
    return false;
  }
  const session = adminSessions.get(sessionId);
  if (!session || session.expiresAt <= Date.now()) {
    adminSessions.delete(sessionId);
    return false;
  }
  session.expiresAt = Date.now() + adminSessionMs;
  return true;
}

function passwordMatches(value) {
  const expected = crypto.createHash("sha256").update(adminPassword).digest();
  const actual = crypto.createHash("sha256").update(String(value || "")).digest();
  return crypto.timingSafeEqual(expected, actual);
}

function requireAdmin(req, res) {
  if (!hasAdminSession(req)) {
    sendError(res, 401, "Please sign in to manage the catalog");
    return false;
  }
  return true;
}

async function ensureStorage() {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(uploadsDir, { recursive: true });
}

async function readCatalog() {
  await ensureStorage();
  const raw = await fs.readFile(catalogPath, "utf8");
  const catalog = JSON.parse(raw);
  catalog.categories = Array.isArray(catalog.categories) ? catalog.categories : [];
  catalog.products = Array.isArray(catalog.products) ? catalog.products : [];
  return catalog;
}

async function writeCatalog(catalog) {
  await ensureStorage();
  const tempPath = `${catalogPath}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, catalogPath);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > maxJsonBytes) {
        reject(new Error("Request is too large"));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

async function loginAdmin(req, res) {
  const body = await readJson(req);
  if (!passwordMatches(body.password)) {
    sendError(res, 401, "Incorrect admin password");
    return;
  }

  const sessionId = crypto.randomBytes(32).toString("base64url");
  adminSessions.set(sessionId, {
    createdAt: Date.now(),
    expiresAt: Date.now() + adminSessionMs
  });

  sendJson(
    res,
    200,
    { ok: true },
    { "Set-Cookie": adminSessionCookie(sessionId, Math.floor(adminSessionMs / 1000)) }
  );
}

function logoutAdmin(req, res) {
  const sessionId = getAdminSessionId(req);
  if (sessionId) {
    adminSessions.delete(sessionId);
  }
  sendJson(
    res,
    200,
    { ok: true },
    { "Set-Cookie": adminSessionCookie("", 0) }
  );
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70) || "item";
}

function uniqueId(base, existingIds) {
  let id = base;
  let count = 2;
  while (existingIds.has(id)) {
    id = `${base}-${count}`;
    count += 1;
  }
  return id;
}

function assertHttpUrl(value, label) {
  try {
    const parsed = new URL(String(value || ""));
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error();
    }
    return parsed.toString();
  } catch (error) {
    throw new Error(`${label} must be a valid http or https URL`);
  }
}

async function saveUploadedImage(image) {
  if (!image || !image.dataUrl) {
    return null;
  }

  const match = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([a-z0-9+/=]+)$/i.exec(image.dataUrl);
  if (!match) {
    throw new Error("Image upload must be PNG, JPG, WebP, or GIF");
  }

  const mime = match[1].toLowerCase();
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > maxImageBytes) {
    throw new Error("Image upload must be under 5 MB");
  }

  const extension = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif"
  }[mime];
  const originalName = path.parse(String(image.name || "product")).name;
  const filename = `${slugify(originalName)}-${crypto.randomUUID().slice(0, 8)}.${extension}`;
  await ensureStorage();
  await fs.writeFile(path.join(uploadsDir, filename), buffer);
  return `uploads/${filename}`;
}

async function createCategory(req, res) {
  const body = await readJson(req);
  const name = String(body.name || "").trim();
  const description = String(body.description || "").trim();
  if (name.length < 2) {
    sendError(res, 400, "Category name is required");
    return;
  }

  const catalog = await readCatalog();
  const ids = new Set(catalog.categories.map((category) => category.id));
  const category = {
    id: uniqueId(slugify(name), ids),
    name,
    description
  };
  catalog.categories.push(category);
  await writeCatalog(catalog);
  sendJson(res, 201, category);
}

async function createProduct(req, res) {
  const body = await readJson(req);
  const title = String(body.title || "").trim();
  const categoryId = String(body.categoryId || "").trim();
  const affiliateUrl = assertHttpUrl(body.affiliateUrl, "Affiliate link");
  const priceLabel = String(body.priceLabel || "").trim() || "See latest price";
  const imageUrl = String(body.imageUrl || "").trim();

  if (title.length < 2) {
    sendError(res, 400, "Product title is required");
    return;
  }

  const catalog = await readCatalog();
  if (!catalog.categories.some((category) => category.id === categoryId)) {
    sendError(res, 400, "Choose a valid category");
    return;
  }

  let imageSrc = await saveUploadedImage(body.image);
  if (!imageSrc && imageUrl) {
    imageSrc = assertHttpUrl(imageUrl, "Image URL");
  }
  if (!imageSrc) {
    sendError(res, 400, "Upload an image or enter an image URL");
    return;
  }

  const ids = new Set(catalog.products.map((product) => product.id));
  const product = {
    id: uniqueId(slugify(title), ids),
    title,
    priceLabel,
    categoryId,
    affiliateUrl,
    imageSrc,
    isFeatured: Boolean(body.isFeatured),
    createdAt: new Date().toISOString()
  };
  catalog.products.unshift(product);
  await writeCatalog(catalog);
  sendJson(res, 201, product);
}

async function deleteProduct(productId, res) {
  const catalog = await readCatalog();
  const product = catalog.products.find((item) => item.id === productId);
  if (!product) {
    sendError(res, 404, "Product not found");
    return;
  }

  catalog.products = catalog.products.filter((item) => item.id !== productId);
  await writeCatalog(catalog);

  if (product.imageSrc && product.imageSrc.startsWith("uploads/")) {
    const imagePath = path.resolve(rootDir, product.imageSrc);
    const relative = path.relative(uploadsDir, imagePath);
    if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
      await fs.rm(imagePath, { force: true });
    }
  }

  sendJson(res, 200, { ok: true });
}

async function deleteCategory(categoryId, res) {
  const catalog = await readCatalog();
  if (catalog.products.some((product) => product.categoryId === categoryId)) {
    sendError(res, 409, "Delete or move products before deleting this category");
    return;
  }
  const before = catalog.categories.length;
  catalog.categories = catalog.categories.filter((category) => category.id !== categoryId);
  if (catalog.categories.length === before) {
    sendError(res, 404, "Category not found");
    return;
  }
  await writeCatalog(catalog);
  sendJson(res, 200, { ok: true });
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/catalog") {
    sendJson(res, 200, await readCatalog());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/login") {
    await loginAdmin(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/logout") {
    logoutAdmin(req, res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/admin/check") {
    if (!requireAdmin(req, res)) {
      return;
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  if (!requireAdmin(req, res)) {
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/categories") {
    await createCategory(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/products") {
    await createProduct(req, res);
    return;
  }

  const categoryMatch = /^\/api\/categories\/([^/]+)$/.exec(url.pathname);
  if (req.method === "DELETE" && categoryMatch) {
    await deleteCategory(decodeURIComponent(categoryMatch[1]), res);
    return;
  }

  const productMatch = /^\/api\/products\/([^/]+)$/.exec(url.pathname);
  if (req.method === "DELETE" && productMatch) {
    await deleteProduct(decodeURIComponent(productMatch[1]), res);
    return;
  }

  sendError(res, 404, "API route not found");
}

async function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "/home.html" : url.pathname;
  let decoded;
  try {
    decoded = decodeURIComponent(requested);
  } catch (error) {
    sendError(res, 400, "Bad path");
    return;
  }

  const filePath = path.resolve(rootDir, `.${decoded}`);
  const relative = path.relative(rootDir, filePath).replace(/\\/g, "/");
  if (relative.startsWith("..") || path.isAbsolute(relative) || relative.startsWith("data/")) {
    sendError(res, 403, "Forbidden");
    return;
  }
  if (["server.js", "package.json"].includes(relative)) {
    sendError(res, 403, "Forbidden");
    return;
  }
  if (path.extname(filePath) === ".js" && !relative.startsWith("assets/")) {
    sendError(res, 403, "Forbidden");
    return;
  }

  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      sendError(res, 404, "Not found");
      return;
    }
    const contentType = mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": relative.startsWith("uploads/") ? "public, max-age=3600" : "no-cache"
    });
    fsSync.createReadStream(filePath).pipe(res);
  } catch (error) {
    sendError(res, 404, "Not found");
  }
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      sendError(res, 405, "Method not allowed");
      return;
    }
    await serveStatic(req, res, url);
  } catch (error) {
    sendError(res, 500, error.message || "Server error");
  }
}

let activeServer;
let keepAliveTimer;

ensureStorage()
  .then(() => {
    activeServer = http.createServer(handleRequest);
    keepAliveTimer = setInterval(() => {}, 60 * 60 * 1000);
    activeServer.on("close", () => clearInterval(keepAliveTimer));
    activeServer.listen(port, () => {
      console.log(`Zaar Finds is running at http://localhost:${port}`);
      console.log("Admin login is enabled at /admin.html");
    });
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
