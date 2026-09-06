# Provisional API Contracts

These HTTP/REST design contracts are not implemented endpoints. They support independent frontend/backend work and matching, explicitly labeled frontend mocks. Shared types eventually belong in `packages/shared/`. No authentication endpoints or verified-user claims are included.

## Conventions and Shared DTOs

Use JSON, opaque string IDs, ISO-8601 UTC timestamps, and camelCase fields. Examples use synthetic data. Lists use `{ "items": [] }`; pagination is deferred. Missing optional values may be omitted; explicitly unknown scalar values use `null`. Successful reads and updates return 200; new chat results, evidence, and draft revisions return 201.

| DTO | Fields / meaning |
| --- | --- |
| Query | `id`, `question`, `answer`, `sufficientKnowledge` boolean, `category` string/null, `sources` SourceReference[], optional `knowledgeGapId`, `createdAt`. Immutable outcome of a successfully processed question. |
| ChatRequest | `question`: nonempty string. |
| ChatResponse | `answer`, `sufficientKnowledge`, `sources`: SourceReference[], `queryId`, optional `knowledgeGapId`. |
| SourceReference | `sourceId`, `title`, optional `documentId` and `locator`; approved local content additionally requires `articleId` and `articleRevision`. No provider-specific payloads. |
| KnowledgeGapStatus | Exactly `DETECTED`, `TRIAGED`, `ACTION_PROPOSED`, `IN_PROGRESS`, `KNOWLEDGE_COLLECTED`, `AWAITING_APPROVAL`, `PUBLISHED`, `RESOLVED`. |
| SuggestedAction | `id`, `type`, `description`, `simulated`: true, `approvedAt`: timestamp/null. |
| KnowledgeGap | `id`, `originalQuestion`, `normalizedQuestionKey`, separate display `title`, `category`, `status`, `priority` (`LOW`, `MEDIUM`, `HIGH`; default `MEDIUM`), `occurrences`, `evidenceRevision` (initially 0), `suggestedDepartment`: string/null, `suggestedExperts`: string[], `suggestedActions`: SuggestedAction[], `collectedInformation`: CollectedInformation[], `draftKnowledge`: KnowledgeDraft/null, `approvals`: Approval[], `createdAt`, `updatedAt`. |
| CollectedInformation | `id`, `content`, `origin`, `createdAt`; associated with its containing gap. |
| KnowledgeDraft | `id`, `title`, `content`, `revision`: positive integer, `evidenceRevision`, `publication`: PublishedArticleReference/null, `updatedAt`. Regeneration/editing increments revision. |
| PublishedArticleReference | `articleId`, `articleRevision`: positive integer, `sourceId` (`nexa-approved` for MVP). Identifies published content, not just its source. |
| ApprovalDecision | Exactly `APPROVED`, `CHANGES_REQUESTED`, `REJECTED`. |
| Approval | `id`, `decision`: ApprovalDecision, `draftRevision`, `comment`: string/null, `createdAt`. A human UI decision, not authenticated identity. |
| KnowledgeSource | `id`, `name`, `status` (`CONNECTED`, `NOT_CONFIGURED`, `UNAVAILABLE`), `description`. CONNECTED means actually functioning; UNAVAILABLE means a configured source currently failing. |
| DashboardSummary | `totalQueries`, `answeredQueries`, `insufficientQueries`, `openGaps`, `resolvedGaps`, `gapsByStatus`: map containing every lifecycle status. |
| AnalyticsSummary | `totalQueries`, `answeredQueries`, `insufficientQueries`, `categories`: array of `{category, count}`, `recentActivity`: Query[], `gapsByStatus`, `sourceUsage`: array of `{sourceId, queryCount}` or null when unavailable. |
| KnowledgeHealthSummary | `openGaps`, `resolvedGaps`, `queryAnswerRate`: number/null, `gapResolutionRate`: number/null, `recurringTopics`: array of `{knowledgeGapId, title, occurrences}`. |

SuggestedAction types: `REQUEST_INFORMATION`, `DRAFT_EMAIL`, `PROPOSE_MEETING`, `REQUEST_DOCUMENT`, `CREATE_DOCUMENTATION_TASK`. All are proposals; there is no automatic external execution.

