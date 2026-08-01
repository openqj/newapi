import { describe, expect, it } from "vitest";
import { appRoutes, getPrimaryNavigation, type AppRouteContext } from "./routes";

describe("application route registry", () => {
  it("keeps every public view registered and every navigation entry routable", () => {
    const navigation = getPrimaryNavigation();

    expect(Object.keys(appRoutes)).toEqual([
      "overview", "accounts", "rates", "keys", "usage", "apiDetection", "remote", "profiles", "offers", "merchantCenter", "personalCenter", "settings",
    ]);
    expect(navigation.map((item) => item.view)).toEqual([
      "overview", "accounts", "rates", "keys", "usage", "apiDetection", "remote", "offers", "personalCenter", "settings",
    ]);
    navigation.forEach(({ view }) => expect(appRoutes[view].createPage).toBeTypeOf("function"));
  });

  it("shows remote configuration to every role", () => {
    const proNavigation = getPrimaryNavigation({ accountRole: "pro" } as AppRouteContext);
    expect(proNavigation.map((item) => item.view)).toEqual([
      "overview", "accounts", "rates", "keys", "usage", "apiDetection", "remote", "offers", "personalCenter", "settings",
    ]);
    const navigation = getPrimaryNavigation({ accountRole: "merchant" } as AppRouteContext);
    expect(navigation.map((item) => item.view)).toEqual([
      "overview", "accounts", "rates", "keys", "usage", "apiDetection", "remote", "offers", "personalCenter", "settings",
    ]);
  });
});
