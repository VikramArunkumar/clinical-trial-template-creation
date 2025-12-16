#!/usr/bin/env node
// === clincialtrialtemplate_server.js (complete fixed version) ===

import "dotenv/config";
import fs from "fs";
import path from "path";
import process from "process";
import { fileURLToPath } from "url";
import { createRequire } from "module";

import express from "express";
import cors from "cors";
import multer from "multer";
import { nanoid } from "nanoid";

import { ChatAnthropic } from "@langchain/anthropic";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { Embeddings } from "@langchain/core/embeddings";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { StateGraph, END, Annotation } from "@langchain/langgraph";
import { pipeline } from "@xenova/transformers";

// Import approval workflow and adaptive templates
import { ApprovalWorkflow } from "./approvalWorkflow.js";
import { AdaptiveTemplateEngine } from "./adaptiveTemplates.js";

// Import RAG and grounding validation
import { RAGKnowledgeBase } from "./ragKnowledgeBase.js";
import { FactualGroundingValidator } from "./groundingValidator.js";

console.log("ANTHROPIC_API_KEY present in process.env?", !!process.env.ANTHROPIC_API_KEY);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url); // <-- ESM-friendly require
const { Document, Packer, Paragraph } = require("docx"); 

// ---------------- Embeddings ----------------
class XenovaEmbeddings extends Embeddings {
  constructor({ model = "Xenova/all-MiniLM-L6-v2" } = {}) {
    super();
    this.model = model;
    this._pipePromise = null;
  }
  async _pipe() {
    if (!this._pipePromise) this._pipePromise = pipeline("feature-extraction", this.model);
    return this._pipePromise;
  }
  async embedQuery(text) {
    const pipe = await this._pipe();
    const output = await pipe(text, { pooling: "mean", normalize: true });
    return Array.from(output.data);
  }
  async embedDocuments(texts) {
    const pipe = await this._pipe();
    const out = [];
    for (const t of texts) {
      const res = await pipe(t, { pooling: "mean", normalize: true });
      out.push(Array.from(res.data));
    }
    return out;
  }
}

// ---------------- Simple in-memory Vector Store ----------------
class SimpleVectorStore {
  constructor(embeddings) {
    this.embeddings = embeddings;
    this.items = [];
  }
  static _cosine(a, b) {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-12);
  }
  async addDocuments(docs) {
    const texts = docs.map(d => d.pageContent);
    const vecs = await this.embeddings.embedDocuments(texts);
    for (let i = 0; i < docs.length; i++) {
      this.items.push({ text: texts[i], metadata: docs[i].metadata || {}, vector: vecs[i] });
    }
  }
  asRetriever({ k = 4 } = {}) {
    return {
      getRelevantDocuments: async (query) => {
        const q = await this.embeddings.embedQuery(query);
        const scored = this.items.map(it => ({ it, score: SimpleVectorStore._cosine(q, it.vector) }));
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, k).map(s => ({ pageContent: s.it.text, metadata: s.it.metadata, score: s.score }));
      }
    };
  }
}

// ---------------- PDF ingestion ----------------
async function extractTextFromPDF(filePath) {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs"); // lazy load
  const data = new Uint8Array(fs.readFileSync(filePath));
   // Tell PDF.js where its standard fonts live to avoid the warning/error
  const pdfjsPkgDir = path.dirname(require.resolve("pdfjs-dist/package.json"));
  const loadingTask = pdfjsLib.getDocument({
    data,
    standardFontDataUrl: path.join(pdfjsPkgDir, "standard_fonts/"),
  });

  const pdfDoc = await loadingTask.promise;
  let out = "";
  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const textContent = await page.getTextContent();
    const strings = textContent.items.map(it => ("str" in it ? it.str : "")).filter(Boolean);
    out += strings.join(" ") + "\n\n";
  }
  return out.trim();
}

async function loadPDFs(dir) {
  if (!fs.existsSync(dir)) {
    console.warn("PDF directory does not exist:", dir);
    return [];
  }

  const files = fs.readdirSync(dir);
  const pdfs = files.filter(f => f.toLowerCase().endsWith(".pdf"));

  if (pdfs.length === 0) {
    console.warn("No PDFs found to ingest in:", dir);
    return [];
  }

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1200,
    chunkOverlap: 150
  });

  const docs = [];
  for (const fn of pdfs) {
    const full = path.join(dir, fn);
    const text = await extractTextFromPDF(full);
    const chunks = await splitter.splitText(text || "");
    chunks.forEach((chunk, i) =>
      docs.push({
        pageContent: chunk,
        metadata: { source: full, chunk: i }
      })
    );
  }
  return docs;
}


// ---------------- LangGraph pipeline ----------------
function getLLM() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Set ANTHROPIC_API_KEY");
  const model = process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022"; // claude-3-haiku-20240307
  return new ChatAnthropic({ apiKey, model, temperature: 0.2 });
}

const DRAFT_PROMPT = ChatPromptTemplate.fromMessages([
  ["system", "You are a clinical-trial documentation assistant. Write clear, precise, compliant text. Follow retrieved guidance carefully and avoid ambiguous statements."],
  ["human", "TASK: {task}\n\nCONTEXT (guidance snippets):\n{context}\n\nWrite the requested section. Use neutral tone and professional clinical-trial style."]
]);

const REVISION_PROMPT = ChatPromptTemplate.fromMessages([
  ["system", "You are a meticulous compliance editor for clinical-trial documents."],
  ["human", "Revise the DRAFT to resolve the following compliance issues. Preserve meaning and structure.\n\nDRAFT:\n{draft}\n\nCOMPLIANCE ISSUES:\n{issues}\n\nReturn the full revised text, improved but not overly verbose."]
]);

const COMPLIANCE_PROMPT = ChatPromptTemplate.fromMessages([
  ["system",
   "You are a senior clinical-trial regulatory specialist. "
   + "Review the text for potential compliance risks against ICH E6(R2) GCP principles, "
   + "informed consent requirements, safety reporting, data protection/privacy, "
   + "and typical FDA/EMA expectations. "
   + "You are assisting a human QA/RA reviewer; you do NOT give legal advice."],
  ["human",
   "TEXT TO REVIEW:\n\n{draft}\n\n"
   + "RELEVANT GUIDANCE EXCERPTS:\n\n{context}\n\n"
   + "Identify concrete, text-level issues. For each issue, provide:\n"
   + "- rule: a short code (e.g., 'ICH_E6_informed_consent', 'GCP_safety_reporting', 'data_protection', 'protocol_clarity')\n"
   + "- message: what might be non-compliant or unclear\n"
   + "- severity: low / medium / high\n\n"
   + "Return one issue per line in this format:\n"
   + "rule | severity | message\n\n"
   + "If there are no issues, return: OK\n"]
]);


function complianceCheck(text) {
  const issues = [];
  if (/\bTBD\b/i.test(text) || /to be determined/i.test(text)) issues.push({ rule: "no_placeholders", message: "Remove TBD/placeholder language." });
  if (/risk/i.test(text) && !/mitigation/i.test(text)) issues.push({ rule: "risk_mitigation", message: "Mention risk mitigation when risks are discussed." });
  if (/consent/i.test(text) && !/withdraw/i.test(text)) issues.push({ rule: "consent_withdrawal", message: "State withdrawal rights in consent context." });
  const wc = (text.trim().match(/\S+/g) || []).length; if (wc < 150) issues.push({ rule: "min_length", message: "Provide at least ~150 words for sufficient detail." });
  return { ok: issues.length === 0, issues };
}

