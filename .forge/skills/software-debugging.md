---
name: software-debugging
description: Systematic debugging workflows for application crashes, stack traces, race conditions, and test regressions.
---

# Software Debugging Skill

## 1. Investigation Protocol
1. **Reproduce**: Run the test suite or command that triggers the failure.
2. **Isolate**: Extract the exact stack trace, error message, and failing line numbers.
3. **Trace**: Check recent git commits (`git log -n 5 --stat`) and diffs (`git diff`).
4. **Fix**: Apply minimal, surgical edits.
5. **Verify**: Run unit tests and type checks (`npm test`, `npm run check`, `pytest`, etc.).

## 2. Best Practices
- Never assume a bug is fixed without running the automated test suite.
- Check for edge cases, null/undefined pointers, and boundary conditions.
