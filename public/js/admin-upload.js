// Catalog edit page: uploads a chosen file with a raw PUT (streamed into R2 by the admin Worker),
// shows progress, then reloads the page. Server errors are shown next to the control.
for (const input of document.querySelectorAll("#uploads input[type=file][data-upload-url]")) {
  const field = input.closest(".admin-upload");
  const progress = field?.querySelector("progress");
  const status = field?.querySelector(".admin-upload__status");

  const show = (text, isError = false) => {
    if (!status) return;
    status.textContent = text;
    status.classList.toggle("admin-error", isError);
  };

  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (!file) return;
    const type = file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "");
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", input.dataset.uploadUrl);
    xhr.setRequestHeader("Content-Type", type || "application/octet-stream");
    input.disabled = true;
    if (progress) {
      progress.hidden = false;
      progress.value = 0;
    }
    show("Uploading… 0%");

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const percent = Math.round((event.loaded / event.total) * 100);
      if (progress) progress.value = percent;
      show(`Uploading… ${percent}%`);
    };
    xhr.onload = () => {
      let body = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = null;
      }
      if (xhr.status === 200 && body?.ok) {
        if (progress) progress.value = 100;
        show("Uploaded. Reloading…");
        window.location.reload();
        return;
      }
      input.disabled = false;
      input.value = "";
      if (progress) progress.hidden = true;
      show(body?.error ?? `Upload failed (HTTP ${xhr.status}).`, true);
    };
    xhr.onerror = () => {
      input.disabled = false;
      if (progress) progress.hidden = true;
      show("Upload failed. Check your connection and try again.", true);
    };
    xhr.send(file);
  });
}
