# RAG Integration with Draft Generation

## Complete End-to-End Workflow

This guide shows how to use RAG to generate **factually grounded clinical trial templates** with >90% confidence.

---

## Architecture: From Question to Grounded Response

```
┌─────────────────────────────────┐
│  User Request / Draft Topic     │
│  e.g., "Create Consent Form"    │
└────────────────┬────────────────┘
                 │
                 ▼
        ┌───────────────────┐
        │  Extract Query    │
        │  "Consent form    │
        │   requirements"   │
        └────────┬──────────┘
                 │
                 ▼
    ┌────────────────────────────┐
    │  RAG Retrieve Relevant      │
    │  Knowledge Sources          │
    │  (FDA, EMA, ICH, SOPs)      │
    └────────────┬───────────────┘
                 │
         ┌───────┴───────┐
         │               │
         ▼               ▼
    Semantic         Keyword
    Search          Ranking
         │               │
         └───────┬───────┘
                 │
                 ▼
    ┌────────────────────────────┐
    │  Retrieved Sources         │
    │  (Ranked by Relevance)     │
    │  (With Embeddings)         │
    └────────────┬───────────────┘
                 │
                 ▼
    ┌────────────────────────────┐
    │  Build LLM Prompt with     │
    │  Retrieved Context         │
    │  (Few-shot + Examples)     │
    └────────────┬───────────────┘
                 │
                 ▼
    ┌────────────────────────────┐
    │  LLM Generates Draft       │
    │  Using Sources as Context  │
    │  (ChatAnthropic)           │
    └────────────┬───────────────┘
                 │
                 ▼
    ┌────────────────────────────┐
    │  Validate Grounding        │
    │  (5 Criteria)              │
    │  Calculate Confidence      │
    └────────────┬───────────────┘
                 │
        ┌────────┴────────┐
        │                 │
        ▼                 ▼
    ✓ >90% Conf      ✗ <90% Conf
    APPROVED         NEEDS REVISION
        │                 │
        ▼                 ▼
    Finalize          Get Recommendations
    + Log              + Retry or Manual
    + Route            + Review
```

---

## Step-by-Step Implementation

### Step 1: Initialize RAG System

```javascript
import { RAGKnowledgeBase } from './ragKnowledgeBase.js';
import { FactualGroundingValidator } from './groundingValidator.js';

// Initialize at server startup
const ragKnowledgeBase = new RAGKnowledgeBase({
  knowledgeDir: './knowledge_base',
  embeddingModel: new XenovaEmbeddings(),
  retrievalTopK: 5
});

const groundingValidator = new FactualGroundingValidator({
  evaluationsDir: './evaluations',
  confidenceThreshold: 0.90  // >90% required for approval
});
```

### Step 2: Populate Knowledge Base

```javascript
// Add FDA regulations
await addDocument({
  title: 'FDA Guidance for Industry: Informed Consent',
  content: fs.readFileSync('./docs/fda_icf_guidance.txt', 'utf8'),
  source_type: 'regulation',
  source_name: 'FDA',
  document_type: 'consent',
  tags: ['informed', 'consent', 'FDA']
});

// Add EMA guidelines
await addDocument({
  title: 'EMA Guidance: Good Clinical Practice',
  content: fs.readFileSync('./docs/ema_gcp.txt', 'utf8'),
  source_type: 'regulation',
  source_name: 'EMA',
  document_type: 'protocol',
  tags: ['GCP', 'EMA']
});

// Add ICH standards
// Add organization SOPs
// Add approved templates
```

### Step 3: Create Grounding Workflow

