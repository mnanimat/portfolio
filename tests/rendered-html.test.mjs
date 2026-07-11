import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function readBundle(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const chunks = [];
  for (const entry of entries) {
    const url = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) chunks.push(await readBundle(url));
    else if (/\.(?:js|mjs|html|json|css)$/i.test(entry.name)) chunks.push(await readFile(url, "utf8"));
  }
  return chunks.join("\n");
}

test("production bundle contains the finished MN Animation experience", async () => {
  const bundle = await readBundle(new URL("../dist/", import.meta.url));
  assert.match(bundle, /MN Animation/i);
  assert.match(bundle, /Motion Forge/i);
  assert.match(bundle, /Fight Lab/i);
  assert.match(bundle, /Solicitar no WhatsApp/i);
  assert.doesNotMatch(bundle, /codex-preview|Starter Project|SkeletonPreview|react-loading-skeleton/i);
});

test("ships the 3D, PWA, social and upload assets", async () => {
  const required = [
    "public/models/moto-mn-optimized.glb",
    "public/draco/draco_decoder.wasm",
    "public/draco/draco_wasm_wrapper.js",
    "public/og.png",
    "public/icon-192.png",
    "public/icon-512.png",
    "public/manifest.webmanifest",
    "public/sw.js",
    "app/api/uploads/route.ts",
  ];
  await Promise.all(required.map((path) => access(new URL(path, root))));

  const [page, layout, packageJson, hosting, upload] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
    readFile(new URL(".openai/hosting.json", root), "utf8"),
    readFile(new URL("app/api/uploads/route.ts", root), "utf8"),
  ]);

  assert.match(page, /<MotoViewer\s*\/>/);
  assert.match(page, /<MotionForge\s*\/>/);
  assert.match(page, /<QuoteStudio\s*\/>/);
  assert.match(layout, /\/og\.png/);
  assert.match(layout, /manifest\.webmanifest/);
  assert.match(packageJson, /"name": "mn-animation-portfolio"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.equal(JSON.parse(hosting).r2, "CLIPS");
  assert.match(upload, /export async function POST/);
});
