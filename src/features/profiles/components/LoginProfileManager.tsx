import { type FormEvent, useState } from "react";
import { FormDialog } from "../../../components/ui";
import { isTauri } from "../../../lib/platform";
import { profileApi } from "../api";
import type { LoginProfile } from "../types";

type LoginProfileManagerProps = {
  profiles: LoginProfile[];
  onClose: () => void;
  onChanged: () => Promise<void>;
  setError: (message: string) => void;
};

export function LoginProfileManager({
  profiles,
  onClose,
  onChanged,
  setError,
}: LoginProfileManagerProps) {
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    try {
      if (isTauri()) {
        await profileApi.save({
          name: form.get("name"),
          username: form.get("username"),
          password: form.get("password"),
        });
      }
      await onChanged();
      (event.currentTarget.elements.namedItem("name") as HTMLInputElement).value = "";
      (event.currentTarget.elements.namedItem("username") as HTMLInputElement).value = "";
      (event.currentTarget.elements.namedItem("password") as HTMLInputElement).value = "";
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormDialog
      title="\u8d26\u53f7\u5bc6\u7801\u7ba1\u7406"
      description="\u5bc6\u7801\u4ec5\u4fdd\u5b58\u5728 Windows Credential Manager\u3002"
      ariaLabel="\u8d26\u53f7\u5bc6\u7801\u7ba1\u7406"
      onClose={onClose}
      onSubmit={submit}
      contentClassName="space-y-4"
      footer={
        <>
          <button
            type="button"
            className="button-secondary form-dialog-cancel"
            onClick={onClose}
          >
            \u53d6\u6d88
          </button>
          <button className="button-primary form-dialog-submit" disabled={saving}>
            {saving ? "\u4fdd\u5b58\u4e2d" : "\u4fdd\u5b58\u8d26\u53f7"}
          </button>
        </>
      }
    >
      <div className="rounded-lg border border-slate-100">
        {profiles.length === 0 ? (
          <p className="px-3 py-4 text-sm text-slate-500">
            \u5c1a\u65e0\u5df2\u4fdd\u5b58\u8d26\u53f7\u3002
          </p>
        ) : (
          profiles.map((profile) => (
            <div
              className="flex items-center justify-between border-b border-slate-100 px-3 py-2 text-sm last:border-0"
              key={profile.id}
            >
              <span className="font-medium">{profile.name}</span>
              <span className="text-slate-500">{profile.username}</span>
            </div>
          ))
        )}
      </div>
      <label>
        \u8d26\u53f7\u540d\u79f0
        <input
          className="input mt-1"
          name="name"
          required
          placeholder="\u4f8b\u5982\uff1a\u5e38\u7528\u4e2d\u8f6c\u7ad9\u8d26\u53f7"
        />
      </label>
      <label>
        \u7528\u6237\u540d
        <input
          className="input mt-1"
          name="username"
          required
          autoComplete="username"
        />
      </label>
      <label>
        \u5bc6\u7801
        <input
          className="input mt-1"
          name="password"
          type="password"
          required
          autoComplete="new-password"
        />
      </label>
    </FormDialog>
  );
}
