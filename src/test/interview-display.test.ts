import { describe, expect, it } from "vitest";
import {
  datetimeLocalInZoneToIso,
  formatInterviewResponseLabel,
  isDisplayableMeetLink,
  isoToDatetimeLocalInZone,
} from "@/lib/integrations/interview-display";
import { GOOGLE_MEET_URL_PREFIX } from "@/lib/integrations/google-calendar";

describe("interview-display", () => {
  it("only treats Google-issued Meet URLs as displayable", () => {
    expect(isDisplayableMeetLink(`${GOOGLE_MEET_URL_PREFIX}abc-defg-hij`)).toBe(true);
    expect(isDisplayableMeetLink("https://evil.example/meet")).toBe(false);
    expect(isDisplayableMeetLink(null)).toBe(false);
  });

  it("maps Calendar RSVP values to readable labels", () => {
    expect(formatInterviewResponseLabel("accepted")).toBe("Accepted");
    expect(formatInterviewResponseLabel("needsAction")).toBe("Awaiting response");
  });

  it("round-trips datetime-local through Asia/Dhaka offset", () => {
    const local = "2026-11-10T10:00";
    const iso = datetimeLocalInZoneToIso(local, "Asia/Dhaka");
    expect(iso).toBe("2026-11-10T10:00:00+06:00");
    expect(isoToDatetimeLocalInZone(iso, "Asia/Dhaka")).toBe(local);
  });
});
