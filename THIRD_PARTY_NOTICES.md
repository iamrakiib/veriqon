# Third-party notices

Veriqon's original source and synthetic research fixtures are offered under the MIT license in `LICENSE`. Installed dependencies retain their own licenses; `package-lock.json` records the resolved packages.

The bundled Geist and Geist Mono fonts are Copyright 2024 The Geist Project Authors, distributed under the SIL Open Font License 1.1. The complete notice is preserved in `apps/web/public/fonts/OFL.txt`.

The correction method is inspired by Changmao Li and Jeffrey Flanigan's *RAC: Efficient LLM Factuality Correction with Retrieval Augmentation* (Findings of EMNLP 2025): https://aclanthology.org/2025.findings-emnlp.1370/. The official Python implementation is Apache-2.0 licensed: https://github.com/jlab-nlp/Retrieval-Augmented-Correction. This repository implements its own TypeScript orchestration and safeguards; it does not bundle the RAC code, weights, or evaluation datasets, and does not claim to reproduce RAC's reported results.

The included policy PDF/DOCX files and research examples are synthetic test documents. They are not corporate policies, real experimental results, or documents uploaded by users.
