#!/usr/bin/env node

// src/server/index.ts
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyMultipart from "@fastify/multipart";
import fastifyCors from "@fastify/cors";
import path4 from "path";
import { fileURLToPath } from "url";

// src/server/routes/files.ts
import fs from "fs/promises";
import path2 from "path";
import dns from "dns/promises";

// src/server/utils/path-guard.ts
import path from "path";
function resolveSafePath(baseDir, requestedPath) {
  const decoded = decodeURIComponent(requestedPath);
  if (decoded.includes("\0")) {
    throw new Error("Path outside project directory");
  }
  const resolved = path.resolve(baseDir, decoded);
  const normalizedBase = path.resolve(baseDir);
  if (!resolved.startsWith(normalizedBase + path.sep) && resolved !== normalizedBase) {
    throw new Error("Path outside project directory");
  }
  return resolved;
}

// src/server/utils/html-combiner.ts
function parseHtmlTemplate(html) {
  const doctypeMatch = html.match(/^(<!DOCTYPE[^>]*>)/i);
  const doctype = doctypeMatch ? doctypeMatch[1] : "";
  const htmlAttrMatch = html.match(/<html([^>]*)>/i);
  const htmlAttributes = htmlAttrMatch ? htmlAttrMatch[1].trim() : "";
  const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  let head = headMatch ? headMatch[1] : "";
  head = head.replace(/<style\s+id="pagesmith-styles"[^>]*>[\s\S]*?<\/style>/i, "").trim();
  const bodyAttrMatch = html.match(/<body([^>]*)>/i);
  const bodyAttributes = bodyAttrMatch ? bodyAttrMatch[1].trim() : "";
  return { doctype, htmlAttributes, head, bodyAttributes };
}
function recombineHtml(template, bodyHtml, css) {
  const htmlAttr = template.htmlAttributes ? ` ${template.htmlAttributes}` : "";
  const bodyAttr = template.bodyAttributes ? ` ${template.bodyAttributes}` : "";
  const styleBlock = css ? `
<style id="pagesmith-styles">
${css}
</style>` : "";
  const lines = [
    template.doctype,
    `<html${htmlAttr}>`,
    "<head>",
    template.head,
    styleBlock,
    "</head>",
    `<body${bodyAttr}>`,
    bodyHtml,
    "</body>",
    "</html>"
  ].filter(Boolean);
  return lines.join("\n") + "\n";
}

