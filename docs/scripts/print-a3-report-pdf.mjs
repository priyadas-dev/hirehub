import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import puppeteer from "puppeteer";

const __dirname = dirname(fileURLToPath(import.meta.url));
const htmlPath = resolve(__dirname, "../ASSESSMENT_3_SUBMISSION_REPORT.html");
const outPath = resolve(__dirname, "../ASSESSMENT_3_SUBMISSION_REPORT.pdf");

const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});
const page = await browser.newPage();
await page.goto(pathToFileURL(htmlPath).href, {
  waitUntil: ["load", "networkidle0"],
  timeout: 120000,
});
await page.pdf({
  path: outPath,
  format: "A4",
  printBackground: true,
  margin: { top: "12mm", right: "10mm", bottom: "12mm", left: "10mm" },
});
await browser.close();
console.log("wrote", outPath);
