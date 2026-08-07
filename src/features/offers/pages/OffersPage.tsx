import { EmptyState, List, ListItem, PageHeader, Panel } from "../../../components/ui";
import type { Offer } from "../types";

export function OffersPage({ offers }: { offers: Offer[] }) {
  return <>
    <PageHeader title="优惠中心" description="汇总站点公告与套餐" />
    <List className="grid max-w-4xl gap-3">
      {offers.map((offer) => (
        <ListItem key={offer.id}>
          <Panel className="offers-card">
          <div className="flex items-start justify-between gap-5 p-5">
            <div>
              <h2 className="font-semibold">{offer.title}</h2>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">
                {offer.summary || "查看站点获取详情。"}
              </p>
            </div>
            <a className="button-secondary shrink-0" href={offer.sourceUrl} target="_blank" rel="noreferrer">
              打开站点
            </a>
          </div>
          </Panel>
        </ListItem>
      ))}
      {!offers.length && (
        <Panel>
          <EmptyState title="暂无优惠或公告" description="当前站点没有可公开的内容。" />
        </Panel>
      )}
    </List>
  </>;
}
