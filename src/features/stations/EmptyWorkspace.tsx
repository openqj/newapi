import { KeyRound, Plus } from "lucide-react";

export function EmptyWorkspace({ onAdd }: { onAdd: () => void }) {
  return <div className="grid min-h-[500px] place-items-center"><div className="max-w-sm text-center"><div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-teal-50 text-teal-700"><KeyRound size={24} /></div><h1 className="text-xl font-semibold">添加第一个中转站</h1><p className="mt-2 text-sm leading-6 text-slate-500">保存普通用户登录态后，RelayHub 会集中追踪你的可用分组、倍率、密钥和站点优惠。</p><button className="button-primary mt-5" onClick={onAdd}><Plus size={16} />添加站点</button></div></div>;
}
