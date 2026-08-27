---
name: memory-investigation
description: Workflows for diagnosing Linux memory pressure, OOM killer incidents, swap thrashing, process memory leaks, slab cache bloat, and GPU memory usage.
---

# Memory Investigation Skill

## 1. Quick Overview
```bash
free -h
vmstat 1 5
cat /proc/meminfo | grep -E "MemTotal|MemFree|MemAvailable|Buffers|Cached|SwapTotal|SwapFree|Slab|HugePages"
```

## 2. Top Memory-Consuming Processes
```bash
ps -eo pid,user,%mem,%cpu,rss,vsz,comm --sort=-rss | head -n 15
# Smaps-based accurate RSS per process:
cat /proc/<pid>/status | grep -E "VmRSS|VmPeak|VmSwap"
```

## 3. OOM Killer & Memory Pressure Events
```bash
dmesg -T | grep -i -E "oom[-_]killer|killed process|out of memory" | tail -n 20
journalctl -k --since "1 hour ago" | grep -i -E "oom|memory" | head -n 30
```

## 4. Swap Pressure & Thrashing
```bash
# Watch swap in/out rate (si/so columns — sustained >0 indicates thrashing)
vmstat 2 10
swapon --show
cat /proc/swaps
```

## 5. Slab Cache Bloat
```bash
# Large slab caches can look like kernel memory leak
cat /proc/slabinfo | sort -k3 -rn | head -n 15 2>/dev/null || slabtop -o -s l | head -n 20
```

## 6. GPU Memory (NVIDIA / CUDA)
```bash
nvidia-smi --query-gpu=name,memory.used,memory.free,memory.total --format=csv 2>/dev/null
nvidia-smi pmon -c 1 2>/dev/null   # per-process GPU memory
# For AMD ROCm:
rocm-smi --showmeminfo vram 2>/dev/null
```

## 7. HugePages
```bash
cat /proc/meminfo | grep -i huge
cat /sys/kernel/mm/transparent_hugepage/enabled
```

## 8. Per-Process Memory Map (leak investigation)
```bash
pmap -x <pid> | sort -k3 -rn | head -n 20
```

## 9. Remediation Guidelines
- Distinguish application RSS growth (leak) from Linux PageCache reclamation — `available` in `free -h` is the reliable headroom indicator, not `free`.
- Slab bloat from dentries/inodes is normal under heavy filesystem workloads; drop caches only in non-production: `echo 3 > /proc/sys/vm/drop_caches`.
- Do not kill processes without checking parent PID and restart supervisor (`systemctl status`, `ps -o ppid=`).
- Swap usage under 20% of swap capacity is typically harmless; sustained `vmstat` si/so > 0 is the true pressure signal.
