---
name: linux-log-analysis
description: Workflows and best practices for analyzing Linux operational logs, journald, syslog, and application logs.
---

# Linux Log Analysis Skill

## 1. Core Guidelines
- **Bounded Chunk Ingestion**: Never dump massive log files. Read logs in bounded line chunks tracking line offsets.
- **Deduplication**: Group identical or normalized log events to avoid filling the LLM context.
- **Context Windowing**: When investigating error or warning lines, always examine 3–5 lines of preceding and succeeding context.

## 2. Common Log Locations & Commands
- **Systemd Journal**:
  ```bash
  journalctl -u <service> -n 100 --no-pager
  journalctl -u <service> --since "10 minutes ago" --no-pager
  journalctl -p err..emerg -n 50 --no-pager
  ```
- **Standard Syslog / Messages**:
  ```bash
  tail -n 100 /var/log/syslog
  tail -n 100 /var/log/messages
  ```
- **Authentication Logs**:
  ```bash
  grep -i "failed" /var/log/auth.log | tail -n 50
  ```

## 3. Investigating Log Spikes
1. Filter by timestamp or status code.
2. Group by error class or status code.
3. Identify upstream dependency timeouts or resource exhaustions.
