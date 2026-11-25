/**
 * Extract architecture pages from the polished Assessment 3 reference PDF.
 */
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pdf } from "pdf-to-img";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, "..");
const src = resolve(
  process.env.USERPROFILE || "",
  ".cursor/projects/c-Users-SJI-Desktop-project-hirehub/attachments/3e07e5c5-20f2-4487-a6f3-37bc6d4e2f1a/assessment-3-submission__1__1.pdf",
);

const wanted = {
  1: "a3-ref-cover.png",
  2: "a3-ref-links.png",
  3: "a3-arch-nested-plane.png",
  4: "a3-arch-plane-map.png",
};

const document = await pdf(src, { scale: 2.5 });
let page = 1;
for await (const image of document) {
  const name = wanted[page];
  if (name) {
    const dest = resolve(outDir, name);
    await writeFile(dest, image);
    console.log("wrote", name, image.length);
  }
  page += 1;
  if (page > 4) break;
}
console.log("done");
