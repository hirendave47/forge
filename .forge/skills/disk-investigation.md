---
name: disk-investigation
description: Diagnostics for disk space exhaustion, inode exhaustion, high I/O wait, large unlinked open files, LVM volumes, mount failures, and drive health via SMART.
---

# Disk Space & I/O Investigation Skill

## 1. Filesystem Utilization
```bash
df -h          # space usage
df -i          # inode exhaustion (Use% 100% = inode full even if space free)
findmnt --real # all real (non-pseudo) mounts with options
```

## 2. Locate Top Space Consumers
```bash
du -xh --max-depth=3 / 2>/dev/null | sort -rh | head -n 20
# Limit to a single filesystem (-x skips other mounts)
du -xsh /var/log/* 2>/dev/null | sort -rh | head -n 10
# Find large files directly:
find / -xdev -size +500M -type f 2>/dev/null | head -n 20
```

## 3. Deleted-but-Open Files (space not released until FD closed)
```bash
lsof +L1 2>/dev/null | awk 'NR==1 || $7>104857600' | head -n 20
# Column 7 is SIZE; 104857600 = 100 MB threshold
```

## 4. I/O Wait & Bottlenecks
```bash
iostat -xz 1 5          # extended stats; %util near 100% = saturated disk
iotop -obP -n 3 2>/dev/null || pidstat -d 2 5
# Check queue depth and await (ms) per device in iostat -x output
```

## 5. Mount & fstab Issues
```bash
mount | grep -E "error|ro,"          # check for read-only remounts (sign of I/O errors)
cat /etc/fstab
systemctl --failed | grep -i mount   # failed automount units
dmesg -T | grep -iE "error|failed|remount" | tail -n 20
```

## 6. LVM Volumes
```bash
pvs && vgs && lvs          # physical, volume group, logical volume overview
lvdisplay 2>/dev/null
# Extend a logical volume and resize filesystem (non-destructive):
# lvextend -l +100%FREE /dev/vgname/lvname && resize2fs /dev/vgname/lvname
```

## 7. Drive Health (SMART)
```bash
# List block devices and their device nodes:
lsblk -o NAME,SIZE,TYPE,MOUNTPOINT
# Quick SMART health check (requires smartmontools):
smartctl -H /dev/sda 2>/dev/null
# Full SMART attribute table:
smartctl -a /dev/sda 2>/dev/null | head -n 40
```

## 8. Log Rotation & Cleanup
```bash
journalctl --disk-usage
journalctl --vacuum-size=500M    # trim journal to 500 MB
ls -lh /var/log/*.gz 2>/dev/null | head -n 20
```

## 9. Remediation Guidelines
- Never run `du -sh /` without `-x` on a production system — it will cross mounts and take very long.
- Inode exhaustion cannot be fixed by freeing space; clean up many small files (e.g. sessions, mail spools, tmp dirs).
- A filesystem remounted read-only (`ro`) indicates kernel detected I/O errors; check `dmesg` immediately and treat as potential drive failure.
- Use `lsof +L1` before restarting services to find log files held open by running processes.
