import { useEffect, useState } from "react";
import { Trash2, X } from "lucide-react";
import { DataTable } from "../../../components/ui";
import { isTauri } from "../../../lib/platform";
import { profileApi } from "../api";
import type { LoginProfile } from "../types";

type LoginProfileRow = {
  id?: string;
  name: string;
  username: string;
  password: string;
};

type LoginProfileField = keyof Omit<LoginProfileRow, "id">;

type LoginProfileTableManagerProps = {
  profiles: LoginProfile[];
  onClose?: () => void;
  onChanged: () => Promise<void>;
  setError: (message: string) => void;
  embedded?: boolean;
};

export function LoginProfileTableManager({
  profiles,
  onClose,
  onChanged,
  setError,
  embedded = false,
}: LoginProfileTableManagerProps) {
  const [rows, setRows] = useState<LoginProfileRow[]>([]);
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
                .get<{ username: string; password: string }>(profile.id)
                .catch(() => ({ username: profile.username, password: "" }))
            : { username: profile.username, password: "demo-password" };
          return { id: profile.id, name: profile.name, ...secret };
        }),
      );
      setRows([...savedRows, { name: "", username: "", password: "" }]);
    } catch (reason) {
      setError(String(reason));
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
    if (!row.name.trim() || !row.username.trim() || !row.password) return;
    try {
      if (isTauri()) {
        const saved = await profileApi.save<LoginProfile>(row);
        setRows((current) =>
          current.map((currentRow, rowIndex) =>
            rowIndex === index ? { ...row, id: saved.id } : currentRow,
          ),
        );
      }
      await onChanged();
    } catch (reason) {
      setError(String(reason));
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
          type={field === "password" ? "password" : "text"}
          autoComplete={field === "username" ? "username" : "new-password"}
          placeholder={
            field === "username"
              ? "\u8bf7\u8f93\u5165\u767b\u5f55\u8d26\u53f7"
              : field === "password"
                ? "\u8bf7\u8f93\u5165\u767b\u5f55\u5bc6\u7801"
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
      name: "\u8d26\u53f7\u540d\u79f0",
      username: "\u767b\u5f55\u8d26\u53f7",
      password: "\u767b\u5f55\u5bc6\u7801",
    };
    return (
      <button
        type="button"
        className="profile-cell-display"
        aria-label={`\u7f16\u8f91${labels[field]}`}
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
          : [...next, { name: "", username: "", password: "" }];
      });
    } catch (reason) {
      setError(String(reason));
    }
  };

  return (
    <div
      className={embedded ? "profile-manager-panel" : "modal-backdrop"}
      role="presentation"
    >
      <section
        className={embedded ? "profile-editor-panel" : "modal profile-manager-modal"}
        aria-label="\u5e38\u7528\u767b\u5f55"
      >
        {!embedded && (
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <h2 className="font-semibold">\u5e38\u7528\u767b\u5f55</h2>
            <button type="button" className="icon-button" onClick={onClose}>
              <X size={17} />
            </button>
          </div>
        )}
        <div className={embedded ? "" : "p-5"}>
          <DataTable className="profile-editor-table">
            <table>
              <thead>
                <tr>
                  <th>\u8d26\u53f7\u540d\u79f0</th>
                  <th>\u767b\u5f55\u8d26\u53f7</th>
                  <th>\u767b\u5f55\u5bc6\u7801</th>
                  <th className="profile-delete-heading">\u7ba1\u7406</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.id ?? `new-${index}`}>
                    <td>{renderCell(row, index, "name")}</td>
                    <td>{renderCell(row, index, "username")}</td>
                    <td>{renderCell(row, index, "password")}</td>
                    <td className="profile-delete-cell">
                      <button
                        type="button"
                        className="icon-button"
                        aria-label="\u5220\u9664\u8d26\u53f7"
                        title="\u5220\u9664\u8d26\u53f7"
                        onClick={() => void deleteRow(index)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataTable>
        </div>
        {!embedded && (
          <div className="flex justify-end border-t border-slate-200 px-5 py-4">
            <button type="button" className="button-secondary" onClick={onClose}>
              \u5173\u95ed
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
