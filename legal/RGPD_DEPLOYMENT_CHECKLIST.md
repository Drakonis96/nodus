# RGPD deployment checklist for Nodus

This checklist is for the person or organisation that determines why and how
personal data is entered into Nodus. It is not a certification and does not replace
the controller's data-protection officer or legal advice.

## Before processing personal data

- Identify the controller, representative and DPO/contact channel.
- Record each purpose, category of data and data subject, lawful basis, recipient,
  international transfer, retention period and security measure.
- Provide the complete Articles 13/14 notice to affected people. The short notices in
  Nodus are just-in-time reminders, not the controller's complete notice.
- Apply data minimisation: do not store a name, recording, special-category datum or
  full document when a code, excerpt or aggregate is sufficient.
- Configure a retention schedule covering live data, trash, exports, recordings,
  caches, synced packages and backups.
- Decide who may access each device and vault; enable full-disk encryption, strong
  operating-system authentication, updates and encrypted backups.
- Define and test restore, incident response, breach assessment and notification.

## External providers

- Prefer local models for personal, confidential, student or special-category data.
- For every remote provider, document its role, region, retention, training policy,
  sub-processors and security terms.
- Conclude an Article 28 data-processing agreement where the provider is a processor.
- Establish and document a Chapter V transfer mechanism where data leaves the EEA.
- Do not rely on a click in Nodus as the data subject's legal consent.

## Education and recordings

- Obtain institutional approval and involve the DPO before processing a student
  roster, grades, recordings or minors' data.
- Inform every affected person before recording. Document the purpose and legal basis;
  obtain consent only where consent is the appropriate basis.
- Restrict recordings and grades to authorised staff, the student and, where legally
  appropriate, their parents or guardians.
- Never use Nodus or a connected model to grade, profile, rank, admit, promote,
  monitor or otherwise evaluate a student. Nodus deliberately exposes no AI endpoint
  for those purposes.

## DPIA decision

Document whether Article 35 GDPR requires a data-protection impact assessment. A
DPIA is particularly important when the context includes minors, systematic
monitoring, large-scale or special-category data, novel technology or several high
risk factors. If residual high risk remains, consult the supervisory authority before
processing.

## Release audit

- Run `npm run privacy:verify` and `npm run licenses:verify`.
- Confirm `PRIVACY.md`, `THIRD_PARTY_NOTICES.md`, the Nodus MIT licence and all
  generated third-party notices are present in the installer.
- Review this checklist whenever processing, providers, defaults or applicable law
  changes.
