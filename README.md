# CourtPlus

CourtPlus helps jail offices, District Legal Services Authorities (DLSAs) and legal-aid lawyers in Chhattisgarh find undertrial prisoners who can apply for release under section 479 of the Bharatiya Nagarik Suraksha Sanhita (BNSS). It reads court orders, lets a person confirm every extracted fact, shows the legal working step by step with the exact words of the law, and prepares signed drafts for a human to review and file. It runs fully offline on a Windows desktop.

## Features

- **Order reader.** A fine-tuned legal named-entity model (InLegalBERT trained on InLegalNER) highlights sections, acts, dates, case number and court in a court order and shows the sentence each fact came from. A person confirms or corrects each fact.
- **Name masking.** The same model finds the names of people and replaces them (for example "Accused-1") before anything is shown or saved.
- **Old-law to new-law converter.** Maps an IPC section to the matching BNS section and its maximum punishment, from the official crosswalk table.
- **Rule checker with full working.** Returns Apply now, Due in N days, Needs a lawyer, Outside this check, or Urgent: maximum reached, with dates, day counts and the quoted provision.
- **Action board.** Cards grouped by what needs doing, each with a responsible person, due date and status.
- **All cases of one person.** Lists every case against an individual; more than one pending case is routed to a lawyer.
- **Draft paperwork.** Superintendent's application under s.479(3), DLSA notes and related drafts, all marked DRAFT for a person to check and sign.
- **Tamper evidence.** Drafts are digitally signed, a separate verifier reports valid or changed, and every action goes into a hash-chained audit log.
- **Offline by design.** Nothing leaves the computer unless a staff member exports it.

See [FEATURES.md](FEATURES.md) for the full description.

## Tech stack

TypeScript monorepo (npm workspaces) with an Electron desktop shell, SQLite with encryption at rest, a pure TypeScript rules engine with golden tests, and an ONNX-exported NER model run locally. Details are in [docs/TECH_STACK.md](docs/TECH_STACK.md); shared types are described in [docs/CONTRACTS.md](docs/CONTRACTS.md) and the legal rules in [docs/LEGAL_RULES.md](docs/LEGAL_RULES.md).

## Getting started

Requires Node.js 22 or newer.

```bash
npm install
npm run build
npm test
```

Run the desktop app in development:

```bash
npm run dev -w @courtplus/desktop
```

## Safeguards

- No outcome prediction. CourtPlus never scores or predicts bail; the model only reads documents and masks names.
- A human confirms every AI-suggested fact before it is used.
- Names are masked before display or storage, and masking is checked by a second person.
- Real court orders are never committed to this repository.

## Project status

Hackathon build. Interfaces and data formats may change.
