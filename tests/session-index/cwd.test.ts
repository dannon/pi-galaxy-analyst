import { describe, it, expect } from "vitest";
import { encodeCwd, decodeCwd } from "../../extensions/loom/session-index/cwd";

describe("cwd codec", () => {
  it("encodes absolute paths Pi-style", () => {
    expect(encodeCwd("/Users/dannon/work/loom")).toBe("--Users-dannon-work-loom--");
    expect(encodeCwd("/tmp")).toBe("--tmp--");
    expect(encodeCwd("/")).toBe("----");
  });

  it("decodes Pi-style back to absolute", () => {
    expect(decodeCwd("--Users-dannon-work-loom--")).toBe("/Users/dannon/work/loom");
    expect(decodeCwd("--tmp--")).toBe("/tmp");
  });

  it("round-trips", () => {
    const paths = ["/a", "/a/b", "/Users/x/y", "/var/folders/cp/loomtest"];
    for (const p of paths) {
      expect(decodeCwd(encodeCwd(p))).toBe(p);
    }
  });

  it("round-trips the root path", () => {
    expect(encodeCwd("/")).toBe("----");
    expect(decodeCwd("----")).toBe("/");
  });

  it("returns null for non-encoded strings", () => {
    expect(decodeCwd("not-an-encoded-cwd")).toBeNull();
    expect(decodeCwd("")).toBeNull();
  });
});