// src/server/routes/files.ts
var templates = /* @__PURE__ */ new Map();
var FETCH_TIMEOUT_MS = 15e3;
var MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
var IS_DEV = process.env.NODE_ENV === "development" || !!process.env.npm_lifecycle_event;
function isPrivateIp(ip) {
  if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|0\.|127\.)/.test(ip)) return true;
  if (/^(::1|fe80:|fc00:|fd00:|::ffff:(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|0\.))/.test(ip)) return true;
  return false;
}
async function validateExternalUrl(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Invalid URL");
  }
  const isLocalDev = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (isLocalDev && !IS_DEV) {
    throw new Error("Localhost URLs are only allowed in development mode");
  }
  if (parsed.protocol !== "https:" && !(isLocalDev && parsed.protocol === "http:")) {
    throw new Error("Only HTTPS URLs are allowed");
  }
  if (!isLocalDev) {
    try {
      const { address } = await dns.lookup(parsed.hostname);
      if (isPrivateIp(address)) {
        throw new Error("URLs resolving to private/internal IPs are not allowed");
      }
    } catch (err) {
      if (err.message.includes("private") || err.message.includes("internal")) throw err;
      throw new Error(`DNS resolution failed for ${parsed.hostname}`);
    }
  }
  return parsed;
}
async function safeFetch(url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      redirect: "error"
      // Block redirects to prevent SSRF bypass
    });
    const cl = res.headers.get("content-length");
    if (cl && parseInt(cl, 10) > MAX_RESPONSE_BYTES) {
      throw new Error("Response too large");
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}
async function safeReadText(res) {
  if (!res.body) return res.text();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        reader.cancel();
        throw new Error("Response too large");
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
  } finally {
    reader.releaseLock();
  }
  return chunks.join("");
}
async function listHtmlFiles(dir, base = "") {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    const relativePath = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory() && entry.name !== "node_modules" && !entry.name.startsWith(".")) {
      const children = await listHtmlFiles(path2.join(dir, entry.name), relativePath);
      results.push(...children);
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      results.push({ name: entry.name, path: relativePath, isDirectory: false });
    }
  }
  return results;
}
function registerFileRoutes(app2, projectDir2) {
  app2.addHook("onRequest", async (request, reply) => {
    const url = request.url;
    if (url !== "/api/files" && !url.startsWith("/api/files/") && url.match(/^\/(etc|var|tmp|home|root|sys|proc|dev|usr|lib|bin)\b/i)) {
      return reply.status(403).send({ error: "forbidden", message: "Path outside project directory" });
    }
  });
  app2.get("/api/files", async () => {
    return listHtmlFiles(projectDir2);
  });
  app2.get("/api/files/*", async (request, reply) => {
    const filePath = request.params["*"];
    let resolved;
    try {
      resolved = resolveSafePath(projectDir2, filePath);
    } catch {
      return reply.status(403).send({ error: "forbidden", message: "Path outside project directory" });
    }
    try {
      const content = await fs.readFile(resolved, "utf-8");
      templates.set(filePath, parseHtmlTemplate(content));
      return reply.type("text/html").send(content);
    } catch {
      return reply.status(404).send({ error: "not_found", message: "File not found" });
    }
  });
  app2.put("/api/files/*", async (request, reply) => {
    const filePath = request.params["*"];
    let resolved;
    try {
      resolved = resolveSafePath(projectDir2, filePath);
    } catch {
      return reply.status(403).send({ error: "forbidden", message: "Path outside project directory" });
    }
    const { html, css } = request.body;
    const template = templates.get(filePath);
    let output;
    if (template) {
      output = recombineHtml(template, html, css);
    } else {
      output = recombineHtml(
        { doctype: "<!DOCTYPE html>", htmlAttributes: "", head: "", bodyAttributes: "" },
        html,
        css
      );
    }
    await fs.writeFile(resolved, output, "utf-8");
    templates.set(filePath, parseHtmlTemplate(output));
    return { success: true };
  });
  app2.post("/api/files/fetch-remote", async (request, reply) => {
    const body = request.body;
    if (!body || typeof body !== "object") {
      return reply.status(400).send({ error: "bad_request", message: "JSON body required" });
    }
    const { url, filename } = body;
    if (!url || !filename) {
      return reply.status(400).send({ error: "bad_request", message: "url and filename required" });
    }
    try {
      await validateExternalUrl(url);
    } catch (err) {
      return reply.status(400).send({ error: "bad_request", message: err.message });
    }
    let resolved;
    try {
      resolved = resolveSafePath(projectDir2, filename);
    } catch {
      return reply.status(403).send({ error: "forbidden", message: "Path outside project directory" });
    }
    try {
      const res = await safeFetch(url);
      if (!res.ok) {
        return reply.status(502).send({ error: "fetch_failed", message: `Remote returned ${res.status}` });
      }
      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
        return reply.status(400).send({ error: "bad_request", message: "Response is not HTML" });
      }
      const content = await safeReadText(res);
      await fs.writeFile(resolved, content, "utf-8");
      templates.set(filename, parseHtmlTemplate(content));
      return { success: true, path: filename };
    } catch (err) {
      return reply.status(502).send({ error: "fetch_failed", message: err.message });
    }
  });
  app2.post("/api/files/emir-sync", async (request, reply) => {
    const body = request.body;
    if (!body || typeof body !== "object") {
      return reply.status(400).send({ error: "bad_request", message: "JSON body required" });
    }
    const { url, html, sync_token } = body;
    if (!url || !html || !sync_token) {
      return reply.status(400).send({ error: "bad_request", message: "url, html, and sync_token required" });
    }
    try {
      await validateExternalUrl(url);
    } catch (err) {
      return reply.status(400).send({ error: "bad_request", message: err.message });
    }
    try {
      const res = await safeFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html, sync_token })
      });
      if (!res.ok) {
        const errBody = await safeReadText(res).catch(() => "Unknown error");
        return reply.status(res.status).send({ error: "emir_error", message: errBody.slice(0, 1e3) });
      }
      return { success: true };
    } catch (err) {
      return reply.status(502).send({ error: "sync_failed", message: err.message });
    }
  });
  app2.post("/api/files/emir-revise", async (request, reply) => {
    const body = request.body;
    if (!body || typeof body !== "object") {
      return reply.status(400).send({ error: "bad_request", message: "JSON body required" });
    }
    const { emir_api, proposal_id, html, message, sync_token } = body;
    if (!emir_api || !proposal_id || !html || !message || !sync_token) {
      return reply.status(400).send({
        error: "bad_request",
        message: "emir_api, proposal_id, html, message, and sync_token required"
      });
    }
    try {
      await validateExternalUrl(emir_api);
    } catch (err) {
      return reply.status(400).send({ error: "bad_request", message: err.message });
    }
    const url = `${emir_api.replace(/\/+$/, "")}/api/proposals/${encodeURIComponent(proposal_id)}/revise-html`;
    try {
      const res = await safeFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html, message, sync_token })
      });
      if (!res.ok) {
        const errBody = await safeReadText(res).catch(() => "Unknown error");
        return reply.status(res.status).send({ error: "emir_error", message: errBody.slice(0, 1e3) });
      }
      const result = await res.json();
      return result;
    } catch (err) {
      return reply.status(502).send({ error: "revision_failed", message: err.message });
    }
  });
  app2.post("/api/files/emir-messages", async (request, reply) => {
    const body = request.body;
    if (!body || typeof body !== "object") {
      return reply.status(400).send({ error: "bad_request", message: "JSON body required" });
    }
    const { emir_api, proposal_id, sync_token } = body;
    if (!emir_api || !proposal_id || !sync_token) {
      return reply.status(400).send({ error: "bad_request", message: "emir_api, proposal_id, and sync_token required" });
    }
    try {
      await validateExternalUrl(emir_api);
    } catch (err) {
      return reply.status(400).send({ error: "bad_request", message: err.message });
    }
    const url = `${emir_api.replace(/\/+$/, "")}/api/proposals/${encodeURIComponent(proposal_id)}/messages/external?sync_token=${encodeURIComponent(sync_token)}&phase=revision`;
    try {
      const res = await safeFetch(url);
      if (!res.ok) {
        const errBody = await safeReadText(res).catch(() => "Unknown error");
        return reply.status(res.status).send({ error: "emir_error", message: errBody.slice(0, 1e3) });
      }
      const result = await res.json();
      return result;
    } catch (err) {
      return reply.status(502).send({ error: "fetch_failed", message: err.message });
    }
  });
  app2.post("/api/files", async (request, reply) => {
    const { filename, html, css } = request.body;
    let resolved;
    try {
      resolved = resolveSafePath(projectDir2, filename);
    } catch {
      return reply.status(403).send({ error: "forbidden", message: "Path outside project directory" });
    }
    const output = recombineHtml(
      { doctype: "<!DOCTYPE html>", htmlAttributes: "", head: "", bodyAttributes: "" },
      html,
      css
    );
    await fs.writeFile(resolved, output, "utf-8");
    templates.set(filename, parseHtmlTemplate(output));
    return reply.status(201).send({ success: true, path: filename });
  });
}

