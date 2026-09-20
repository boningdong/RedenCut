# Apache-2.0 project license transition

The sole contributor confirmed that project code was authored by them with AI assistance, and authorized changing the project license before final installer work.
This records the contributor's representation, not an independent certification of provenance.
The root LICENSE now contains the official Apache-2.0 text from https://www.apache.org/licenses/LICENSE-2.0.txt.
Root npm metadata, README, active runtime documentation and staged project-license wording are synchronized.
Third-party code, native libraries and model weights retain their original licenses; historical reports and releases are not rewritten.
Python license-inventory completion, model redistribution packaging and final signed-installer compliance verification remain pending.
This change does not create a public model download endpoint or remove HF authentication from the existing model acquisition flow.
UI acceptance is excluded because this change only updates licensing metadata, documentation and staged explanatory text.

Verification: npm run format and npm run check passed (171 test files, 1311 tests, lint, dead-code analysis, type checking and production build).
The root license was compared byte-for-byte with the downloaded official text, and both npm root license fields were checked as Apache-2.0.
