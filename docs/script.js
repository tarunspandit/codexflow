const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const locale = document.body.dataset.locale === "zh" ? "zh" : "en";
const announcer = document.querySelector("[data-announcer]");
const header = document.querySelector("[data-header]");

function announce(message) {
  if (!announcer) return;
  announcer.textContent = "";
  window.requestAnimationFrame(() => {
    announcer.textContent = message;
  });
}

async function writeClipboard(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Clipboard unavailable");
}

for (const button of document.querySelectorAll("[data-copy]")) {
  const idleText = button.textContent?.trim() || (locale === "zh" ? "复制" : "Copy");
  const idleLabel = button.dataset.copyLabel || idleText;
  const doneText = button.dataset.copyDone || (locale === "zh" ? "已复制" : "Copied");
  button.setAttribute("aria-label", idleLabel);

  button.addEventListener("click", async () => {
    const value = button.dataset.copy;
    if (!value) return;
    button.disabled = true;
    try {
      await writeClipboard(value);
      button.textContent = doneText;
      button.setAttribute("aria-label", doneText);
      announce(doneText);
    } catch {
      const retry = locale === "zh" ? "重试" : "Retry";
      button.textContent = retry;
      button.setAttribute("aria-label", retry);
      announce(locale === "zh" ? "复制失败，请重试。" : "Copy failed. Try again.");
    } finally {
      window.setTimeout(() => {
        button.disabled = false;
        button.textContent = idleText;
        button.setAttribute("aria-label", idleLabel);
      }, 1500);
    }
  });
}

const sessions = {
  en: {
    atlas: {
      task: "Polish onboarding",
      id: "conversation_01",
      project: "atlas-web",
      path: "~/DEV/atlas-web",
      terminal: "workspace bound · skills loaded · ready",
    },
    signal: {
      task: "Refactor authentication",
      id: "conversation_02",
      project: "signal-api",
      path: "~/DEV/signal-api",
      terminal: "repository mapped · tests located · ready",
    },
    flow: {
      task: "Audit the release",
      id: "conversation_03",
      project: "codexflow",
      path: "~/DEV/codexflow",
      terminal: "git clean · package verified · ready",
    },
  },
  zh: {
    atlas: {
      task: "优化新手流程",
      id: "conversation_01",
      project: "atlas-web",
      path: "~/DEV/atlas-web",
      terminal: "工作区已绑定 · skills 已加载 · 就绪",
    },
    signal: {
      task: "重构身份验证",
      id: "conversation_02",
      project: "signal-api",
      path: "~/DEV/signal-api",
      terminal: "仓库已映射 · 测试已定位 · 就绪",
    },
    flow: {
      task: "审查发布版本",
      id: "conversation_03",
      project: "codexflow",
      path: "~/DEV/codexflow",
      terminal: "git 干净 · package 已验证 · 就绪",
    },
  },
};

const router = document.querySelector("[data-router]");
const tabs = [...document.querySelectorAll("[data-session]")];
const outputs = {
  task: document.querySelector("[data-session-task]"),
  id: document.querySelector("[data-session-id]"),
  project: document.querySelector("[data-project-name]"),
  path: document.querySelector("[data-project-path]"),
  terminal: document.querySelector("[data-terminal-line]"),
};

function setSession(key, focus = false) {
  const session = sessions[locale][key];
  const activeTab = tabs.find((tab) => tab.dataset.session === key);
  if (!session || !activeTab || !router) return;

  for (const tab of tabs) {
    const active = tab === activeTab;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-pressed", String(active));
    tab.tabIndex = active ? 0 : -1;
  }

  for (const [name, node] of Object.entries(outputs)) {
    if (node) node.textContent = session[name];
  }

  router.animate?.(
    [
      { borderColor: "rgba(125, 181, 218, 0.22)" },
      { borderColor: "rgba(125, 181, 218, 0.58)" },
      { borderColor: "rgba(244, 238, 231, 0.25)" },
    ],
    { duration: reducedMotion ? 1 : 700, easing: "cubic-bezier(.22, 1, .36, 1)" },
  );

  if (focus) activeTab.focus();
  announce(locale === "zh" ? `${session.task} 已路由到 ${session.project}` : `${session.task} is routed to ${session.project}`);
}

tabs.forEach((tab, index) => {
  tab.addEventListener("click", () => setSession(tab.dataset.session));
  tab.addEventListener("keydown", (event) => {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    setSession(tabs[next].dataset.session, true);
  });
});

for (const link of document.querySelectorAll('a[href^="#"]')) {
  link.addEventListener("click", (event) => {
    const selector = link.getAttribute("href");
    if (!selector || selector === "#") return;
    const target = document.querySelector(selector);
    if (!target) return;
    event.preventDefault();
    history.pushState(null, "", selector);
    target.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
  });
}

const revealItems = document.querySelectorAll(".reveal");
if (reducedMotion || !("IntersectionObserver" in window)) {
  revealItems.forEach((item) => item.classList.add("is-visible"));
} else {
  const observer = new IntersectionObserver(
    (entries, revealObserver) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-visible");
        revealObserver.unobserve(entry.target);
      }
    },
    { threshold: 0.12, rootMargin: "0px 0px -7%" },
  );
  revealItems.forEach((item) => observer.observe(item));
}

function updateHeader() {
  header?.classList.toggle("is-scrolled", window.scrollY > 21);
}

updateHeader();
window.addEventListener("scroll", updateHeader, { passive: true });

for (const details of document.querySelectorAll(".faq-list details")) {
  details.addEventListener("toggle", () => {
    if (!details.open) return;
    for (const sibling of document.querySelectorAll(".faq-list details")) {
      if (sibling !== details) sibling.open = false;
    }
  });
}