// src/server/routes/assets.ts
import fs2 from "fs/promises";
import path3 from "path";
var ALLOWED_EXTENSIONS = /* @__PURE__ */ new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"]);
function registerAssetRoutes(app2, projectDir2) {
  const assetsDir = path3.join(projectDir2, "assets");
  app2.get("/api/assets", async () => {
    try {
      const entries = await fs2.readdir(assetsDir, { withFileTypes: true });
      const assets = entries.filter((e) => e.isFile() && ALLOWED_EXTENSIONS.has(path3.extname(e.name).toLowerCase())).map((e) => ({ name: e.name, path: `assets/${e.name}` }));
      return assets;
    } catch {
      return [];
    }
  });
  app2.post("/api/assets", async (request, reply) => {
    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: "bad_request", message: "No file uploaded" });
    }
    const safeName = path3.basename(data.filename);
    if (!safeName || safeName === "." || safeName === "..") {
      return reply.status(400).send({ error: "bad_request", message: "Invalid filename" });
    }
    const ext = path3.extname(safeName).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return reply.status(400).send({
        error: "bad_request",
        message: `Unsupported file type: ${ext}. Allowed: ${[...ALLOWED_EXTENSIONS].join(", ")}`
      });
    }
    await fs2.mkdir(assetsDir, { recursive: true });
    const filePath = path3.join(assetsDir, safeName);
    const buffer = await data.toBuffer();
    await fs2.writeFile(filePath, buffer);
    return reply.status(201).send({ success: true, path: `assets/${safeName}` });
  });
}

