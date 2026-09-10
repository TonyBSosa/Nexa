# Architecture and Product Decision Log

These records capture planned MVP decisions, consistent with `AGENTS.md`, `PROJECT_BRIEF.md`, and the documentation-foundation request. They do not claim implementation. API field details remain provisional in `API_CONTRACTS.md`; material scope/architecture changes require clarification and an explicit decision update.

## ADR-001 — Agentic AI as emerging technology

**Decision:** Demonstrate intent interpretation, evidence assessment, gap classification, recovery suggestions, and drafting through Agentic AI.
**Rationale:** The academic prototype must visibly go beyond retrieval.
**Consequences:** Demo agent reasoning outcomes through useful workflow steps; preserve human approval.

## ADR-002 — Organizational knowledge lifecycle platform

**Decision:** Center NEXA on ASK → DETECT → RECOVER → VALIDATE → PUBLISH → LEARN.
**Rationale:** Employee questions reveal missing organizational knowledge.
**Consequences:** Answering questions and recovering knowledge are both core product responsibilities.

## ADR-003 — Human-in-the-loop for consequential actions

**Decision:** Require explicit human approval for consequential actions and publication.
**Rationale:** Generated proposals and drafts require organizational validation.
**Consequences:** Backend enforces review gates; approval applies to the current draft revision, with simple rejection/change-request handling.

## ADR-004 — React + TypeScript + Vite frontend

**Decision:** Plan React with strict TypeScript and Vite, Tailwind CSS, and shadcn/ui.
**Rationale:** Support a custom portal with shared components and a practical team workflow.
**Consequences:** Keep business rules outside components; no framework initialization during documentation work.

## ADR-005 — Node.js + Express + TypeScript backend

**Decision:** Use a pragmatic Express backend with strict TypeScript.
**Rationale:** Centralize business rules while sharing entity contracts with the frontend.
**Consequences:** Backend owns query logging, analytics, gaps, recovery, approvals, and integration boundaries.

## ADR-006 — SQLite for MVP persistence

**Decision:** Use SQLite for persistent demo entities.
**Rationale:** Local persistence is sufficient without a separate database service.
**Consequences:** Keep the model simple; query links and an occurrence counter initially replace a separate occurrence entity.

## ADR-007 — Replaceable Botpress Cloud boundary

**Decision:** Use Botpress Cloud initially behind a provider-neutral backend agent gateway.
**Rationale:** Orchestration choice must not define the product or lock its domain model to one provider.
**Consequences:** No Botpress provider payloads enter shared domain contracts. All frontend product workflows, including the employee assistant, depend on the NEXA backend. A public Webchat embed may be used only as a disabled-by-default development diagnostic.

## ADR-008 — REST API between frontend and backend

**Decision:** Use HTTP/REST and shared provisional DTOs.
**Rationale:** Let frontend and backend contributors work independently.
**Consequences:** Mocks follow the same contracts; preserve agreed compatibility unless a task explicitly changes it.

## ADR-009 — Synthetic company data

**Decision:** Use only synthetic/non-confidential prototype data.
**Rationale:** Demonstrate realistic business value without private company information.
**Consequences:** Demo procedures and roles are fictional; secrets remain in environment variables and outside Git.

## ADR-010 — Kanban + GitHub Projects

**Decision:** Organize the four-person team's work using Kanban / GitHub Projects.
**Rationale:** Make focused tasks and progress visible with minimal process overhead.
**Consequences:** Divide work around agreed document, UI, API, and integration boundaries.

## ADR-011 — GitHub collaboration

**Decision:** Use GitHub for source control and review.
**Rationale:** Support human and Codex collaboration with reviewable history.
**Consequences:** Focus changes, preserve others' work, and do not commit directly to main unless explicitly instructed.

## ADR-012 — One working knowledge source is sufficient

**Decision:** Require at least one real synthetic-document source for the MVP.
**Rationale:** A functioning knowledge loop proves value without broad integration work.
**Consequences:** Verify grounded retrieval from the configured source; recovered knowledge publishes immediately to backend-owned SQLite storage as specified in ADR-018. No external publication/indexing is required.

## ADR-013 — Honest integration representation

**Decision:** Future integrations may appear as clearly labeled mockups or not configured.
**Rationale:** Communicate direction without false functionality claims.
**Consequences:** Notion, SharePoint, Google Drive, Microsoft 365, and ERP/internal API capabilities remain replaceable future adapters unless actually implemented.