```javascript
// Main workflow function
async function generateGroundedDraft(userRequest) {
  console.log(`\n📋 Processing: ${userRequest.topic}`);

  // Step A: Extract relevant query
  const query = extractQueryFromRequest(userRequest);
  console.log(`🔍 Query: ${query}`);

  // Step B: Retrieve relevant knowledge
  console.log(`📚 Retrieving knowledge...`);
  const sources = await ragKnowledgeBase.retrieveRelevantKnowledge(query, {
    topK: 5,
    sourceType: null,
    sourceName: null
  });
  console.log(`✓ Found ${sources.length} relevant sources`);

  // Step C: Build LLM prompt with retrieved context
  const systemPrompt = buildSystemPrompt(sources);
  const userPrompt = buildUserPrompt(userRequest, sources);

  // Step D: Generate draft using LLM
  console.log(`🤖 Generating draft...`);
  const draft = await generateWithLLM(systemPrompt, userPrompt);
  console.log(`✓ Draft generated (${draft.length} chars)`);

  // Step E: Validate grounding
  console.log(`✅ Validating grounding...`);
  const evaluation = await groundingValidator.evaluateGrounding(draft, sources.map(s => ({
    chunk_id: s.id,
    document_id: s.document_id,
    source_name: s.source_name,
    source_type: s.source_type,
    title: s.title,
    relevance_score: s.relevance_score,
    quote: s.text.substring(0, 100)
  })));

  console.log(`Confidence Score: ${(evaluation.confidence_score * 100).toFixed(1)}%`);

  // Step F: Route based on confidence
  if (evaluation.approved) {
    console.log(`✓ APPROVED (>90% confidence)`);
    return {
      status: 'approved',
      draft: draft,
      evaluation: evaluation,
      sources: sources
    };
  } else {
    console.log(`✗ NEEDS REVISION (<90% confidence)`);
    return {
      status: 'needs_revision',
      draft: draft,
      evaluation: evaluation,
      recommendations: evaluation.recommendations,
      sources: sources
    };
  }
}
```

### Step 4: Build Enhanced LLM Prompts

```javascript
function buildSystemPrompt(sources) {
  const context = sources.map((s, i) => 
    `SOURCE ${i+1} (${s.source_name} - ${s.title}):\n${s.text}\n`
  ).join('\n---\n');

  return `You are an expert clinical trial template writer.
Generate detailed, accurate clinical trial documents based on:
- Regulatory requirements (FDA, EMA, ICH-GCP)
- Best practices and SOPs
- Retrieved authoritative sources

Always:
1. Ground responses in provided sources
2. Be specific (include section numbers, dates, percentages)
3. Use regulatory language
4. Cite sources in your response
5. Maintain accuracy and compliance

RETRIEVED SOURCES:
${context}

Now generate the requested document template.`;
}

function buildUserPrompt(userRequest, sources) {
  const sourceList = sources
    .map((s, i) => `${i+1}. ${s.source_name}: ${s.title} (relevance: ${(s.relevance_score*100).toFixed(0)}%)`)
    .join('\n');

  return `REQUEST: ${userRequest.topic}
GUIDELINES: ${userRequest.guidelines || 'FDA, EMA, ICH-GCP'}
LANGUAGE_LEVEL: ${userRequest.language_level || 'professional'}

RELEVANT SOURCES RETRIEVED:
${sourceList}

Generate a comprehensive template that:
1. Addresses the topic
2. Incorporates guidance from retrieved sources
3. Is specific and regulatory-compliant
4. Includes citations to sources
5. Can be reviewed and approved

Start with a brief summary of regulatory requirements, then provide the template.`;
}
```

### Step 5: REST API Integration

```javascript
// Express endpoint for grounded draft generation
app.post('/api/draft/generate-with-rag', async (req, res) => {
  try {
    const { topic, guidelines = 'FDA, EMA, ICH', language_level = 'professional' } = req.body;

    if (!topic) {
      return res.status(400).json({ ok: false, error: 'topic required' });
    }

    const result = await generateGroundedDraft({
      topic,
      guidelines,
      language_level
    });

    res.json({
      ok: true,
      ...result,
      grounding_details: {
        confidence_score: result.evaluation.confidence_score,
        approval_status: result.evaluation.approved ? 'APPROVED' : 'NEEDS_REVISION',
        sources_used: result.sources.length,
        issues: result.evaluation.issues,
        recommendations: result.recommendations
      }
    });
  } catch (e) {
    console.error('draft generation error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});
```

