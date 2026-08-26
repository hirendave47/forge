---
name: email-reporting
description: Best practices for drafting concise, structured operational summaries and alert notifications sent via email.
---

# Email Reporting Skill

## 1. Notification Structure
When sending operational notifications or monitoring summaries via `send_notification`, structure the content as follows:
- **Subject**: Concise and prefixed with severity (e.g. `[SUMMARY] Daily Log Monitoring Report`, `[CRITICAL] Nginx Upstream Outage`).
- **Executive Summary**: 2–3 sentences highlighting key findings and current system health.
- **Incident Breakdown**: Table or bullet points with deduplicated incident counts and timestamps.
- **Actions Taken**: Concrete remediation steps executed.
- **Next Steps / Recommendations**: Any outstanding manual checks required.

## 2. Tone & Conciseness
- Be direct, professional, and fact-driven.
- Avoid unnecessary chatter; focus on actionable telemetry.
