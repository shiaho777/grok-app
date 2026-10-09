import { describe, expect, it } from "vitest";
import {
  APP_BEHIND_ERROR_PREFIX,
  isAppBehindInstallError,
  isCliUpdateAppBehind,
  stripAppBehindErrorPrefix,
} from "./cliUpdateAppBehind";

describe("cliUpdateAppBehind", () => {
  it("detects appBehind / appUpdateAvailable flags", () => {
    expect(isCliUpdateAppBehind(null)).toBe(false);
    expect(isCliUpdateAppBehind({})).toBe(false);
    expect(isCliUpdateAppBehind({ appBehind: true })).toBe(true);
    expect(isCliUpdateAppBehind({ appUpdateAvailable: true })).toBe(true);
    expect(
      isCliUpdateAppBehind({ appBehind: false, appUpdateAvailable: false }),
    ).toBe(false);
  });

  it("parses APP_BEHIND soft-fail errors", () => {
    const err = `${APP_BEHIND_ERROR_PREFIX}App 0.2.19 → 0.2.30 available`;
    expect(isAppBehindInstallError(err)).toBe(true);
    expect(isAppBehindInstallError("network failed")).toBe(false);
    expect(stripAppBehindErrorPrefix(err)).toBe(
      "App 0.2.19 → 0.2.30 available",
    );
  });
});
