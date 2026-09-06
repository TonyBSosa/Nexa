# Demo Objective

Demonstrate in approximately five minutes how NEXA converts questions into reusable organizational knowledge through ASK → DETECT → RECOVER → VALIDATE → PUBLISH → LEARN. Show Agentic AI, persistent recovery work, human approval, and observable improvement in a custom portal. This is a planned scenario, not a statement that features already work.

# Fictional Company Context

**Valle Norte Supplies** is a fictional Honduran small business distributing office and warehouse supplies. All roles, procedures, and records below are synthetic. It has Operations and Finance departments. The Operations Coordinator handles equipment issues; the Finance Lead is the contact for documenting payment procedures. The General Manager and Finance Assistant are fictional roles, not real contacts.

**Question A (documented):** “At Valle Norte Supplies, what should I do if a warehouse barcode scanner stops working?”

**Question B (intentionally undocumented):** “At Valle Norte Supplies, who approves an urgent supplier payment when the Finance Lead is absent?”

# Seed Knowledge Needed

Prepare these assets in a later implementation task, not as part of this documentation change:

- **Warehouse Scanner Procedure:** record the asset tag and fault in the equipment log, notify the Operations Coordinator, and use the spare scanner from cabinet B after the coordinator records the swap.
- **Department Responsibility Directory:** Operations Coordinator handles warehouse equipment; Finance Lead is the contact for payment-procedure documentation. It must not disclose who approves payments during the Finance Lead's absence.
- **Initially empty query/gap records:** use a clean primary demo dataset so the metric changes below are reproducible.
- **Initially empty NEXA Approved Knowledge store:** SQLite-owned articles are published only during recovery. Seed canonical questions and explicit supported aliases separately from AI display titles. Backend workflow states and metrics are deterministic; known workflow/output fixtures belong in the labeled fallback dataset.
- **One functioning synthetic-document source:** include the scanner procedure and directory; verify retrieval before presentation. Future sources remain explicitly not configured.
- **Presenter-held collected information, initially excluded from retrieval:** “When the Finance Lead is absent, the General Manager approves urgent supplier payments. The Finance Assistant prepares the invoice and urgency note and records approval before payment.” This is entered only during simulated recovery.
- **Separate labeled fallback snapshots:** pre-seeded workflow stages, screenshots, and a short recording. Never load the recovered procedure into the primary starting knowledge source.

# Exact Demo Flow

| Time | Action and narration |
| --- | --- |
| 0:00–0:30 | Dashboard: introduce the fictional company and fragmented knowledge problem. Show clean data; briefly identify the working source and unconfigured integrations. |
| 0:30–1:00 | AI Assistant: ask Question A. Show the grounded scanner procedure and its document reference. “NEXA uses company knowledge.” |
| 1:00–1:35 | Ask Question B. Show explicit insufficient knowledge and the persisted gap link. “The system identifies what the organization has not documented.” |
| 1:35–2:15 | Open Knowledge Operations; show Finance category, MEDIUM priority, Finance Lead as a suggested contact, and an AI evidence-aware REQUEST_INFORMATION recommendation. Explain that the directory identifies the contact but lacks the procedure. Review metadata through triage, then move to ACTION_PROPOSED. Human approves the simulated request, entering IN_PROGRESS. No real message is sent. |
| 2:15–2:50 | Add the presenter-held synthetic Finance response with its origin. Move to KNOWLEDGE_COLLECTED. Explain that this information was absent from initial retrieval. |
| 2:50–3:30 | Generate the draft procedure, inspect its three steps, and submit it to AWAITING_APPROVAL. Show that it remains unpublished. |
| 3:30–4:05 | Human approves the current fresh draft. A local SQLite transaction records approval and publishes an article id/revision to NEXA Approved Knowledge (PUBLISHED). No external indexing wait is needed. Explicitly close the gap (RESOLVED). |
| 4:05–4:35 | Ask Question B again. Show the grounded General Manager approval procedure and the newly published article reference. |
| 4:35–5:00 | Knowledge Health / Analytics: show one resolved gap, no open gaps, and three queries with two answered and one historically insufficient. Close with knowledge recovery and business value. |

# Expected Screen State

