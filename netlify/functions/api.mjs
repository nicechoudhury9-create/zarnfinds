import { getStore } from "@netlify/blobs";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const catalogKey = "catalog.json";
const catalogStoreName = "zaar-finds-catalog";
const uploadsStoreName = "zaar-finds-uploads";
const adminCookieName = "zaar_admin_session";
const sessionHours = Number(getEnv("ADMIN_SESSION_HOURS") || 8);
const sessionMs = sessionHours * 60 * 60 * 1000;
const maxJsonBytes = 8 * 1024 * 1024;
const maxImageBytes = 5 * 1024 * 1024;

export const config = {
  path: "/api/*"
};

export default async function handler(req, context) {
  const pathname = apiPath(req);

  try {
    if (req.method === "GET" && pathname === "/api/catalog") {
      return json(await readCatalog());
    }

    if (req.method === "GET" && pathname.startsWith("/api/uploads/")) {
      return getUpload(pathname);
    }

    if (req.method === "POST" && pathname === "/api/admin/login") {
      return loginAdmin(req);
    }

    if (req.method === "POST" && pathname === "/api/admin/logout") {
      return logoutAdmin(req);
    }

    if (req.method === "GET" && pathname === "/api/admin/check") {
      const denied = requireAdmin(req);
      if (denied) {
        return denied;
      }
      return json({ ok: true });
    }

    const denied = requireAdmin(req);
    if (denied) {
      return denied;
    }

    if (req.method === "POST" && pathname === "/api/categories") {
      return createCategory(req);
    }

    if (req.method === "POST" && pathname === "/api/products") {
      return createProduct(req);
    }

    const categoryMatch = /^\/api\/categories\/([^/]+)$/.exec(pathname);
    if (req.method === "DELETE" && categoryMatch) {
      return deleteCategory(decodeURIComponent(categoryMatch[1]));
    }

    const productMatch = /^\/api\/products\/([^/]+)$/.exec(pathname);
    if (req.method === "DELETE" && productMatch) {
      return deleteProduct(decodeURIComponent(productMatch[1]));
    }

    return error(404, "API route not found");
  } catch (err) {
    return error(err.status || 500, err.message || "Server error");
  }
}

function getEnv(name) {
  if (globalThis.Netlify?.env?.get) {
    return globalThis.Netlify.env.get(name);
  }
  return process.env[name];
}

function getAdminPassword() {
  return getEnv("ADMIN_PASSWORD") || getEnv("ADMIN_TOKEN") || "zarn123@@";
}

function getSessionSecret() {
  return getEnv("ADMIN_SESSION_SECRET") || getAdminPassword();
}

function apiPath(req) {
  const pathname = new URL(req.url).pathname;
  if (pathname.startsWith("/api/")) {
    return pathname;
  }

  const functionPrefix = "/.netlify/functions/api";
  if (pathname.startsWith(functionPrefix)) {
    const rest = pathname.slice(functionPrefix.length);
    return rest ? `/api${rest}` : "/api";
  }

  return pathname;
}

function json(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers
    }
  });
}

function error(status, message) {
  return json({ error: message }, status);
}

async function readJson(req) {
  const body = await req.text();
  if (Buffer.byteLength(body) > maxJsonBytes) {
    throw httpError(413, "Request is too large");
  }
  if (!body.trim()) {
    return {};
  }
  try {
    return JSON.parse(body);
  } catch (err) {
    throw httpError(400, "Invalid JSON body");
  }
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function store(name) {
  return getStore({ name, consistency: "strong" });
}

async function seedCatalog() {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(process.cwd(), "data/catalog.json"),
    resolve(here, "../../data/catalog.json"),
    resolve(here, "../../../data/catalog.json")
  ];

  for (const candidate of candidates) {
    try {
      return JSON.parse(await readFile(candidate, "utf8"));
    } catch (err) {
      // Keep looking; Netlify bundles included files differently from local Node.
    }
  }

  return {
    site: {
      name: "Zaar Finds",
      tagline: "Curated affiliate finds for a refined everyday."
    },
    categories: [],
    products: []
  };
}

async function readCatalog() {
  const catalogStore = store(catalogStoreName);
  let catalog = await catalogStore.get(catalogKey, { type: "json", consistency: "strong" });

  if (!catalog) {
    catalog = await seedCatalog();
    await writeCatalog(catalog);
  }

  catalog.categories = Array.isArray(catalog.categories) ? catalog.categories : [];
  catalog.products = Array.isArray(catalog.products) ? catalog.products : [];
  return catalog;
}

