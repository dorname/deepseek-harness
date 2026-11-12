---
name: "openlogos-sync"
description: "OpenLogos — OpenLogos sync command"
disable-model-invocation: true
---


Sync the OpenLogos project configuration by regenerating AI instruction files and re-deploying skills.

1. Run `openlogos sync` in the project root directory.
2. If the `openlogos` CLI is not found, tell the user to install it:
   ```
   npm install -g @miniidealab/openlogos
   ```
3. After sync completes, inform the user that AGENTS.md, CLAUDE.md, and skills have been refreshed based on the current `logos/logos.config.json` settings.
