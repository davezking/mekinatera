// Copy buttons: <button data-copy="0977328406">Copy</button>.
// Copies the value, shows "Copied" for 1.6 s, and never throws when the clipboard API is missing.
const COPIED_MS = 1600;

async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path (e.g. insecure context or permission denied).
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand?.("copy") ?? false;
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

document.addEventListener("click", async (event) => {
  const button = event.target instanceof Element ? event.target.closest("[data-copy]") : null;
  if (!button) return;
  const label = button.dataset.copyLabel ?? button.textContent;
  button.dataset.copyLabel = label;
  if (await copyText(button.dataset.copy ?? "")) {
    button.textContent = "Copied";
    clearTimeout(Number(button.dataset.copyTimer));
    button.dataset.copyTimer = String(
      setTimeout(() => {
        button.textContent = label;
      }, COPIED_MS),
    );
  }
});
