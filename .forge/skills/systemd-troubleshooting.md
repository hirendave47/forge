---
name: systemd-troubleshooting
description: Diagnostics and remediation for failed systemd units, service crashes, timer jobs, dependency loops, boot performance, and journald storage management.
---

# Systemd Troubleshooting Skill

## 1. Triage: Find Failed Units
```bash
systemctl --failed --no-pager
systemctl list-units --state=failed --no-pager
```

## 2. Service Deep-Dive
```bash
systemctl status <service> -l --no-pager
journalctl -u <service> -n 100 --no-pager
journalctl -u <service> --since "30 minutes ago" --no-pager
# Previous boot logs for a service (crashes that took down the system):
journalctl -u <service> -b -1 --no-pager | tail -n 50
```

## 3. Unit File Diagnostics
```bash
systemctl cat <service>                # show effective unit file and all drop-ins
systemd-analyze verify <unit-file>     # syntax and dependency check
systemctl show <service> | grep -E "ExecStart|Restart|WantedBy|After|Requires"
```

## 4. Safe Restart Protocol
1. Check that dependencies are active: `systemctl is-active <dep1> <dep2>`
2. Reload unit files if changed: `systemctl daemon-reload`
3. Restart: `systemctl restart <service>`
4. Confirm: `systemctl is-active <service>` and check journal for errors.

## 5. Dependency & Ordering Issues
```bash
systemd-analyze critical-chain <service>   # shows blocking chain in startup order
systemd-analyze dot <service> 2>/dev/null | dot -Tsvg > /tmp/deps.svg  # dependency graph
systemctl list-dependencies <service> --all --no-pager
```

## 6. Timer Units (cron replacement)
```bash
systemctl list-timers --all --no-pager      # next trigger times + last run
systemctl status <timer>.timer
journalctl -u <service>.service --since "24 hours ago" --no-pager | tail -n 30
# Force immediate run of a timer's service:
systemctl start <service>.service
```

## 7. Boot Performance Analysis
```bash
systemd-analyze                            # total boot time
systemd-analyze blame | head -n 20        # services ranked by startup time
systemd-analyze critical-chain             # critical path through boot
```

## 8. Journald Storage Management
```bash
journalctl --disk-usage
journalctl --vacuum-time=7d               # keep only last 7 days
journalctl --vacuum-size=500M             # trim to 500 MB
# Persistent journal storage config: /etc/systemd/journald.conf
grep -E "Storage|SystemMaxUse|RuntimeMaxUse" /etc/systemd/journald.conf 2>/dev/null
```

## 9. Masking & Enabling Units
```bash
systemctl is-enabled <service>             # static/enabled/disabled/masked
systemctl enable --now <service>           # enable + start
systemctl mask <service>                   # prevent accidental start
systemctl unmask <service>
```

## 10. Remediation Guidelines
- Always run `systemctl daemon-reload` after editing any unit file or drop-in under `/etc/systemd/system/`.
- `systemd-analyze verify` catches missing `After=` ordering that causes race conditions on boot.
- If a service restarts in a tight loop, set `StartLimitIntervalSec=` and `StartLimitBurst=` to prevent log flooding.
- `journalctl -b -1` accesses the previous boot — useful when the system crashed and lost in-memory journal.