Metrics cover stored demo data: total queries = answered + insufficient. Service failures are not completed query outcomes. Open gaps have status other than RESOLVED, including PUBLISHED. Query answer rate = answered / total queries; gap resolution rate = resolved / total gaps. Rates are fractions from 0 to 1, or null for a zero denominator. Categories count queries (unknown category grouped as `Unclassified`). Source usage counts each referenced source at most once per query. Recurring topics are open gaps with occurrences > 1. Historical query outcomes do not change when a gap resolves. These are observed query/gap indicators, not a comprehensive company knowledge score.

## Shared Mutation Requests

| DTO | Fields |
| --- | --- |
| TriageUpdateRequest | At least one of `priority`, `category`, `suggestedDepartment` (string/null), `suggestedExperts` (string[]). Omitted fields unchanged; null/empty array clears optional suggestions. |
| GapTransitionRequest | Required `fromStatus`, `toStatus`; `selectedActionId` and `approveSimulatedAction: true` required only when entering IN_PROGRESS. |
| AddEvidenceRequest | Required nonempty `content`, `origin`. |
| GenerateDraftRequest | Required `mode` (GENERATE or SAVE), `evidenceRevision`; SAVE also requires nonempty `title`, `content`. |
| ApprovalRequest | Required `decision`, `draftRevision`; optional `comment`, mandatory nonempty for CHANGES_REQUESTED/REJECTED. |

Validate runtime payloads and reject unsupported fields. Frontend mocks use these same DTOs.

## Internal Agent Contract (Not HTTP Endpoints)

`assessQuestion()` accepts question and backend-retrieved approved evidence with article/revision references. Return `organizationallyRelevant` (boolean, null allowed on FAILURE), `status` (SUFFICIENT / INSUFFICIENT / FAILURE), `retrievalCompleted` boolean, `answer` string/null, `sources` SourceReference[], `suggestedCategory` string/null, `suggestedDepartment` string/null, `suggestedExperts` string[], and `suggestedActions` (type/description proposals). Optional short recommendation explanations cite evidence; never expose hidden chain-of-thought. Backend supplies action IDs and approval metadata.

SUFFICIENT requires a grounded answer. Relevant INSUFFICIENT with successful retrieval permits gap creation. FAILURE includes a sanitized error code and never creates a gap; malformed responses are failures. Non-relevant inputs never create gaps. Unknown contacts remain unspecified. Prefer this single structured assessment over separate classification/suggestion calls. If no usable action is returned, backend adds a labeled REQUEST_INFORMATION fallback.

`generateKnowledgeDraft()` accepts collected information and evidenceRevision and returns title/content tied to that version, or structured failure. Backend assigns draft revisions and verifies evidence freshness before saving. Botpress payloads stay in its adapter; FakeAgentProvider implements the same boundary for independent backend work. Eligibility, matching, counts, persistence, transitions, freshness, approvals, publication, and metrics remain deterministic backend responsibilities.

## Error Responses

All endpoints use this error envelope with an appropriate HTTP status:

```json
{"error":{"code":"INVALID_REQUEST","message":"Question must not be empty."}}
```

Common errors: 400 `INVALID_REQUEST`, 404 `NOT_FOUND`, 409 `INVALID_TRANSITION` / `STALE_STATE` / `APPROVAL_REQUIRED`, 500 `PERSISTENCE_ERROR`, 502 `INVALID_PROVIDER_RESPONSE`, 503 `AGENT_UNAVAILABLE` / `SOURCE_UNAVAILABLE`. Return useful sanitized messages, never credentials. Every persistent read/write can return PERSISTENCE_ERROR. No success is returned for a failed save. Insufficient evidence is a successful domain response, not a service error.

## GET /api/health

Purpose: API liveness only; does not claim all integrations work. No body.

```json
{"status":"ok"}
```

Errors: transport/server failure; source health is exposed through Sources.

## GET /api/dashboard

Purpose: DashboardSummary. No body.

```json
{"totalQueries":2,"answeredQueries":1,"insufficientQueries":1,"openGaps":1,"resolvedGaps":0,"gapsByStatus":{"DETECTED":1,"TRIAGED":0,"ACTION_PROPOSED":0,"IN_PROGRESS":0,"KNOWLEDGE_COLLECTED":0,"AWAITING_APPROVAL":0,"PUBLISHED":0,"RESOLVED":0}}
```

