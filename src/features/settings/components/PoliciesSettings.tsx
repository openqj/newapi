import type { LucideIcon } from "lucide-react";
import { Cookie, ExternalLink, FileText, Info, ShieldCheck } from "lucide-react";
import { List, ListItem } from "../../../components/ui";
import "./PoliciesSettings.css";

type PolicySection = {
  heading: string;
  paragraphs?: readonly string[];
  bullets?: readonly string[];
};

type PolicyDocument = {
  id: string;
  title: string;
  summary: string;
  version: string;
  Icon: LucideIcon;
  sections: readonly PolicySection[];
};

const policyDocuments: readonly PolicyDocument[] = [
  {
    id: "privacy-policy",
    title: "隐私政策",
    summary: "说明 RelayHub 收集、使用、保存和共享数据的方式。",
    version: "v1.0",
    Icon: ShieldCheck,
    sections: [
      {
        heading: "1. 适用范围",
        paragraphs: [
          "本政策适用于 RelayHub 桌面客户端，以及客户端连接的云端账户、个人中心和云备份功能。连接第三方站点、模型服务、邮箱或远程服务器时，还应同时遵守对应服务商的隐私政策。",
        ],
      },
      {
        heading: "2. 我们处理的数据",
        bullets: [
          "本地应用数据：站点名称和地址、同步快照、倍率和密钥的脱敏信息、使用记录、告警历史、配置档案、登录资料以及远程服务器连接信息。",
          "凭据和会话数据：站点账号密码、API 密钥、SSH 密码或密钥口令、Relay 密钥、站点 Cookie/会话令牌，以及在你配置邮箱功能时产生的 IMAP 或 OAuth 凭据。敏感凭据默认保存在操作系统凭据管理器中。",
          "云端账户数据：注册邮箱、账户 ID、角色、个人中心成员关系、通知偏好、通知和审计记录。云端登录和风控流程可能记录邮箱、IP 地址、User-Agent、结果和时间。",
          "匿名鉴定统计：使用 API 鉴定功能时，客户端会尝试上传应用版本、时间、单向处理后的站点地址摘要、模型和协议、评分、探针状态、延迟及 Token 统计。该上传会排除 API 密钥、Authorization、请求头、提示词、响应正文和请求 ID。",
        ],
      },
      {
        heading: "3. 数据用途",
        bullets: [
          "完成站点登录、数据同步、API Gateway、使用统计、告警、个人中心和配置恢复。",
          "保存和恢复你主动创建的云端备份，并验证账户、权限和备份归属。",
          "检测服务稳定性、改进 API 鉴定能力和排查故障；匿名鉴定统计不会用于读取或还原你的请求内容。",
        ],
      },
      {
        heading: "4. 数据共享",
        paragraphs: [
          "RelayHub 不出售个人信息，也不使用广告追踪。只有在你主动添加站点、调用 Gateway、配置云端功能或使用相关功能时，必要数据才会发送给对应的第三方站点、模型服务、Supabase 云端服务、邮箱服务或远程服务器。第三方服务对数据的处理由其自身政策约束。",
        ],
      },
      {
        heading: "5. 保存与安全",
        bullets: [
          "本地数据库用于保存配置、缓存和历史记录；敏感凭据及云端会话优先使用操作系统凭据管理器保存。",
          "云端备份在上传前使用你设置的恢复密码进行客户端加密。恢复密码不会上传，遗失恢复密码可能导致备份无法恢复。",
          "我们会采取合理的访问控制、传输保护和最小化记录措施，但任何本地设备、网络或第三方服务都不能保证绝对安全。",
        ],
      },
      {
        heading: "6. 保留、删除与用户权利",
        paragraphs: [
          "本地数据通常保留到你在应用中删除相应记录、清理应用数据或卸载应用为止；云端备份可在云备份管理中单独删除。退出云端账户会清除本机保存的云端会话，但不会自动删除云端账户或已有云端记录。你可以通过支持渠道咨询账户、云端记录或隐私请求。",
        ],
      },
      {
        heading: "7. 政策更新",
        paragraphs: [
          "当数据处理方式或产品功能发生重要变化时，我们会更新本页的版本和生效日期。继续使用相关功能即表示你已阅读更新后的说明。",
        ],
      },
    ],
  },
  {
    id: "terms-of-service",
    title: "服务条款",
    summary: "约定 RelayHub 的使用边界、第三方服务责任和云备份规则。",
    version: "v1.0",
    Icon: FileText,
    sections: [
      {
        heading: "1. 接受条款",
        paragraphs: [
          "安装、启动或使用 RelayHub，即表示你同意遵守本条款、隐私政策和 Cookie/数据说明。如果你不同意，请停止使用并删除本应用及其本地数据。",
        ],
      },
      {
        heading: "2. 账户与凭据",
        bullets: [
          "你应使用自己拥有或获得明确授权的站点账户、API 密钥、远程服务器和邮箱凭据，并对其合法性、准确性和安全性负责。",
          "你应妥善保管本机设备、云端账户密码和云备份恢复密码；因设备、凭据或恢复密码泄露造成的损失由你自行承担。",
          "不得冒用他人身份、绕过权限、探测未授权接口，或利用 RelayHub 访问你无权使用的资源。",
        ],
      },
      {
        heading: "3. 合法使用",
        paragraphs: [
          "你不得使用 RelayHub 实施违法活动、发送恶意流量、窃取或滥用凭据、侵犯第三方权利、规避站点限流或违反所连接服务商的协议。你应自行确认所在地区、目标站点和模型服务对相关使用方式的限制。",
        ],
      },
      {
        heading: "4. 第三方服务",
        paragraphs: [
          "RelayHub 是用于管理连接和本地工作流的客户端，不代表或控制你添加的站点、模型服务、邮箱、Supabase 项目或远程服务器。第三方服务的可用性、价格、计费、内容、数据处理和服务条款由第三方独立决定。",
        ],
      },
      {
        heading: "5. 云备份",
        bullets: [
          "云备份是可选功能，只有在你登录云端账户并主动创建备份时才会上传。备份可能包含本地数据库、配置和凭据的加密副本。",
          "你应在创建备份前确认恢复密码已安全保存。RelayHub 无法读取或重置恢复密码，也不保证备份服务永久可用。",
          "删除云端备份后，除法律或技术原因要求的短期留存外，RelayHub 不会继续向你提供该备份的恢复能力。",
        ],
      },
      {
        heading: "6. 可用性与责任限制",
        paragraphs: [
          "RelayHub 按现状提供。我们会尽力维护软件和功能，但不保证所有第三方接口、站点登录、网络连接、价格数据、同步结果或更新服务持续可用、准确或无中断。使用前请核对重要数据，并为关键配置保留独立备份。",
        ],
      },
      {
        heading: "7. 条款变更与终止",
        paragraphs: [
          "我们可以根据产品、法律或安全需要更新本条款。你可以随时停止使用并删除本地数据；若你违反本条款或相关服务的使用规则，我们可以限制对应功能的访问。",
        ],
      },
    ],
  },
  {
    id: "cookie-data-notice",
    title: "Cookie / 数据说明",
    summary: "解释桌面端 Cookie、会话数据、本地存储和数据上传边界。",
    version: "v1.0",
    Icon: Cookie,
    sections: [
      {
        heading: "1. 广告和追踪 Cookie",
        paragraphs: [
          "RelayHub 桌面客户端不使用用于广告画像的浏览器 Cookie，也不接入基于 Cookie 的第三方广告追踪或页面行为分析。",
        ],
      },
      {
        heading: "2. 站点登录 Cookie 与会话令牌",
        paragraphs: [
          "部分站点需要 Cookie、访问令牌或刷新令牌才能保持登录和完成同步。RelayHub 可能在本机凭据管理器中保存这些站点会话数据，并仅在访问对应站点时发送给对应域名。删除站点账户或清理凭据后，相关站点可能需要重新登录。",
        ],
      },
      {
        heading: "3. 本地存储的数据",
        bullets: [
          "本地数据库：站点、快照、缓存、Gateway 使用记录、告警、配置档案和同步日志。",
          "操作系统凭据管理器：登录密码、API 密钥、SSH 凭据、Relay 密钥、Cookie/会话数据和云端会话。",
          "应用 Web 存储：API 鉴定的本地趋势等非必要的界面辅助数据。",
        ],
      },
      {
        heading: "4. 何时会向外发送数据",
        bullets: [
          "你添加或刷新站点、调用 Gateway、连接远程服务器、配置邮箱或登录云端账户时，客户端会向相应服务发送完成操作所需的数据。",
          "你主动创建、预览或恢复云备份时，客户端会与云端存储交换加密备份文件。",
          "你使用 API 鉴定时，客户端会尝试发送隐私政策中列出的匿名鉴定统计；不会发送 API 密钥、Authorization、提示词或响应正文。",
        ],
      },
      {
        heading: "5. 管理方式",
        paragraphs: [
          "你可以在设置、站点、常用登录、配置档案、使用统计和云备份相关页面中管理或删除对应数据。删除本地登录资料会影响后续自动登录；删除云端备份不可恢复。需要处理无法在界面中删除的云端账户或隐私记录时，请通过支持渠道联系维护者。",
        ],
      },
    ],
  },
];

