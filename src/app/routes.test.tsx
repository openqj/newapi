import { describe, expect, it } from "vitest";
import { appRoutes, getPrimaryNavigation } from "./routes";

describe("application route registry", () => {
  it("keeps every public view registered and every navigation entry routable", () => {
    const navigation = getPrimaryNavigation();

    expect(Object.keys(appRoutes)).toEqual([
      "overview", "accounts", "rates", "keys", "usage", "apiDetection", "remote", "profiles", "offers", "personalCenter", "settings", "alertHistory",
    ]);
    expect(navigation.map((item) => item.view)).toEqual([
      "overview", "accounts", "rates", "keys", "usage", "apiDetection", "remote", "offers", "personalCenter", "settings",
    ]);
    navigation.forEach(({ view }) => expect(appRoutes[view].createPage).toBeTypeOf("function"));
  });
});
