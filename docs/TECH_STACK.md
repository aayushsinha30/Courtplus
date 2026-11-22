# CourtPlus tech stack (v6)

| Layer | Choice | Why |
|---|---|---|
| Monorepo | npm workspaces: `packages/*`, `apps/*`; TypeScript 5 strict everywhere | One toolchain; each package owns its own folder |
| Desktop shell | Electron (pinned current stable) + electron-builder **portable .exe** | Offline, bundled Chromium (Hindi/Indic shaping, PDF), no admin rights |
| UI | React 18 + Vite + TypeScript + Tailwind CSS; Recharts (statistics page); react-router | Fast to build, works in Electron and in the appliance web mode |
| Database | SQLite via `better-sqlite3-multiple-ciphers` (SQLCipher-compatible, AES-256 at rest) | Encryption at rest for F19; synchronous, reliable in Electron |
| Rules engine | `packages/engine`: pure TypeScript, no I/O; Vitest golden tests | Deterministic, testable, shows its working |
| IPC-BNS crosswalk | `data/crosswalk/*.csv` transcribed from the official BPR&D correspondence table, with page refs | Real, citable |
| Reading orders | `pdfjs-dist` (text layer); `tesseract.js` with bundled `eng` + `hin` traineddata for scanned/photographed orders | Fully offline |
| AI model (trained) | Fine-tuned **InLegalBERT** (MIT) on **InLegalNER** (MIT), PyTorch + Hugging Face `transformers` on the RTX 4050 (CUDA); eval with `seqeval`; exported to ONNX | Real fine-tuned model with a measured F1 |
| AI runtime | `@huggingface/transformers` (transformers.js) token-classification pipeline on `onnxruntime-node`; fallback `onnxruntime-web` (WASM) | No Python at runtime; offline |
| Anonymiser | Same NER model + rule pass (masks PETITIONER, RESPONDENT, WITNESS, OTHER_PERSON, LAWYER; CNR/FIR numbers by regex) + human release gate | Draft r.19(1)(i) permitted use |
| Translation (F18) | **IndicTrans2** en-indic distilled 200M (AI4Bharat, MIT), run **at build time** in Python to pre-translate the rights-card and draft templates into 12 languages; shipped as JSON; marked "machine translation, English/Hindi authoritative"; reviewed strings flagged | Offline (Bhashini needs internet and a key) |
| Fonts | Noto Sans Devanagari, Bengali, Gurmukhi, Gujarati, Oriya, Tamil, Telugu, Kannada, Malayalam; Noto Naskh Arabic (Urdu) - all SIL OFL | Correct Indic rendering in UI and PDF |
| Drafts / PDF | HTML templates (EN + HI) printed with Electron `webContents.printToPDF` | Proper Devanagari shaping |
| SC reporting spreadsheet | `exceljs` (.xlsx) + CSV | Matches SC order 19 Nov 2024 column list (labelled provisional) |
| QR | `qrcode` (generate); `jsqr` (read in verifier) | Receipt ID + key ID only, no personal data |
| Signing / audit | Node `crypto` Ed25519; `canonicalize` (RFC 8785 JSON); SHA-256 hash-chained audit log; key wrapped by Electron `safeStorage` (Windows DPAPI) + passphrase | Tamper evidence |
| Verifier | Separate small window/app mode (same build, `--verifier`) | Runs on laptop 2 |
| F19 appliance | `apps/appliance`: Fastify (Node 22) serving the same React UI + engine over the prison LAN; Dockerfile + docker-compose on an `internal: true` network (no outbound internet); SQLCipher volume; role-based access (superintendent, DLSA, lawyer, UTRC member) with audit log | DPDP-minded on-premise option |
| Testing | Vitest (unit, golden legal fixtures); Playwright for one end-to-end smoke in Electron | |
| ML tooling | Python 3.13, `torch` (CUDA 12.x wheel), `transformers`, `datasets`, `accelerate`, `seqeval`, `optimum[onnxruntime]`; for F18 `IndicTransToolkit` / `ctranslate2` | Training only; not shipped |

**Not used:** Z3, Docker-hosted LLM, LayoutLMv3/PaddleOCR, any cloud API at runtime, any outcome-prediction model.
