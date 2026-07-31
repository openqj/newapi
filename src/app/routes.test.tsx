import { describe, expect, it } from "vitest";
import { appRoutes, getPrimaryNavigation, type AppRouteContext } from "./routes";

describe("application route registry", () => {
  it("keeps every public view registered and every navigation entry routable", () => {
    const navigation = getPrimaryNavigation();

    expect(Object.keys(appRoutes)).toEqual([
      "overview", "accounts", "rates", "keys", "usage", "apiDetection", "remote", "profiles", "offers", "personalCenter", "settings",
    ]);
    expect(navigation.map((item) => item.view)).toEqual([
      "overview", "accounts", "rates", "keys", "usage", "apiDetection", "remote", "offers", "personalCenter", "settings",
    ]);
    navigation.forEach(({ view }) => expect(appRoutes[view].createPage).toBeTypeOf("function"));
  });

  it("does not hide local navigation for a signed-in personal-center account", () => {
    const navigation = getPrimaryNavigation({} as unknown as AppRouteContext);
    expect(navigation.map((item) => item.view)).toEqual([
      "overview", "accounts", "rates", "keys", "usage", "apiDetection", "remote", "offers", "personalCenter", "settings",
    ]);
  });
});
