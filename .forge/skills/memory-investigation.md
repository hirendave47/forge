---
name: memory-investigation
description: Workflows for diagnosing Linux memory pressure, OOM killer incidents, swap thrashing, and process memory leaks.
---

# Memory Investigation Skill

## 1. Quick Assessment
```bash
free -h
vmstat 1 5
cat /proc/meminfo | grep -E "MemTotal|MemFree|MemAvailable|Buffers|Cached|SwapTotal|SwapFree"
```

## 2. Identify Top Consuming Processes
```bash
ps -eo pid,user,%mem,%cpu,rss,comm --sort=-rss | head -n 15
```

## 3. Check for OOM Killer Invocations
```bash
dmesg -T | grep -i -E "oom[-_]killer|killed process" | tail -n 20
journalctl -k | grep -i oom | tail -n 20
```

## 4. Remediation Guidelines
- Distinguish between application RSS growth (memory leak) and Linux PageCache reclamation.
- Do not blindly kill processes without understanding parent PID and restart supervisors.
