# Agent instructions (compatibility entrypoint)

Read [AGENTS.md](AGENTS.md) for canonical SDK instructions and workflow links.
The block below is maintained by vendor-reference tooling; `@repos/` denotes local `repos/`.

<!-- agent-repos:start -->

## Vendored Repositories

This project vendors external repositories under @repos/ for coding-agent reference.

- Use vendored repositories as read-only reference material when working with related libraries.
- Prefer examples and patterns from vendored source code over generated guesses or web search results.
- Do not edit files under @repos/ unless explicitly asked.
- Do not import from @repos/; application code should continue importing from normal package dependencies.

Vendored repositories currently available:

- @repos/effect/ — https://github.com/Effect-TS/effect.git (effect@4.0.0-beta.105)

When working with a related library, inspect its vendored repository for idiomatic usage, tests, module structure, API design, examples, and docs. If the vendored repository contains agent-oriented guidance such as LLMS.md, AGENTS.md, or AGENT.md, read that guidance before making changes.

<!-- agent-repos:end -->
