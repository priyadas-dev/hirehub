import { describe, expect, it } from "vitest";
import { APP_CONTENT_SHELL } from "@/lib/shell-layout";

describe("APP_CONTENT_SHELL", () => {
  it("keeps header and main on the same max-width and horizontal padding", () => {
    expect(APP_CONTENT_SHELL).toContain("max-w-6xl");
    expect(APP_CONTENT_SHELL).toContain("px-4");
    expect(APP_CONTENT_SHELL).toContain("sm:px-6");
    expect(APP_CONTENT_SHELL).toContain("lg:px-10");
  });
});
