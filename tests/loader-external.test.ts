import { afterEach, expect, test, vi } from "vitest";
import { loadExternalModule } from "../src/loader/external";

afterEach(() => vi.restoreAllMocks());

test("blob 通道：createObjectURL → import → revoke，命名空间原样返回", async () => {
  const code = "export const name = 'ext-demo'; export const apply = () => {};";
  const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake-url");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const importFn = vi.fn(async (url: string) => {
    expect(url).toBe("blob:fake-url");
    return { name: "ext-demo", apply: () => {} };
  });
  const mod = await loadExternalModule(code, importFn);
  expect(mod.name).toBe("ext-demo");
  // Blob 内容逐字传递、类型是 JS 模块
  const blob = create.mock.calls[0][0] as Blob;
  expect(blob.type).toBe("text/javascript");
  await expect(blob.text()).resolves.toBe(code);
  expect(importFn).toHaveBeenCalledWith("blob:fake-url");
  expect(revoke).toHaveBeenCalledWith("blob:fake-url");
});

test("装载失败也回收 blob URL（finally 兜底）", async () => {
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:boom");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const importFn = vi.fn(async () => {
    throw new SyntaxError("bad module");
  });
  await expect(loadExternalModule("export broken", importFn)).rejects.toThrow("bad module");
  expect(revoke).toHaveBeenCalledWith("blob:boom");
});
