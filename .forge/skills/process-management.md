---
name: process-management
description: Workflows for inspecting, managing, and safely terminating Linux processes — including zombie processes, stuck processes, signal handling, ulimits, and process trees.
---

# Process Management Skill

## 1. Process Overview
```bash
ps aux --sort=-%cpu | head -n 20          # top CPU consumers
ps aux --sort=-%mem | head -n 20          # top memory consumers
ps -eo pid,ppid,user,stat,start,time,comm # PID, parent, state, start time
pgrep -a <pattern>                        # find processes by name pattern
```

## 2. Process Tree
```bash
pstree -p                                 # full tree with PIDs
pstree -p <pid>                           # subtree rooted at PID
ps -o pid,ppid,comm $(pgrep <name>)       # parents of matching processes
```

## 3. Process State Investigation
```bash
# Process states: R=running, S=sleeping, D=uninterruptible, Z=zombie, T=stopped
cat /proc/<pid>/status | grep -E "^(Name|State|Pid|PPid|VmRSS|Threads)"
cat /proc/<pid>/wchan                     # kernel function process is waiting in
ls -l /proc/<pid>/fd | wc -l              # open file descriptor count
cat /proc/<pid>/cmdline | tr '\0' ' '     # full command line
```

## 4. Zombie Processes
```bash
# Zombies cannot be killed — only the parent can reap them via wait()
ps aux | awk '$8 == "Z"'                  # list all zombie processes
# Find the zombie's parent:
ps -o ppid= -p <zombie-pid>
# If parent is stuck and zombies are accumulating, inspect parent:
strace -e wait4 -p <parent-pid> 2>&1 | head -n 20
# If parent is unkillable, a system restart may be required
```

## 5. Sending Signals
```bash
kill -l                                   # list all signal names
kill -TERM <pid>                          # graceful shutdown (default)
kill -HUP <pid>                           # reload config (for daemons)
kill -INT <pid>                           # interrupt (like Ctrl+C)
kill -KILL <pid>                          # force kill — use as LAST resort only
killall -TERM <name>                      # send signal to all matching by name
pkill -TERM -u <user>                     # kill all processes by user
```

## 6. Stuck / Uninterruptible Processes (D state)
```bash
# D-state processes are waiting for I/O — cannot be killed with SIGKILL
ps aux | awk '$8 ~ /^D/'
cat /proc/<pid>/wchan                     # shows what kernel call it's blocked in
dmesg -T | grep -iE "hung task|blocked" | tail -n 10
# A process stuck in D for >2 minutes usually indicates I/O subsystem failure
```

## 7. Resource Limits (ulimits)
```bash
cat /proc/<pid>/limits                    # effective limits for a running process
ulimit -a                                 # limits for current shell
# Check open file limit (common cause of "too many open files" errors):
cat /proc/sys/fs/file-max                 # system-wide maximum
lsof -p <pid> | wc -l                    # FDs currently open by process
```

## 8. Process Priorities
```bash
ps -eo pid,ni,pri,comm --sort=ni | head -n 20   # sorted by nice value
renice +10 -p <pid>                       # lower priority (higher nice = lower priority)
renice -5 -p <pid>                        # higher priority (requires root for negative values)
# I/O priority:
ionice -c 3 -p <pid>                      # set idle I/O class
```

## 9. Remediation Guidelines
- Always attempt `SIGTERM` before `SIGKILL` — give the process time to flush buffers and close files.
- Never `kill -9 1` (init/systemd); it is blocked by project safety rules and will cause system instability.
- Zombie processes are harmless in small numbers but indicate a bug in the parent; if the parent cannot be fixed, restarting the parent is the correct remedy.
- D-state processes blocking I/O for >2 minutes typically require investigating the storage or NFS subsystem, not the process itself.
