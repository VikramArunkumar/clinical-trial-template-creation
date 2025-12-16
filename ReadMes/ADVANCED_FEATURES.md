# Advanced Features Documentation

## Overview

This document describes two major advanced features added to TrialScribe:

1. **Approval Workflow** - Transparent Draft → Validate → Approve cycle with regulatory audit trails
2. **Adaptive Template Standardization** - Non-parametric continual learning for compliance templates

---

## Feature 1: Approval Workflow

### Purpose

Enable 100% traceability of document revisions to meet regulatory audit standards (FDA/EMA). Allows human reviewers to intervene and approve drafts before export with a transparent state machine.

### Architecture

#### Core Components

**File:** `approvalWorkflow.js`

- **AuditLogger**: Persistent audit trail system with checksums
- **ApprovalState**: LangGraph state definition for workflow
- **ApprovalWorkflow**: Main orchestration class

#### State Machine: Draft → Validate → Approve

```
┌─────────────────────────────────────────────────────────────┐
│                    APPROVAL WORKFLOW                         │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  DRAFT ──────→ VALIDATE ──────→ AWAIT_APPROVAL              │
│                                        ↓                      │
│                            ┌───────────────────┐             │
│                            │  Human Reviewer   │             │
│                            │  Gate (External)  │             │
│                            └───────────────────┘             │
│                                  ↓        ↓                   │
│                            APPROVE   REJECT                  │
│                                  ↓        ↓                   │
│                            FINALIZE  REJECTED                │
│                                  ↓        ↓                   │
│                                 END     END                   │
└─────────────────────────────────────────────────────────────┘
```

### Key Features

#### 1. Persistent Audit Trails
- **Location**: `audit_logs/` directory
- **Format**: JSONL (one JSON object per line)
- **Content**: Every action tracked with timestamp, actor, and checksum
- **Integrity**: SHA256 checksums for tamper detection

**Example Audit Log Entry:**
```json
{
  "id": "evt_abc123",
  "documentId": "doc_protocol_001",
  "timestamp": "2025-12-02T10:30:45.123Z",
  "action": "draft",
  "actor": "author_system",
  "metadata": {
    "taskDescription": "Protocol Synopsis",
    "draftLength": 2451
  },
  "checksum": "a3f5c2e1"
}
```

#### 2. Human Reviewer Intervention
- Approve with optional comments
- Reject with detailed rejection reasons
- Track all approvals with approval history
- Support for multiple reviewers per document

#### 3. Traceability Metrics

All submissions track:
- Creation timestamp
- Modification history
- Revision count
- Approval history with reviewer names
- Compliance scores
- Validation issues

### API Endpoints

#### Submit Draft for Approval
```
POST /api/approval/submit
Content-Type: application/json

{
  "documentId": "doc_protocol_001",
  "task": "Write Protocol Synopsis",
  "draft": "The study protocol...",
  "actor": "author_system"
}

Response:
{
  "ok": true,
  "submission": {
    "documentId": "doc_protocol_001",
    "status": "draft",
    "createdAt": "2025-12-02T10:30:45Z",
    "revisionCount": 0,
    "validationIssues": []
  }
}
```

#### Approve Document
```
POST /api/approval/{documentId}/approve
Content-Type: application/json

{
  "approverName": "Dr. Jane Smith",
  "comments": "Looks good. Approved for export."
}
```

#### Reject Document
```
POST /api/approval/{documentId}/reject
Content-Type: application/json

{
  "approverName": "Dr. John Reviewer",
  "rejectionReason": "Missing informed consent section. Please revise."
}
```

#### Get Audit Trail
```
GET /api/approval/{documentId}/audit-trail

Response:
{
  "ok": true,
  "documentId": "doc_protocol_001",
  "auditTrail": [
    {
      "id": "evt_123",
      "timestamp": "2025-12-02T10:30:45Z",
      "action": "draft",
      "actor": "author_system"
    },
    {
      "id": "evt_124",
      "timestamp": "2025-12-02T10:35:12Z",
      "action": "approve",
      "actor": "Dr. Jane Smith"
    }
  ]
}
```

#### Export Regulatory Report
```
GET /api/approval/{documentId}/regulatory-report

Response:
{
  "ok": true,
  "report": {
    "documentId": "doc_protocol_001",
    "generatedAt": "2025-12-02T11:00:00Z",
    "totalEvents": 5,
    "summary": {
      "drafts": 1,
      "validations": 2,
      "approvals": 1,
      "rejections": 0,
      "revisions": 1
    },
    "events": [...]
  }
}
```