async function llmComplianceCheck(text) {
  const llm = getLLM();

   // Optional: retrieve from regulatory guidance
  const regVS = await ensureRegulatoryVS();
  const retriever = regVS.asRetriever({ k: 4 });
  const guidanceDocs = await retriever.getRelevantDocuments(text);
  const guidanceContext = guidanceDocs.map(d => d.pageContent).join("\n\n").slice(0, 4000);


  const chain = COMPLIANCE_PROMPT.pipe(llm).pipe(new StringOutputParser());
  const raw = await chain.invoke({ draft: text || "" ,  context: guidanceContext});
  const issues = [];

  // If the model says OK → no issues
  if (/^\s*OK\s*$/i.test(raw.trim())) {
    return { ok: true, issues: [] };
  }

  // Expect lines like: rule | severity | message
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split("|").map(p => p.trim());
    if (parts.length < 3) continue;
    const [rule, severity, message] = parts;
    issues.push({
      rule,
      severity,
      message,
      source: "LLM_ICH_GCP_FDA_heuristic"
    });

  }

  return { ok: issues.length === 0, issues };
}

// If you store guidance docs in a separate folder:
async function ensureRegulatoryVS() {
  const embeddings = new XenovaEmbeddings();
  const vs = new SimpleVectorStore(embeddings);
  const docs = await loadPDFs(path.join(__dirname, "uploads", "guidance"));
  await vs.addDocuments(docs);
  return vs;
}



function fmtContext(docs) {
  return docs.map((d, i) => `- [${i + 1}] (${path.basename(d.metadata?.source || "doc")}) ${String(d.pageContent).replace(/\n/g, " ").slice(0, 350)}...`).join("\n");
}

function makeRetrieveNode(retriever) {
  return async (state) => {
    const docs = await retriever.getRelevantDocuments(state.task);
    return { context: fmtContext(docs) };
  };
}

async function draftNode(state) {
  const llm = getLLM();
  const chain = DRAFT_PROMPT.pipe(llm).pipe(new StringOutputParser());
  const draft = await chain.invoke({ task: state.task, context: state.context || "" });
  return { draft };
}

/*
async function checkNode(state) {
  const res = complianceCheck(state.draft || "");
  return { issues: res.issues };
}
  */

async function checkNode(state) {
  const res = await llmComplianceCheck(state.draft || "");
  return { issues: res.issues };
}


async function reviseNode(state) {
  const llm = getLLM();
  const issuesStr = (state.issues || []).map(i => `- ${i.rule}: ${i.message}`).join("\n");
  const chain = REVISION_PROMPT.pipe(llm).pipe(new StringOutputParser());
  const revised = await chain.invoke({ draft: state.draft || "", issues: issuesStr });
  return { draft: revised, i: (state.i || 0) + 1 };
}

function decideNext(state) {
  const issues = state.issues || [];
  if (issues.length === 0) return "end";
  if ((state.i || 0) >= (state.maxIters ?? 2)) return "end";  //
  return "revise";
}

const DocState = Annotation.Root({
  task: Annotation(),
  context: Annotation(),
  draft: Annotation(),
  issues: Annotation(),
  i: Annotation({ reducer: (_, next) => next }),
  maxIters: Annotation(),
});

function buildGraph(retriever) {
  const graph = new StateGraph(DocState);
  graph.addNode("retrieve", makeRetrieveNode(retriever));
  graph.addNode("draft_step", draftNode);
  graph.addNode("check", checkNode);
  graph.addNode("revise", reviseNode);
  graph.setEntryPoint("retrieve");
  graph.addEdge("retrieve", "draft_step");
  graph.addEdge("draft_step", "check");
  graph.addConditionalEdges("check", decideNext, { revise: "revise", end: END });
  graph.addEdge("revise", "check");
  return graph.compile();
}

// ---------------- Server & UI ----------------
const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));

const uploadDir = path.join(__dirname, "uploads", "pdfs");
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir });

let GLOBAL_VS = null;

// Initialize approval workflow and adaptive templates
const auditLogsDir = path.join(__dirname, "audit_logs");
const complianceRulesDir = path.join(__dirname, "compliance_rules");
const knowledgeDir = path.join(__dirname, "knowledge_base");
const evaluationsDir = path.join(__dirname, "evaluations");

const approvalWorkflow = new ApprovalWorkflow({ storePath: auditLogsDir });
const adaptiveTemplates = new AdaptiveTemplateEngine({ rulesDir: complianceRulesDir });
const ragKnowledgeBase = new RAGKnowledgeBase({ knowledgeDir });
const groundingValidator = new FactualGroundingValidator({ evaluationsDir, complianceRulesPath: complianceRulesDir });

async function ensureVS(pdfDir = uploadDir) {
  if (GLOBAL_VS) return GLOBAL_VS;
  const embeddings = new XenovaEmbeddings();
  const vs = new SimpleVectorStore(embeddings);
  try {
    const docs = await loadPDFs(pdfDir);
    await vs.addDocuments(docs);
  } catch (_) {}
  GLOBAL_VS = vs;
  return vs;
}

const jobs = new Map();
function pushEvent(jobId, payload) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.events.push(payload);
  if (job.emitter) job.emitter.write(`data: ${JSON.stringify(payload)}\n\n`);
}