## ADR-014 — Docker deferred

**Decision:** Start locally; consider Docker Compose after frontend/backend integration is stable.
**Rationale:** Avoid infrastructure work before the core prototype functions.
**Consequences:** Docker is not initially required; Botpress remains cloud-hosted; no Kubernetes.

## ADR-015 — No MVP authentication or real multi-tenancy

**Decision:** Employee/admin are conceptual UI modes; omit authentication, authorization, and real multi-tenancy.
**Rationale:** Focus the academic prototype on knowledge intelligence.
**Consequences:** Do not claim production access protection; enterprise SSO, advanced RBAC, billing, and subscriptions are excluded.

## ADR-016 — Knowledge Operations as core differentiator

**Decision:** Persist gaps through the eight-state recovery lifecycle, ending in approved publication and resolution.
**Rationale:** Missing knowledge must become actionable and reusable.
**Consequences:** Track recurrence, information, drafts, and approvals. Metrics reflect stored data; resolving a gap does not rewrite earlier query outcomes.

## ADR-017 — Proposed/simulated external actions

**Decision:** Recovery actions are human-approved proposals and simulations in the MVP.
**Rationale:** Demonstrate agentic recovery within a short presentation without live external automation.
**Consequences:** No autonomous real emails or meetings. Clearly label simulations; the internal persistence, review, publication, and resolution workflow must function.

## ADR-018 — Local approved knowledge and atomic publication

**Decision:** Publish approved articles with stable article IDs and revisions into NEXA Approved Knowledge in SQLite. Approve, persist approval, publish the article revision, and set PUBLISHED in one transaction; failure rolls back all writes.
**Rationale:** The recovery demo needs immediate retrieval without external indexing or partial external-write recovery.
**Consequences:** Backend reads approved content into the agent assessment path alongside configured knowledge. Explicit human closure sets RESOLVED later. Successful approval retries reuse the same publication; external publication is a future adapter.

## ADR-019 — Two provider-neutral AI operations

**Decision:** Use assessQuestion() and generateKnowledgeDraft(). Assessment returns relevance, SUFFICIENT/INSUFFICIENT/FAILURE, retrieval completion, answer/evidence, and recovery suggestions in one structured call.
**Rationale:** Keep Botpress replaceable and avoid separate model calls for each suggestion.
**Consequences:** Provider payloads stay in the adapter. Failures never create gaps. Backend owns all domain writes and approvals; FakeAgentProvider supports independent implementation.

## ADR-020 — Deterministic gap matching and eligibility

**Decision:** Only relevant INSUFFICIENT results after successful retrieval create gaps. Match open gaps by normalizedQuestionKey with lowercase/trim/punctuation-to-space/whitespace normalization and a small explicit demo alias map.
**Rationale:** Predictable recurrence is sufficient for the prototype.
**Consequences:** Display titles are separate; no embeddings, confidence percentages, or separate occurrence table are required. Each accepted unanswered query is linked transactionally. The accepted optional clientSessionId policy suppresses repeat demand increments within five minutes of the last counted occurrence per session/gap; without it each eligible submission counts. Unrelated and FAILURE attempts persist for observability but are excluded from organizational metrics. Greetings, out-of-scope input, and service failures create no gap.

## ADR-021 — Fresh drafts and explicit workflow meanings

**Decision:** Preserve all eight states, require evidenceRevision on gaps/drafts, and prohibit stale draft approval or unchanged resubmission after rejection/change requests.
**Rationale:** Review must apply to current collected information and the exact draft revision.
**Consequences:** Evidence changes require a newer draft; rejection keeps recovery open. Supply REQUEST_INFORMATION if no usable AI proposal exists. Triage metadata uses a narrow PATCH; no screen-per-state or generic workflow engine.

## ADR-022 — Independent workstreams and reliable demonstration

**Decision:** Separate frontend, backend/domain, AI/Botpress, and knowledge/demo/QA work through shared DTOs, fake provider results, and deterministic fixtures.
**Rationale:** Four people can progress independently while preserving a reproducible five-minute story.
**Consequences:** Sources stays read-only; summaries share aggregation logic. Seed/reset local and relevant external knowledge/conversation state. Agree a fallback cutoff and prepare screenshots, known outputs, and a recording. Visibly demonstrate assessment, evidence-aware suggestions, and drafting; do not expose hidden chain-of-thought. LEARN is knowledge reuse and indicators, not training. Keep the agreed stack and defer Docker until local integration stabilizes.

