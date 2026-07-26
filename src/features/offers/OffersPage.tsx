import { EmptyState, PageHeader, Panel } from "../../components/ui";
import type { Offer } from "./types";

export function OffersPage({ offers }: { offers: Offer[] }) {
  return <>
    <PageHeader title="\u4f18\u60e0\u4e2d\u5fc3" description="\u6c47\u603b\u7ad9\u70b9\u516c\u544a\u4e0e\u5957\u9910" />
    <div className="grid max-w-4xl gap-3">
      {offers.map((offer) => <Panel key={offer.id} className="offers-card"><div className="flex items-start justify-between gap-5 p-5"><div><h2 className="font-semibold">{offer.title}</h2><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">{offer.summary || "\u67e5\u770b\u7ad9\u70b9\u83b7\u53d6\u8be6\u60c5\u3002"}</p></div><a className="button-secondary shrink-0" href={offer.sourceUrl} target="_blank" rel="noreferrer">\u6253\u5f00\u7ad9\u70b9</a></div></Panel>)}
      {!offers.length && <Panel><EmptyState title="\u6682\u65e0\u4f18\u60e0\u6216\u516c\u544a" description="\u5f53\u524d\u7ad9\u70b9\u6ca1\u6709\u53ef\u516c\u5f00\u7684\u5185\u5bb9\u3002" /></Panel>}
    </div>
  </>;
}
