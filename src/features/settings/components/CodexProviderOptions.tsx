import { useEffect, useState, type FormEvent } from "react";
import { Button, FormDialog, FormField, Panel, Switch, TextareaField, useToast } from "../../../components/ui";
import { errorMessage } from "../../../lib/errors";
import { settingsApi } from "../api";
import type { CodexIntegrationStatus } from "../types";
import "./CodexProviderOptions.css";

type CodexProviderOptionsProps = {
  compact?: boolean;
};

export function CodexProviderOptions({ compact = false }: CodexProviderOptionsProps) {
  const { notify } = useToast();
  const [status, setStatus] = useState<CodexIntegrationStatus | null>(null);
  const [snippetDraft, setSnippetDraft] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    void settingsApi.codexIntegration()
      .then((next) => {
        if (!mounted) return;
        setStatus(next);
        setSnippetDraft(next.commonConfigSnippet);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);

  const updateOption = async (
    patch: Partial<
      Pick<CodexIntegrationStatus, "goalMode" | "remoteCompaction" | "commonConfigEnabled">
    >,
  ) => {
    if (!status) return;
    setSaving(true);
    try {
      const next = {
        goalMode: patch.goalMode ?? status.goalMode,
        remoteCompaction: patch.remoteCompaction ?? status.remoteCompaction,
        commonConfigEnabled: patch.commonConfigEnabled ?? status.commonConfigEnabled,
      };
      setStatus(await settingsApi.setCodexPreferences(
        next.goalMode,
        next.remoteCompaction,
        next.commonConfigEnabled,
      ));
    } catch (reason) {
      notify(errorMessage(reason, "Codex 配置选项保存失败"), "error");
    } finally {
      setSaving(false);
    }
  };

  const saveSnippet = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    try {
      const next = await settingsApi.setCodexCommonConfig(snippetDraft);
      setStatus(next);
      setSnippetDraft(next.commonConfigSnippet);
      setDialogOpen(false);
      notify("Codex 通用配置已保存", "success");
    } catch (reason) {
      notify(errorMessage(reason, "Codex 通用配置保存失败"), "error");
    } finally {
      setSaving(false);
    }
  };

  const options = <div className={`codex-option-grid ${compact ? "codex-option-grid-compact" : ""}`}>
    <label>
      <Switch
        aria-label="Goal mode"
        checked={status?.goalMode ?? true}
        disabled={!status || saving}
        onCheckedChange={(checked) => void updateOption({ goalMode: checked })}
      />
      <span>启用 Goal mode</span>
    </label>
    <label title="将当前供应商名称写为 OpenAI，让 Codex 尝试远程压缩。">
      <Switch
        aria-label="Remote compaction"
        checked={status?.remoteCompaction ?? true}
        disabled={!status || saving}
        onCheckedChange={(checked) => void updateOption({ remoteCompaction: checked })}
      />
      <span>启用远程压缩</span>
    </label>
    <label>
      <Switch
        aria-label="Common config"
        checked={status?.commonConfigEnabled ?? false}
        disabled={!status || saving}
        onCheckedChange={(checked) => void updateOption({ commonConfigEnabled: checked })}
      />
      <span>应用通用配置</span>
    </label>
    <Button
      type="button"
      variant="secondary"
      className="codex-common-config-button"
      disabled={!status || saving}
      onClick={() => setDialogOpen(true)}
    >
      编辑通用配置
    </Button>
  </div>;

  const dialog = dialogOpen && <FormDialog
    title="编辑 Codex 通用配置"
    description="保存后，勾选应用通用配置时会合并到供应商切换生成的 config.toml。"
    ariaLabel="编辑 Codex 通用配置"
    onClose={() => setDialogOpen(false)}
    onSubmit={(event) => void saveSnippet(event)}
    footer={<>
      <Button type="button" variant="secondary" onClick={() => setDialogOpen(false)} disabled={saving}>取消</Button>
      <Button type="submit" variant="primary" disabled={saving}>保存</Button>
    </>}
  >
    <FormField label="TOML 配置片段">
      <TextareaField rows={16} value={snippetDraft} onChange={(event) => setSnippetDraft(event.target.value)} placeholder={'[tui]\nnotifications = true'} />
    </FormField>
  </FormDialog>;

  if (compact) {
    return <div className="codex-inline-provider-options">{options}{dialog}</div>;
  }

  return <Panel
    className="settings-panel codex-options-panel"
    title="Codex 供应商选项"
    description="这些选项会在切换直转或本地路由时写入新的 config.toml。"
  >
    {options}
    {dialog}
  </Panel>;
}
