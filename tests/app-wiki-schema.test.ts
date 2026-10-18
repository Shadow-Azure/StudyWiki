import { describe, expect, it } from "vitest";
import { WIKI_SCHEMA, WIKI_SCHEMA_VERSION } from "../src/plugins/app-wiki/schema";

describe("wiki schema", () => {
  it("版本与体积预算", () => {
    expect(WIKI_SCHEMA_VERSION).toBe(1);
    expect(WIKI_SCHEMA.length).toBeLessThanOrEqual(6000);
  });

  it("覆盖三流程与关键纪律", () => {
    for (const kw of ["ingest", "query", "lint", "frontmatter", "主题对照", "[[wikilink]]", "log.md", "index.md", "不要手改", "视频源"]) {
      expect(WIKI_SCHEMA).toContain(kw);
    }
  });
});