export function PoliciesSettings() {
  return <div className="policies-settings">
    <header className="policies-intro">
      <span className="policies-intro-icon" aria-hidden="true"><ShieldCheck size={21} /></span>
      <div className="policies-intro-copy">
        <span className="policies-kicker">数据使用规则</span>
        <h2>隐私与政策</h2>
        <p>在使用云端账户、站点同步或 API 鉴定前，查看 RelayHub 当前的数据处理和使用边界。</p>
      </div>
      <dl className="policies-meta">
        <div><dt>版本</dt><dd>v1.0</dd></div>
        <div><dt>生效日期</dt><dd>2026-08-06</dd></div>
      </dl>
    </header>
    <div className="policies-notice" role="note">
      <Info size={17} aria-hidden="true" />
      <p>这些说明针对当前 RelayHub 客户端功能。第三方站点、模型服务、邮箱和云服务仍由各自的政策和条款约束。</p>
    </div>
    <div className="policy-documents">
      {policyDocuments.map(({ id, title, summary, version, Icon, sections }) => <article key={id} className="policy-document" aria-labelledby={`${id}-title`}>
        <header className="policy-document-header">
          <div className="policy-document-heading">
            <span className="policy-document-icon" aria-hidden="true"><Icon size={18} /></span>
            <div><h3 id={`${id}-title`}>{title}</h3><p>{summary}</p></div>
          </div>
          <span className="policy-version">{version}</span>
        </header>
        <div className="policy-document-body">
          {sections.map(({ heading, paragraphs, bullets }) => <section key={heading} className="policy-section">
            <h4>{heading}</h4>
            {paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            {bullets && <List as="ul">{bullets.map((bullet) => <ListItem as="li" key={bullet}>{bullet}</ListItem>)}</List>}
          </section>)}
        </div>
      </article>)}
    </div>
    <footer className="policies-contact">
      <div><strong>需要更正、删除或咨询隐私问题？</strong><p>请在项目支持渠道提交请求，并尽量说明相关账户或数据范围，不要在公开内容中粘贴密码、API 密钥或恢复密码。</p></div>
      <a href="https://github.com/openqj/newapi/issues" target="_blank" rel="noreferrer">GitHub Issues <ExternalLink size={14} aria-hidden="true" /></a>
    </footer>
  </div>;
}
