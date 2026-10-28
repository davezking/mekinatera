// Admin catalog form: suggests a slug from the name (and year) until the slug is edited by hand.
// The server makes the same suggestion when the slug is left empty, so this is optional.
const slug = document.querySelector("input[data-slug-from]");
const name = document.getElementById("name");
const year = document.getElementById("modelYear");

export function slugify(...parts) {
  return parts
    .join(" ")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

if (slug && name) {
  let touched = slug.value !== "";
  slug.addEventListener("input", () => {
    touched = slug.value !== "";
  });
  const suggest = () => {
    if (!touched) slug.value = slugify(name.value, year?.value ?? "");
  };
  name.addEventListener("input", suggest);
  year?.addEventListener("input", suggest);
}