Errors: PERSISTENCE_ERROR.

## GET /api/queries

Purpose: persisted query activity, newest first. No body.

```json
{"items":[{"id":"q-2","question":"At Valle Norte Supplies, who approves an urgent supplier payment when the Finance Lead is absent?","answer":"The available organizational knowledge does not document this approval procedure.","sufficientKnowledge":false,"category":"Finance","sources":[],"knowledgeGapId":"gap-1","createdAt":"2026-09-06T15:01:00Z"}]}
```

Errors: PERSISTENCE_ERROR.

## POST /api/chat

Purpose: answer a question, persist its outcome, and create/link a relevant gap when evidence is insufficient. Request:

```json
{"question":"At Valle Norte Supplies, who approves an urgent supplier payment when the Finance Lead is absent?"}
```

201 insufficient response:

```json
{"answer":"The available organizational knowledge does not document this approval procedure.","sufficientKnowledge":false,"sources":[],"queryId":"q-2","knowledgeGapId":"gap-1"}
```

Representative 201 response for the documented equipment question:

```json
{"answer":"Record the asset tag and fault in the equipment log, notify the Operations Coordinator, and use the spare scanner from cabinet B after the coordinator records the swap.","sufficientKnowledge":true,"sources":[{"sourceId":"source-1","title":"Warehouse Scanner Procedure","documentId":"scanner-procedure","locator":"Scanner failure"}],"queryId":"q-1"}
```

Create gaps only for organizationally relevant INSUFFICIENT assessments after successful retrieval. Normalize question keys by lowercasing, trimming, replacing punctuation with spaces, and collapsing whitespace; apply explicit demo aliases. Match non-RESOLVED gaps by key, never AI display title. Persist/link each accepted unanswered query and increment occurrences exactly once in the same transaction; initial occurrences is 1. Separate deliberate submissions count separately; clients must not automatically retry this POST or submit twice while pending.

Greetings and unrelated/out-of-scope questions return 422 `OUT_OF_SCOPE` with a helpful organizational-question prompt in the error envelope; no query/gap is persisted and no knowledge-health metric changes. Provider/source failures likewise create no completed query or gap. Thus the existing total = answered + insufficient metric identity covers accepted organizational queries only. Other errors: INVALID_REQUEST, AGENT_UNAVAILABLE, SOURCE_UNAVAILABLE, INVALID_PROVIDER_RESPONSE, PERSISTENCE_ERROR.

## GET /api/sources

Purpose: read-only view of actual and potential source states. Include backend-owned NEXA Approved Knowledge (`id: "nexa-approved"`) as well as configured document sources. No body or source mutation endpoints.

```json
{"items":[{"id":"source-1","name":"Synthetic company documents","status":"CONNECTED","description":"Implemented demo document source."},{"id":"future-sharepoint","name":"SharePoint","status":"NOT_CONFIGURED","description":"Future integration; not functional."}]}
```

CONNECTED is an example of the required eventual working source, not a claim about today's repository. Errors: PERSISTENCE_ERROR. A known source outage is represented as UNAVAILABLE when its metadata remains readable.

## GET /api/knowledge-gaps

Purpose: list KnowledgeGap DTOs, newest updated first. Optional `?status=DETECTED` uses the lifecycle enum. No body. Representative empty response:

```json
{"items":[]}
```

Nonempty items use the detail shape below. Errors: INVALID_REQUEST for an invalid status; PERSISTENCE_ERROR.

## GET /api/knowledge-gaps/:id

Purpose: gap details. No body.

```json
{"id":"gap-1","originalQuestion":"At Valle Norte Supplies, who approves an urgent supplier payment when the Finance Lead is absent?","normalizedQuestionKey":"at valle norte supplies who approves an urgent supplier payment when the finance lead is absent","title":"Urgent supplier payment approval during Finance Lead absence","category":"Finance","status":"DETECTED","priority":"MEDIUM","occurrences":1,"evidenceRevision":0,"suggestedDepartment":"Finance","suggestedExperts":["Finance Lead"],"suggestedActions":[{"id":"action-1","type":"REQUEST_INFORMATION","description":"Ask the Finance Lead to document the absence approval procedure.","simulated":true,"approvedAt":null}],"collectedInformation":[],"draftKnowledge":null,"approvals":[],"createdAt":"2026-09-06T15:01:00Z","updatedAt":"2026-09-06T15:01:00Z"}
```

