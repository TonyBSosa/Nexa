# NEXA Project Brief

## Product Purpose and Problem

NEXA is the working name of an AI-powered B2B SaaS concept for Organizational Knowledge Intelligence and organizational knowledge lifecycle management. This brief is the product-level source of truth; repository contribution rules remain in the root `AGENTS.md`.

Organizational knowledge is distributed across documents, procedures, employees, departments, SaaS platforms, and internal systems. Information may be difficult to find, duplicated across locations, outdated, held only by individuals, or never formally documented.

NEXA converts employee questions into organizational knowledge intelligence: it answers when sufficient knowledge exists and explicitly detects knowledge gaps when it does not. Its value extends beyond chatbot conversations, document Q&A, and retrieval to continuously improving the organization's reusable knowledge.

## Target Market and Users

Initial positioning focuses on small and medium-sized organizations in Honduras and Latin America with growing operational knowledge and limited knowledge-management infrastructure. The concept should remain applicable to larger organizations and domains beyond IT support, including operations, finance, administration, inventory, internal policies, equipment and maintenance, and procedures.

The MVP may demonstrate a fictional company inspired by realistic businesses. All demonstration data must be synthetic or non-confidential.

- **Employee:** asks the assistant for organizational information.
- **Administrator / Knowledge Manager:** reviews analytics, knowledge health, gaps, proposed recovery actions, drafts, and approvals.

These are conceptual product flows and interface distinctions. Authentication and role management are not implemented in the MVP.

## Core Knowledge Lifecycle

**ASK → DETECT → RECOVER → VALIDATE → PUBLISH → LEARN**

1. **Ask:** an employee submits a company-specific question; NEXA searches available organizational knowledge.
2. **Detect:** if evidence is insufficient, acknowledge the limitation, record a Knowledge Gap, and classify it by relevant domain or department.
3. **Recover:** identify likely responsible roles or subject-matter experts and propose information requests, email drafts, meetings, existing-document requests, or documentation tasks. A human chooses or approves the action, and information is collected.
4. **Validate:** AI converts collected information into a draft article or procedure for human review and approval.
5. **Publish:** approved knowledge enters the organization's knowledge base, and the gap can become resolved.
6. **Learn:** future questions can use the newly captured knowledge; usage and gap information help reveal further improvement needs.

For example, an undocumented company payment procedure becomes a Finance gap, progresses through approved recovery and review, and becomes a validated procedure that answers future employee questions.

## Agentic AI and Human Control

Agentic AI is the selected emerging technology. The agent should interpret intent, select relevant knowledge or tools, assess evidence sufficiency, classify gaps, identify potentially responsible experts or departments, recommend next actions, and transform collected information into draft knowledge.

The agent must never invent internal company knowledge when sources are insufficient. Missing information must be surfaced explicitly as a knowledge gap.

Consequential actions require explicit human approval. In the MVP, AI may recommend or prepare external actions, but must not autonomously send real emails, schedule real meetings, publish knowledge, or modify critical external systems. Documentation remains a draft until human validation and approval.

## MVP Modules

| Module | Purpose |
| --- | --- |
| Dashboard | High-level organizational knowledge health and usage. |
| AI Assistant | Conversational access to organizational knowledge. |
| Sources | Connected and potential knowledge sources. At least one source must work; other integrations must be clearly marked available/not configured and never represented as functional. |
| Analytics | Knowledge queries and usage, potentially including total, resolved, and unresolved queries, categories, most-used sources, and recent activity. |
| Knowledge Health | Knowledge coverage and areas with insufficient documentation. |
| Knowledge Operations | Persistent knowledge gaps and their recovery lifecycle. |

The intended Knowledge Operations statuses are:

`DETECTED → TRIAGED → ACTION_PROPOSED → IN_PROGRESS → KNOWLEDGE_COLLECTED → AWAITING_APPROVAL → PUBLISHED → RESOLVED`

## Demonstration and Success Criteria

The MVP must demonstrate a functional, visually convincing end-to-end workflow within a custom NEXA portal:

1. Show the dashboard and ask a documented company-specific question through a working AI assistant.
2. Return an answer grounded in synthetic organizational knowledge from a working source.
3. Ask an intentionally undocumented question; acknowledge insufficient knowledge and persist a Knowledge Gap alongside query data.
4. Show the gap in Knowledge Operations or Knowledge Health, with suggested responsible roles or experts and recovery actions.
5. Let an administrator simulate recovery progress and convert collected information into a draft article.
6. Require human approval before publication, then progress the gap to resolution so validated knowledge can be reused in future answers.
7. Show useful analytics and Knowledge Health indicators based on the workflow.

External actions may be simulated; the gap workflow itself must function. Success means demonstrating a clear path from missing knowledge to newly validated, reusable knowledge, with persistent query and gap data and human control over publication.

## Differentiation and Long-Term Value

The central differentiator is a continuous knowledge-improvement cycle driven by employee questions. NEXA should help organizations understand what employees ask, what knowledge exists, which sources are useful, which questions remain unanswered, which departments have recurring gaps, which procedures need documentation, how quickly gaps are resolved, and whether coverage improves.

The long-term concept is a knowledge base that improves through use. These questions guide product value without defining additional MVP metrics or capabilities.

## Business Model

NEXA is conceived as B2B SaaS. Possible future tiers include Starter, Business, and Enterprise. Potential revenue sources include subscriptions, implementation/setup, custom integrations, support, and enterprise/private deployment. Pricing is not defined. Billing, subscriptions, and real multi-tenancy are outside the MVP.

## Technical Direction and Boundaries

The planned stack is React + TypeScript + Vite with Tailwind CSS + shadcn/ui, a Node.js + Express + TypeScript backend, SQLite MVP persistence, and HTTP/REST communication. Botpress Cloud is the initial agent/AI orchestration provider. Collaboration uses GitHub and Kanban.

Botpress is an implementation choice. Agent providers and knowledge sources must remain replaceable integrations. The frontend must not depend directly on Botpress; the backend owns business logic, analytics, persistence, knowledge-gap workflows, and integration boundaries. Detailed architecture and API contracts belong in their respective documents.

## Explicit MVP Exclusions

Unless a future requirement explicitly changes scope, exclude:

- Authentication and role management, including production authentication, enterprise SSO, and advanced RBAC.
- Real multi-tenancy, billing, subscriptions, and mobile applications.
- Kubernetes, microservices, and production infrastructure complexity.
- Real ERP integration and full Microsoft 365 automation.
- Real autonomous email sending and meeting scheduling.
- Custom model training and fine-tuning.
- Confidential company information.

Use environment variables for secrets; never hardcode or commit them. The planned stack does not authorize scaffolding, dependency installation, or implementation without a subsequent task.
