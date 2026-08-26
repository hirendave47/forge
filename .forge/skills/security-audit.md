---
name: security-audit
description: Security auditing workflows for permissions, listening sockets, sudoers, sshd configuration, and exposed credentials.
---

# Security Audit Skill

## 1. Network Exposure & Listening Ports
```bash
ss -tulpn
ip a
```

## 2. Check Sudoers & Root Privileges
```bash
cat /etc/sudoers
ls -la /etc/sudoers.d/
grep -E ":0:" /etc/passwd
```

## 3. SSH Configuration Hardening Verification
Check `/etc/ssh/sshd_config` for:
- `PermitRootLogin no`
- `PasswordAuthentication no`
- `PubkeyAuthentication yes`
- `X11Forwarding no`

Verify syntax with:
```bash
sshd -t
```

## 4. Sensitive File Permissions
```bash
ls -la /etc/shadow /etc/gshadow
find / -perm -4000 -type f 2>/dev/null | head -n 30  # SUID binaries
```