| Stage | Visible result |
| --- | --- |
| Start | Six module navigation; zero stored queries/gaps; rate indicators show “No data.” Sources distinguishes working and not-configured integrations. |
| After A | One answered query with the scanner source reference; no gap. |
| After B | Two queries: one answered, one insufficient. One DETECTED Finance gap, occurrences 1. The assistant does not guess an approver. |
| Recovery | Same persistent gap progresses through TRIAGED, ACTION_PROPOSED, IN_PROGRESS, and KNOWLEDGE_COLLECTED. Suggested contact is based on the directory, not proof of approval authority. Simulation is labeled; collected text and origin are visible. |
| Draft review | Saved draft revision 1 reflects evidenceRevision 1 and faithfully states the collected procedure. AWAITING_APPROVAL is visible; changes/rejection requires a newer draft before resubmission. |
| Publication | Successful publication precedes resolution. Failure must not display PUBLISHED or RESOLVED. |
| Final | Three queries: two answered, one insufficient; one RESOLVED gap, zero open gaps. Query answer rate is 2/3 (about 66.7%); gap resolution rate is 1/1 (100%). These describe this tiny synthetic dataset, not organization-wide coverage. |

The primary live script submits Question B once before recovery. Demonstrate duplicate prevention separately in rehearsal: an equivalent unanswered repeat must increase occurrences on the same gap. If added to the live script, update counts accordingly; do not show the three-query totals above.

# Failure-safe Plan

- Rehearse the exact questions and verify the grounded-answer and insufficiency paths, publication, and retrieval before presentation. Avoid unpredictable model behavior for every critical step by preparing the collected response and a saved fallback draft.
- Keep pre-seeded fallback states separate and clearly labeled “Prepared demo data.” These support workflow explanation without claiming a live AI result.
- Capture screenshots of each milestone and prepare a short recording of the complete functioning loop for AI/network failure. Announce when switching to a recording or prepared example.
- If a live service fails, show the honest error and move to the fallback. Do not manufacture a gap from an outage or claim unsaved publication succeeded.
- Reset the primary dataset before presenting and ensure the recovered payment procedure is not already retrievable.
- Reset local queries, gaps, articles, and metric state plus relevant Botpress conversation/knowledge state from earlier rehearsals. Verify Question B is still undocumented before starting; do not merely clear the UI history.
- Agree a fallback cutoff during rehearsal (target: 10 seconds without a usable AI result). Switch openly to prepared outputs/screenshots or the short recording instead of repeatedly retrying. Seed documents, expected questions/aliases, recovery text, and fallback workflow/metric state deterministically.
- Rehearse three genuine agentic moments: evidence-sufficiency assessment, an evidence-aware recovery recommendation, and drafting from new information. A backend REQUEST_INFORMATION fallback keeps recovery usable but must not be presented as an AI-generated recommendation. Short evidence-supported explanations are permitted; hidden chain-of-thought is not.

# What the Presenter Should Emphasize

Agentic AI assesses evidence, classifies a gap, suggests recovery, and helps produce a draft. Humans select actions and approve knowledge. NEXA turns a missing procedure into an answer future employees can reuse, with stored indicators showing the change. Botpress supplies initial orchestration; the product is NEXA's portal, knowledge workflow, controls, and organizational value. Production completeness and autonomous external execution are not required to prove that value.

LEARN means immediately reusable approved knowledge plus updated indicators, not model training. Approval shows explicit human interaction, not verified identity. Eligibility, matching, occurrences, persistence, transitions, draft freshness, publication, and metrics are deterministic backend behavior.

# Current Development Harness

The implemented fake-provider rehearsal uses the synthetic printer-retirement question documented in README.md; the Finance story above remains the planned presentation scenario. Save triage metadata, explicitly transition DETECTED → TRIAGED → ACTION_PROPOSED, approve/select the simulated action to enter IN_PROGRESS, add evidence, explicitly confirm KNOWLEDGE_COLLECTED, generate/save a draft, and explicitly submit AWAITING_APPROVAL. Human approval publishes; a separate closure resolves. Repeat the printer question before and after closure to verify approved article evidence, unchanged occurrences, and no new gap. No Botpress or external execution is required for this development rehearsal.
