---
name: cron-job-management
description: Workflows for creating, auditing, debugging, and managing cron jobs and systemd timers — including missed runs, permission issues, environment differences, and log investigation.
---

# Cron Job Management Skill

## 1. Listing All Cron Jobs
```bash
crontab -l                                  # current user
sudo crontab -l                             # root
cat /etc/crontab                            # system-wide crontab
ls -la /etc/cron.d/ /etc/cron.hourly/ /etc/cron.daily/ /etc/cron.weekly/ /etc/cron.monthly/
cat /etc/cron.d/* 2>/dev/null
# All users' crontabs:
for u in $(cut -d: -f1 /etc/passwd); do
  crontab -l -u "$u" 2>/dev/null | grep -v "^#" && echo "  # user: $u"
done
```

## 2. Cron Execution Logs
```bash
# Debian/Ubuntu:
grep -i cron /var/log/syslog | tail -n 50
# RHEL/CentOS:
grep -i cron /var/log/cron | tail -n 50
# systemd-based (cronie via systemd):
journalctl -u cron --since "1 hour ago" --no-pager
journalctl -u crond --since "1 hour ago" --no-pager
```

## 3. Debugging a Failing Cron Job
Common causes:
- **Environment**: cron runs with minimal PATH (`/usr/bin:/bin`). Commands must use full paths.
- **Missing MAILTO**: if `MAILTO=""` is not set, errors are silently discarded.
- **Permissions**: script file must be executable; check with `ls -la <script>`.
- **Working directory**: cron does NOT run from the same directory as the script.

```bash
# Test cron's environment manually:
env -i HOME=/root MAIL=/var/mail/root SHELL=/bin/bash PATH=/usr/bin:/bin /bin/bash -c '<command>'
# Check script exit code:
bash -x /path/to/script.sh 2>&1 | tail -n 30
# Check for syntax errors:
bash -n /path/to/script.sh && echo "OK"
```

## 4. Cron Format Reference
```
# ┌─ minute (0–59)
# │  ┌─ hour (0–23)
# │  │  ┌─ day of month (1–31)
# │  │  │  ┌─ month (1–12 or Jan–Dec)
# │  │  │  │  ┌─ day of week (0–7; 0 and 7 = Sunday)
# │  │  │  │  │
# *  *  *  *  *  user  command
  0  2  *  *  *  root  /usr/local/bin/backup.sh >> /var/log/backup.log 2>&1
```

## 5. Systemd Timer Alternative (preferred for new jobs)
```bash
# List all timers with next/last run:
systemctl list-timers --all --no-pager
# Create a timer (create two unit files):
# /etc/systemd/system/myjob.service  — defines the command
# /etc/systemd/system/myjob.timer    — defines the schedule (OnCalendar=)
# Enable and start:
systemctl daemon-reload
systemctl enable --now myjob.timer
# Force immediate run:
systemctl start myjob.service
# View logs:
journalctl -u myjob.service --since "1 hour ago" --no-pager
```

## 6. Cron Security Considerations
```bash
# Restrict cron access:
cat /etc/cron.allow 2>/dev/null       # whitelist — only listed users can use cron
cat /etc/cron.deny  2>/dev/null       # blacklist — listed users cannot use cron
# Scripts in /etc/cron.d/ must be owned by root and not world-writable:
find /etc/cron* -not -user root -o -perm -o+w 2>/dev/null
```

## 7. Remediation Guidelines
- Always redirect stdout and stderr in cron jobs: `command >> /var/log/job.log 2>&1` to preserve output for debugging.
- Set `MAILTO=""` in the crontab header to suppress unwanted local mail, but only after directing output to a log file.
- Prefer systemd timers for new jobs — they integrate with journald for logging, support dependencies, and handle missed runs gracefully.
- Scripts triggered by cron must not rely on user session environment variables (`NVM_DIR`, `JAVA_HOME`, etc.) — source them explicitly.
