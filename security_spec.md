# Security Specification - GESTÃO SST

## 1. Data Invariants
1. An employee cannot exist without a valid associated `empresaId`.
2. A document cannot be marked as `aprovado` by a non-admin user; status change from `pendente` to `aprovado` or `reprovado` requires role `admin`.
3. If a document is `reprovado`, a `motivoReprovacao` is mandatory.
4. Non-admin users (role: `solicitante`) can only read and write documents, employees, and trainings corresponding to their own `empresaId`.
5. Auditor users (role: `auditor`) only have read access across records, no write or delete permissions.
6. User profiles cannot be self-elevated to `admin` by regular users.
7. Audit log entries are append-only and cannot be altered or deleted.
8. Medical exam documents and conclusion notes (`apto`/`inapto`) are restricted to authorized safety/medical roles and isolated from general access.
9. Timestamps must be validated and document IDs constrained to standard alphanumeric character sets.

## 2. The "Dirty Dozen" Threat Payloads
1. **Ghost Field Elevation**: Injecting `role: "admin"` during user self-registration.
2. **Cross-Company Access**: A contractor from Empresa A attempting to read/list employees of Empresa B.
3. **Approval Forgery**: A contractor directly submitting `situacao: "aprovado"` on their own uploaded document.
4. **Denial of Wallet**: Submitting a 50MB string payload in `nomeTreinamento` or `motivoReprovacao`.
5. **ID Poisoning**: Submitting invalid characters or path traversals in `companyId` (e.g. `../admin`).
6. **Orphan Employee Write**: Creating an employee record pointing to a non-existent `empresaId`.
7. **Audit Log Tampering**: Overwriting or deleting an existing audit log entry to cover unauthorized actions.
8. **Unjustified Rejection**: Rejecting a document without providing a `motivoReprovacao`.
9. **Auditor Write Attempt**: Auditor account attempting to insert an inspection or delete a document.
10. **Shadow Key Injection**: Sending unexpected secret fields such as `__proto__` or `isSuperUser: true`.
11. **Direct Terminal State Reversion**: Changing an already approved legal document without version incrementation.
12. **Unauthenticated Query Scrape**: An unauthenticated user querying `/employees` or `/documents`.
