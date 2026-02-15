# Incident Response Plan

## Severity Levels

| Level | Definition | Examples | Response Time |
|-------|-----------|----------|---------------|
| **SEV-1** | Service down, all users affected | Database unreachable, Cloud Run not serving, auth completely broken | Immediate |
| **SEV-2** | Major feature broken, workaround exists | Email delivery failing, document uploads broken, storage grids not loading | Within 2 hours |
| **SEV-3** | Minor issue, limited impact | UI glitch, slow queries, non-critical feature degraded | Within 1 business day |
| **SEV-4** | Cosmetic or low-priority | Typo, minor styling issue, feature request | Next sprint |

---

## Detection

### Automated

- **Health check**: `/api/health` checks DB connectivity + object storage. Cloud Run restarts unhealthy instances automatically.
- **Cloud Monitoring**: GCP alerting on Cloud Run error rates, latency, and Cloud SQL metrics.
- **CI/CD health check**: Post-deploy `curl` to health endpoint in deploy pipeline.

### Manual

- User reports via support tickets (in-app)
- Email to [CONTACT_EMAIL]
- Monitoring dashboard review

---

## Response Procedure

### 1. Acknowledge

- Confirm the issue exists and assess severity level
- If SEV-1 or SEV-2: immediately begin investigation
- Note the start time

### 2. Investigate

**Quick diagnostic commands:**

```bash
# Check Cloud Run service status
gcloud run services describe labaid-backend --region=us-central1 --project=labaid-prod

# Check recent logs for errors
gcloud run services logs read labaid-backend --region=us-central1 --project=labaid-prod --limit=50

# Check Cloud SQL status
gcloud sql instances describe labaid-db --project=labaid-prod --format='value(state)'

# Check recent deployments
gcloud run revisions list --service=labaid-backend --region=us-central1 --project=labaid-prod --limit=5

# Health check
curl -sf https://labaid.io/api/health | python3 -m json.tool
```

### 3. Mitigate

**Common mitigations:**

| Issue | Action |
|-------|--------|
| Bad deploy broke prod | Roll back to previous revision: `gcloud run services update-traffic labaid-backend --to-revisions=PREVIOUS_REVISION=100 --region=us-central1 --project=labaid-prod` |
| Database connection errors | Check Cloud SQL instance state, restart if needed: `gcloud sql instances restart labaid-db --project=labaid-prod` |
| Database corruption | Restore from backup (see [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md)) |
| Auth/cookie issues | Verify COOKIE_DOMAIN and APP_URL match, check SECRET_KEY secret hasn't changed |
| Email delivery failing | Check Resend dashboard, verify API key in Secret Manager |
| Storage/uploads broken | Check GCS bucket permissions, verify S3_ACCESS_KEY/S3_SECRET_KEY secrets |
| Rate limiting too aggressive | Temporary: increase limits in code and redeploy |

### 4. Communicate

**SEV-1/SEV-2:**
- Notify affected lab admins via email (if email is working) or direct contact
- Post status update if a status page exists

**Template:**
```
Subject: [LabAid] Service Disruption — [Brief Description]

We are aware of an issue affecting [description of impact].

Current status: [Investigating / Identified / Fixing / Monitoring]
Start time: [UTC timestamp]
Estimated resolution: [ETA or "investigating"]

We will provide updates as we have them.
```

### 5. Resolve

- Confirm the fix is deployed and verified
- Run validation queries if data was affected (see [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md))
- Send resolution notification to affected users

### 6. Post-Mortem

Complete within 48 hours of resolution for SEV-1/SEV-2 incidents.

---

## Post-Mortem Template

```markdown
# Post-Mortem: [Incident Title]

**Date**: YYYY-MM-DD
**Severity**: SEV-X
**Duration**: X hours Y minutes
**Author**: [Name]

## Summary
One-paragraph description of what happened and the impact.

## Timeline (UTC)
- HH:MM — [Event: issue detected / alert fired / user reported]
- HH:MM — [Event: investigation started]
- HH:MM — [Event: root cause identified]
- HH:MM — [Event: fix deployed]
- HH:MM — [Event: confirmed resolved]

## Root Cause
What specifically caused the incident.

## Impact
- Users affected: [number or "all"]
- Data loss: [none / description]
- Duration of impact: [time]

## Resolution
What was done to fix the immediate issue.

## Lessons Learned
### What went well
-

### What went poorly
-

### Action Items
- [ ] [Action] — Owner — Due date
- [ ] [Action] — Owner — Due date
```

---

## Escalation Path

| Step | Contact | When |
|------|---------|------|
| 1 | On-call engineer | All incidents |
| 2 | [CONTACT_EMAIL] | SEV-1 or SEV-2 unresolved after 30 min |
| 3 | GCP Support | Infrastructure issues beyond our control |

---

## Key Links

| Resource | URL |
|----------|-----|
| Cloud Run Console | https://console.cloud.google.com/run?project=labaid-prod |
| Cloud SQL Console | https://console.cloud.google.com/sql/instances?project=labaid-prod |
| Cloud Logging | https://console.cloud.google.com/logs?project=labaid-prod |
| Resend Dashboard | https://resend.com/emails |
| GitHub Actions | https://github.com/ditar94/LabAid/actions |
| Disaster Recovery | [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md) |
