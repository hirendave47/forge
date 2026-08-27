---
name: security-audit
description: Security auditing workflows for listening ports, sudoers, SSH hardening, SUID binaries, world-writable paths, exposed credentials, fail2ban status, cron jobs, and auditd logs.
---

# Security Audit Skill

## 1. Network Exposure & Listening Ports
```bash
ss -tulpn                                   # all listening sockets with owning process
ss -tulpn | grep -v "127.0.0.1\|::1"       # externally exposed sockets only
ip a                                        # interface addresses
iptables -L -n -v --line-numbers 2>/dev/null || nft list ruleset 2>/dev/null
```

## 2. Sudoers & Privilege Escalation Paths
```bash
cat /etc/sudoers
ls -la /etc/sudoers.d/
cat /etc/sudoers.d/* 2>/dev/null
grep -E ":0:" /etc/passwd                   # accounts with UID 0
awk -F: '$3==0 && $1!="root"' /etc/passwd  # non-root accounts with UID 0
```

## 3. SSH Configuration Hardening
Check `/etc/ssh/sshd_config` for:
- `PermitRootLogin no`
- `PasswordAuthentication no`
- `PubkeyAuthentication yes`
- `X11Forwarding no`
- `MaxAuthTries 3`
- `AllowUsers` / `AllowGroups` restrictions

```bash
sshd -t                                     # syntax check
grep -E "^(PermitRoot|PasswordAuth|X11Forward|MaxAuth|AllowUser|AllowGroup)" /etc/ssh/sshd_config
```

## 4. SUID / SGID Binaries & World-Writable Paths
```bash
find / -xdev -perm -4000 -type f 2>/dev/null | sort   # SUID binaries
find / -xdev -perm -2000 -type f 2>/dev/null | sort   # SGID binaries
find / -xdev -perm -0002 -type d 2>/dev/null | grep -v /proc | head -n 30  # world-writable dirs
```

## 5. Sensitive File Permissions
```bash
ls -la /etc/shadow /etc/gshadow /etc/passwd /etc/group
ls -la /root/.ssh/ 2>/dev/null
find /home -name "authorized_keys" 2>/dev/null
find /etc -name "*.conf" -perm -o+r 2>/dev/null | grep -iE "pass|secret|key|token" | head -n 10
```

## 6. Exposed Credentials in Environment & Files
```bash
# Check for plain-text secrets in common locations (never exfiltrate; just report paths)
grep -rli --include="*.env" --include="*.conf" --include="*.cfg" \
  -E "(password|secret|apikey|api_key|token)\s*=" /etc /opt /srv 2>/dev/null | head -n 20
env | grep -iE "key|secret|pass|token"
```

## 7. Fail2ban Status
```bash
fail2ban-client status 2>/dev/null
fail2ban-client status sshd 2>/dev/null
journalctl -u fail2ban --since "1 hour ago" --no-pager | tail -n 20
```

## 8. Cron Jobs (all users)
```bash
crontab -l 2>/dev/null
ls -la /etc/cron.* /etc/crontab 2>/dev/null
for u in $(cut -d: -f1 /etc/passwd); do
  crontab -l -u "$u" 2>/dev/null && echo "  ^^^ $u"
done
```

## 9. Auditd Logs
```bash
ausearch -m AVC,USER_AUTH,USER_LOGIN -ts recent 2>/dev/null | tail -n 30
aureport --summary 2>/dev/null
# Recent failed logins:
lastb | head -n 20
last -a | head -n 20
```

## 10. Remediation Guidelines
- Any account with UID 0 other than `root` is a critical finding — investigate immediately.
- SUID binaries on non-standard paths (outside `/bin`, `/usr/bin`, `/sbin`) should be reviewed against package manifests.
- World-writable directories under `/etc`, `/usr`, or `/opt` are escalation risks.
- Never display or log actual credential values — report file paths and variable names only.
