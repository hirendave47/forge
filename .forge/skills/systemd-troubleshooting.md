---
name: systemd-troubleshooting
description: Diagnostics and remediation workflows for failed systemd units, service timeouts, and dependency loops.
---

# Systemd Troubleshooting Skill

## 1. Diagnostic Sequence
1. Check overall failed units:
   ```bash
   systemctl --failed
   ```
2. Check detailed service status:
   ```bash
   systemctl status <service> -l --no-pager
   ```
3. Check recent service journal logs:
   ```bash
   journalctl -u <service> -n 50 --no-pager
   ```
4. Verify unit file syntax:
   ```bash
   systemd-analyze verify <unit-file>
   ```

## 2. Safe Restart Protocol
- Before restarting a service, verify that dependencies are up.
- Use `systemctl daemon-reload` if unit configuration files were modified.
- Verify status immediately with `systemctl is-active <service>`.
