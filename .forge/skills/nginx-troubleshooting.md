---
name: nginx-troubleshooting
description: Troubleshooting guide for Nginx HTTP 502/504 errors, upstream timeouts, SSL certificate issues, and configuration testing.
---

# Nginx Troubleshooting Skill

## 1. Error Diagnosis
- **HTTP 502 Bad Gateway**: Upstream service is down, listening on a different port, or refusing connections.
- **HTTP 504 Gateway Timeout**: Upstream backend took longer to respond than `proxy_read_timeout`.
- **HTTP 500 Internal Server Error**: Lua/Perl module failure, invalid rewrite loop, or permissions error on static root.

## 2. Verification Routine
- Always run `nginx -t` before reloading or restarting Nginx.
- Check error logs:
  ```bash
  tail -n 50 /var/log/nginx/error.log
  ```
- Check upstream port listener:
  ```bash
  ss -tulpn | grep <port>
  ```
