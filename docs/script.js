const copyButtons = document.querySelectorAll("[data-copy]");
const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const announcer = document.createElement("div");

announcer.className = "sr-only";
announcer.setAttribute("aria-live", "polite");
announcer.setAttribute("aria-atomic", "true");
document.body.append(announcer);

function announce(message) {
  announcer.textContent = "";
  window.requestAnimationFrame(() => {
    announcer.textContent = message;
  });
}

async function copyValue(value) {
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
  if (!copied) throw new Error("Clipboard is unavailable");
}

for (const button of copyButtons) {
  const defaultLabel = button.textContent?.trim() || "Copy";
  const defaultAriaLabel = button.getAttribute("aria-label") || defaultLabel;

  button.addEventListener("click", async () => {
    const value = button.getAttribute("data-copy") || "";
    if (!value) return;

    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    try {
      await copyValue(value);
      button.textContent = "Copied";
      button.setAttribute("aria-label", "Copied to clipboard");
      announce("Copied to clipboard");
    } catch {
      button.textContent = "Copy failed";
      button.setAttribute("aria-label", "Copy failed; try again");
      announce("Copy failed. Try again.");
    } finally {
      button.disabled = false;
      button.removeAttribute("aria-busy");
      window.setTimeout(() => {
        button.textContent = defaultLabel;
        button.setAttribute("aria-label", defaultAriaLabel);
      }, 1400);
    }
  });
}

const internalLinks = document.querySelectorAll('a[href^="#"]');

for (const link of internalLinks) {
  link.addEventListener("click", (event) => {
    const targetId = link.getAttribute("href")?.slice(1);
    const target = targetId ? document.getElementById(targetId) : null;
    if (!target) return;
    event.preventDefault();
    if (window.location.hash !== `#${targetId}`) {
      history.pushState(null, "", `#${targetId}`);
    }
    if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
    target.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
  });
}
