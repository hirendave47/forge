---
name: disk-investigation
description: Diagnostics for disk space exhaustion, high I/O wait, inode exhaustion, and large unlinked open files.
---

# Disk Space & I/O Investigation Skill

## 1. Filesystem Utilization
```bash
df -h
df -i  # Check inode exhaustion
```

## 2. Locate Top Space Consumers
```bash
du -xh / | sort -rh | head -n 20
du -sh /var/log/* 2>/dev/null | sort -rh | head -n 10
```

## 3. Check for Deleted but Open Files (holding disk space)
```bash
lsof +L1 2>/dev/null | head -n 20
```

## 4. I/O Wait & Bottlenecks
```bash
iostat -xz 1 5 2>/dev/null || vmstat 1 5
```