Errors: NOT_FOUND, PERSISTENCE_ERROR.

## POST /api/knowledge-gaps/:id/transition

Purpose: advance an administrator-controlled workflow step using GapTransitionRequest. `fromStatus` guards against stale screens; `selectedActionId` plus `approveSimulatedAction: true` is required to enter IN_PROGRESS. Priority/category/contact edits use the triage endpoint.

```json
{"fromStatus":"ACTION_PROPOSED","toStatus":"IN_PROGRESS","selectedActionId":"action-1","approveSimulatedAction":true}
```

```json
{"id":"gap-1","status":"IN_PROGRESS","updatedAt":"2026-09-06T15:02:00Z"}
```

Allowed forward steps: DETECTED → TRIAGED → ACTION_PROPOSED → IN_PROGRESS → KNOWLEDGE_COLLECTED → AWAITING_APPROVAL; PUBLISHED → RESOLVED. TRIAGED records human review. Evidence is required for KNOWLEDGE_COLLECTED. AWAITING_APPROVAL requires a saved draft whose evidenceRevision equals the gap's current version and whose revision is newer than any rejected/change-requested revision. ACTION_PROPOSED requires a usable proposal (deterministic REQUEST_INFORMATION fallback if AI provides none). Only approval can enter PUBLISHED or return a reviewed draft to KNOWLEDGE_COLLECTED. RESOLVED requires explicit human closure after local publication. Response is a mutation receipt; reload detail for full state.

Errors: INVALID_REQUEST, NOT_FOUND, STALE_STATE, INVALID_TRANSITION, APPROVAL_REQUIRED, PERSISTENCE_ERROR. No arbitrary status jump or real external action is permitted.

## POST /api/knowledge-gaps/:id/evidence

Purpose: add collected information during IN_PROGRESS or KNOWLEDGE_COLLECTED. Request:

```json
{"content":"When the Finance Lead is absent, the General Manager approves urgent supplier payments. The Finance Assistant prepares the invoice and urgency note and records approval before payment.","origin":"Synthetic Finance Lead response; simulated recovery"}
```

201 response:

```json
{"id":"evidence-1","content":"When the Finance Lead is absent, the General Manager approves urgent supplier payments. The Finance Assistant prepares the invoice and urgency note and records approval before payment.","origin":"Synthetic Finance Lead response; simulated recovery","createdAt":"2026-09-06T15:03:00Z"}
```

Use AddEvidenceRequest. Evidence does not advance status, but atomically increments gap evidenceRevision. Reload gap detail for the new version; any draft based on an older evidenceRevision is stale. Evidence cannot change during AWAITING_APPROVAL or after publication. Errors: INVALID_REQUEST, NOT_FOUND, INVALID_TRANSITION, PERSISTENCE_ERROR.

## POST /api/knowledge-gaps/:id/draft

Purpose: generate and save a new current draft revision from evidence while KNOWLEDGE_COLLECTED. Request:

```json
{"mode":"GENERATE","evidenceRevision":1}
```

GenerateDraftRequest also accepts `{"mode":"SAVE","evidenceRevision":1,"title":"...","content":"..."}` for human revision. Both modes increment revision and record the input evidenceRevision. Check that version on receipt and again before saving a generated result; return STALE_STATE if evidence changed. SAVE stores a draft, never published knowledge. Neither a stale draft nor an unchanged rejected/change-requested revision can be submitted for review.

201 response:

```json
{"id":"draft-1","title":"Urgent supplier payment approval during Finance Lead absence","content":"The Finance Assistant prepares the invoice and urgency note. When the Finance Lead is absent, the General Manager approves the urgent supplier payment. The Finance Assistant records approval before payment.","revision":1,"evidenceRevision":1,"publication":null,"updatedAt":"2026-09-06T15:03:30Z"}
```

Errors: INVALID_REQUEST, NOT_FOUND, INVALID_TRANSITION (including missing evidence), AGENT_UNAVAILABLE / INVALID_PROVIDER_RESPONSE for generation, PERSISTENCE_ERROR.