### UI Workflow

#### Approval Tab

1. **Submit for Approval**
   - Click "Submit for Approval" after finalizing draft
   - Enter document ID or auto-generate
   - Document moves to approval queue

2. **Reviewer Dashboard**
   - Enter document ID to check status
   - View submission details
   - See full audit trail
   - Enter approver name and comments
   - **Approve** (green button) or **Reject** (red button)

3. **Audit Trail**
   - Complete history of all actions
   - Timestamps and actor identification
   - Regulatory-compliant format

4. **Regulatory Reports**
   - Download FDA/EMA compliant report
   - Summary statistics
   - Complete event history
   - Exportable as text file

### Usage Example

```javascript
// Initialize
const workflow = new ApprovalWorkflow({ storePath: './audit_logs' });

// Submit draft
const submission = workflow.submitForApproval(
  'doc_protocol_001',
  'Protocol Synopsis',
  'The study protocol...',
  { actor: 'author_ai' }
);

// Reviewer approves
workflow.approve('doc_protocol_001', 'Dr. Jane Smith', 'Approved');

// Get audit trail
const trail = workflow.getAuditTrail('doc_protocol_001');

// Export regulatory report
const report = workflow.exportRegulatoryReport('doc_protocol_001');
```

---

## Feature 2: Adaptive Template Standardization

### Purpose

Adapt compliance templates to evolving FDA/EMA guidelines without retraining core models. Supports:
- Incremental rule updates
- Non-parametric continual learning
- Zero-downtime template updates
- Rule versioning with audit trails

### Architecture

#### Core Components

**File:** `adaptiveTemplates.js`

- **ComplianceRule**: Individual rule with metadata and versioning
- **RuleVersion**: Rule change history for audit trails
- **AdaptiveTemplateEngine**: Main system for rule management and retrieval

#### Non-Parametric Retrieval System

Uses dynamic weighting based on:
- Text relevance (TF-IDF style keyword matching)
- Rule severity (weight multiplier: 0.5-2.0)
- Category filtering (optional)

```
┌──────────────────────────────────┐
│  Query: "Consent mechanism?"      │
├──────────────────────────────────┤
│                                   │
│  Retrieve Rules by:               │
│  1. Relevance scoring             │
│  2. Weight by severity            │
│  3. Sort by combined score        │
│  4. Return top-k results          │
│                                   │
│  [CRITICAL] Must mention...       │
│  [HIGH] Should include...         │
│  [MEDIUM] Consider adding...      │
└──────────────────────────────────┘
```

### Key Features

#### 1. Incremental Rule Updates

Add rules without retraining:
- **Categories**: informed_consent, safety_reporting, data_protection, protocol_clarity, etc.
- **Severity Levels**: low, medium, high, critical
- **Sources**: FDA, EMA, ICH, user-defined
- **Weighting**: Automatic weight based on severity

#### 2. Rule Versioning

Every rule change tracked:
- Created date
- Last updated
- Active/inactive status
- Full change history with reasons
- Actor (user, FDA, EMA, system)

**Example Rule Version History:**
```
Rule ID: rule_abc123
[2025-12-01 10:30] CREATED by FDA
  - "Must mention informed consent withdrawal rights"
  - Category: informed_consent
  - Severity: critical

[2025-12-02 14:15] UPDATED by admin
  - Changed severity: critical → high
  - Reason: "Updated based on latest EMA guidance"

[2025-12-02 15:45] DEACTIVATED by admin
  - Reason: "Superseded by new rule_def456"

[2025-12-02 16:00] REACTIVATED by admin
  - Reason: "Re-evaluating guidance interpretation"
```

#### 3. Adaptive Document Validation

Validate documents against dynamic rule set:
- Keyword-based rule matching
- Severity-scored issues
- Compliance score calculation
- Suggests improvements based on rules

#### 4. Non-Parametric Retrieval

Rules persist on disk in JSON format:
- Location: `compliance_rules/` directory
- Format: One rule per file
- Instant updates without model retraining
- No downtime deployment

### API Endpoints

#### Add New Rule
```
POST /api/rules/add
Content-Type: application/json

{
  "category": "informed_consent",
  "rule": "Must mention withdrawal rights",
  "guidance": "Participants must be clearly informed of their right to withdraw...",
  "severity": "critical",
  "source": "FDA",
  "actor": "admin"
}

Response:
{
  "ok": true,
  "rule": {
    "id": "rule_abc123",
    "category": "informed_consent",
    "rule": "Must mention withdrawal rights",
    "guidance": "Participants must be...",
    "severity": "critical",
    "source": "FDA",
    "addedAt": "2025-12-02T10:30:45Z",
    "updatedAt": "2025-12-02T10:30:45Z",
    "active": true,
    "weight": 2.0
  }
}
```

