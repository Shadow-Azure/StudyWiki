# Agent Note: Dual-protocol ASR supply: transcriptions endpoint and chat audio unified

Status: proposed

English | [中文](2026-10-19-asr-dual-protocol.md)

## Problem

m3-01 delivers ASR transcription, but OpenAI-compatible ASR comes in two wire shapes: the transcription endpoint `/v1/audio/transcriptions` (multipart + verbose_json with contract timestamps, the Speaches/whisper.cpp family) and the chat endpoint `chat/completions` + `input_audio` (Xiaomi MiMo ASR and peers, without contract timestamps). Two requirements hold at once: with no ASR configured the agent must not change behavior; chat models (such as deepseek-v4-flash) must not be misused for transcription.

## Decision

- ASR models get their own partition: they are configured only on `kind: asr` endpoints, with a new optional `protocol` field (`transcriptions` by default / `chat`). Chat routing accepts only kind=chat and transcription routing only kind=asr, a structural separation.
- Both protocols return the same `TranscriptionResult { text, segments[] }`. The chat route has no contract timestamps, so the TS tool layer parses them with a deterministic rule (at least 3 matching lines and at least 80% coverage); on failure it degrades to a single segment plus `timestamps: none`.
- The `transcribe` tool is mounted per turn: with no asr endpoint it never enters the declaration list, so agent behavior does not change.
- Uploading is its own approval family `transcribe`; one approval covers both the upload and writing the output.
- The client does no decoding, chunking, or transcoding (ffmpeg conflicts with environment independence); video containers are uploaded as-is and rely on server-side decoding.

## Alternatives considered

- Reuse a chat endpoint's audio-capable model for ASR: blurs the chat role and pollutes model lists; rejected.
- Support only the transcriptions endpoint: chat-route models such as MiMo ASR would be unusable; rejected.
- Mount the tool even without ASR and return guidance: the model would burn a turn just to say "please configure"; the settings panel and docs carry that guidance instead; rejected.
- Client-side ffmpeg chunking: violates the environment-independence hard constraint; rejected, oversize input fails loudly this cycle.

## Consequences

- settings.json stays compatible: protocol is optional and the version number does not change.
- The chat route's input_audio follows the MiMo documented shape (data as a data URL plus a format field), unlike the repo's chat attachment raw-base64 shape — the attachment path is unchanged.
- The m3-03 raw index and m3-04 local ASR assistance are not constrained by this cycle.
