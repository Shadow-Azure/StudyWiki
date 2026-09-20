# M2 AI agent host

English | [中文](m2-ai-agent-host.md)

```yaml flow
kind: milestone
id: m2
title: AI agent 宿主
status: planned
github:
  number: 3
  url: https://github.com/Shadow-Azure/StudyWiki/milestone/3
```

## Goal

Host capabilities for external plugins to plug in an AI agent, plus one basic agent plugin: multi-turn conversation, read/grep/write/edit tools, and the llm-wiki compiled knowledge layer (full compounding).

## Prerequisite decision

Model supply = a user-configured remote endpoint (including a self-hosted closed loop), settled and registered; see the [AI inference supply ADR](../../notes/proposed/architecture/2026-09-19-ai-inference-supply.en.md).

## Acceptance

- The agent plugin reaches system capabilities only through host services.
- Multi-turn conversation, read/grep/write/edit, and note persistence work.
- llm-wiki index/log/concepts are maintained automatically through ingest/query/lint.

## Issues

- [Model supply decision and inference service](../issues/m2-01-ai-inference-supply.en.md)
- [Agent host capabilities](../issues/m2-02-agent-host.en.md)
- [Basic agent plugin](../issues/m2-03-basic-agent.en.md)
- [llm-wiki knowledge layer](../issues/m2-04-llm-wiki.en.md)
