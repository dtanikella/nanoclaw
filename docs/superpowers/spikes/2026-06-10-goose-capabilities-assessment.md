# Spike: Goose Capabilities Assessment

**Date:** 2026-06-10
**Issue:** #5
**Status:** Open

## Purpose

Evaluate Block's Goose AI agent framework (`github.com/block/goose`) as a potential agent provider for NanoClaw. Produce a comprehensive, neutral research document covering Goose's capabilities and its compatibility with NanoClaw's architecture.

## Scope

### In Scope

- **Goose core architecture:** Agent loop, session model, tool invocation, process lifecycle, design philosophy
- **Extension & toolkit system:** Built-in toolkits, extension registration, out-of-the-box capabilities, custom extension authoring
- **Model flexibility:** Supported LLM providers and models, model selection mechanism, provider lock-in (or lack thereof)
- **Programmatic API & headless usage:** Whether Goose can be driven without its CLI/TUI, SDK/library interfaces, embedding options
- **NanoClaw compatibility assessment:**
  - *Containerization:* Can Goose run inside Docker/Apple containers? Runtime dependencies, startup behavior, resource requirements
  - *Two-DB session protocol:* Can Goose be adapted to read from `inbound.db` and write to `outbound.db`? What adapter layer would be needed?
- **Claude vs Goose comparison:** Feature-by-feature comparison covering tool use, context handling, multi-turn conversation, code generation, MCP support, extensibility
- **Open questions:** Specific, actionable unknowns that would require further investigation or a PoC to resolve

### Out of Scope

- Side-by-side provider routing design (running Goose alongside Claude)
- Proof-of-concept implementation or code changes to NanoClaw
- Cost analysis or licensing review
- Go/no-go recommendation — the document presents facts neutrally

## Research Methodology

- **Primary sources:** Goose open-source repo (`github.com/block/goose`), official documentation, README, source code
- **Secondary sources:** Community discussions, release notes, published architecture docs
- **Hands-on verification:** Install Goose locally and exercise key features to verify documentation claims

## Deliverable

A single Markdown document at this path (`docs/superpowers/spikes/2026-06-10-goose-capabilities-assessment.md`), updated in-place as the spike progresses. Neutral tone throughout.

## Document Structure

1. **Executive Summary** — 2-3 sentence overview of what Goose is and key findings
2. **Goose Architecture Overview** — How Goose works internally: agent loop, session model, how it invokes tools, process lifecycle
3. **Extension & Toolkit System** — Built-in toolkits, how extensions are registered, what capabilities ship out of the box, how custom extensions are built
4. **Model Flexibility** — Supported LLM providers/models, how model selection works, any provider lock-in
5. **Programmatic API & Headless Usage** — Whether Goose can be driven without its CLI/TUI, SDK/library interfaces, embedding options
6. **NanoClaw Compatibility Assessment**
   - Containerization feasibility
   - Two-DB session protocol compatibility
7. **Claude vs Goose Comparison** — Feature-by-feature comparison table
8. **Open Questions** — Specific unknowns requiring further investigation
9. **References** — All documentation, articles, and resources cited with direct links

## Success Criteria

- Each section answers its questions with enough detail to make an informed decision
- The compatibility assessment identifies specific technical blockers (if any) vs solvable integration work
- The comparison table is factual and covers dimensions relevant to NanoClaw's use case
- Open questions are specific and actionable (not vague "needs more research")

## Constraints

- Goose must be viable to run inside Docker/Apple containers (same as current agent providers)
- Goose must be adaptable to NanoClaw's two-DB session protocol (`inbound.db` / `outbound.db`)

## References

All documentation, articles, and resources consulted during research will be cited here with direct links. This section will be populated as the spike is executed.
