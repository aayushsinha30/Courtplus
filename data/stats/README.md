# Statistics data

`chhattisgarh.json` and `india.json` hold `{ "figures": [...] }`. Each figure has
`id, label, value, unit, date, geography, source, url, note, verified`.

## Verification status

Figures were compiled from the official documents listed under Sources.
`verified: true` means two independent sources agree and the official document was checked.
It was **not** re-fetched from the official URL when this file was prepared (no network access in that session),
so re-open the URL before quoting a figure on stage. `verified: false` means a single source only, or a secondary source.

## Sources

| Source | Used for | URL |
| --- | --- | --- |
| NCRB, Prison Statistics India 2024 (revised 15 Sep 2026) | Inmates, capacity, occupancy, undertrials, detention bands (31 Dec 2024) | https://www.ncrb.mha.gov.in/uploads/files/PSI-2024Ason15092026.pdf |
| NCRB Table 7.4 | CG s.479 (19/4/15) and s.479 with 436A (57/4/53), 2024 | https://www.ncrb.mha.gov.in/uploads/files/Table741.pdf |
| NALSA UTRC quarterly report, Oct-Dec 2025 | CG funnel 400/195/183 of 21,412; India funnel | https://cdnbbsr.s3waas.gov.in/s32e45f93088c7db59767efef516b306aa/uploads/2026/02/20260211666479586.pdf (CG); the India rows cite `.../20260209543755368.pdf`, a different file name that should be reconciled |
| MHA reply, Rajya Sabha answer 3597, 2 Apr 2025 (via PIB 2117796) | Constitution Day campaign: India 951/334, CG 2/0 | https://mha.gov.in/MHA1/Par2017/pdfs/par2025-pdfs/RS02042025/3597.pdf |
| The Hitavada, 8 May 2026 (**secondary**, reports RTI responses) | Raipur Central Jail, 31 Mar 2026 | https://www.thehitavada.com/Encyc/2026/5/8/rti-exposes-144-overcrowding-crisis-in-chhattisgarh-jails.html |

## Cautions

- NCRB Table 7.4: the s.479-only and the s.479 + 436A rows have different scopes; do not mix them.
- The Constitution Day counts are a campaign through 26 Nov 2024, not NCRB calendar 2024. They record bail grants, not physical releases.
- UTRC counts use broad review categories; they do not measure s.479 eligibility or missed cases.
