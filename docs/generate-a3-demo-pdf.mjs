import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, "Assessment3_Demo_Live_Guide_Priya.pdf");

const doc = new PDFDocument({
  margin: 48,
  size: "A4",
  info: {
    Title: "HireHub Assessment 3 — Live Demo Guide",
    Author: "Priya Das",
  },
});

const stream = fs.createWriteStream(outPath);
doc.pipe(stream);

const PAGE_W = 595.28;
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;

function ensureSpace(needed = 80) {
  if (doc.y + needed > doc.page.height - MARGIN) {
    doc.addPage();
  }
}

function h1(text) {
  ensureSpace(44);
  doc.moveDown(0.35);
  doc.font("Helvetica-Bold").fontSize(16).fillColor("#0f172a").text(text, { width: CONTENT_W });
  doc.moveDown(0.35);
}

function h2(text) {
  ensureSpace(36);
  doc.moveDown(0.25);
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#1e3a5f").text(text, { width: CONTENT_W });
  doc.moveDown(0.2);
}

function body(text) {
  ensureSpace(28);
  doc.font("Helvetica").fontSize(10.5).fillColor("#334155").text(text, { width: CONTENT_W, lineGap: 2.5 });
  doc.moveDown(0.25);
}

function arrow(text) {
  ensureSpace(22);
  doc.font("Helvetica").fontSize(10.5).fillColor("#0f172a").text(`→  ${text}`, {
    width: CONTENT_W,
    lineGap: 2,
  });
  doc.moveDown(0.12);
}

function check(text) {
  ensureSpace(20);
  doc.font("Helvetica").fontSize(10).fillColor("#166534").text(`✓  Check: ${text}`, {
    width: CONTENT_W,
  });
  doc.moveDown(0.1);
}

function prompt(text) {
  ensureSpace(20);
  doc.font("Courier").fontSize(10).fillColor("#1e40af").text(`   "${text}"`, { width: CONTENT_W });
  doc.moveDown(0.1);
}

function tip(text) {
  ensureSpace(22);
  doc.font("Helvetica-Oblique").fontSize(9.5).fillColor("#64748b").text(`Tip: ${text}`, {
    width: CONTENT_W,
  });
  doc.moveDown(0.2);
}

function hr() {
  ensureSpace(16);
  doc.moveDown(0.25);
  doc
    .strokeColor("#cbd5e1")
    .lineWidth(0.8)
    .moveTo(MARGIN, doc.y)
    .lineTo(PAGE_W - MARGIN, doc.y)
    .stroke();
  doc.moveDown(0.45);
}

/** Big script part title */
function scriptPart(title) {
  ensureSpace(70);
  doc.moveDown(0.7);
  // soft band
  const y = doc.y;
  doc.save();
  doc.roundedRect(MARGIN, y, CONTENT_W, 28, 4).fill("#e8eef7");
  doc.restore();
  doc
    .font("Helvetica-Bold")
    .fontSize(13)
    .fillColor("#0f2744")
    .text(title, MARGIN + 10, y + 7, { width: CONTENT_W - 20 });
  doc.y = y + 36;
  doc.moveDown(0.35);
}

/** One spoken paragraph — large + airy */
function say(text) {
  ensureSpace(48);
  doc.font("Helvetica").fontSize(12).fillColor("#0f172a").text(text, {
    width: CONTENT_W,
    lineGap: 4,
    align: "left",
  });
  doc.moveDown(0.55);
}

function stage(text) {
  ensureSpace(28);
  doc.font("Helvetica-Oblique").fontSize(10).fillColor("#64748b").text(`[ ${text} ]`, {
    width: CONTENT_W,
  });
  doc.moveDown(0.35);
}

// ===== COVER =====
doc.font("Helvetica-Bold").fontSize(20).fillColor("#0f172a").text("HireHub — Assessment 3", {
  width: CONTENT_W,
  align: "center",
});
doc.moveDown(0.3);
doc.font("Helvetica-Bold").fontSize(14).fillColor("#1e3a5f").text("Live Demo Guide", {
  width: CONTENT_W,
  align: "center",
});
doc.moveDown(0.45);
doc
  .font("Helvetica")
  .fontSize(11)
  .fillColor("#475569")
  .text("Order on video:", {
    width: CONTENT_W,
    align: "center",
  });
