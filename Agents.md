# Repository Guidelines

## Purpose and Product Lifecycle

NEXA is an AI-powered SaaS for organizational knowledge management, beyond a chatbot or RAG interface. Its core lifecycle is:

ASK → DETECT → RECOVER → VALIDATE → PUBLISH → LEARN

Help organizations query internal knowledge, detect and classify gaps, suggest recovery actions, identify relevant departments or subject-matter experts, collect information, draft documentation, obtain human validation and approval, publish approved knowledge, and measure and improve knowledge health.

## MVP Modules and Knowledge Operations

Planned modules: Dashboard, AI Assistant, Sources, Analytics, Knowledge Health, and Knowledge Operations.

Knowledge Operations manages gaps through this intended lifecycle:

DETECTED → TRIAGED → ACTION_PROPOSED → IN_PROGRESS → KNOWLEDGE_COLLECTED → AWAITING_APPROVAL → PUBLISHED → RESOLVED

Keep workflow rules in the backend. Publication requires human validation and approval.

## AI Behavior and Human Approval

- Never invent internal company knowledge when sources are insufficient. Explicitly surface missing knowledge as a knowledge gap.
- Human-in-the-loop approval is mandatory for consequential actions.
- AI may propose emails, meetings, document requests, or documentation tasks; execution requires human approval in the MVP.
- Generated documentation remains a draft until a human validates and approves publication to the organization's knowledge base.

## Planned Architecture

- Frontend: React, TypeScript, and Vite; Tailwind CSS and shadcn/ui.
- Backend: Node.js, Express, and TypeScript; HTTP/REST communication with the frontend.
- MVP persistence: SQLite. Initial agent/LLM orchestration: Botpress Cloud.
- Backend owns business logic, analytics, persistence, knowledge-gap workflows, and integration boundaries. Keep business rules outside UI components.
- Frontend product workflows, including the employee assistant, must use the NEXA backend. A public Botpress Webchat embed may exist only as an explicitly enabled development diagnostic; it must be disabled by default, receive no backend credentials, and never write NEXA domain state.
- Treat Notion, SharePoint, Google Drive, Microsoft 365, ERP systems, and company APIs as replaceable integrations.
- Use shared types for entities exchanged between frontend and backend.

These are planned decisions, not installed capabilities. The repository is in its foundation stage: do not scaffold applications, install dependencies, or initialize frameworks, databases, or infrastructure until a later task explicitly requests implementation.

## MVP Scope and Security

Use synthetic, non-confidential business data. Configure secrets through environment variables; never hardcode or commit secrets, tokens, or populated secret files to Git.

Unless later requested, exclude production authentication, enterprise SSO, real multi-tenancy, billing, mobile applications, Kubernetes, microservices, production ERP integrations, complex RBAC, full Microsoft 365 automation, custom LLM training or fine-tuning, and unnecessary infrastructure.

## Implementation and Verification

- Prefer simple, maintainable solutions and modular boundaries over overengineering.
- Use strict TypeScript. Add dependencies only for a concrete, explained need.
- Keep changes scoped; avoid unrelated files, large unrelated refactors, and silent scope expansion.
- Add or update tests when implementing business logic.
- Once lint, test, and build commands exist, run the relevant commands before declaring implementation complete. Report failures or checks that could not run; do not invent commands or claim unperformed validation.
- Explain important architectural decisions that differ from documented decisions.

## Collaboration and Change Management

Use GitHub for repository collaboration and Kanban for project management. Multiple human developers and Codex agents may work concurrently: preserve others' work and keep changes focused and easy to review.

Do not commit directly to `main` unless explicitly instructed. Preserve backward compatibility with agreed API contracts unless the task explicitly changes them. Use concise, action-oriented commit subjects; describe purpose, changes, and validation in pull requests, linking related issues when applicable.

If ambiguity could materially affect architecture or scope, stop and ask before proceeding with dependent work.
