# Purpose

Specify the planned NEXA MVP, following `AGENTS.md` and `PROJECT_BRIEF.md`. These requirements describe intended behavior, not implemented capabilities. NEXA demonstrates ASK → DETECT → RECOVER → VALIDATE → PUBLISH → LEARN through Agentic AI and human-controlled knowledge recovery.

# Actors

- **Employee:** asks organizational questions, receives grounded answers when evidence exists, and explicit insufficient-knowledge responses otherwise.
- **Administrator / Knowledge Manager:** reviews dashboard, analytics, gaps, suggested departments/experts and actions; progresses recovery; provides collected information; reviews drafts; approves publication or rejects/requests changes.

Actors are conceptual UI/product modes. Authentication and authorization are not implemented.

# Functional Requirements

| ID | Requirement |
| --- | --- |
| FR-001 | AI Assistant accepts a nonempty organizational question. |
| FR-002 | Return a grounded answer when evidence is sufficient, with source metadata when available. |
| FR-003 | Explicitly report insufficient organizational knowledge without fabricating internal procedures. |
| FR-004 | Persist query text, outcome, time, category, available source references, and associated gap when applicable. |
| FR-005 | Create a gap only for organizationally relevant INSUFFICIENT results after successful retrieval. Greetings, unrelated questions, and provider/source/service failures never create gaps. |
| FR-006 | Match open gaps using deterministic normalizedQuestionKey: lowercase, trim, replace punctuation with spaces, collapse whitespace, and apply supported demo aliases. Keep AI display titles separate. Persist/link each accepted unanswered submission and increment occurrences exactly once transactionally; new gaps start at 1. No embeddings or confidence thresholds for matching. |
| FR-007 | Give gaps a normalized title, category, editable priority, and suggested responsible department/experts when evidence supports them. Unknown responsibility remains unspecified. |
| FR-008 | AI suggests evidence-aware recovery actions, including information/document requests, email drafts, meetings, and documentation tasks. Backend supplies a labeled REQUEST_INFORMATION fallback if none is usable. |
| FR-009 | Display persistent gaps and details in Knowledge Operations. |
| FR-010 | Support exactly DETECTED, TRIAGED, ACTION_PROPOSED, IN_PROGRESS, KNOWLEDGE_COLLECTED, AWAITING_APPROVAL, PUBLISHED, and RESOLVED. |
| FR-011 | Let the administrator progress valid transitions; backend enforces state and prerequisite checks. |
| FR-012 | Require human selection/approval of a recovery action before simulated execution; clearly label simulation. |
| FR-013 | Associate collected information and origin with a gap; increment evidenceRevision for each change. |
| FR-014 | AI generates a draft from newly collected evidence; persist draft revision and its input evidenceRevision. Evidence changes make the old draft stale and require a newer draft before review/approval. |
| FR-015 | Atomically approve the current fresh draft, persist approval, publish an article id/revision to SQLite-backed NEXA Approved Knowledge, and set PUBLISHED. No external publication/indexing is required. Failure rolls back all writes. |
| FR-016 | Support APPROVED, CHANGES_REQUESTED, and REJECTED. Changes requested/rejection returns to KNOWLEDGE_COLLECTED and requires a newer draft revision before resubmission; recovery remains open. |
| FR-017 | Resolve a gap only after successful approved publication. A later question can use the newly published knowledge. |
| FR-018 | Provide a read-only Sources view with at least one functioning prototype source and the local approved store. Show future integrations as not configured, never falsely functional. |
| FR-019 | Derive analytics from stored query/gap data: total queries, answered and insufficient queries, categories, recent activity, gap counts by status, and source usage when available. |
| FR-020 | Knowledge Health exposes open gaps, recurring insufficient topics, and understandable query-coverage/gap-resolution indicators derived from stored demo data; do not imply comprehensive organizational coverage. |
| FR-021 | Dashboard summarizes key metrics and workflow states and links to all six MVP modules. |

# Non-Functional Requirements

Dashboard, Analytics, and Knowledge Health reuse shared backend aggregation logic. LEARN means reusable knowledge and updated indicators, not training. Frontend development uses mocked DTOs; backend can use FakeAgentProvider independently of Botpress.

