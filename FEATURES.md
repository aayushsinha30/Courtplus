# CourtPlus: what the app does (plain language, v2.1)

CourtPlus is a Windows app for a **jail office**, the **District Legal Services Authority (DLSA)** and **legal-aid lawyers**. You give it real court orders. Its **trained AI model** reads them and fills in the facts. A person checks the facts. Then the app shows who could apply for release under the law, why, and who must act, and writes the paperwork as a draft for a human to sign. It works **without internet**.

It does **not** decide bail or predict anything about anyone. The AI only reads documents and hides names. The legal answer comes from the words of the law, shown step by step.

**Demo data is real:** published Chhattisgarh court orders downloaded from official court websites, real law text, the government's official IPC-to-BNS table, and real NCRB/NALSA figures. No made-up data. We never use orders about sexual offences or children, and a second person checks that every name is hidden before anything is shown.

---

## A. Built first (what the judges will see)

**1. AI order reader (our trained model).**
Drop in a court order PDF. Our model highlights the **sections, laws, dates, case number and court**, and shows the sentence each came from. The model is InLegalBERT, retrained by us on thousands of labelled Indian judgments, and we show its measured accuracy. A person clicks **confirm** or corrects each fact. If the AI misses something, the person can select the text and fill it in by hand.

**2. AI name hider.**
The same model finds the names of people in the order and replaces them (for example "Accused-1") before anything is shown or saved. The Supreme Court's draft AI rules list hiding names in court records as an allowed use of AI.

**3. Old-law to new-law converter.**
Shows the new BNS section that matches an old IPC section, and its maximum punishment, from the government's official table.

**4. Rule checker with full working.**
Answers **Apply now**, **Due in N days**, **Needs a lawyer**, **Outside this check** (death or life sentence possible) or **Urgent: maximum reached**. It shows the dates, how days were counted, the sum and the exact words of the law. For old cases it uses only what was known on the order date.

**5. Action board.**
Columns: Apply now · Due in 30 days · Needs a lawyer · Bail granted but still in jail (7-day note to DLSA, 1-month reminder) · Court and jail records disagree (shown with the real Devilal Gond case). Each card has a person responsible, a due date and a status, plus tags for the official review category (NALSA's 16).

**6. All cases of one person.**
Lists every case against a person. More than one pending case means "send to a lawyer", as the law requires. A Supreme Court bail-category tag is shown for information.

**7. Draft paperwork.**
One click makes the jail superintendent's application under section 479(3), the 7-day note to the DLSA, and a short note saying AI helped read the order. Everything is marked DRAFT for a person to check and sign.

**8. Proof nobody changed anything.**
Each draft is digitally signed. A checker app on a second laptop says **valid**, or **changed** if even one letter was edited. Every action goes into a log that cannot be quietly rewritten.

**9. Works fully offline.**
Nothing leaves the computer unless a staff member exports it.

**10. Honest results.**
One slide gives the model's accuracy on test data and what we found in the real orders: how many we checked, how many had enough facts, how many needed a lawyer, and, for the cases that qualified, how long after the one-third mark bail actually came.

## B. Added later, only if A is finished on time

- "What if" date slider (from original Feature 6)
- Switch between lawyer view and review-committee view (Feature 3)
- Police-custody day tracker (Feature 17)
- QR code on drafts (part of Feature 14)
- "No court update for 180 days" column
- The Supreme Court's reporting spreadsheet
- A page of statistics
- A second small AI model that tells what each date means (arrest, remand, bail)
- Reading scanned (photographed) orders
- Hindi draft

## C. Never built, and why

| Original feature | Why not |
|---|---|
| **9. Predicting bail outcome** | **Must never be built.** The Supreme Court's draft AI rules would forbid AI scoring of bail eligibility, and it is unfair. |
| 8. Voice input and Hindi speech | Not needed; later phase. |
| 10. Auto-download from eCourts | eCourts has a CAPTCHA and no public data service; getting around it is not allowed. A person downloads the order instead. |
| 16. WhatsApp / SMS alerts | Needs telecom registration and internet; could reveal that someone is in jail. |
| 18. 12-language translation | Needs internet; legal translation mistakes are risky. |
| 19's Docker box and chatbot | Not needed: the app itself is offline. |
| Z3 maths solver | Adds nothing for date sums. |
| "Official letterhead" | Could look like a fake government document. Drafts only. |
| Made-up demo data | The demo uses real, published data only. |

## The 3-minute demo

1. Wi-Fi off. Drop a real Chhattisgarh bail order. The AI highlights the facts and hides the names. The officer confirms.
2. The app shows: "one-third reached on [date]; bail came on [date], N days later", with the law quoted.
3. Board of the real orders we checked, including a person with several cases held for a lawyer, and the Devilal Gond mismatch.
4. Signed draft; the second laptop says valid; an edited copy says changed.
5. Last slide: model accuracy, our real findings with exact counts, the safeguards, and a lawyer's comment.