## POST /api/knowledge-gaps/:id/approval

Purpose: human review of the current fresh draft in AWAITING_APPROVAL using ApprovalRequest. APPROVED validates freshness, persists approval, creates/updates a NEXA Approved Knowledge article revision, and sets PUBLISHED in one SQLite transaction. The article is immediately available to backend retrieval; no Botpress indexing or external publication call is needed. This demonstrates human interaction, not verified identity or enterprise authorization. Request:

```json
{"decision":"APPROVED","draftRevision":1,"comment":"Reviewed against the collected synthetic Finance response."}
```

200 response after successful publication:

```json
{"approval":{"id":"approval-1","decision":"APPROVED","draftRevision":1,"comment":"Reviewed against the collected synthetic Finance response.","createdAt":"2026-09-06T15:04:00Z"},"gapStatus":"PUBLISHED","publication":{"articleId":"article-1","articleRevision":1,"sourceId":"nexa-approved"}}
```

`CHANGES_REQUESTED` or `REJECTED` requires a nonempty comment and returns the same envelope with that decision, `gapStatus: "KNOWLEDGE_COLLECTED"`, and `publication: null`. Require a newer draft revision before another review; neither decision closes recovery. Rejection applies to the draft, not the gap.

Errors: INVALID_REQUEST, NOT_FOUND, STALE_STATE (draft/evidence revision mismatch), INVALID_TRANSITION, PERSISTENCE_ERROR. Failure rolls back approval, article, and state together, leaving AWAITING_APPROVAL. A retry after success for the same draft/revision returns the existing approval/publication and current gapStatus (PUBLISHED or RESOLVED), without duplicate articles or state regression. Resolution remains a separate explicit transition. No external publication retry process is needed.

## PATCH /api/knowledge-gaps/:id/triage

Purpose: narrow metadata edits during DETECTED or TRIAGED using TriageUpdateRequest; no status change. Suggestions remain tentative role/department labels, not verified identities. Request:

```json
{"priority":"HIGH","category":"Finance","suggestedDepartment":"Finance","suggestedExperts":["Finance Lead"]}
```

200 response (reload detail for full state):

```json
{"id":"gap-1","priority":"HIGH","category":"Finance","suggestedDepartment":"Finance","suggestedExperts":["Finance Lead"],"updatedAt":"2026-09-06T15:01:30Z"}
```

Errors: INVALID_REQUEST (empty update, invalid priority, unsupported fields), NOT_FOUND, INVALID_TRANSITION, PERSISTENCE_ERROR. Cannot edit matching keys, occurrences, evidence, drafts, approvals, or lifecycle status through triage. This is not generic CRUD.

## GET /api/analytics

Purpose: AnalyticsSummary from persisted data. No body.

```json
{"totalQueries":2,"answeredQueries":1,"insufficientQueries":1,"categories":[{"category":"Operations","count":1},{"category":"Finance","count":1}],"recentActivity":[{"id":"q-2","question":"At Valle Norte Supplies, who approves an urgent supplier payment when the Finance Lead is absent?","answer":"The available organizational knowledge does not document this approval procedure.","sufficientKnowledge":false,"category":"Finance","sources":[],"knowledgeGapId":"gap-1","createdAt":"2026-09-06T15:01:00Z"}],"gapsByStatus":{"DETECTED":1,"TRIAGED":0,"ACTION_PROPOSED":0,"IN_PROGRESS":0,"KNOWLEDGE_COLLECTED":0,"AWAITING_APPROVAL":0,"PUBLISHED":0,"RESOLVED":0},"sourceUsage":[{"sourceId":"source-1","queryCount":1}]}
```

Errors: PERSISTENCE_ERROR.

## GET /api/knowledge-health

Purpose: KnowledgeHealthSummary, with observed-data indicators. No body.

```json
{"openGaps":1,"resolvedGaps":0,"queryAnswerRate":0.5,"gapResolutionRate":0,"recurringTopics":[]}
```

Use `/api/knowledge-gaps` for underlying gap details. Errors: PERSISTENCE_ERROR. Empty-data rates are null and displayed as “No data,” not a fabricated healthy score.
