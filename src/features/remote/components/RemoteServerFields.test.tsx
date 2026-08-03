import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RemoteServerFields, parseSshHostInput } from "./RemoteServerFields";

function renderFields(username = "") {
  const view = render(
    <form>
      <RemoteServerFields
        authType="password"
        onAuthTypeChange={vi.fn()}
        password=""
        onPasswordChange={vi.fn()}
        privateKeyPath=""
        onChoosePrivateKey={vi.fn()}
        onGenerateKey={vi.fn()}
        generatingKey={false}
        server={username ? { id: "server-1", name: "", host: "", port: 22, username, authType: "password", updatedAt: 0 } : undefined}
      />
    </form>,
  );
  return {
    hostInput: view.container.querySelector<HTMLInputElement>('input[name="host"]')!,
    usernameInput: view.container.querySelector<HTMLInputElement>('input[name="username"]')!,
  };
}

describe("RemoteServerFields host parsing", () => {
  it("splits user@host input into username and host", () => {
    expect(parseSshHostInput("root@keie.com")).toEqual({ username: "root", host: "keie.com" });

    const { hostInput, usernameInput } = renderFields();
    fireEvent.change(hostInput, { target: { value: "root@keie.com" } });
    fireEvent.blur(hostInput);

    expect(hostInput.value).toBe("keie.com");
    expect(usernameInput.value).toBe("root");
  });

  it("does not overwrite a username that the user already changed", () => {
    const { hostInput, usernameInput } = renderFields();
    fireEvent.change(usernameInput, { target: { value: "admin" } });
    fireEvent.change(hostInput, { target: { value: "root@keie.com" } });
    fireEvent.blur(hostInput);

    expect(hostInput.value).toBe("keie.com");
    expect(usernameInput.value).toBe("admin");
  });

  it("updates a previously auto-filled username when the host syntax changes", () => {
    const { hostInput, usernameInput } = renderFields();
    fireEvent.change(hostInput, { target: { value: "root@keie.com" } });
    fireEvent.blur(hostInput);
    fireEvent.change(hostInput, { target: { value: "deploy@example.com" } });
    fireEvent.blur(hostInput);

    expect(hostInput.value).toBe("example.com");
    expect(usernameInput.value).toBe("deploy");
  });
});