---

## Complete Example: Informed Consent Form

### Request

```javascript
// User creates ICF generation request
const request = {
  topic: "Informed Consent Form",
  guidelines: "FDA, EMA, ICH-GCP",
  language_level: "professional"
};

// Send to RAG-enhanced draft generation
const response = await fetch('/api/draft/generate-with-rag', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(request)
});

const result = await response.json();
```

### Process Flow

```
1. Extract Query
   → "What are informed consent requirements?"

2. Retrieve Sources (5 results)
   ✓ FDA Guidance for Industry: Informed Consent (relevance: 0.98)
   ✓ EMA Guideline: GCP (relevance: 0.92)
   ✓ ICH E11: Pediatric Guidance (relevance: 0.87)
   ✓ Organization SOP: Consent (relevance: 0.85)
   ✓ Approved Template: ICF (relevance: 0.82)

3. Generate with LLM
   LLM receives:
   - System prompt with regulatory requirements
   - User request for ICF
   - 5 retrieved sources as context
   → Generates detailed ICF draft

4. Validate Grounding
   Evidence-Based:      95% ✓
   Compliance-Aligned:  92% ✓
   Source Recency:      90% ✓
   Source Credibility:  98% ✓
   Specificity:         88% ✓
   ─────────────────────────
   Confidence Score:    92.6% ✓ APPROVED

5. Output
   Status: APPROVED
   Draft: [Generated ICF]
   Sources: FDA (primary), EMA, ICH, SOP, Template
   Confidence: 92.6%
   Next: Route to approver for signature
```

### Response Structure

```javascript
{
  "ok": true,
  "status": "approved",
  "draft": "INFORMED CONSENT FORM\n\n1. PURPOSE OF STUDY...",
  "grounding_details": {
    "confidence_score": 0.926,
    "approval_status": "APPROVED",
    "sources_used": 5,
    "issues": [],
    "recommendations": []
  },
  "sources": [
    {
      "id": "chunk_001",
      "title": "FDA Guidance for Industry: Informed Consent",
      "source_name": "FDA",
      "relevance_score": 0.98,
      "text": "The informed consent form must..."
    },
    // ... more sources
  ],
  "evaluation": {
    "confidence_score": 0.926,
    "grounding_breakdown": {
      "evidence_based": 0.95,
      "compliance_aligned": 0.92,
      "source_recency": 0.90,
      "source_credibility": 0.98,
      "specificity": 0.88
    },
    "approved": true
  }
}
```

---

## Iterative Improvement Workflow

### If Confidence < 90%

```javascript
// Response has issues
if (!result.approved) {
  console.log("Issues found:");
  result.evaluation.issues.forEach(issue => {
    console.log(`- ${issue.severity}: ${issue.message}`);
    console.log(`  Fix: ${issue.suggested_fix}`);
  });

  console.log("\nRecommendations:");
  result.recommendations.forEach(rec => {
    console.log(`- ${rec.action}: ${rec.details}`);
  });

  // Options:
  // 1. Modify draft based on recommendations
  // 2. Add more/better sources
  // 3. Route to expert for manual review
  // 4. Update compliance rules
}
```

### Feedback Loop

```javascript
// After user review/approval:
async function recordApprovedDraft(draftId, draft, evaluation) {
  // 1. Store in approvals
  await approvalWorkflow.recordApproval(draftId, {
    content: draft,
    evaluator: 'human_review',
    groundingScore: evaluation.confidence_score,
    timestamp: new Date()
  });

  // 2. Add to knowledge base if exceptional
  if (evaluation.confidence_score > 0.95) {
    await ragKnowledgeBase.addDocument(
      `Approved Template: ${draftId}`,
      draft,
      {
        source_type: 'template',
        source_name: 'organization',
        document_type: 'approved',
        tags: ['approved', 'template']
      }
    );
  }

  // 3. Update metrics
  // 4. Generate audit log
}
```

