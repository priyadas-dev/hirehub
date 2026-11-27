/** @type {import('md-to-pdf/dist/config').Config} */
module.exports = {
  basedir: __dirname,
  document_title: "HireHub Assessment 4 Submission Report — Memory Layer",
  pdf_options: {
    format: "A4",
    printBackground: true,
    margin: { top: "16mm", right: "14mm", bottom: "16mm", left: "14mm" },
  },
  css: `
    body { font-family: Segoe UI, Helvetica, Arial, sans-serif; font-size: 11pt; line-height: 1.45; color: #111; }
    h1, h2, h3 { color: #0f3d2e; }
    img { max-width: 100%; height: auto; border: 1px solid #ddd; border-radius: 6px; margin: 8px 0 16px; }
    table { border-collapse: collapse; width: 100%; font-size: 10pt; }
    th, td { border: 1px solid #ccc; padding: 6px 8px; vertical-align: top; }
    th { background: #eef6f2; }
    code { font-size: 9.5pt; }
    pre { background: #f6f8f7; padding: 10px; overflow: auto; border-radius: 6px; }
  `,
};
