# Related Work Comparison

Comparison of MedVault-X against representative prior blockchain-EHR
systems, for the paper's related-work section.

| System | Framework | Consent model | Off-chain storage | AI / anomaly detection | Performance eval reported |
|---|---|---|---|---|---|
| **MedRec** (Azaria et al., 2016) | Ethereum, proof-of-work | Basic permission grants; patient data stays at provider databases, chain stores pointers/permissions only | None (relies on existing provider databases) | None | Limited — later analysis found PoW block-size/interval tuning insufficient for high-load use, calling for a more fundamental redesign |
| **Healthchain** (PLOS ONE, 2020) | Hyperledger Fabric + Hyperledger Composer | Patient-centric permission management among stakeholders | IPFS | None | Architecture-focused; no dedicated throughput/latency benchmark |
| **PREHEALTH** | Hyperledger Fabric + Identity Mixer (Idemix) | Anonymous/unlinkable record access via Idemix credentials, rather than an explicit relationship precondition | Not IPFS-based; anonymity handled via the credential layer | None | Reports efficiency/feasibility results for real-world-scale deployment |
| **ACHealthChain** (Scientific Reports, 2025) | Hyperledger Fabric, multi-chaincode | PolicyChain: fine-grained access control + revocation | IPFS | None | Yes — throughput, latency, and resource-utilization experiments |
| **IoT-Hyperledger EHR** (Wiley, 2024) | Hyperledger Fabric + IoT integration | Administrator-granted read/edit/delete/revoke after identity verification (not a patient-declared relationship precondition) | Not detailed | None | Not detailed in available material |
| **MedVault-X (this work)** | Hyperledger Fabric, 5 orgs (Hospital/Pharmacy/Lab/Governance/Research) | **Active treatment relationship as a cryptographic access precondition**, enforced via Private Data Collections, not just a policy check | IPFS/Helia, AES-256-GCM encrypted, custom KMS | **5-model PyOD ensemble (P1 detector, validation-calibrated percentile threshold)** with z-score feature attributions, governed as its own Fabric identity; classifies flags (point / emergency_abuse), actor clarification loop, Governance escalation | Partial — detection precision/recall/F1, storage overhead (on-chain PDC vs off-chain IPFS); full Caliper throughput/latency in progress |

## What differentiates MedVault-X

- **Consent as a cryptographic precondition, not a policy layer.** Most
  prior systems (MedRec, IoT-Hyperledger) grant access via administrator
  or basic permission checks; MedVault-X requires an active
  `TreatmentRelationship` record to exist before PDC access is even
  possible.
- **AI detection as a governed on-chain identity.** None of the compared
  systems integrate an anomaly-detection model that itself operates as an
  audited Fabric identity with a closed enforcement loop (flag → audit →
  Governance review → ban/escalation). This is the most novel single
  contribution relative to prior work.
- **Tiered emergency access with AI-assisted post-hoc review.** Compared
  systems don't describe an emergency "glass-break" mechanism cross-checked
  by an anomaly model against the declared reason.

## What MedVault-X still lacks relative to best-in-class prior work

- **ACHealthChain and PREHEALTH both report real throughput/latency/scale
  experiments** — MedVault-X's performance evaluation is currently
  detection-quality and storage-overhead only; a Caliper-based
  throughput/latency benchmark is the most direct way to close this gap.
- **No formal security proof** of the consent-precondition claim (none of
  the compared systems have one either, but it remains a stated
  limitation, not a differentiator).

## Sources

- Azaria, A., Ekblaw, A., Vieira, T., Lippman, A. "MedRec: Using Blockchain
  for Medical Data Access and Permission Management." OBD 2016.
  https://www.media.mit.edu/publications/medrec-whitepaper/
- "Healthchain: A novel framework on privacy preservation of electronic
  health records using blockchain technology." PLOS ONE, 2020.
  https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0243043
- "A Privacy-Preserving Healthcare Framework Using Hyperledger Fabric"
  (PREHEALTH). https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7698751/
- "ACHealthChain blockchain framework for access control and privacy
  preservation in healthcare." Scientific Reports, 2025.
  https://www.nature.com/articles/s41598-025-00757-1
- "An Efficient Secure Sharing of Electronic Health Records Using
  IoT-Based Hyperledger Blockchain." International Journal of Intelligent
  Systems, 2024. https://onlinelibrary.wiley.com/doi/10.1155/2024/6995202