async function writeCatalog(catalog) {
  await store(catalogStoreName).setJSON(catalogKey, catalog);
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

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function hmac(value) {
  return createHmac("sha256", getSessionSecret()).update(value).digest("base64url");
}

function cookieHeader(req, value, maxAgeSeconds) {
  const isSecure = new URL(req.url).protocol === "https:";
  return `${adminCookieName}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}${isSecure ? "; Secure" : ""}`;
}

function passwordMatches(value) {
  const expected = Buffer.from(createHmac("sha256", "zaar-password-check").update(getAdminPassword()).digest("hex"));
  const actual = Buffer.from(createHmac("sha256", "zaar-password-check").update(String(value || "")).digest("hex"));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function createSessionToken() {
  const payload = base64UrlJson({
    exp: Date.now() + sessionMs,
    nonce: randomBytes(12).toString("base64url")
  });
  return `${payload}.${hmac(payload)}`;
}

function validSession(req) {
  const token = parseCookies(req.headers.get("cookie"))[adminCookieName];
  if (!token || !token.includes(".")) {
    return false;
  }

  const [payload, signature] = token.split(".");
  const expected = hmac(payload);
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature || "");
  if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) {
    return false;
  }

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Number(data.exp) > Date.now();
  } catch (err) {
    return false;
  }
}

function requireAdmin(req) {
  if (!validSession(req)) {
    return error(401, "Please sign in to manage the catalog");
  }
  return null;
}

async function loginAdmin(req) {
  const body = await readJson(req);
  if (!passwordMatches(body.password)) {
    return error(401, "Incorrect admin password");
  }

  const token = createSessionToken();
  return json(
    { ok: true },
    200,
    { "Set-Cookie": cookieHeader(req, token, Math.floor(sessionMs / 1000)) }
  );
}

function logoutAdmin(req) {
  return json(
    { ok: true },
    200,
    { "Set-Cookie": cookieHeader(req, "", 0) }
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
  } catch (err) {
    throw httpError(400, `${label} must be a valid http or https URL`);
  }
}

async function saveUploadedImage(image) {
  if (!image || !image.dataUrl) {
    return null;
  }

  const match = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([a-z0-9+/=]+)$/i.exec(image.dataUrl);
  if (!match) {
    throw httpError(400, "Image upload must be PNG, JPG, WebP, or GIF");
  }

  const mime = match[1].toLowerCase();
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > maxImageBytes) {
    throw httpError(400, "Image upload must be under 5 MB");
  }

  const extension = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif"
  }[mime];
  const originalName = String(image.name || "product").replace(/\.[^.]+$/, "");
  const key = `${slugify(originalName)}-${randomBytes(4).toString("hex")}.${extension}`;

  await store(uploadsStoreName).set(key, buffer, {
    metadata: {
      contentType: mime,
      originalName: String(image.name || "")
    }
  });
  return `/api/uploads/${key}`;
}

async function getUpload(pathname) {
  const key = decodeURIComponent(pathname.replace("/api/uploads/", ""));
  if (!key || key.includes("..") || key.startsWith("/")) {
    return error(400, "Bad upload key");
  }

  const entry = await store(uploadsStoreName).getWithMetadata(key, {
    type: "arrayBuffer",
    consistency: "strong"
  });
  if (!entry) {
    return error(404, "Upload not found");
  }

  return new Response(entry.data, {
    headers: {
      "Content-Type": entry.metadata?.contentType || "application/octet-stream",
      "Cache-Control": "public, max-age=3600"
    }
  });
}

async function createCategory(req) {
  const body = await readJson(req);
  const name = String(body.name || "").trim();
  const description = String(body.description || "").trim();
  if (name.length < 2) {
    return error(400, "Category name is required");
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
  return json(category, 201);
}

async function createProduct(req) {
  const body = await readJson(req);
  const title = String(body.title || "").trim();
  const categoryId = String(body.categoryId || "").trim();
  const affiliateUrl = assertHttpUrl(body.affiliateUrl, "Affiliate link");
  const priceLabel = String(body.priceLabel || "").trim() || "See latest price";
  const imageUrl = String(body.imageUrl || "").trim();

  if (title.length < 2) {
    return error(400, "Product title is required");
  }

  const catalog = await readCatalog();
  if (!catalog.categories.some((category) => category.id === categoryId)) {
    return error(400, "Choose a valid category");
  }

  let imageSrc = await saveUploadedImage(body.image);
  if (!imageSrc && imageUrl) {
    imageSrc = assertHttpUrl(imageUrl, "Image URL");
  }
  if (!imageSrc) {
    return error(400, "Upload an image or enter an image URL");
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
  return json(product, 201);
}

async function deleteProduct(productId) {
  const catalog = await readCatalog();
  const product = catalog.products.find((item) => item.id === productId);
  if (!product) {
    return error(404, "Product not found");
  }

  catalog.products = catalog.products.filter((item) => item.id !== productId);
  await writeCatalog(catalog);

  if (product.imageSrc?.startsWith("/api/uploads/")) {
    const key = decodeURIComponent(product.imageSrc.replace("/api/uploads/", ""));
    await store(uploadsStoreName).delete(key);
  }

  return json({ ok: true });
}

async function deleteCategory(categoryId) {
  const catalog = await readCatalog();
  if (catalog.products.some((product) => product.categoryId === categoryId)) {
    return error(409, "Delete or move products before deleting this category");
  }

  const before = catalog.categories.length;
  catalog.categories = catalog.categories.filter((category) => category.id !== categoryId);
  if (catalog.categories.length === before) {
    return error(404, "Category not found");
  }

  await writeCatalog(catalog);
  return json({ ok: true });
}
