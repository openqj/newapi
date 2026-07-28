import { type FormEvent, useState } from "react";
import { FormDialog } from "../../../components/ui";
import { useToast } from "../../../components/ui";
import { errorMessage } from "../../../lib/errors";
import { isTauri } from "../../../lib/platform";
import { profileApi } from "../api";
import type { LoginProfile } from "../types";

type LoginProfileManagerProps = {
  profiles: LoginProfile[];
  onClose: () => void;
  onChanged: () => Promise<void>;
};

export function LoginProfileManager({
  profiles,
  onClose,
  onChanged,
}: LoginProfileManagerProps) {
  const { notify } = useToast();
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
      notify(errorMessage(reason), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormDialog
      title="账号密码管理"
      description="密码仅保存在 Windows Credential Manager。"
      ariaLabel="账号密码管理"
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
            取消
          </button>
          <button className="button-primary form-dialog-submit" disabled={saving}>
            {saving ? "保存中" : "保存账号"}
          </button>
        </>
      }
    >
      <div className="rounded-lg border border-slate-100">
        {profiles.length === 0 ? (
          <p className="px-3 py-4 text-sm text-slate-500">
            尚无已保存账号。
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
        账号名称
        <input
          className="input mt-1"
          name="name"
          required
          placeholder="例如：常用中转站账号"
        />
      </label>
      <label>
        用户名
        <input
          className="input mt-1"
          name="username"
          required
          autoComplete="username"
        />
      </label>
      <label>
        密码
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