doc.moveDown(0.15);
doc
  .font("Helvetica-Bold")
  .fontSize(11)
  .fillColor("#0f172a")
  .text("1) Third-party   →   2) CRM   →   3) Multi-agent", {
    width: CONTENT_W,
    align: "center",
  });
doc.moveDown(0.4);
doc
  .font("Helvetica")
  .fontSize(10)
  .fillColor("#64748b")
  .text("Priya Das  ·  https://capture-replay-tool.vercel.app/", {
    width: CONTENT_W,
    align: "center",
  });
doc.moveDown(0.15);
doc
  .font("Helvetica")
  .fontSize(10)
  .fillColor("#64748b")
  .text("Simple English  ·  About 4–6 minutes", {
    width: CONTENT_W,
    align: "center",
  });

hr();
body("You already know the three logins. On camera follow this order: Third-party first, then CRM, then Multi-agent.");

// ===== STEPS (compact) =====
h1("PART A — What to click (short)");

h2("1) Third-party");
arrow("Recruiter → Applicants → change status → check inbox (Resend email)");
arrow("Applicants → Schedule interview → open Google Calendar");
arrow("Open email → Campaign tracking → sent / delivered / opened (webhook)");
check("Say: webhook checks signature. Bad signature is blocked.");

h2("2) CRM");
arrow("CRM → Contacts (your email) → Segments (new / active / placed)");
arrow("Campaigns → New → Subject + Body → Preview → Confirm send");
arrow("Tracking: sent / opened  ·  Send again = no full duplicate");

h2("3) Multi-agent");
body("Seeker assistant prompts:");
prompt("Find React developer jobs in Dhaka");
prompt("Only show me jobs for young male candidates under 30");
prompt("Apply to the first job");
prompt("Apply to the same job again");
prompt("What is the status of my applications?");
doc.moveDown(0.25);
body("Recruiter agent prompts:");
prompt("Shortlist candidates for <YOUR JOB TITLE>");
prompt("Draft outreach email for the top candidate");
arrow("Also open resume → this recruiter can see · other recruiter blocked");

hr();

// ===== FULL SCRIPT — BIG TEXT =====
doc.addPage();

doc.font("Helvetica-Bold").fontSize(18).fillColor("#0f172a").text("FULL SPOKEN SCRIPT", {
  width: CONTENT_W,
  align: "center",
});
doc.moveDown(0.25);
doc
  .font("Helvetica")
  .fontSize(11)
  .fillColor("#64748b")
  .text("Read slowly. One box = one part. Pause when you click.", {
    width: CONTENT_W,
    align: "center",
  });
doc.moveDown(0.5);

// OPENING
scriptPart("OPENING");
stage("Show live app home / login");
say("Hi, I am Priya.");
say("This is HireHub for Assessment 3.");
say("HireHub is a job portal with three roles: Job Seeker, Recruiter, and Admin.");
say("Login is secure. The user role comes from the database, not from the browser.");
say("Today I will show three main parts.");
say("First — third-party integration.");
say("Second — CRM and campaigns.");
say("Third — the multi-agent AI system.");

// PART 1
scriptPart("PART 1 — THIRD-PARTY INTEGRATION");
stage("Login as Recruiter → Applicants");
say("Part one — third-party integration.");
say("HireHub connects to real free services.");
say("We use Resend for email.");
say("And we use Google Calendar for interviews.");
say("Here I am logged in as a recruiter.");
say("I open Applicants.");
say("I change one application status.");
say("HireHub sends a real status email through Resend.");
say("That is an outbound action.");

stage("Schedule interview → Google Calendar");
say("Next, I schedule an interview.");
say("HireHub creates a Google Calendar event.");
say("That is our second real service.");

stage("Open email → show tracking / webhook");
say("Emails also have an inbound webhook.");
say("When the email is delivered or opened, Resend sends a signed webhook back to HireHub.");
say("We verify the signature.");
say("If the signature is wrong, the request is blocked.");
say("Calendar also uses a signed webhook token.");