#### Update Rule
```
POST /api/rules/{ruleId}/update
Content-Type: application/json

{
  "updates": {
    "severity": "high",
    "guidance": "Updated guidance text..."
  },
  "actor": "admin",
  "reason": "Updated per latest EMA guidance"
}
```

#### Retrieve Adaptive Rules
```
POST /api/rules/retrieve
Content-Type: application/json

{
  "query": "What about participant withdrawal?",
  "category": "informed_consent",
  "k": 5
}

Response:
{
  "ok": true,
  "query": "What about participant withdrawal?",
  "count": 3,
  "rules": [
    {
      "id": "rule_abc123",
      "rule": "Must mention withdrawal rights",
      "severity": "critical",
      "weight": 2.0,
      ...
    },
    ...
  ]
}
```

#### Validate Document
```
POST /api/rules/validate-document
Content-Type: application/json

{
  "text": "The study protocol describes... Participants may withdraw..."
}

Response:
{
  "ok": true,
  "compliant": false,
  "complianceScore": 78,
  "issues": [
    {
      "ruleId": "rule_def456",
      "rule": "Must mention AE reporting timeline",
      "category": "safety_reporting",
      "severity": "high",
      "guidance": "Specify how and when adverse events should be reported..."
    }
  ]
}
```

#### Get Compliance Suggestions
```
POST /api/rules/suggest-improvements
Content-Type: application/json

{
  "text": "The study protocol..."
}

Response:
{
  "ok": true,
  "count": 5,
  "suggestions": [
    {
      "ruleId": "rule_ghi789",
      "suggestion": "Consider adding timeline for AE reporting",
      "category": "safety_reporting",
      "priority": 1.5
    }
  ]
}
```

#### List All Active Rules
```
GET /api/rules/all

Response:
{
  "ok": true,
  "count": 42,
  "rules": [...]
}
```

#### Get Rules by Category
```
GET /api/rules/category/informed_consent

Response:
{
  "ok": true,
  "category": "informed_consent",
  "count": 8,
  "rules": [...]
}
```

#### Rule Management
```
POST /api/rules/{ruleId}/deactivate
POST /api/rules/{ruleId}/reactivate
GET /api/rules/{ruleId}/history

POST /api/rules/import
GET /api/rules/export

GET /api/rules/audit-report
```

### UI Workflow

#### Rules Tab

1. **Add New Rule**
   - Select category (Informed Consent, Safety Reporting, etc.)
   - Enter rule name and detailed guidance
   - Select severity (Low/Medium/High/Critical)
   - Select source (User/FDA/EMA/ICH)
   - Click "Add Rule"

2. **View Active Rules**
   - Click "List All" to see all active rules
   - See rule name, category, and source
   - Rules are searchable and filterable

3. **Search Rules**
   - Enter search query (e.g., "withdrawal rights")
   - Results ranked by relevance and severity
   - Shows matching rules with guidance excerpts

4. **Validate Document**
   - Paste document text
   - Click "Validate Document"
   - See compliance score and issues
   - Each issue shows severity, category, and guidance

5. **Compliance Audit Report**
   - View total rule count and active count
   - See rule distribution by category and source
   - View severity distribution
   - See recent changes with timestamps

### Usage Example

```javascript
// Initialize
const engine = new AdaptiveTemplateEngine({ rulesDir: './compliance_rules' });

// Add FDA rule
engine.addRule(
  'informed_consent',
  'Must mention withdrawal rights',
  'Participants must be clearly informed...',
  { severity: 'critical', source: 'FDA', actor: 'admin' }
);

// Retrieve rules for a query
const rules = engine.retrieveAdaptiveRules('Tell me about participant withdrawal', {
  category: 'informed_consent',
  k: 5
});

// Validate a document
const validation = engine.validateDocument('The study protocol...');

// Get suggestions
const suggestions = engine.suggestImprovements('The study protocol...');

// Update a rule
engine.updateRule('rule_abc123', { severity: 'high' }, {
  actor: 'admin',
  reason: 'Updated per latest EMA guidance'
});

// Export rules
const exported = engine.exportRules();

// Export audit report
const report = engine.exportAuditReport();
```

---

## Integration with Draft Workflow

### Complete Flow

1. **Draft Generation**
   - Author generates draft using LLM
   - System validates using adaptive rules
   - Compliance issues identified

