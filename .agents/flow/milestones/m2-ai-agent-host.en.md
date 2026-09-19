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

Host capabilities for external plugins to plug in an AI agent, plus a basic agent plugin: conversation, context sourcing, and note persistence.

## Prerequisite decision

How model inference is supplied (local model / external API) is in tension with the environment-independence hard constraint; it must be decided and registered in [environment-independence.md](../../../docs/environment-independence.en.md) before this milestone starts.

## Acceptance

- The agent plugin reaches system capabilities only through host services (layering discipline holds).
- Basic conversation and note persistence work.

## Issues

To be decomposed — issues are filed through discussion rounds before this milestone starts.