---

## Performance Optimization

### Batch Processing

```javascript
// Generate multiple drafts efficiently
async function generateBatchDrafts(requests) {
  const results = [];

  for (const req of requests) {
    const result = await generateGroundedDraft(req);
    results.push(result);
  }

  // Batch evaluate grounding
  const evaluations = await fetch('/api/grounding/batch-evaluate', {
    method: 'POST',
    body: JSON.stringify({
      responses: results.map(r => ({
        text: r.draft,
        citations: r.sources
      }))
    })
  }).then(r => r.json());

  return results.map((r, i) => ({
    ...r,
    evaluation: evaluations.evaluations[i]
  }));
}
```

### Caching & Reuse

```javascript
// Cache frequently used queries
const queryCache = new Map();

async function retrieveWithCache(query) {
  if (queryCache.has(query)) {
    return queryCache.get(query);
  }

  const sources = await ragKnowledgeBase.retrieveRelevantKnowledge(query);
  queryCache.set(query, sources);

  // Auto-clear cache after 1 hour
  setTimeout(() => queryCache.delete(query), 3600000);

  return sources;
}
```

---

## Monitoring & Metrics

### Track Approval Rates

```javascript
// Daily report
async function generateDailyReport() {
  const stats = groundingValidator.getApprovalStatistics();
  const ragStats = ragKnowledgeBase.getStatistics();

  console.log(`
📊 DAILY REPORT
─────────────────
Drafts Generated: ${stats.total}
Approved (>90%): ${stats.approved} (${stats.approval_rate}%)
Avg Confidence: ${(stats.average_confidence * 100).toFixed(1)}%

Knowledge Base:
- Documents: ${ragStats.total_documents}
- Chunks: ${ragStats.total_chunks}
- Citations Used: ${ragStats.total_citations}

Top Sources:
${ragStats.sources.map(s => `- ${s.source}: ${s.count}`).join('\n')}
  `);
}
```

---

## Integration with Approval Workflow

```
RAG Draft Generation
         ↓
    ✓ Confidence >90%
         ↓
    Auto-Approve & Route to Reviewer
         ↓
    Reviewer Verifies
         ↓
    Approve / Request Changes
         ↓
    Log in Audit Trail with Sources
         ↓
    Add to Knowledge Base (if exceptional)
```

---

## Troubleshooting

### Low Confidence Scores

**Symptoms:** Most drafts returning 70-80% confidence

**Solutions:**
1. Add more regulatory documents
2. Increase number of retrieved sources (topK: 7-10)
3. Review compliance rules alignment
4. Check for vague language in prompts

### Poor Retrieval Results

**Symptoms:** Irrelevant sources retrieved

**Solutions:**
1. Add domain-specific documents
2. Improve document tagging
3. Lower relevance threshold
4. Use more specific queries

### Slow Generation

**Symptoms:** Draft generation taking >5 seconds

**Solutions:**
1. Reduce topK (5 is good)
2. Cache frequent queries
3. Batch evaluate
4. Optimize LLM prompt size

---

## Best Practices

### DO ✓
- Use 3-5 sources per draft
- Cite authoritative sources (FDA, EMA, ICH)
- Include specific regulatory references
- Monitor confidence scores
- Keep knowledge base updated
- Archive old versions

### DON'T ✗
- Use single source
- Ignore low confidence warnings
- Generate without validation
- Mix credibility levels
- Keep outdated documents active
- Over-customize thresholds

---

## Production Deployment Checklist

- [ ] Knowledge base populated with 50+ documents
- [ ] All source types represented (FDA, EMA, ICH, org)
- [ ] Grounding validator confidence tested
- [ ] Batch evaluation tested
- [ ] Monitoring dashboards set up
- [ ] Approval workflows connected
- [ ] Audit logging enabled
- [ ] User documentation complete
- [ ] Team trained on usage
- [ ] Backup procedures established

---

**Ready to generate factually grounded clinical trial templates!**
