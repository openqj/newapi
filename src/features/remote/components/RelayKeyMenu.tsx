import type { Ref } from "react";
import { createPortal } from "react-dom";
import type { KeyRow } from "../../api-keys";

export function RelayKeyMenu({ position, rows, saving, menuRef, onSelect, onSelectLocal }: { position: { top: number; left: number; width: number }; rows: KeyRow[]; saving: boolean; menuRef: Ref<HTMLDivElement>; onSelect: (value: string) => void; onSelectLocal: () => void }) {
  return createPortal(<div ref={menuRef} className="relay-switch-options" style={position}>
    <button type="button" className="relay-switch-local" disabled={saving} onClick={onSelectLocal}>本地中转站 / API 密钥</button>
    {rows.map((row) => <button type="button" key={`${row.stationId}:${row.key.id}`} disabled={saving} onClick={() => onSelect(`${row.stationId}:${row.key.id}`)}>{row.stationName} · {row.key.name || row.key.id} · {row.key.maskedKey}</button>)}
    {rows.length === 0 && <p className="relay-switch-empty">暂无本地中转站密钥。</p>}
  </div>, document.body);
}
