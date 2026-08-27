---
name: cpu-performance-investigation
description: Workflows for diagnosing high CPU usage, runaway processes, CPU throttling, load average spikes, IRQ contention, and per-core utilization on Linux.
---

# CPU Performance Investigation Skill

## 1. Quick Overview
```bash
uptime                          # load averages (1, 5, 15 min) — sustained > nCPU is concerning
nproc                           # number of logical CPUs
grep -c ^processor /proc/cpuinfo
top -b -n 1 | head -n 20       # snapshot of top consumers
```

## 2. Per-Process CPU Usage
```bash
ps -eo pid,user,%cpu,%mem,stat,comm --sort=-%cpu | head -n 15
# Watch CPU in real time (1-second refresh, quit after 5 iterations):
top -b -n 5 -d 1 | grep -E "^(%Cpu|[0-9])" | head -n 30
```

## 3. Per-Core Utilization
```bash
# mpstat from sysstat package:
mpstat -P ALL 1 5
# Alternative — /proc/stat snapshot:
cat /proc/stat | grep "^cpu"
# Identify imbalance: one core pegged at 100% often means single-threaded bottleneck
```

## 4. Load Average vs. CPU Utilization
```bash
# Load average includes BOTH runnable (CPU) AND uninterruptible (I/O wait) tasks
# Distinguish CPU saturation from I/O wait:
vmstat 1 10   # 'us+sy' = CPU, 'wa' = I/O wait, 'r' = run queue depth
iostat -c 1 5 # idle% — if not near 100% and wa% is high, it's I/O, not CPU
```

## 5. CPU Throttling & Frequency Scaling
```bash
# Current frequency per core:
cat /proc/cpuinfo | grep "cpu MHz"
# cpufreq governor:
cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor 2>/dev/null
# Thermal throttling events:
dmesg -T | grep -i -E "throttl|thermal|overheat" | tail -n 20
# Package temperature:
sensors 2>/dev/null | grep -iE "Package|Core|temp"
```

## 6. IRQ & Softirq Contention
```bash
cat /proc/interrupts | sort -k2 -rn | head -n 20
cat /proc/softirqs
mpstat -I ALL 1 3 2>/dev/null
# High NET_RX or BLOCK softirqs on one CPU = IRQ affinity problem
```

## 7. Kernel & System CPU Usage
```bash
# kworker, ksoftirqd, migration threads consuming CPU = kernel/driver issue
ps -eo pid,comm,%cpu --sort=-%cpu | grep -E "kworker|ksoftirq|migration" | head -n 10
# High system%: check for excessive syscalls with strace on the top process:
strace -c -p <pid> 2>&1 | head -n 20    # WARNING: adds overhead; use briefly only
```

## 8. Profiling a Runaway Process
```bash
# perf top — live flamegraph-style (requires linux-tools):
perf top -p <pid> 2>/dev/null
# Or poor-man's stack sampling:
for i in $(seq 1 5); do cat /proc/<pid>/wchan; echo; sleep 1; done
```

## 9. Remediation Guidelines
- Load average > nCPU for more than 5 minutes warrants investigation; check `vmstat` `r` column to confirm CPU (not I/O) saturation.
- A single kworker process at 100% often indicates a misbehaving driver or firmware; check `dmesg` for hardware errors.
- CPU throttling due to thermal events: check `sensors`, improve airflow or reduce workload — **never** override thermal limits in firmware.
- Before killing a runaway process, capture its stack with `gdb -p <pid>` or `/proc/<pid>/stack` for post-mortem.
