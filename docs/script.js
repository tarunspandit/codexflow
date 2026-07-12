const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
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
  const idleText = button.textContent?.trim() || "Copy";
  const idleLabel = button.dataset.copyLabel || idleText;
  const doneText = button.dataset.copyDone || "Copied";
  button.setAttribute("aria-label", idleLabel);

  button.addEventListener("click", async () => {
    if (!button.dataset.copy) return;
    button.disabled = true;
    try {
      await writeClipboard(button.dataset.copy);
      button.textContent = doneText;
      button.setAttribute("aria-label", doneText);
      announce(doneText);
    } catch {
      button.textContent = "Retry";
      button.setAttribute("aria-label", "Copy failed. Try again.");
      announce("Copy failed. Try again.");
    } finally {
      window.setTimeout(() => {
        button.disabled = false;
        button.textContent = idleText;
        button.setAttribute("aria-label", idleLabel);
      }, 1500);
    }
  });
}

const sessionsEn = {
  atlas: {
    letter: "A",
    task: "Polish onboarding",
    id: "conversation_01",
    project: "atlas-web",
    path: "~/DEV/atlas-web",
    terminal: "workspace bound · skills loaded · ready",
    accent: "#9d83ff",
  },
  signal: {
    letter: "S",
    task: "Refactor auth",
    id: "conversation_02",
    project: "signal-api",
    path: "~/DEV/signal-api",
    terminal: "repository mapped · tests located · ready",
    accent: "#ff8f5b",
  },
  flow: {
    letter: "C",
    task: "Release audit",
    id: "conversation_03",
    project: "codexflow",
    path: "~/DEV/codexflow",
    terminal: "git clean · package verified · ready",
    accent: "#caff5b",
  },
};

const sessionsZh = {
  atlas: {
    letter: "A",
    task: "优化新手流程",
    id: "conversation_01",
    project: "atlas-web",
    path: "~/DEV/atlas-web",
    terminal: "工作区已绑定 · skills 已加载 · 就绪",
    accent: "#9d83ff",
  },
  signal: {
    letter: "S",
    task: "重构身份验证",
    id: "conversation_02",
    project: "signal-api",
    path: "~/DEV/signal-api",
    terminal: "仓库已映射 · 测试已定位 · 就绪",
    accent: "#ff8f5b",
  },
  flow: {
    letter: "C",
    task: "发布审查",
    id: "conversation_03",
    project: "codexflow",
    path: "~/DEV/codexflow",
    terminal: "git clean · package 已验证 · 就绪",
    accent: "#caff5b",
  },
};

const locale = document.body.dataset.locale === "zh" ? "zh" : "en";
const sessions = locale === "zh" ? sessionsZh : sessionsEn;

const switchboard = document.querySelector(".switchboard");
const sessionOutputs = {
  letter: document.querySelector("[data-session-letter]"),
  task: document.querySelector("[data-session-task]"),
  id: document.querySelector("[data-session-id]"),
  project: document.querySelector("[data-project-name]"),
  path: document.querySelector("[data-project-path]"),
  terminal: document.querySelector("[data-terminal-line]"),
};

for (const tab of document.querySelectorAll("[data-session]")) {
  tab.addEventListener("click", () => {
    const session = sessions[tab.dataset.session];
    if (!session) return;

    for (const item of document.querySelectorAll("[data-session]")) {
      const active = item === tab;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-pressed", String(active));
    }

    sessionOutputs.letter.textContent = session.letter;
    sessionOutputs.task.textContent = session.task;
    sessionOutputs.id.textContent = session.id;
    sessionOutputs.project.textContent = session.project;
    sessionOutputs.path.textContent = session.path;
    sessionOutputs.terminal.textContent = session.terminal;
    switchboard?.style.setProperty("--session-accent", session.accent);
    announce(locale === "zh" ? `${session.task} 已路由到 ${session.project}` : `${session.task} is routed to ${session.project}`);
  });
}

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
  const revealObserver = new IntersectionObserver(
    (entries, observer) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    },
    { threshold: 0.12, rootMargin: "0px 0px -8%" },
  );
  revealItems.forEach((item) => revealObserver.observe(item));
}

function updateHeader() {
  header?.classList.toggle("is-scrolled", window.scrollY > 18);
}

updateHeader();
window.addEventListener("scroll", updateHeader, { passive: true });

if (!reducedMotion && window.matchMedia?.("(hover: hover) and (pointer: fine)").matches) {
  window.addEventListener(
    "pointermove",
    (event) => {
      document.documentElement.style.setProperty("--pointer-x", `${event.clientX}px`);
      document.documentElement.style.setProperty("--pointer-y", `${event.clientY}px`);
    },
    { passive: true },
  );
}

for (const details of document.querySelectorAll(".faq-list details")) {
  details.addEventListener("toggle", () => {
    if (!details.open) return;
    for (const sibling of document.querySelectorAll(".faq-list details")) {
      if (sibling !== details) sibling.open = false;
    }
  });
}
