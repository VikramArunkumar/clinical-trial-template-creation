# Quick Start Guide - Advanced Features

## Getting Started in 5 Minutes

### 1. Start the Server

```bash
npm install
node clinicaltrialtemplate_server.js
```

Visit `http://localhost:3000`

### 2. Generate a Draft

**Tab: Draft**
1. Enter task: "Write a Protocol Synopsis for Phase II oncology trial"
2. Click "Run"
3. Wait for draft generation
4. Review final draft and compliance issues

### 3. Submit for Approval

**Tab: Draft**
1. Click "Submit for Approval"
2. Enter a Document ID (or accept auto-generated)
3. Document moves to approval workflow

### 4. Review and Approve

**Tab: Approval Workflow**
1. Enter the Document ID from step 3
2. Click "Check Status" to see submission
3. Enter your name in "Your name (approver)"
4. Add comments (optional)
5. Click ✓ "Approve" button
6. View updated audit trail

### 5. Add Compliance Rules

**Tab: Adaptive Templates**
1. Select Category: "Informed Consent"
2. Enter Rule: "Participants must understand risks"
3. Enter Guidance: "Clearly explain study risks and benefits"
4. Select Severity: "High"
5. Click "Add Rule"
6. Click "List All" to see your new rule

### 6. Validate Document

**Tab: Adaptive Templates**
1. Paste a document in "Validate Document"
2. Click "Validate Document"
3. See compliance score and issues
4. Review suggested improvements

---

## Common Tasks

### Export Regulatory Report

```
Approval Workflow Tab →
→ Enter Document ID →
→ Click "Export Report"
→ Save regulatory_report_*.txt
```

**Includes:**
- Complete audit trail
- Approval statistics
- Event timeline
- Regulatory metadata

### Search Rules

```
Adaptive Templates Tab →
→ Enter query: "withdrawal rights" →
→ Click "Search" →
→ See ranked results
```

### Update a Rule

```
Add a new version of the rule with same name
→ System tracks version history
→ Old rule becomes inactive
```

### Generate Audit Report

```
Adaptive Templates Tab →
→ "Compliance Audit Report" section →
→ Click "Generate Audit Report" →
→ See rule statistics and recent changes
```

---

## Key Endpoints (for API Usage)

### Approval Workflow

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/approval/submit` | POST | Submit draft for approval |
| `/api/approval/{id}/status` | GET | Check submission status |
| `/api/approval/{id}/approve` | POST | Approve a document |
| `/api/approval/{id}/reject` | POST | Reject a document |
| `/api/approval/{id}/audit-trail` | GET | Get full audit trail |
| `/api/approval/{id}/regulatory-report` | GET | Export compliance report |

### Adaptive Templates

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/rules/add` | POST | Add new rule |
| `/api/rules/retrieve` | POST | Search rules |
| `/api/rules/all` | GET | List all active rules |
| `/api/rules/validate-document` | POST | Validate document |
| `/api/rules/suggest-improvements` | POST | Get suggestions |
| `/api/rules/{id}/update` | POST | Update rule |
| `/api/rules/{id}/deactivate` | POST | Deactivate rule |
| `/api/rules/audit-report` | GET | Get compliance report |

---

## Data Locations

### Audit Trails
```
audit_logs/
├── doc_protocol_001.jsonl      # One event per line
├── doc_synopsis_002.jsonl
└── _history.jsonl              # Master history
```

### Compliance Rules
```
compliance_rules/
├── rule_abc123.json            # One rule per file
├── rule_def456.json
└── _history.jsonl              # Rule change history
```

### Uploaded PDFs
```
uploads/
├── pdfs/                        # User uploaded PDFs
└── guidance/                    # Regulatory guidance PDFs
```

---

## Example API Calls

### Submit Draft for Approval

```bash
curl -X POST http://localhost:3000/api/approval/submit \
  -H "Content-Type: application/json" \
  -d '{
    "documentId": "doc_protocol_001",
    "task": "Protocol Synopsis",
    "draft": "The study will assess...",
    "actor": "author_ai"
  }'
```

### Approve Document

```bash
curl -X POST http://localhost:3000/api/approval/doc_protocol_001/approve \
  -H "Content-Type: application/json" \
  -d '{
    "approverName": "Dr. Jane Smith",
    "comments": "Looks good to export"
  }'
```

### Add Compliance Rule

```bash
curl -X POST http://localhost:3000/api/rules/add \
  -H "Content-Type: application/json" \
  -d '{
    "category": "informed_consent",
    "rule": "Must mention withdrawal rights",
    "guidance": "Participants must be informed of their right to withdraw...",
    "severity": "critical",
    "source": "FDA",
    "actor": "admin"
  }'
```

### Validate Document

```bash
curl -X POST http://localhost:3000/api/rules/validate-document \
  -H "Content-Type: application/json" \
  -d '{
    "text": "The study protocol describes informed consent procedures..."
  }'
```

### Get Audit Trail

```bash
curl http://localhost:3000/api/approval/doc_protocol_001/audit-trail
```

---

## Troubleshooting

### "No audit events" appears

**Solution:** Make sure you've clicked "Submit for Approval" and "Check Status"

### Rules not showing up

**Solution:** Click "List All" to load all active rules

### Validation always shows "compliant"

**Solution:** Add some rules first using the "Add New Rule" section

### Can't find previous document

**Solution:** Use the exact Document ID. IDs are case-sensitive.

---

## Tips & Tricks

1. **Auto-generate Document IDs** - Just click Submit without entering an ID
2. **Bulk Add Rules** - Add multiple rules sequentially; they persist
3. **Search by Keyword** - Rules are ranked by relevance
4. **Export Before Reviewing** - Get Word document before going to approval
5. **Check Audit Trail Often** - Ensures all actions are tracked
6. **Update Rules Frequently** - No downtime, instant deployment

---

## Next Steps

1. **Read Full Documentation** - See `ADVANCED_FEATURES.md`
2. **Integrate with Database** - For production, use PostgreSQL
3. **Set Up Webhooks** - Notify reviewers when docs need approval
4. **Configure Access Control** - Role-based permissions
5. **Monitor Compliance** - Track most common issues

---

## Support Commands

Check if server is running:
```bash
curl http://localhost:3000/health
```

List all active rules:
```bash
curl http://localhost:3000/api/rules/all
```

Get compliance audit report:
```bash
curl http://localhost:3000/api/rules/audit-report
```

---

*For detailed API documentation, see `ADVANCED_FEATURES.md`*