## ADR-023 — Knowledge Operations remediation

**Decision:** Keep metadata/evidence/draft writes separate from explicit human transitions. Canonical approved content is authoritative: answer an existing match before external provider work and recheck it inside the immediate query-write transaction after provider work. Approval retries require APPROVED, the current revision, and a consistent publication; conflicting reviews fail.
**Rationale:** Preserve the documented lifecycle and prevent delayed insufficient assessments from recreating demand after publication.
**Consequences:** No provider call runs inside a SQLite transaction. Runtime validation rejects malformed provider shapes; unusable action entries are filtered and replaced with the labeled fallback when necessary. Existing message/evidence naming, HTTP 200 chat assessments, session demand suppression, and observability logging remain unchanged. The local store and FakeAgentProvider remain sufficient without an external provider.

## ADR-024 — Botpress Runtime API provider

**Decision:** Add BotpressAgentProvider behind AgentProvider, selected with `AGENT_PROVIDER=botpress`; keep FakeAgentProvider as the default. Use the official Botpress TypeScript client and Runtime API, discover an installed integration and proven channel, create an isolated integration-scoped user/conversation for each assessment, and exchange a narrow `nexa.assessment.v1` JSON envelope.
**Rationale:** The deployed NEXA bot and its indexed synthetic knowledge were verified through the public Webchat proof; the backend needs an independent, narrow adapter so that real semantic retrieval does not couple shared contracts or domain state to Botpress.
**Consequences:** Botpress credentials remain server environment values. Bot context uses the token and bot ID for discovery; the resolved installed `integrationId` establishes integration context for Runtime writes. `x-integration-alias` is not required. Calls distinguish authentication, authorization, timeout, unavailability, and invalid provider responses internally while public failures remain sanitized. Each assessment sends the `NEXA_ASSESSMENT_V1` prefix and accepts only validated `nexa.assessment.v1` JSON, never conversational inference. Botpress cannot write queries, gaps, workflow state, approvals, or publications. Draft generation remains deterministic until a separate Botpress draft flow is justified.

## ADR-025 — Webchat connectivity diagnostic

**Decision:** Retain the floating Botpress Webchat only as an optional development connectivity and RAG diagnostic. It is disabled by default, guarded by `VITE_ENABLE_BOTPRESS_WEBCHAT=true`, and excluded from production builds. The product request path remains React → Express → AgentProvider → Botpress.
**Rationale:** The proof verified the deployed agent, MX550 retrieval, and Webchat v5 message fields including `authorId` and `block`, without making a browser-owned integration part of NEXA's architecture.
**Consequences:** Do not ingest Webchat events or create a second domain path. The diagnostic uses public embed resources and no credentials. Express continues to own relevance, assessment outcomes, query/gap persistence, approved-knowledge priority, workflow, and analytics. BotpressAgentProvider remains the production path; its Runtime transport now works through explicit integration-ID context, independently of the diagnostic embed.

## ADR-026 — Bounded Botpress assessment stability

**Decision:** Accept SUFFICIENT and valid non-organizational assessments immediately. Retry a Botpress failure, timeout, or malformed response once in a fresh isolated conversation. Confirm a relevant INSUFFICIENT assessment once in another fresh conversation; either SUFFICIENT result wins, and only two valid relevant INSUFFICIENT results permit gap creation.

**Rationale:** Runtime availability and semantic retrieval can vary between otherwise identical isolated requests. One bounded retry/confirmation prevents a transient miss from becoming false organizational demand without adding a general resilience framework.

**Consequences:** Repeated failures and inconsistent confirmation map to provider FAILURE and never create gaps. Safe development logs identify timeout, invalid response, recovered retrieval, and confirmed insufficiency without prompts or credentials. Valid JSON may be extracted from Markdown or surrounding conversational text, but domain fields are never inferred from that prose. Runtime context is cached per API process, and non-structured output ends after a bounded quiet period rather than consuming the full polling timeout. The frontend request timeout accommodates the bounded two-attempt backend operation. FakeAgentProvider remains explicitly selectable and is never chosen per request; deterministic draft generation is a shared evidence-only helper.
