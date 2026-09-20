# Agent Note: AI inference supply — configurable remote endpoint + self-hosted closed loop

Status: proposed

English | [中文](2026-09-19-ai-inference-supply.md)

## Problem

Environment independence is a hard constraint: the shipped client is fully offline and environment-free at runtime. But the AI agent from m2 and the ASR and visual summarization from m3 all need model inference, which directly conflicts. The supply model must be settled and the exemption registered now, or m2/m3/m4 cannot start.

## Decision

- The primary supply is a user-configured remote endpoint: `base URL + model + key`, speaking an OpenAI-compatible protocol; self-hosting is supported (vLLM / Ollama / LM Studio for LLM/VLM, faster-whisper-server for ASR), so intranets can close the loop and keep data inside. This is the only network point; an environment-independence exemption is registered for it.
- LLM and VLM share the same OpenAI-compatible `chat/completions` (multimodal); ASR uses the OpenAI-compatible `/v1/audio/transcriptions` and is exposed as an agent tool, not a separate pipeline.
- A local small ASR model is an optional helper: it downloads and quickly starts a local service with environment detection, P2, and is excluded from the offline guarantee; its runtime form (WASM vs a host-native runtime) is decided separately later.
- The product ships no API key; endpoint configuration lives only on the user side.

## Alternatives considered

- Download models at plugin-install time and run offline: closest to "fully offline at runtime", but the LLM/VLM/ASR weights are large, quality is limited, and the engineering is heavy; the local runtime also conflicts with the "single-file zero-dependency JS" plugin contract. Rejected, keeping only the local ASR as an optional helper.
- A hard-coded external API vendor: violates environment independence and cannot close the loop on an intranet; rejected.
- Bundling small models entirely locally: the size/quality tradeoff is unacceptable; rejected.

## Consequences

- [environment-independence.md](../../../../docs/environment-independence.en.md) gains an exemption: AI inference via a user-configured remote endpoint.
- The endpoint configuration contract (LLM/VLM/ASR, base URL/model/key, probing and error semantics) lands in m2-02; the ASR tool lands in m3-01.
- Intranet closed loop depends on a user-run endpoint; the client's own offline ability does not regress into "must be online".