| ID | Requirement |
| --- | --- |
| NFR-001 | Use simple, maintainable modules and keep business rules outside UI components. |
| NFR-002 | Isolate Botpress and external sources behind replaceable backend adapters. |
| NFR-003 | Use strict TypeScript and shared API entity types. |
| NFR-004 | Use a pragmatic frontend/backend MVP with SQLite; avoid unnecessary infrastructure or dependencies. |
| NFR-005 | Load secrets from environment variables and never commit them. |
| NFR-006 | Use only synthetic/non-confidential demonstration data. |
| NFR-007 | Eventually document reproducible installation, configuration, seed, and local startup steps; Docker is not initially required. |
| NFR-008 | Show useful errors for service, source, malformed-response, and persistence failures without claiming a successful answer or write. Service failure alone must not become a knowledge gap. |
| NFR-009 | Enforce human approval for consequential actions in backend rules, not merely disabled UI controls. |
| NFR-010 | Clearly distinguish working features, simulated actions, and unavailable/mock integrations. |
| NFR-011 | Provide responsive, desktop-oriented screens with labeled inputs, keyboard access, visible focus, readable contrast, and statuses conveyed beyond color alone. |
| NFR-012 | Add/update business-logic tests during implementation and run relevant lint, test, and build commands once available. No enterprise SLA or production-scale guarantees are assumed. |

# MVP Acceptance Criteria

The eight state meanings and guards in `ARCHITECTURE.md` apply. TRIAGED records human review; PUBLISHED means an approved article revision is immediately retrievable; RESOLVED requires subsequent explicit human closure. No separate screen per state is needed. Triage metadata uses a narrow update endpoint.

1. In the custom portal, Question A from `DEMO_SCENARIO.md` returns the documented procedure with a source reference and persists an answered query (FR-001–004, FR-018).
2. Question B returns explicit insufficiency and creates one DETECTED gap. Repeating the equivalent question before resolution reuses that gap and increases occurrences (FR-003–007).
3. Reloading the interface retains queries, gap details, category, priority, and recovery state (FR-004–011).
4. An administrator reviews proposals and approves a simulated action, adds collected information, and creates a saved draft (FR-012–014).
5. Reject publication without approval, stale-evidence drafts, and unchanged resubmission after rejection/change requests. A newer fresh revision requires human approval. Transaction failure leaves no partial approval/article (FR-013–016).
6. Local publication precedes explicit human resolution. Repeating Question B immediately retrieves the approved article revision without external indexing and produces a grounded answer (FR-017).
7. Dashboard, Analytics, and Knowledge Health reflect stored queries and state changes. Historical insufficient queries retain their original outcome after gap resolution (FR-019–021).
8. An unavailable AI/source produces a clear error, not a fabricated answer or automatic knowledge gap; unavailable integrations and simulated actions are visibly labeled (NFR-008–010).
9. Greetings and unrelated questions create no gap or insufficient-organizational-query metric. Canonical questions and supported aliases reuse one open gap regardless of its display title.
10. Show AI evidence-sufficiency assessment, an evidence-aware recovery recommendation, and drafting from newly collected information. Short evidence-supported explanations are allowed; hidden chain-of-thought is not. Deterministic fallback proposals are not proof of live AI behavior.

# Explicit Out of Scope

Authentication/authorization, enterprise SSO, advanced RBAC, real multi-tenancy, billing/subscriptions, mobile apps, Kubernetes, microservices, real ERP integrations, full Microsoft 365 automation, autonomous real emails/meetings, model training/fine-tuning, production infrastructure complexity, and confidential company information remain excluded.

# Academic / Demonstration Constraints

The prototype supports an innovation/entrepreneurship academic presentation of approximately five minutes. A working demonstration is important; communicating innovation and business value takes precedence over production completeness. Four team members collaborate through GitHub and Kanban / GitHub Projects.

Clearly labeled mockups may illustrate future capabilities. Agentic AI must visibly assess evidence, classify gaps, suggest recovery, and assist drafting, demonstrating behavior beyond document Q&A. See `DEMO_SCENARIO.md` for the presentation and fallbacks.