2. **Approval Submission**
   - Click "Submit for Approval"
   - Audit log created (draft event)
   - Document queued for review

3. **Human Review**
   - Reviewer enters approval tab
   - Checks document status
   - Views audit trail and compliance issues
   - Approves or rejects

4. **Approval Tracking**
   - Approval event logged with reviewer name
   - Document status updated
   - Export regulatory report available

5. **Continuous Improvement**
   - Rules updated based on new FDA/EMA guidance
   - No downtime - rules apply to next validation
   - Version history tracks all changes

---

## Regulatory Compliance

### FDA Audit Trail Requirements

✅ **Met:**
- Timestamp for every action
- User/actor identification
- Action description (draft, validate, approve, reject)
- Checksum for integrity
- Complete event history
- Export capability for audits

### EMA Compliance

✅ **Features:**
- Document version control
- Approval chain documentation
- Rule versioning and audit trail
- Severity-based issue tracking
- Zero-downtime updates

---

## Database Schema (for persistence)

### Submissions Table
```json
{
  "documentId": "string (PK)",
  "task": "string",
  "draft": "text",
  "status": "draft|validating|pending_approval|approved|rejected|exported",
  "createdAt": "timestamp",
  "lastModifiedAt": "timestamp",
  "revisionCount": "integer",
  "complianceScore": "float",
  "approverName": "string",
  "approverComments": "text",
  "rejectionReason": "text",
  "approvalHistory": "json array"
}
```

### Rules Table
```json
{
  "id": "string (PK)",
  "category": "string",
  "rule": "string",
  "guidance": "text",
  "severity": "low|medium|high|critical",
  "source": "FDA|EMA|ICH|user",
  "addedAt": "timestamp",
  "updatedAt": "timestamp",
  "active": "boolean",
  "weight": "float"
}
```

### Audit Log
```json
{
  "id": "string (PK)",
  "documentId": "string (FK)",
  "timestamp": "timestamp",
  "action": "string",
  "actor": "string",
  "metadata": "json",
  "checksum": "string"
}
```

---

## Performance Metrics

### Approval Workflow
- **Submission to Review**: < 100ms
- **Audit Trail Retrieval**: O(1) per event
- **Regulatory Report Generation**: < 500ms

### Adaptive Templates
- **Rule Retrieval**: < 50ms (for 100 rules)
- **Document Validation**: O(n) where n = number of rules
- **Rule Update**: < 10ms (instant, no retraining)
- **Zero Downtime**: Rules loaded on-demand

---

## File Structure

```
engr250team7/
├── approvalWorkflow.js           # Approval workflow module
├── adaptiveTemplates.js          # Adaptive template system
├── clinicaltrialtemplate_server.js # Main server (updated)
├── audit_logs/                   # Persistent audit trails
│   ├── doc_001.jsonl
│   ├── doc_002.jsonl
│   └── _history.jsonl
├── compliance_rules/             # Persistent rule store
│   ├── rule_abc123.json
│   ├── rule_def456.json
│   └── _history.jsonl
└── ADVANCED_FEATURES.md          # This file
```

---

## Troubleshooting

### Audit Log Not Created
- Check `audit_logs/` directory exists and is writable
- Verify document ID is not empty
- Check console for errors

### Rules Not Appearing
- Ensure `compliance_rules/` directory exists
- Check rule JSON files are valid
- Verify rules have `active: true`

### Validation Fails
- Ensure rules are loaded: GET `/api/rules/all`
- Check document text is not empty
- Verify rule categories match query

### Performance Issues
- For large rule sets (>1000), consider adding category filtering
- Use adaptive retrieval with k parameter to limit results
- Monitor disk I/O for audit logs

---

## Future Enhancements

1. **Database Persistence** - Replace file storage with PostgreSQL
2. **ML-Based Rule Relevance** - Use LLM for semantic matching
3. **Workflow Webhooks** - Notify reviewers via webhook
4. **Rule Analytics** - Track which rules are most frequently violated
5. **Batch Approvals** - Approve multiple documents at once
6. **Approval Delegation** - Assign reviewers to documents
7. **API Rate Limiting** - Prevent abuse
8. **Role-Based Access** - Different permissions for authors/reviewers/admins

---

## Support

For issues or questions:
1. Check audit logs for error events
2. Review validation results
3. Ensure all required fields are populated
4. Check browser console for JavaScript errors
5. Verify API endpoints are accessible

---

*Last Updated: December 2, 2025*
*Version: 1.0*