// PART 2
scriptPart("PART 2 — CRM AND CAMPAIGNS");
stage("Recruiter → CRM → Contacts");
say("Part two — CRM and campaigns.");
say("Now I open Recruiter CRM.");
say("Here I manage contacts.");
say("I can create a contact or import applicants.");

stage("Segments");
say("I have segments: new, active, and placed.");
say("This helps me group talent.");

stage("Campaigns → Preview → Confirm send → Tracking");
say("I create an email campaign.");
say("I write the subject and body.");
say("I preview the audience.");
say("Then I confirm send.");
say("The email goes out through Resend.");
say("In campaign tracking, I can see sent, delivered, and opened.");
say("So CRM has segments, outreach, and tracking — all in one place.");

// PART 3
scriptPart("PART 3 — MULTI-AGENT AI");
stage("Logout → Login as Seeker → AI Job Assistant");
say("Part three — multi-agent AI.");
say("Now I log in as a job seeker.");
say("I open the AI Job Assistant.");
say("HireHub uses a supervisor.");
say("The supervisor checks the message.");
say("It applies safety rules.");
say("It uses shared memory.");
say("Then it sends the work to the right agent.");

stage('Type: "Find React developer jobs in Dhaka"');
say("I ask for React developer jobs in Dhaka.");
say("The Discovery agent finds real approved jobs.");
say("It uses hybrid search and re-ranking.");
say("It does not invent fake jobs.");

stage('Type: "Only show me jobs for young male candidates under 30"');
say("Now a fairness test.");
say("I ask to show jobs only for young male candidates under thirty.");
say("The system refuses.");
say("Matching never uses age or gender.");

stage('Type: "Apply to the first job" → Confirm');
say("Next I ask to apply to the first job.");
say("The Application agent asks me to confirm first.");
say("I confirm.");
say("The application is saved with my resume.");

stage('Type: "Apply to the same job again"');
say("I try to apply again to the same job.");
say("The system blocks the duplicate.");
say("One job and one seeker can make only one application.");

stage('Type: "What is the status of my applications?"');
say("I ask for my application status.");
say("The agent shows my real status from the database.");

stage("Logout → Login as Recruiter → AI Recruiter Agent");
say("Now I switch to the recruiter agent.");
say("I ask it to shortlist candidates for my job.");
say("Again, it asks for confirmation.");
say("Then I ask it to draft an outreach email.");
say("It only drafts.");
say("It does not send automatically.");

stage("Applicants → open resume");
say("I also open a resume.");
say("Only the seeker and the hiring recruiter can see it.");
say("Another recruiter is blocked.");
say("Resume storage is private and secure.");

// CLOSE
scriptPart("CLOSING");
stage("Show metrics screenshot + GitHub Actions green");
say("Our job search corpus has twenty thousand jobs.");
say("Search quality improved from Hit at five of zero point five five to zero point seven zero.");
say("Our job category model Macro F1 is zero point eight six one.");
say("That is above the zero point eight five target.");
say("CI is green on GitHub Actions.");
say("We also use Sentry, rate limits, and secure resume access.");
say("That is HireHub Assessment 3.");
say("Real integrations. CRM campaigns. And safe multi-agent AI.");
say("Thank you.");

hr();
h1("Before you record");
arrow("Tabs ready: Live app · Gmail · Calendar · GitHub Actions · metrics");
arrow("Seeker resume already uploaded");
arrow("Recruiter job already has at least one applicant");
arrow("Use your own email in CRM");
arrow("Do not show passwords or API keys");
arrow("Order: Third-party → CRM → Multi-agent");

doc.moveDown(0.6);
doc
  .font("Helvetica-Oblique")
  .fontSize(9)
  .fillColor("#94a3b8")
  .text("SJ Innovation · Assessment 3 · HireHub · Demo guide for Priya Das", {
    width: CONTENT_W,
    align: "center",
  });

doc.end();

await new Promise((resolve, reject) => {
  stream.on("finish", resolve);
  stream.on("error", reject);
});

console.log("Wrote", outPath);