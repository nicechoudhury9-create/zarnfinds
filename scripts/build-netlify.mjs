import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(root, "..");
const publicDir = join(projectRoot, "public");

const files = [
  "home.html",
  "finds.html",
  "contact.html",
  "admin.html",
  "mmp.png",
  "BAG.jpg",
  "CARGO WMN.jpg",
  "CLOGS.jpg",
  "CROP TOP.jpg",
  "SIDE SLIT.jpg",
  "TAILOR PANTS.jpg",
  "TEE.jpg",
  "TROUSER WMN.jpg"
];

await rm(publicDir, { recursive: true, force: true });
await mkdir(publicDir, { recursive: true });
await cp(join(projectRoot, "assets"), join(publicDir, "assets"), { recursive: true });

for (const file of files) {
  await cp(join(projectRoot, file), join(publicDir, file));
}

console.log("Netlify public folder built.");
