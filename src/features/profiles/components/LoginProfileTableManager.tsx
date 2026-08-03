import { useEffect, useState } from "react";
import { Trash2, X } from "lucide-react";
import { DataTable, useToast } from "../../../components/ui";
import { errorMessage } from "../../../lib/errors";
import { isTauri } from "../../../lib/platform";
import { profileApi } from "../api";
import type { LoginProfile } from "../types";
import "./LoginProfileTableManager.css";

type LoginProfileRow = {
  id?: string;
  name: string;
  username: string;
  email: string;
  password: string;
};

type LoginProfileField = "username" | "email" | "password";

type LoginProfileTableManagerProps = {
  profiles: LoginProfile[];
  onClose?: () => void;
  onChanged: () => Promise<void>;
  embedded?: boolean;
};

export function LoginProfileTableManager({
  profiles,
  onClose,
  onChanged,
  embedded = false,
}: LoginProfileTableManagerProps) {
  const { notify } = useToast();
  const [rows, setRows] = useState<LoginProfileRow[]>([
    { name: "", username: "", email: "", password: "" },
  ]);
  const [editingCell, setEditingCell] = useState<{
    index: number;
    field: LoginProfileField;
  } | null>(null);

  const loadRows = async () => {
    try {
      const savedRows = await Promise.all(
        profiles.map(async (profile) => {
          const secret = isTauri()
            ? await profileApi
                .get<{ username: string; email?: string; password: string }>(profile.id)
                .catch(() => ({ username: profile.username, email: profile.email ?? "", password: "" }))
            : { username: profile.username, email: profile.email ?? "", password: "demo-password" };
          return { id: profile.id, name: profile.name, email: profile.email ?? secret.email ?? "", ...secret };
        }),
      );
      setRows([...savedRows, { name: "", username: "", email: "", password: "" }]);
    } catch (reason) {
      notify(errorMessage(reason), "error");
    }
  };

  useEffect(() => {
    void loadRows();
  }, [profiles]);

  const updateRow = (index: number, field: LoginProfileField, value: string) => {
    setRows((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [field]: value } : row,
      ),
    );
  };

  const saveRow = async (index: number, row: LoginProfileRow) => {
    if (!row.username.trim() || !row.password) return;
    try {
      if (isTauri()) {
        const payload = {
          ...row,
          name: row.name.trim() || row.email.trim() || row.username.trim(),
        };
        const saved = await profileApi.save<LoginProfile>(payload);
        setRows((current) =>
          current.map((currentRow, rowIndex) =>
            rowIndex === index ? { ...payload, id: saved.id } : currentRow,
          ),
        );
      }
      await onChanged();
    } catch (reason) {
      notify(errorMessage(reason), "error");
    }
  };

  const renderCell = (
    row: LoginProfileRow,
    index: number,
    field: LoginProfileField,
  ) => {
    const editing = editingCell?.index === index && editingCell.field === field;
    if (editing) {
      return (
        <input
          autoFocus
          className="input profile-cell-input"
          value={row[field]}
          type={field === "password" ? "password" : field === "email" ? "email" : "text"}
          autoComplete={field === "username" ? "username" : field === "email" ? "email" : "new-password"}
          placeholder={
            field === "username"
              ? "请输入用户名"
              : field === "email"
                ? "请输入邮箱"
              : field === "password"
                ? "请输入登录密码"
                : ""
          }
          onBlur={(event) => {
            const nextRow = { ...row, [field]: event.currentTarget.value };
            setEditingCell(null);
            void saveRow(index, nextRow);
          }}
          onChange={(event) => updateRow(index, field, event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
      );
    }

    const value = field === "password" && row.password ? "••••••••" : row[field];
    const labels: Record<LoginProfileField, string> = {
      email: "邮箱",
      username: "用户名",
      password: "密码",
    };
    return (
      <button
        type="button"
        className={`profile-cell-display profile-cell-${field}`}
        aria-label={`编辑${labels[field]}`}
        onClick={() => setEditingCell({ index, field })}
      >
        {value}
      </button>
    );
  };

  const deleteRow = async (index: number) => {
    const row = rows[index];
    try {
      if (row.id && isTauri()) {
        await profileApi.remove(row.id);
        await onChanged();
      }
      setRows((current) => {
        const next = current.filter((_, rowIndex) => rowIndex !== index);
        return next.some((item) => !item.id)
          ? next
          : [...next, { name: "", username: "", email: "", password: "" }];
      });
    } catch (reason) {
      notify(errorMessage(reason), "error");
    }
  };

  return (
    <div
      className={embedded ? "profile-manager-panel" : "modal-backdrop"}
      role="presentation"
    >
      <section
        className={embedded ? "profile-editor-panel" : "modal profile-manager-modal"}
        aria-label="常用登录"
      >
        {!embedded && (
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <h2 className="font-semibold">常用登录</h2>
            <button type="button" className="icon-button" onClick={onClose}>
              <X size={17} />
            </button>
          </div>
        )}
        <div className={embedded ? "" : "p-5"}>
          <DataTable
            className="profile-editor-table"
            ariaLabel="常用登录配置"
            desktop={
              <table>
                <thead>
                  <tr>
                    <th>用户名</th>
                    <th>邮箱</th>
                    <th>密码</th>
                    <th className="profile-delete-heading">管理</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={row.id ?? `new-${index}`}>
                      <td>{renderCell(row, index, "username")}</td>
                      <td>{renderCell(row, index, "email")}</td>
                      <td>{renderCell(row, index, "password")}</td>
                      <td className="profile-delete-cell">
                        <button
                          type="button"
                          className="icon-button"
                          aria-label="删除账号"
                          title="删除账号"
                          onClick={() => void deleteRow(index)}
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            }
          />
        </div>
        {!embedded && (
          <div className="flex justify-end border-t border-slate-200 px-5 py-4">
            <button type="button" className="button-secondary" onClick={onClose}>
              关闭
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