// UI page (escaped ${} in script)
app.get("/", (_req, res) => {
  res.type("html").send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ClinicalTrialTemplateScriber UI</title>
  <style>
    body{font-family:system-ui,Arial,sans-serif;margin:0;background:#0b1020;color:#e7ecf3}
    header{padding:16px 24px;border-bottom:1px solid #1c2340;display:flex;gap:12px;align-items:center}
    main{display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:16px}
    section{background:#121938;border:1px solid #1c2340;border-radius:12px;padding:16px}
    h2{margin:0 0 8px 0;font-size:18px}
    textarea,input,button{font:inherit}
    textarea{width:100%;min-height:160px;background:#0e1530;color:#e7ecf3;border:1px solid #26305c;border-radius:8px;padding:10px}
    input[type="text"],input[type="password"]{width:100%;background:#0e1530;color:#e7ecf3;border:1px solid #26305c;border-radius:8px;padding:8px}
    .row{display:flex;gap:8px;align-items:center}
    .row-wrap{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
    .tag{display:inline-block;padding:2px 8px;border-radius:999px;background:#1e274d;color:#9db0ff;border:1px solid #2b3770;font-size:12px}
    .log{white-space:pre-wrap;font-family:ui-monospace,Menlo,Consolas,monospace;background:#0d132b;border:1px solid #1f2750;border-radius:8px;padding:10px;max-height:260px;overflow:auto;font-size:11px}
    .ok{color:#7ee787}.warn{color:#f1c40f}.err{color:#ff7676}
    .pill{padding:4px 8px;border-radius:8px;background:#0e1530;border:1px solid #26305c;font-size:12px}
    .issues{margin:0;padding-left:18px;font-size:13px}
    .tabs{display:flex;gap:4px;margin-bottom:12px;border-bottom:1px solid #1c2340;padding-bottom:8px}
    .tab-btn{padding:6px 12px;background:#1c2340;border:none;color:#9db0ff;cursor:pointer;border-radius:4px}
    .tab-btn.active{background:#2b3770;color:#7ee787}
    .tab-content{display:none}
    .tab-content.active{display:block}
    .status-badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:bold}
    .status-draft{background:#1e274d;color:#9db0ff}
    .status-pending{background:#4a3500;color:#f1c40f}
    .status-approved{background:#1b3d2a;color:#7ee787}
    .status-rejected{background:#4a1515;color:#ff7676}
    button{background:#2b3770;color:#9db0ff;border:1px solid #3d4a99;padding:6px 12px;border-radius:6px;cursor:pointer}
    button:hover{background:#3d4a99}
    button.btn-approve{background:#1b3d2a;color:#7ee787}
    button.btn-approve:hover{background:#2a5c3f}
    button.btn-reject{background:#4a1515;color:#ff7676}
    button.btn-reject:hover{background:#6a2525}
    .rule-item{background:#0d132b;padding:8px;margin:4px 0;border-left:3px solid #2b3770;border-radius:4px;font-size:12px}
  </style>
</head>
<body>
  <header>
    <div style="font-weight:700;letter-spacing:.4px">ClinicalTrialTemplateScriber</div>
    <span class="tag">LangChain/LangGraph + Claude</span>
    <span class="tag">Local embeddings</span>
    <span class="tag">PDF ingestion</span>
    <span class="tag" style="background:#1b3d2a">Approval Workflow</span>
    <span class="tag" style="background:#4a3500">Adaptive Templates</span>
  </header>
  <main style="display:block">
    <!-- TABS -->
    <div style="background:#121938;border:1px solid #1c2340;border-radius:12px;padding:16px;margin-bottom:16px">
      <div class="tabs">
        <button class="tab-btn active" onclick="switchTab('tab-draft', event)">📝 Draft</button>
        <button class="tab-btn" onclick="switchTab('tab-approval', event)">✅ Approval Workflow</button>
        <button class="tab-btn" onclick="switchTab('tab-templates', event)">🎨 Adaptive Templates</button>
      </div>

      <!-- TAB 1: DRAFT -->
      <div id="tab-draft" class="tab-content active">
        <h2>Author - Draft Document</h2>
        <div class="row"><input id="task" type="text" placeholder="Describe the section to draft (e.g., Protocol Synopsis for Phase II oncology)"/></div>
        <div style="height:8px"></div>
        <div class="row"><input id="pdfdir" type="text" placeholder="Optional PDF folder (server)"/></div>
        <div style="height:8px"></div>
        <div class="row">
          <input id="file" type="file" accept="application/pdf" multiple/>
          <button type="button" id="upload">Upload PDFs</button>
          <button type="button" id="ingest">Ingest Server PDFs</button>
          <button type="button" id="run">Run</button>
        </div>
        <div style="height:8px"></div>
        <div class="log" id="stream"></div>
        
        <div style="height:16px"></div>
        <div class="pill"><strong>Final Draft</strong></div>
        <div id="final" class="log" style="min-height:120px"></div>

        <div style="height:8px"></div>
        <button type="button" id="exportDocx" style="width:auto">Export Final Draft to Word</button>
        <button type="button" id="submitApproval" style="width:auto">Submit for Approval</button>

        <div style="height:8px"></div>
        <div class="pill"><strong>Compliance Issues</strong></div>
        <ul id="issues" class="issues"></ul>
      </div>

      <!-- TAB 2: APPROVAL WORKFLOW -->
      <div id="tab-approval" class="tab-content">
        <h2>Approval Workflow - Draft → Validate → Approve</h2>
        
        <div class="row-wrap" style="margin-bottom:12px">
          <input id="approvalDocId" type="text" placeholder="Document ID" style="flex:1;min-width:150px"/>
          <button type="button" id="checkApprovalStatus" style="width:auto">Check Status</button>
          <button type="button" id="loadAuditTrail" style="width:auto">View Audit Trail</button>
          <button type="button" id="exportRegulatoryReport" style="width:auto">Export Report</button>
        </div>

        <div class="pill"><strong>Submission Status</strong></div>
        <div id="approvalStatus" class="log" style="min-height:80px"></div>

        <div style="height:12px"></div>
        <div class="row-wrap">
          <input id="approverName" type="text" placeholder="Your name (approver)" style="flex:1;min-width:150px"/>
          <textarea id="approverComments" placeholder="Approval comments..." style="flex:1;min-width:200px;min-height:60px;max-height:80px"></textarea>
        </div>

        <div class="row" style="margin-top:8px">
          <button type="button" id="approveBtn" class="btn-approve" style="flex:1">✓ Approve</button>
          <button type="button" id="rejectBtn" class="btn-reject" style="flex:1">✗ Reject</button>
        </div>

        <div style="height:12px"></div>
        <div class="pill"><strong>Audit Trail</strong></div>
        <div id="auditTrail" class="log" style="min-height:120px"></div>
      </div>

      <!-- TAB 3: ADAPTIVE TEMPLATES -->
      <div id="tab-templates" class="tab-content">
        <h2>Adaptive Template Management - Compliance Rules</h2>
        
        <div style="margin-bottom:12px">
          <h3 style="margin:8px 0">Add New Rule (Incremental Learning)</h3>
          <div class="row" style="margin-bottom:8px">
            <select id="ruleCategory" style="width:100%;background:#0e1530;color:#e7ecf3;border:1px solid #26305c;padding:8px">
              <option value="">-- Select Category --</option>
              <option value="informed_consent">Informed Consent</option>
              <option value="safety_reporting">Safety Reporting</option>
              <option value="data_protection">Data Protection</option>
              <option value="protocol_clarity">Protocol Clarity</option>
              <option value="risk_mitigation">Risk Mitigation</option>
              <option value="withdrawal_rights">Withdrawal Rights</option>
            </select>
          </div>
          <input id="ruleName" type="text" placeholder="Rule name (e.g., Must mention withdrawal rights)" style="margin-bottom:8px"/>
          <textarea id="ruleGuidance" placeholder="Detailed guidance text..." style="min-height:80px;margin-bottom:8px"></textarea>
          <div class="row">
            <select id="ruleSeverity" style="flex:1;background:#0e1530;color:#e7ecf3;border:1px solid #26305c;padding:8px">
              <option value="low">Low</option>
              <option value="medium" selected>Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
            <select id="ruleSource" style="flex:1;background:#0e1530;color:#e7ecf3;border:1px solid #26305c;padding:8px">
              <option value="user">User</option>
              <option value="FDA">FDA</option>
              <option value="EMA">EMA</option>
              <option value="ICH">ICH</option>
            </select>
            <button type="button" id="addRuleBtn" style="width:auto">Add Rule</button>
          </div>
        </div>

        <div style="height:12px;border-bottom:1px solid #1c2340"></div>

        <div style="margin-top:12px">
          <h3 style="margin:8px 0">Active Rules</h3>
          <div class="row" style="margin-bottom:8px">
            <input id="ruleQuery" type="text" placeholder="Search rules..." style="flex:1"/>
            <button type="button" id="searchRulesBtn" style="width:auto">Search</button>
            <button type="button" id="listAllRulesBtn" style="width:auto">List All</button>
          </div>
          <div id="rulesList" class="log" style="min-height:150px"></div>
        </div>

        <div style="height:12px;border-bottom:1px solid #1c2340"></div>

        <div style="margin-top:12px">
          <h3 style="margin:8px 0">Validate Document Against Rules</h3>
          <textarea id="docToValidate" placeholder="Paste document text to validate..." style="min-height:100px;margin-bottom:8px"></textarea>
          <button type="button" id="validateDocBtn" style="width:100%">Validate Document</button>
          <div id="validationResult" class="log" style="min-height:80px;margin-top:8px"></div>
        </div>

        <div style="height:12px;border-bottom:1px solid #1c2340"></div>

        <div style="margin-top:12px">
          <h3 style="margin:8px 0">Compliance Audit Report</h3>
          <button type="button" id="exportAuditReportBtn" style="width:100%">Generate Audit Report</button>
          <div id="auditReportOutput" class="log" style="min-height:120px;margin-top:8px"></div>
        </div>
      </div>
    </div>
  </main>
<script>
const $ = (s) => document.querySelector(s);
const streamEl = document.querySelector('#stream');
const finalEl = document.querySelector('#final');
const issuesEl = document.querySelector('#issues');

let lastFinalText = "";
let lastDocumentId = "";

// ========================================================================
// TAB SWITCHING
// ========================================================================
function switchTab(tabId, evt) {
  // Hide all tabs
  document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));

  // Show selected tab
  const tabEl = document.getElementById(tabId);
  if (tabEl) {
    tabEl.classList.add('active');
  }
  
  // Mark button active if event target is available
  if (evt && evt.target) {
    evt.target.classList.add('active');
  } else {
    // Fallback: find button by onclick attribute
    const buttons = document.querySelectorAll('.tab-btn');
    for (const btn of buttons) {
      if (btn.onclick && btn.onclick.toString().includes("'" + tabId + "'")) {
        btn.classList.add('active');
        break;
      }
    }
  }
}

// ========================================================================
// LOGGING
// ========================================================================
function log(txt, cls=''){
  const d = document.createElement('div');
  if(cls) d.className = cls;
  d.textContent = txt;
  streamEl.appendChild(d);
  streamEl.scrollTop = streamEl.scrollHeight;
}

async function postJSON(url, data){
  const res = await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  const text = await res.text();
  if(!res.ok){ throw new Error(\`HTTP \${res.status} \${res.statusText}: \${text}\`); }
  return text ? JSON.parse(text) : {};
}

async function getJSON(url){
  const res = await fetch(url,{method:'GET',headers:{'Content-Type':'application/json'}});
  const text = await res.text();
  if(!res.ok){ throw new Error(\`HTTP \${res.status} \${res.statusText}: \${text}\`); }
  return text ? JSON.parse(text) : {};
}

// ========================================================================
// DRAFT TAB FUNCTIONS
// ========================================================================

function log(txt, cls=''){
  const d = document.createElement('div');
  if(cls) d.className = cls;
  d.textContent = txt;
  streamEl.appendChild(d);
  streamEl.scrollTop = streamEl.scrollHeight;
}

async function postJSON(url, data){
  const res = await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  const text = await res.text();
  if(!res.ok){ throw new Error(\`HTTP \${res.status} \${res.statusText}: \${text}\`); }
  return text ? JSON.parse(text) : {};
}

document.querySelector('#upload').onclick = async () => {
  try{
    const files = document.querySelector('#file').files;
    if(!files.length) return alert('Choose PDF files first');
    const fd = new FormData();
    for(const f of files) fd.append('pdfs', f, f.name);
    log('Uploading PDFs…');
    const res = await fetch('/api/upload', {method:'POST', body:fd});
    const text = await res.text();
    if(!res.ok) throw new Error(\`Upload failed: \${text}\`);
    const data = text ? JSON.parse(text) : {};
    log(\`Uploaded \${data.files?.length ?? 0} file(s).\`, 'ok');
    alert('Uploaded. Click \"Ingest Server PDFs\" to index them.');
  }catch(err){
    console.error(err);
    log(\`Upload error: \${err.message}\`, 'err');
    alert(\`Upload error: \${err.message}\`);
  }
};

document.querySelector('#ingest').onclick = async () => {
  try{
    const dir = document.querySelector('#pdfdir').value || '';
    log(\`Ingesting PDFs from \"\${dir || 'uploads/pdfs'}\"…\`);
    const r = await postJSON('/api/ingest', { dir });
    log(r.message || 'Ingest complete.', 'ok');
    alert(r.message || 'Ingest complete.');
  }catch(err){
    console.error(err);
    log(\`Ingest error: \${err.message}\`, 'err');
    alert(\`Ingest error: \${err.message}\`);
  }
};

document.querySelector('#run').onclick = async () => {
  try{
    streamEl.textContent=''; finalEl.textContent=''; issuesEl.innerHTML='';
    const task = document.querySelector('#task').value || 'Write a \"Protocol Synopsis\" paragraph for a Phase II oncology trial including design, eligibility, primary endpoint, AE reporting, data protection, and informed consent.';
    log('Starting run…');
    const { jobId } = await postJSON('/api/run', { task, stream:true });
    if(!jobId) throw new Error('No jobId returned.');
    const es = new EventSource('/api/stream/' + jobId);
    es.onmessage = (e) => {
      try{
        const evt = JSON.parse(e.data);
        if(evt.type ==='node'){
          const { node, delta } = evt;
          if(delta?.context) log(\`[\${node}] context: \${delta.context.slice(0,160)}…\`, 'ok');
          if(delta?.draft)   log(\`[\${node}] draft: \${delta.draft.replace(/\\n/g,' ').slice(0,200)}…\`);
          if(Array.isArray(delta?.issues)){
            const rules = delta.issues.map(i=>i.rule).join(', ') || 'none';
            log(\`[\${node}] issues: \${rules}\`, delta.issues.length ? 'warn' : 'ok');
          }
          if(typeof delta?.i !== 'undefined') log(\`[\${node}] iteration: \${delta.i}\`);
        }

        if (evt.type === 'error') {
          log(\`Worker error: \${evt.error}\`, 'err');
        }


        if(evt.type==='final'){
          const draft = evt.final?.draft || '';
          const issues = Array.isArray(evt.final?.issues) ? evt.final.issues : [];
          finalEl.textContent = draft;
          lastFinalText = draft; 
          if (issues.length === 0) {
            issuesEl.innerHTML = '<li>No issues.</li>';
          } else {
            issuesEl.innerHTML = issues.map(i=> \`• <strong>\${i.rule}</strong> — \${i.message}\`).map(x=>\`<li>\${x}</li>\`).join('');
          }
          log('Final received.', 'ok');
        }
        if(evt.type==='done'){
          es.close();
          log('Run complete.', 'ok');
        }
      }catch(err){
        console.error(err);
        log(\`Stream parse error: \${err.message}\`, 'err');
      }
    };
    es.onerror = () => { es.close(); log('Stream closed (error).', 'warn'); };
  }catch(err){
    console.error(err);
    log(\`Run error: \${err.message}\`, 'err');
    alert(\`Run error: \${err.message}\`);
  }
};

document.querySelector('#exportDocx').onclick = async () => {
  try {
    const draft = (lastFinalText || finalEl.textContent || '').trim();
    if (!draft) {
      alert('No final draft to export yet.');
      return;
    }

    log('Exporting Word document…');

    const res = await fetch('/api/export-docx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ draft }),
    });

    if (!res.ok) {
      throw new Error(\`Export failed with HTTP \${res.status}\`);
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'clinicaltrialtemplate_output.docx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    log('Exported Word document.', 'ok');
  } catch (err) {
    console.error(err);
    log(\`Export error: \${err.message}\`, 'err');
    alert(\`Export error: \${err.message}\`);
  }
};

// ========================================================================
// APPROVAL WORKFLOW FUNCTIONS
// ========================================================================
document.querySelector('#submitApproval').onclick = async () => {
  try {
    if (!lastFinalText.trim()) {
      alert('No draft to submit');
      return;
    }
    const docId = prompt('Enter document ID:') || 'doc_' + Date.now();
    const task = document.querySelector('#task').value || 'Protocol Synopsis';
    
    const res = await postJSON('/api/approval/submit', {
      documentId: docId,
      task: task,
      draft: lastFinalText,
      actor: 'author'
    });
    
    lastDocumentId = docId;
    alert(\`Document submitted for approval! ID: \${docId}\`);
    document.querySelector('#approvalDocId').value = docId;
    switchTab('tab-approval');
  } catch (err) {
    console.error(err);
    alert(\`Submission error: \${err.message}\`);
  }
};

document.querySelector('#checkApprovalStatus').onclick = async () => {
  try {
    const docId = document.querySelector('#approvalDocId').value;
    if (!docId) return alert('Enter document ID');
    
    const res = await getJSON(\`/api/approval/\${docId}/status\`);
    const statusEl = document.querySelector('#approvalStatus');
    const submission = res.submission;
    
    statusEl.textContent = \`
Document ID: \${submission.documentId}
Status: \${submission.status}
Created: \${submission.createdAt}
Last Modified: \${submission.lastModifiedAt}
Revision Count: \${submission.revisionCount}
Compliance Score: \${submission.complianceScore || 'N/A'}
Validation Issues: \${submission.validationIssues?.length || 0}
\`;
  } catch (err) {
    alert(\`Status error: \${err.message}\`);
  }
};

document.querySelector('#loadAuditTrail').onclick = async () => {
  try {
    const docId = document.querySelector('#approvalDocId').value;
    if (!docId) return alert('Enter document ID');
    
    const res = await getJSON(\`/api/approval/\${docId}/audit-trail\`);
    const auditEl = document.querySelector('#auditTrail');
    const trail = res.auditTrail || [];
    
    auditEl.textContent = trail.map(e => 
      \`[\${new Date(e.timestamp).toLocaleTimeString()}] \${e.action} by \${e.actor}\`
    ).join('\\n') || 'No audit events';
  } catch (err) {
    alert(\`Audit trail error: \${err.message}\`);
  }
};

document.querySelector('#exportRegulatoryReport').onclick = async () => {
  try {
    const docId = document.querySelector('#approvalDocId').value;
    if (!docId) return alert('Enter document ID');
    
    const res = await getJSON(\`/api/approval/\${docId}/regulatory-report\`);
    const report = res.report;
    
    const reportText = \`
=== REGULATORY COMPLIANCE REPORT ===
Document ID: \${report.documentId}
Generated: \${report.generatedAt}
Total Events: \${report.totalEvents}

Summary:
- Drafts: \${report.summary.drafts}
- Validations: \${report.summary.validations}
- Approvals: \${report.summary.approvals}
- Rejections: \${report.summary.rejections}
- Revisions: \${report.summary.revisions}

Events:
\${report.events.map(e => \`  [\${e.timestamp}] \${e.action} - \${e.actor}\`).join('\\n')}
\`;
    
    const a = document.createElement('a');
    a.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(reportText);
    a.download = \`regulatory_report_\${docId}.txt\`;
    a.click();
  } catch (err) {
    alert(\`Report error: \${err.message}\`);
  }
};

document.querySelector('#approveBtn').onclick = async () => {
  try {
    const docId = document.querySelector('#approvalDocId').value;
    const approverName = document.querySelector('#approverName').value;
    const comments = document.querySelector('#approverComments').value;
    
    if (!docId || !approverName) return alert('Enter document ID and approver name');
    
    await postJSON(\`/api/approval/\${docId}/approve\`, { approverName, comments });
    alert('Document approved!');
    document.querySelector('#checkApprovalStatus').click();
  } catch (err) {
    alert(\`Approval error: \${err.message}\`);
  }
};

document.querySelector('#rejectBtn').onclick = async () => {
  try {
    const docId = document.querySelector('#approvalDocId').value;
    const approverName = document.querySelector('#approverName').value;
    const rejectionReason = document.querySelector('#approverComments').value;
    
    if (!docId || !approverName) return alert('Enter document ID and approver name');
    
    await postJSON(\`/api/approval/\${docId}/reject\`, { approverName, rejectionReason });
    alert('Document rejected.');
    document.querySelector('#checkApprovalStatus').click();
  } catch (err) {
    alert(\`Rejection error: \${err.message}\`);
  }
};

// ========================================================================
// ADAPTIVE TEMPLATES FUNCTIONS
// ========================================================================
document.querySelector('#addRuleBtn').onclick = async () => {
  try {
    const category = document.querySelector('#ruleCategory').value;
    const rule = document.querySelector('#ruleName').value;
    const guidance = document.querySelector('#ruleGuidance').value;
    const severity = document.querySelector('#ruleSeverity').value;
    const source = document.querySelector('#ruleSource').value;
    
    if (!category || !rule || !guidance) return alert('Fill in all rule fields');
    
    const res = await postJSON('/api/rules/add', { category, rule, guidance, severity, source, actor: 'user' });
    alert('Rule added!');
    document.querySelector('#ruleName').value = '';
    document.querySelector('#ruleGuidance').value = '';
    document.querySelector('#listAllRulesBtn').click();
  } catch (err) {
    alert(\`Add rule error: \${err.message}\`);
  }
};

document.querySelector('#listAllRulesBtn').onclick = async () => {
  try {
    const res = await getJSON('/api/rules/all');
    const rulesEl = document.querySelector('#rulesList');
    const rules = res.rules || [];
    
    rulesEl.textContent = rules.map(r => 
      \`[\${r.severity.toUpperCase()}] \${r.rule} (Category: \${r.category}, Source: \${r.source})\`
    ).join('\\n') || 'No rules';
  } catch (err) {
    alert(\`List rules error: \${err.message}\`);
  }
};

document.querySelector('#searchRulesBtn').onclick = async () => {
  try {
    const query = document.querySelector('#ruleQuery').value;
    if (!query) return alert('Enter search query');
    
    const res = await postJSON('/api/rules/retrieve', { query, k: 5 });
    const rulesEl = document.querySelector('#rulesList');
    const rules = res.rules || [];
    
    rulesEl.textContent = rules.map(r => 
      \`[\${r.severity.toUpperCase()}] \${r.rule}\\n   \${r.guidance.substring(0, 100)}...\`
    ).join('\\n\\n') || 'No matching rules';
  } catch (err) {
    alert(\`Search error: \${err.message}\`);
  }
};

document.querySelector('#validateDocBtn').onclick = async () => {
  try {
    const text = document.querySelector('#docToValidate').value;
    if (!text) return alert('Enter document text');
    
    const res = await postJSON('/api/rules/validate-document', { text });
    const resultEl = document.querySelector('#validationResult');
    
    resultEl.textContent = \`
Compliant: \${res.compliant}
Compliance Score: \${res.complianceScore}
Issues Found: \${res.issues.length}

\${res.issues.map(i => 
  \`[\${i.severity.toUpperCase()}] \${i.category} - \${i.rule}\\n  \${i.guidance}\`
).join('\\n\\n')}
\`;
  } catch (err) {
    alert(\`Validation error: \${err.message}\`);
  }
};

document.querySelector('#exportAuditReportBtn').onclick = async () => {
  try {
    const res = await getJSON('/api/rules/audit-report');
    const reportEl = document.querySelector('#auditReportOutput');
    
    reportEl.textContent = \`
Generated: \${res.reportedAt}
Total Rules: \${res.totalRules}
Active Rules: \${res.activeRules}

Categories: \${res.categories.join(', ')}
Sources: \${res.sources.join(', ')}

Severity Distribution:
  Low: \${res.severityDistribution.low}
  Medium: \${res.severityDistribution.medium}
  High: \${res.severityDistribution.high}
  Critical: \${res.severityDistribution.critical}

Recent Changes (last 20):
\${res.recentChanges.map(c => 
  \`[\${new Date(c.timestamp).toLocaleTimeString()}] \${c.action} by \${c.actor}\`
).join('\\n')}
\`;
  } catch (err) {
    alert(\`Report error: \${err.message}\`);
  }
};

</script>
</body>
</html>`);
});

// Upload PDFs
app.post("/api/upload", upload.array("pdfs", 20), async (req, res) => {
  try {
    console.log("[/api/upload] files:", (req.files || []).map(f => f.originalname));
    res.json({ ok: true, files: (req.files || []).map(f => ({ filename: f.originalname })) });
  } catch (e) {
    console.error("upload error", e);
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Ingest PDFs
app.post("/api/ingest", async (req, res) => {
  try {
    const docs = await loadPDFs(uploadDir);   
    const vs = await ensureVS(uploadDir);
    await vs.addDocuments(docs);
    res.json({ ok: true, message: `Ingested ${docs.length} chunks.` });
  } catch (e) {
    console.error("ingest error", e);
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});


// Run and stream
app.post("/api/run", async (req, res) => {
  try {
    const vs = await ensureVS();
    const retriever = vs.asRetriever({ k: 4 });
    const graph = buildGraph(retriever);

    const jobId = nanoid();
    jobs.set(jobId, { events: [], final: null, emitter: null, done: false });

    const task = req.body?.task || "Draft a Protocol Synopsis paragraph.";
    const init = { task, i: 0, maxIters: 2 };

    console.log("[/api/run] jobId:", jobId, "task:", task);

    (async () => {
      try {
        // run the graph once and get the final state
        const final = await graph.invoke(init);
        console.log("FINAL STATE:", final);

        const job = jobs.get(jobId);
        if (job) {
          job.final = final;
          job.done = true;
        }

        // *** THIS is what drives the Final Draft box ***
        pushEvent(jobId, { type: "final", final });
        pushEvent(jobId, { type: "done" });

      } catch (e) {
        console.error("worker error:", e);
        pushEvent(jobId, { type: "error", error: e?.message || String(e) });
        pushEvent(jobId, { type: "done" });
        const job = jobs.get(jobId);
        if (job) job.done = true;
      }

    })();

    res.json({ ok: true, jobId });
  } catch (e) {
    console.error("run error", e);
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Export current draft as a Word .docx
app.post("/api/export-docx", async (req, res) => {
  try {
    const draft = (req.body?.draft || "").toString();
    if (!draft.trim()) {
      return res.status(400).json({ ok: false, error: "No draft provided" });
    }

    // Split into paragraphs on blank lines or single newlines
    const paragraphs = draft
      .split(/\r?\n\r?\n|\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => new Paragraph(line));

    const doc = new Document({
      sections: [
        {
          properties: {},
          children: paragraphs.length ? paragraphs : [new Paragraph(draft)],
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="clinicaltrialtemplate_output.docx"'
    );
    res.send(Buffer.from(buffer));
  } catch (e) {
    console.error("export-docx error", e);
    res
      .status(500)
      .json({ ok: false, error: e?.message || String(e) });
  }
});


// SSE stream
app.get("/api/stream/:jobId", (req, res) => {
  const { jobId } = req.params;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const job = jobs.get(jobId);
  if (!job) { res.write(`data: ${JSON.stringify({ type:'error', error:'no such job' })}\n\n`); return res.end(); }

  job.emitter = res;
  for (const evt of job.events) res.write(`data: ${JSON.stringify(evt)}\n\n`);
  if (job.done) { res.write(`data: ${JSON.stringify({ type:'done' })}\n\n`); return res.end(); }

  req.on("close", () => {});
});

// Viz
app.get("/api/viz", (_req, res) => {
  const mmd = `flowchart TD
  R[retrieve] --> D[draft]
  D --> C[check]
  C -- no issues / max iters --> E{{END}}
  C -- issues remain --> V[revise]
  V --> C
`;
  res.type("text/plain").send(mmd);
});

// ========================================================================
// APPROVAL WORKFLOW ENDPOINTS
// ========================================================================

// Submit draft for approval workflow
app.post("/api/approval/submit", async (req, res) => {
  try {
    const { documentId, task, draft, actor = "system" } = req.body;
    if (!documentId || !task || !draft) {
      return res.status(400).json({ ok: false, error: "Missing documentId, task, or draft" });
    }

    const submission = approvalWorkflow.submitForApproval(documentId, task, draft, { actor });
    res.json({ ok: true, submission });
  } catch (e) {
    console.error("submission error", e);
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Approve a submitted document
app.post("/api/approval/:documentId/approve", async (req, res) => {
  try {
    const { documentId } = req.params;
    const { approverName, comments = "" } = req.body;
    if (!approverName) {
      return res.status(400).json({ ok: false, error: "Missing approverName" });
    }

    const submission = approvalWorkflow.approve(documentId, approverName, comments);
    res.json({ ok: true, submission });
  } catch (e) {
    console.error("approval error", e);
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Reject a submitted document
app.post("/api/approval/:documentId/reject", async (req, res) => {
  try {
    const { documentId } = req.params;
    const { approverName, rejectionReason = "" } = req.body;
    if (!approverName) {
      return res.status(400).json({ ok: false, error: "Missing approverName" });
    }

    const submission = approvalWorkflow.reject(documentId, approverName, rejectionReason);
    res.json({ ok: true, submission });
  } catch (e) {
    console.error("rejection error", e);
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Revise a rejected document
app.post("/api/approval/:documentId/revise", async (req, res) => {
  try {
    const { documentId } = req.params;
    const { newDraft, actor = "system" } = req.body;
    if (!newDraft) {
      return res.status(400).json({ ok: false, error: "Missing newDraft" });
    }

    const submission = approvalWorkflow.revise(documentId, newDraft, actor);
    res.json({ ok: true, submission });
  } catch (e) {
    console.error("revision error", e);
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Get submission status
app.get("/api/approval/:documentId/status", async (req, res) => {
  try {
    const { documentId } = req.params;
    const submission = approvalWorkflow.getSubmission(documentId);
    if (!submission) {
      return res.status(404).json({ ok: false, error: "Submission not found" });
    }
    res.json({ ok: true, submission });
  } catch (e) {
    console.error("status error", e);
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Get full audit trail
app.get("/api/approval/:documentId/audit-trail", async (req, res) => {
  try {
    const { documentId } = req.params;
    const trail = approvalWorkflow.getAuditTrail(documentId);
    res.json({ ok: true, documentId, auditTrail: trail });
  } catch (e) {
    console.error("audit trail error", e);
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Export regulatory compliance report
app.get("/api/approval/:documentId/regulatory-report", async (req, res) => {
  try {
    const { documentId } = req.params;
    const report = approvalWorkflow.exportRegulatoryReport(documentId);
    res.json({ ok: true, report });
  } catch (e) {
    console.error("report error", e);
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// List submissions by status
app.get("/api/approval/submissions/:status", async (req, res) => {
  try {
    const { status } = req.params;
    const submissions = approvalWorkflow.listSubmissions(status === "all" ? null : status);
    res.json({ ok: true, status, count: submissions.length, submissions });
  } catch (e) {
    console.error("list error", e);
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// ========================================================================
// ADAPTIVE TEMPLATES ENDPOINTS
// ========================================================================

// Add new compliance rule (incremental learning)
app.post("/api/rules/add", async (req, res) => {
  try {
    const { category, rule, guidance, severity = "medium", source = "user", actor = "system" } = req.body;
    if (!category || !rule || !guidance) {
      return res.status(400).json({ ok: false, error: "Missing category, rule, or guidance" });
    }

    const newRule = adaptiveTemplates.addRule(category, rule, guidance, { severity, source, actor });
    res.json({ ok: true, rule: newRule.toJSON() });
  } catch (e) {
    console.error("add rule error", e);
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Update compliance rule
app.post("/api/rules/:ruleId/update", async (req, res) => {
  try {
    const { ruleId } = req.params;
    const { updates = {}, actor = "system", reason = "Rule update" } = req.body;

    const updated = adaptiveTemplates.updateRule(ruleId, updates, { actor, reason });
    res.json({ ok: true, rule: updated.toJSON() });
  } catch (e) {
    console.error("update rule error", e);
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Deactivate compliance rule
app.post("/api/rules/:ruleId/deactivate", async (req, res) => {
  try {
    const { ruleId } = req.params;
    const { actor = "system", reason = "Rule deactivated" } = req.body;

    const deactivated = adaptiveTemplates.deactivateRule(ruleId, { actor, reason });
    res.json({ ok: true, rule: deactivated.toJSON() });
  } catch (e) {
    console.error("deactivate rule error", e);
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Reactivate compliance rule
app.post("/api/rules/:ruleId/reactivate", async (req, res) => {
  try {
    const { ruleId } = req.params;
    const { actor = "system", reason = "Rule reactivated" } = req.body;

    const reactivated = adaptiveTemplates.reactivateRule(ruleId, { actor, reason });
    res.json({ ok: true, rule: reactivated.toJSON() });
  } catch (e) {
    console.error("reactivate rule error", e);
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Get all active rules
app.get("/api/rules/all", async (req, res) => {
  try {
    const rules = adaptiveTemplates.getAllRules();
    res.json({ ok: true, count: rules.length, rules: rules.map(r => r.toJSON()) });
  } catch (e) {
    console.error("get rules error", e);
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Get rules by category
app.get("/api/rules/category/:category", async (req, res) => {
  try {
    const { category } = req.params;
    const rules = adaptiveTemplates.getRulesByCategory(category);
    res.json({ ok: true, category, count: rules.length, rules: rules.map(r => r.toJSON()) });
  } catch (e) {
    console.error("get category rules error", e);
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Retrieve adaptive rules based on query
app.post("/api/rules/retrieve", async (req, res) => {
  try {
    const { query, category = null, k = 5 } = req.body;
    if (!query) {
      return res.status(400).json({ ok: false, error: "Missing query" });
    }

    const retrieved = adaptiveTemplates.retrieveAdaptiveRules(query, { category, k });
    res.json({ ok: true, query, count: retrieved.length, rules: retrieved.map(r => r.toJSON()) });
  } catch (e) {
    console.error("retrieve rules error", e);
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Validate document against adaptive rules
app.post("/api/rules/validate-document", async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ ok: false, error: "Missing text" });
    }

    const result = adaptiveTemplates.validateDocument(text);
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error("validate document error", e);
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Get compliance suggestions for document
app.post("/api/rules/suggest-improvements", async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ ok: false, error: "Missing text" });
    }

    const suggestions = adaptiveTemplates.suggestImprovements(text);
    res.json({ ok: true, count: suggestions.length, suggestions });
  } catch (e) {
    console.error("suggest improvements error", e);
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Get rule version history
app.get("/api/rules/:ruleId/history", async (req, res) => {
  try {
    const { ruleId } = req.params;
    const history = adaptiveTemplates.getRuleHistory(ruleId);
    res.json({ ok: true, ruleId, count: history.length, history });
  } catch (e) {
    console.error("get history error", e);
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Export all rules (for backup/deployment)
app.get("/api/rules/export", async (req, res) => {
  try {
    const exported = adaptiveTemplates.exportRules();
    res.json({ ok: true, ...exported });
  } catch (e) {
    console.error("export rules error", e);
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Import rules (bulk update from regulatory changes)
app.post("/api/rules/import", async (req, res) => {
  try {
    const { rulesData, actor = "system", source = "import" } = req.body;
    if (!rulesData) {
      return res.status(400).json({ ok: false, error: "Missing rulesData" });
    }

    const imported = adaptiveTemplates.importRules(rulesData, { actor, source });
    res.json({ ok: true, count: imported.length, imported });
  } catch (e) {
    console.error("import rules error", e);
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Export compliance audit report
app.get("/api/rules/audit-report", async (req, res) => {
  try {
    const report = adaptiveTemplates.exportAuditReport();
    res.json({ ok: true, ...report });
  } catch (e) {
    console.error("audit report error", e);
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// ========================================================================
// RAG KNOWLEDGE BASE ENDPOINTS
// ========================================================================

// Add knowledge source document
// Helper: usage instructions for adding a RAG document
app.get("/api/rag/add-document", (req, res) => {
  try {
    res.json({
      ok: true,
      usage: {
        method: "POST",
        url: "/api/rag/add-document",
        required_fields: ["title", "content"],
        optional_fields: {
          source_type: "guideline",
          source_name: "organization",
          document_type: "general",
          tags: "array",
          metadata: "object"
        },
        example: {
          title: "My Doc",
          content: "This is the document text",
          source_type: "guideline",
          tags: ["example"]
        }
      }
    });
  } catch (e) {
    console.error("usage endpoint error", e);
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.post("/api/rag/add-document", async (req, res) => {
  try {
    const { title, content, source_type, source_name, document_type, tags, metadata } = req.body;
    if (!title || !content) {
      return res.status(400).json({ ok: false, error: "title and content required" });
    }

    const doc = await ragKnowledgeBase.addDocument(title, content, {
      source_type: source_type || "guideline",
      source_name: source_name || "organization",
      document_type: document_type || "general",
      tags: tags || [],
      metadata: metadata || {}
    });

    res.json({ ok: true, document: doc.toJSON() });
  } catch (e) {
    console.error("add document error", e);
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Update knowledge document
app.put("/api/rag/update-document/:docId", async (req, res) => {
  try {
    const { docId } = req.params;
    const { content, version } = req.body;
    if (!content) {
      return res.status(400).json({ ok: false, error: "content required" });
    }

    const doc = await ragKnowledgeBase.updateDocument(docId, content, { version });
    res.json({ ok: true, document: doc.toJSON() });
  } catch (e) {
    console.error("update document error", e);
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// List all knowledge documents
app.get("/api/rag/documents", (req, res) => {
  try {
    const { sourceType, sourceName } = req.query;
    const docs = ragKnowledgeBase.getAllDocuments({
      sourceType: sourceType || null,
      sourceName: sourceName || null
    });

    res.json({
      ok: true,
      count: docs.length,
      documents: docs.map(d => ({
        id: d.id,
        title: d.title,
        source_type: d.source_type,
        source_name: d.source_name,
        document_type: d.document_type,
        version: d.version,
        last_updated: d.last_updated,
        tags: d.tags
      }))
    });
  } catch (e) {
    console.error("list documents error", e);
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Retrieve relevant knowledge for a query (RAG retrieval)
// Helper: usage instructions for RAG retrieve
app.get("/api/rag/retrieve", (req, res) => {
  try {
    res.json({
      ok: true,
      usage: {
        method: "POST",
        url: "/api/rag/retrieve",
        required_fields: ["query"],
        optional_fields: {
          topK: "number (default 5)",
          sourceType: "string",
          sourceName: "string",
          documentType: "string"
        },
        example: {
          query: "informed consent requirements",
          topK: 5
        }
      }
    });
  } catch (e) {
    console.error("rag retrieve usage error", e);
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.post("/api/rag/retrieve", async (req, res) => {
  try {
    const { query, topK = 5, sourceType, sourceName, documentType } = req.body;
    if (!query) {
      return res.status(400).json({ ok: false, error: "query required" });
    }

    const results = await ragKnowledgeBase.retrieveRelevantKnowledge(query, {
      topK,
      sourceType: sourceType || null,
      sourceName: sourceName || null,
      documentType: documentType || null
    });

    res.json({ ok: true, query, results_count: results.length, results });
  } catch (e) {
    console.error("retrieve error", e);
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Search knowledge base
app.get("/api/rag/search", async (req, res) => {
  try {
    const { q, topK = 10, threshold = 0.3 } = req.query;
    if (!q) {
      return res.status(400).json({ ok: false, error: "q (query) required" });
    }

    const results = await ragKnowledgeBase.searchKnowledge(q, { topK: parseInt(topK), threshold: parseFloat(threshold) });

    res.json({ ok: true, query: q, results_count: results.length, results });
  } catch (e) {
    console.error("search error", e);
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Get knowledge base statistics
app.get("/api/rag/statistics", (req, res) => {
  try {
    const stats = ragKnowledgeBase.getStatistics();
    const sourceAnalysis = ragKnowledgeBase.getSourceAnalysis();

    res.json({ ok: true, statistics: stats, source_analysis: sourceAnalysis });
  } catch (e) {
    console.error("statistics error", e);
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Export knowledge base
app.get("/api/rag/export", (req, res) => {
  try {
    const exported = ragKnowledgeBase.exportKnowledge();
    res.json({ ok: true, ...exported });
  } catch (e) {
    console.error("export error", e);
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// ========================================================================
// FACTUAL GROUNDING VALIDATION ENDPOINTS
// ========================================================================

// Evaluate grounding of a response
// Helper: usage instructions for grounding evaluate
app.get("/api/grounding/evaluate", (req, res) => {
  try {
    res.json({
      ok: true,
      usage: {
        method: "POST",
        url: "/api/grounding/evaluate",
        required_fields: ["responseText"],
        optional_fields: {
          citations: "array of citation texts or ids",
          complianceRules: "array",
          sourceCredibility: "object"
        },
        example: {
          responseText: "Subject must sign an informed consent form before enrolment.",
          citations: ["FDA guidance excerpt text or citation id"]
        }
      }
    });
  } catch (e) {
    console.error("grounding evaluate usage error", e);
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.post("/api/grounding/evaluate", async (req, res) => {
  try {
    const { responseText, citations = [], complianceRules = [], sourceCredibility = {} } = req.body;
    if (!responseText) {
      return res.status(400).json({ ok: false, error: "responseText required" });
    }

    const evaluation = await groundingValidator.evaluateGrounding(responseText, citations, {
      complianceRules,
      sourceCredibility
    });

    res.json({ ok: true, evaluation: evaluation.toJSON() });
  } catch (e) {
    console.error("grounding evaluation error", e);
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Generate grounding report
app.post("/api/grounding/report", async (req, res) => {
  try {
    const { responseText, citations = [], complianceRules = [] } = req.body;
    if (!responseText) {
      return res.status(400).json({ ok: false, error: "responseText required" });
    }

    const evaluation = await groundingValidator.evaluateGrounding(responseText, citations, {
      complianceRules
    });

    const report = groundingValidator.generateGroundingReport(evaluation);

    res.json({ ok: true, report });
  } catch (e) {
    console.error("grounding report error", e);
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Get approval statistics
app.get("/api/grounding/statistics", (req, res) => {
  try {
    const stats = groundingValidator.getApprovalStatistics();
    const issuesSummary = groundingValidator.getIssuesSummary();
    const improvementFocus = groundingValidator.getImprovementFocus();

    res.json({
      ok: true,
      approval_statistics: stats,
      issues_summary: issuesSummary,
      improvement_focus: improvementFocus
    });
  } catch (e) {
    console.error("grounding statistics error", e);
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Export grounding evaluations
app.get("/api/grounding/export", (req, res) => {
  try {
    const exported = groundingValidator.exportEvaluations();
    res.json({ ok: true, ...exported });
  } catch (e) {
    console.error("export grounding error", e);
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Batch grounding check for multiple responses
app.post("/api/grounding/batch-evaluate", async (req, res) => {
  try {
    const { responses = [] } = req.body;
    if (!Array.isArray(responses) || responses.length === 0) {
      return res.status(400).json({ ok: false, error: "responses array required" });
    }

    const evaluations = [];
    for (const resp of responses) {
      const evaluation = await groundingValidator.evaluateGrounding(
        resp.text,
        resp.citations || [],
        { complianceRules: resp.complianceRules || [] }
      );
      evaluations.push(evaluation.toJSON());
    }

    const stats = groundingValidator.getApprovalStatistics();

    res.json({
      ok: true,
      evaluated_count: evaluations.length,
      approved_count: evaluations.filter(e => e.approved).length,
      evaluations,
      batch_statistics: stats
    });
  } catch (e) {
    console.error("batch evaluation error", e);
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Get improvement recommendations for a response
app.post("/api/grounding/recommendations", async (req, res) => {
  try {
    const { responseText, citations = [], complianceRules = [] } = req.body;
    if (!responseText) {
      return res.status(400).json({ ok: false, error: "responseText required" });
    }

    const evaluation = await groundingValidator.evaluateGrounding(responseText, citations, {
      complianceRules
    });

    res.json({
      ok: true,
      confidence_score: evaluation.confidence_score,
      approved: evaluation.approved,
      recommendations: evaluation.recommendations,
      issues: evaluation.issues
    });
  } catch (e) {
    console.error("recommendations error", e);
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`ClinicalTrialTemplateCreation UI running → http://localhost:${PORT}`);
});
