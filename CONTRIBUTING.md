# Contributing to Forge

Thank you for your interest in contributing to **Forge — Autonomous AI Agent Framework for Linux**!

## Core Principles

1. **Autonomous, Goal-Driven First**: Forge is designed as an autonomous Linux operational agent for DevOps, SRE, and systems engineering. Features should enhance independence, reliability, and precision.
2. **Modular Architecture**: Built-in tools and capabilities should stay focused. Specializations belong in modular extensions or tools.
3. **Understand Your Code**: Ensure you understand your changes and how they interact with the agent loop, runtime tools, and safety interceptors.

## Development & Verification Workflow

Before submitting a pull request:

```bash
# 1. Install dependencies
npm install --ignore-scripts

# 2. Run lint, format, and typecheck
npm run check

# 3. Build offline
npm run build:offline

# 4. Run test suite
npm test
```

All checks must pass with zero errors and zero warnings.

## Reporting Issues & Feature Requests

- Open an issue on [https://github.com/hirendave47/forge/issues](https://github.com/hirendave47/forge/issues).
- Provide concrete reproductions, relevant terminal logs, and system context.
