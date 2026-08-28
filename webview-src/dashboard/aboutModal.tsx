import type { ComponentChildren } from "preact";
import type { DashboardState } from "../../src/domain/dashboard/types";
import { GitHubIcon } from "./icons";
import { ModalShell } from "./primitives";

const PROJECT_AUTHOR_URL = "https://github.com/wannanbigpig";
const PROJECT_GITHUB_URL = "https://github.com/wannanbigpig/codex-tools";
const PROJECT_ISSUES_URL = "https://github.com/wannanbigpig/codex-tools/issues";
const PROJECT_LICENSE_URL = "https://github.com/wannanbigpig/codex-tools/blob/main/LICENSE";

type AboutLocaleText = {
  title: string;
  close: string;
  extensionChip: string;
  localChip: string;
  desc: string;
  subdesc: string;
  author: string;
  authorDesc: string;
  github: string;
  githubDesc: string;
  feedback: string;
  feedbackDesc: string;
  license: string;
  licenseDesc: string;
  purposeTitle: string;
  purposeItems: string[];
  riskTitle: string;
  riskItems: string[];
  disclaimerTitle: string;
  disclaimer: string;
};

const ABOUT_TEXT: Record<"en" | "zh" | "zh-hant", AboutLocaleText> = {
  en: {
    title: "About",
    close: "Close",
    extensionChip: "VS Code Extension",
    localChip: "Local-first",
    desc: "A local dashboard for managing Codex accounts, quota visibility, and account switching inside VS Code.",
    subdesc:
      "Codex Accounts Manager focuses on saved accounts you already own, helping you organize tokens, inspect quotas, switch accounts, and keep account state easier to understand.",
    author: "Author",
    authorDesc: "wannanbigpig",
    github: "Repository",
    githubDesc: "View source code",
    feedback: "Feedback",
    feedbackDesc: "Report issues or ideas",
    license: "License",
    licenseDesc: "MIT License",
    purposeTitle: "Project Purpose",
    purposeItems: [
      "For learning, local research, and everyday account organization around Codex account management.",
      "This project is not an official client, plugin, or authorized management tool from any third-party platform.",
      "It helps with local observation and switching, and should not be understood as a tool that promises to bypass platform policies."
    ],
    riskTitle: "Usage Notes",
    riskItems: [
      "Use only accounts, tokens, and local environments that you legally own or are authorized to use.",
      "You remain responsible for following platform terms, account rules, API usage policies, and applicable laws.",
      "Frequent switching, abnormal requests, leaked credentials, rate limits, account restrictions, or data mistakes are risks you should evaluate yourself."
    ],
    disclaimerTitle: "Disclaimer",
    disclaimer:
      "This project is provided as-is without warranties. The author and contributors are not liable for losses caused by use, misuse, reliance on, or inability to use this project."
  },
  zh: {
    title: "关于",
    close: "关闭",
    extensionChip: "VS Code 扩展",
    localChip: "本地优先",
    desc: "在 VS Code 内管理 Codex 多账号、查看配额与切换状态的本地工具。",
    subdesc:
      "Codex Accounts Manager 面向你已合法拥有的账号，提供本地导入、账号切换、配额查看、标签整理、导出与状态提示等能力。",
    author: "主作者",
    authorDesc: "wannanbigpig",
    github: "开源仓库",
    githubDesc: "查看源代码",
    feedback: "意见反馈",
    feedbackDesc: "报告问题或建议",
    license: "开源协议",
    licenseDesc: "MIT License",
    purposeTitle: "项目用途说明",
    purposeItems: [
      "用于学习、交流和本地研究 Codex 账号管理、配额展示与 VS Code 工具集成方案。",
      "项目本身不是任何第三方平台的官方客户端、官方插件或官方授权管理工具。",
      "适合个人在本机环境下对已有账号进行整理、观察和切换，不应被理解为规避平台策略的承诺工具。"
    ],
    riskTitle: "使用须知与风险提示",
    riskItems: [
      "请仅在你合法拥有和有权使用的账号、令牌与本地环境中使用本项目，并妥善保管本地凭证文件。",
      "使用本项目时，仍应自行遵守相关平台的服务条款、账号规则、API 使用规范以及所在地法律法规。",
      "如因频繁切号、异常请求、凭证泄露、账号风控、服务限流、账号停用或数据误操作导致任何问题，风险由使用者自行承担。"
    ],
    disclaimerTitle: "免责声明",
    disclaimer:
      "本项目按“现状”提供，不附带任何明示或默示担保。项目作者与贡献者不对因使用、误用、依赖或无法使用本项目而产生的任何直接、间接、附带、特殊或后续损失承担责任。"
  },
  "zh-hant": {
    title: "關於",
    close: "關閉",
    extensionChip: "VS Code 擴充套件",
    localChip: "本機優先",
    desc: "在 VS Code 內管理 Codex 多帳號、查看配額與切換狀態的本機工具。",
    subdesc:
      "Codex Accounts Manager 面向你已合法擁有的帳號，提供本機匯入、帳號切換、配額查看、標籤整理、匯出與狀態提示等能力。",
    author: "主作者",
    authorDesc: "wannanbigpig",
    github: "開源倉庫",
    githubDesc: "查看原始碼",
    feedback: "意見回饋",
    feedbackDesc: "回報問題或建議",
    license: "開源協議",
    licenseDesc: "MIT License",
    purposeTitle: "專案用途說明",
    purposeItems: [
      "用於學習、交流和本機研究 Codex 帳號管理、配額展示與 VS Code 工具整合方案。",
      "專案本身不是任何第三方平台的官方客戶端、官方外掛或官方授權管理工具。",
      "適合個人在本機環境下對既有帳號進行整理、觀察和切換，不應被理解為規避平台策略的承諾工具。"
    ],
    riskTitle: "使用須知與風險提示",
    riskItems: [
      "請僅在你合法擁有和有權使用的帳號、權杖與本機環境中使用本專案，並妥善保管本機憑證檔案。",
      "使用本專案時，仍應自行遵守相關平台的服務條款、帳號規則、API 使用規範以及所在地法律法規。",
      "如因頻繁切號、異常請求、憑證洩露、帳號風控、服務限流、帳號停用或資料誤操作導致任何問題，風險由使用者自行承擔。"
    ],
    disclaimerTitle: "免責聲明",
    disclaimer:
      "本專案按「現狀」提供，不附帶任何明示或默示擔保。專案作者與貢獻者不對因使用、誤用、依賴或無法使用本專案而產生的任何直接、間接、附帶、特殊或後續損失承擔責任。"
  }
};

