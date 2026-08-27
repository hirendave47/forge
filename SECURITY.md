# Security Policy

This document provides guidelines for understanding the security boundaries and reporting vulnerabilities in **Forge**.

## Security Model

Forge is an autonomous operational and coding agent that runs locally within the security boundary of the operating system user invoking it.

Forge treats the local user account and files writable by that account as inside the same trust boundary as the Forge process itself. If an attacker can modify files under the user's home directory, workspace, shell startup files, environment, or Forge configuration (`~/.forge`), they can influence Forge or any other local developer tool.

Reports that depend on prior local write access are not security vulnerabilities unless they demonstrate how Forge itself grants that write access or crosses an operating-system privilege boundary.

### Safety Guardrails
Forge includes safety interceptors that actively block destructive commands (e.g. system reboot, shutting down, disk formatting, killing init / PID 1, dropping root directories, or flushing firewall rules).

## Reporting a Vulnerability

If you believe you have discovered a security vulnerability in Forge, please report it privately:

- **Email**: `hirendave@example.com`
- **GitHub Security Advisories**: Open a private advisory on [https://github.com/hirendave47/forge/security/advisories](https://github.com/hirendave47/forge/security/advisories)

Please include:
- A description of the issue and potential impact
- Steps to reproduce or proof of concept
- Affected version, environment, or configuration

Do not open public GitHub issues for security-sensitive vulnerabilities.

## Scope

Security issues in Forge's core CLI tools, packages, API integrations, and safe command execution interceptors are in scope.

## Out Of Scope

- Intentional local commands executed within the user's existing permissions.
- Prompt injection from untrusted external text in repositories unless bypassing hard guardrails.
- User-supplied API keys or environment credentials residing in local shell configuration.
