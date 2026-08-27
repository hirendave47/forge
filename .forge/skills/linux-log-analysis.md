---
name: linux-log-analysis
description: Workflows for analyzing Linux operational logs — journald, syslog, kernel ring buffer, auth logs, auditd, and application logs — with deduplication and bounded ingestion.
---

# Linux Log Analysis Skill

## 1. Core Guidelines
- **Bounded Ingestion**: Never dump entire log files. Use `tail -n N`, `journalctl --since`, or `grep -n` with line offsets.
- **Deduplication**: Group identical or normalised events. Avoid repeating the same line 50 times in context.
- **Context Windowing**: For error/warning lines, always capture 3–5 lines of surrounding context with `grep -C 3` or `journalctl`.

## 2. Journald (systemd)
```bash
journalctl -u <service> -n 100 --no-pager
journalctl -u <service> --since "10 minutes ago" --no-pager
journalctl -p err..emerg -n 50 --no-pager          # error priority and above
journalctl -p warning --since "1 hour ago" --no-pager
journalctl --since "2024-01-01 08:00" --until "2024-01-01 09:00" --no-pager
journalctl -b --no-pager | tail -n 100              # current boot only
journalctl -b -1 --no-pager | tail -n 100           # previous boot
```

## 3. Kernel Ring Buffer
```bash
dmesg -T | tail -n 50
dmesg -T --level=err,crit,alert,emerg | tail -n 30
dmesg -T | grep -iE "error|fail|warn|oom|blocked|timeout" | tail -n 20
```

## 4. Traditional Syslog / Messages
```bash
tail -n 100 /var/log/syslog 2>/dev/null || tail -n 100 /var/log/messages 2>/dev/null
grep -n "$(date '+%b %d')" /var/log/syslog 2>/dev/null | tail -n 50
```

## 5. Authentication & Login Logs
```bash
grep -i "failed\|invalid\|refused" /var/log/auth.log 2>/dev/null | tail -n 50
lastb | head -n 20         # failed login attempts
last -a | head -n 20       # successful logins
who                        # currently logged-in users
```

## 6. Auditd Logs
```bash
ausearch -m AVC -ts recent 2>/dev/null | tail -n 30          # SELinux/AppArmor denials
ausearch -m USER_AUTH,USER_LOGIN -ts today 2>/dev/null | tail -n 20
aureport --summary 2>/dev/null
```

## 7. Application Log Patterns
```bash
# Follow a log file in real time (bounded — use Ctrl+C or run with timeout):
timeout 10 tail -f /var/log/<app>/app.log 2>/dev/null
# Count error frequency by type:
grep -oP "ERROR\s+\K\S+" /var/log/<app>/app.log | sort | uniq -c | sort -rn | head -n 15
# Extract lines around a specific error:
grep -n "OutOfMemory\|Segfault\|FATAL" /var/log/<app>/app.log | head -n 10
```

## 8. Log Rotation & Archive Investigation
```bash
ls -lht /var/log/<app>/ | head -n 10
# Read a compressed rotated log:
zcat /var/log/syslog.2.gz | grep "error" | tail -n 30
zgrep -i "error" /var/log/<app>/*.gz | head -n 20
```

## 9. Investigating Log Spikes
1. Filter by timestamp range using `--since` / `--until` in journalctl or `grep "$(date '+%b %d %H:%M')"`.
2. Group by error class: `grep -oP 'ERROR \K[^:]+' logfile | sort | uniq -c | sort -rn`.
3. Correlate with resource events: cross-check timestamps against `vmstat` snapshots or `dmesg` kernel events.
4. Identify upstream dependency timeouts or cascading failures by matching timestamps across multiple services.