export function AboutModal(props: {
  open: boolean;
  lang: DashboardState["lang"];
  logoUri: string;
  version: string;
  onClose: () => void;
  onOpenExternal: (url: string) => void;
}) {
  const text = getAboutText(props.lang);
  const entries = [
    {
      key: "author",
      title: text.author,
      desc: text.authorDesc,
      icon: <AboutUserIcon />,
      className: "is-author",
      url: PROJECT_AUTHOR_URL
    },
    {
      key: "github",
      title: text.github,
      desc: text.githubDesc,
      icon: <GitHubIcon />,
      className: "is-github",
      url: PROJECT_GITHUB_URL
    },
    {
      key: "feedback",
      title: text.feedback,
      desc: text.feedbackDesc,
      icon: <AboutFeedbackIcon />,
      className: "is-feedback",
      url: PROJECT_ISSUES_URL
    },
    {
      key: "license",
      title: text.license,
      desc: text.licenseDesc,
      icon: <AboutLicenseIcon />,
      className: "is-license",
      url: PROJECT_LICENSE_URL
    }
  ];

  return (
    <ModalShell
      open={props.open}
      title={text.title}
      closeLabel={text.close}
      className="about-modal"
      onClose={props.onClose}
    >
      <div class="about-card">
        <section class="about-hero">
          <img class="about-logo" src={props.logoUri} alt="Codex Manager logo" />
          <h2 class="about-title">Codex Manager</h2>
          <div class="about-chip-row">
            <span class="about-chip">v{props.version}</span>
            <span class="about-chip">{text.extensionChip}</span>
            <span class="about-chip">{text.localChip}</span>
          </div>
          <p class="about-desc">{text.desc}</p>
          <p class="about-subdesc">{text.subdesc}</p>
        </section>

        <section class="about-section about-section-compact">
          <div class="about-entry-grid">
            {entries.map((entry) => (
              <button
                key={entry.key}
                class={`about-entry-card ${entry.className}`}
                type="button"
                onClick={() => props.onOpenExternal(entry.url)}
              >
                <span class="about-entry-icon" aria-hidden="true">
                  {entry.icon}
                </span>
                <span class="about-entry-title">{entry.title}</span>
                <span class="about-entry-desc">{entry.desc}</span>
              </button>
            ))}
          </div>
        </section>

        <AboutSection title={text.purposeTitle} items={text.purposeItems} />
        <AboutSection title={text.riskTitle} items={text.riskItems} />
        <section class="about-section about-section-warning">
          <div class="about-section-title">{text.disclaimerTitle}</div>
          <div class="about-disclaimer">{text.disclaimer}</div>
        </section>
      </div>
    </ModalShell>
  );
}

function getAboutText(lang: DashboardState["lang"]): AboutLocaleText {
  if (lang === "zh" || lang === "zh-hant") {
    return ABOUT_TEXT[lang];
  }
  return ABOUT_TEXT.en;
}

function AboutSection(props: { title: string; items: string[] }) {
  return (
    <section class="about-section">
      <div class="about-section-title">{props.title}</div>
      <ul class="about-list">
        {props.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function AboutIconShell(props: { children: ComponentChildren }) {
  return (
    <svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true">
      {props.children}
    </svg>
  );
}

function AboutUserIcon() {
  return (
    <AboutIconShell>
      <path d="M20 21a8 8 0 0 0-16 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
      <circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="1.8" />
    </AboutIconShell>
  );
}

function AboutFeedbackIcon() {
  return (
    <AboutIconShell>
      <path
        d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </AboutIconShell>
  );
}

function AboutLicenseIcon() {
  return (
    <AboutIconShell>
      <path
        d="M7 3h7l4 4v14H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linejoin="round"
      />
      <path d="M14 3v5h5M8 13h8M8 17h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
    </AboutIconShell>
  );
}
