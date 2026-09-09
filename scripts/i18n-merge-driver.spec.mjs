// 门禁自测试：.i18n.yaml 合成决策——只合成无歧义的确认记录，两侧各自重录
// 则交还 git 冲突态（fail-closed）。纯函数直接测，CLI 只是文件 IO 包装。

import { describe, expect, it } from "vitest";
import { decideMerge } from "./i18n-merge-driver.mjs";

const A = "foo.md: aaaa\nfoo.en.md: bbbb\n";
const B = "foo.md: cccc\nfoo.en.md: dddd\n";

describe("decideMerge", () => {
  it("两侧相同 → 无歧义，取任一侧", () => {
    expect(decideMerge(A, B, B)).toEqual({ conflict: false, result: B });
  });
  it("本侧未动 → 取对侧的新确认", () => {
    expect(decideMerge(A, A, B)).toEqual({ conflict: false, result: B });
  });
  it("对侧未动 → 取本侧的新确认", () => {
    expect(decideMerge(A, B, A)).toEqual({ conflict: false, result: B });
  });
  it("两侧各自重录 → 冲突（机器无法裁决哪次确认更可信）", () => {
    expect(decideMerge(A, B, "foo.md: eeee\nfoo.en.md: ffff\n")).toEqual({ conflict: true });
  });
});