// src/server/utils/pdf-renderer.ts
import puppeteer from "puppeteer";
var FORMAT_OPTIONS = {
  "a4": { format: "A4", printBackground: true },
  "16:9": { width: "13.333in", height: "7.5in", printBackground: true },
  "4:3": { width: "10in", height: "7.5in", printBackground: true }
};
async function renderPdf(html, options = {}) {
  const format = options.format || "a4";
  const pdfOptions = FORMAT_OPTIONS[format];
  const serverPort = options.serverPort || 3e3;
  const origin = `http://127.0.0.1:${serverPort}`;
  const baseTag = `<base href="${origin}/project/">`;
  let prepared = html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);
  prepared = prepared.replace(
    /(<style[^>]*>)([\s\S]*?)(<\/style>)/gi,
    (_match, open, css, close) => open + css.replace(/url\(\s*(['"]?)\/project\//g, `url($1${origin}/project/`) + close
  );
  prepared = prepared.replace(
    /style="([^"]*)"/gi,
    (_match, styleVal) => `style="${styleVal.replace(/url\(\s*(['"]?)\/project\//g, `url($1${origin}/project/`)}"`
  );
  prepared = prepared.replace(
    /style='([^']*)'/gi,
    (_match, styleVal) => `style='${styleVal.replace(/url\(\s*(['"]?)\/project\//g, `url($1${origin}/project/`)}'`
  );
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(prepared, { waitUntil: "networkidle0", timeout: 25e3 });
    const pdf = await page.pdf(pdfOptions);
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

// src/server/routes/export.ts
function registerExportRoutes(app2, port2) {
  app2.post("/api/export/pdf", async (request, reply) => {
    const body = request.body;
    if (!body.html) {
      return reply.status(400).send({ error: "bad_request", message: "html field is required" });
    }
    try {
      const pdf = await renderPdf(body.html, { format: body.format, serverPort: port2 });
      return reply.header("Content-Type", "application/pdf").header("Content-Disposition", 'attachment; filename="export.pdf"').send(pdf);
    } catch (err) {
      const message = err instanceof Error ? err.message : "PDF export failed";
      return reply.status(500).send({ error: "export_failed", message });
    }
  });
}

// src/server/index.ts
var __dirname2 = path4.dirname(fileURLToPath(import.meta.url));
var args = process.argv.slice(2);
var dirIndex = args.indexOf("--dir");
var projectDir = dirIndex !== -1 ? path4.resolve(args[dirIndex + 1]) : path4.resolve(".");
var portIndex = args.indexOf("--port");
var port = portIndex !== -1 ? parseInt(args[portIndex + 1], 10) : 3e3;
var hostIndex = args.indexOf("--host");
var host = hostIndex !== -1 ? args[hostIndex + 1] : "127.0.0.1";
var app = Fastify({ logger: true });
async function start() {
  await app.register(fastifyCors, {
    origin: true
  });
  await app.register(fastifyMultipart, { limits: { fileSize: 10 * 1024 * 1024 } });
  await app.register(fastifyStatic, {
    root: projectDir,
    prefix: "/project/",
    decorateReply: false
  });
  const extractedAssetsDir = path4.join(projectDir, "extracted_assets");
  await app.register(fastifyStatic, {
    root: extractedAssetsDir,
    prefix: "/extracted_assets/",
    decorateReply: false
  });
  const clientDir = path4.resolve(__dirname2, "../client");
  try {
    await app.register(fastifyStatic, {
      root: clientDir,
      prefix: "/",
      decorateReply: false
    });
  } catch {
  }
  registerFileRoutes(app, projectDir);
  registerAssetRoutes(app, projectDir);
  registerExportRoutes(app, port);
  await app.listen({ port, host });
  console.log(`
PageSmith running at http://${host}:${port}`);
  console.log(`Project directory: ${projectDir}
`);
  const isDevBackend = process.env.npm_lifecycle_event === "dev:server";
  if (process.env.NODE_ENV !== "test" && !isDevBackend) {
    const open = (await import("open")).default;
    await open(`http://127.0.0.1:${port}`);
  }
}
start().catch((err) => {
  console.error(err);
  process.exit(1);
});
export {
  app,
  projectDir
};
//# sourceMappingURL=index.js.map