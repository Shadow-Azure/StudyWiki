# Basic agent plugin

English | [中文](m2-03-basic-agent.md)

```yaml flow
kind: issue
milestone: m2
priority: P0
status: backlog
scope:
  - src/plugins/**
  - src/host/**
  - docs/plugins/*
  - docs/architecture.*
adr: []
github:
  number: 30
  url: https://github.com/Shadow-Azure/StudyWiki/issues/30
```

## Background

A first agent plugin with basic capabilities is needed (the pi/dsh intersection): multi-turn context + read/grep/write/edit + note persistence.

## Goals

- A multi-turn session state machine that keeps history.
- Four tools (read/grep/write/edit) plus note writing into the wiki.

## Acceptance

- Multi-turn conversation with the agent works; read/grep can search the library and wiki, and write/edit can persist notes.
