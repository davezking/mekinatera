/** Raw form values, echoed back on a validation error. */
export type CatalogFormValues = {
  name: string;
  slug: string;
  modelYear: string;
  sortOrder: string;
  visible: boolean;
  price: string;
  versionVisible: boolean;
};

export type CatalogFormErrors = Partial<Record<keyof CatalogFormValues | "form", string>>;

function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: unknown;
}) {
  return (
    <div class="admin-field">
      <label for={id}>{label}</label>
      {children}
      {hint && <span class="field-hint">{hint}</span>}
      {error && (
        <span class="admin-error" id={`${id}-error`}>
          {error}
        </span>
      )}
    </div>
  );
}

export function CatalogEdit({
  modelId,
  values,
  errors = {},
  hasPdf = false,
}: {
  /** null = new model. */
  modelId: number | null;
  values: CatalogFormValues;
  errors?: CatalogFormErrors;
  hasPdf?: boolean;
}) {
  const isNew = modelId === null;
  const invalid = (key: keyof CatalogFormValues) =>
    errors[key] ? { "aria-invalid": "true", "aria-describedby": `${key}-error` } : {};
  return (
    <>
      <p>
        <a href="/admin/catalog">← Catalog</a>
      </p>
      <section class="card stack" aria-labelledby="edit-title">
        <h1 class="card-title" id="edit-title">
          {isNew ? "Add model" : `Edit ${values.name}`}
        </h1>
        {Object.keys(errors).length > 0 && (
          <p class="notice-error" role="alert">
            {errors.form ?? "Please fix the fields marked below. Nothing was saved."}
          </p>
        )}
        <form
          method="post"
          action={isNew ? "/admin/catalog" : `/admin/catalog/${modelId}`}
          class="admin-form"
        >
          <Field id="name" label="Name" error={errors.name}>
            <input
              id="name"
              name="name"
              value={values.name}
              required
              maxlength={100}
              {...invalid("name")}
            />
          </Field>
          <Field
            id="slug"
            label="Slug"
            error={errors.slug}
            hint="Lowercase letters, numbers and dashes. Used in the address: /m/<slug>. Left empty, it is made from the name and year."
          >
            <input
              id="slug"
              name="slug"
              value={values.slug}
              maxlength={60}
              pattern="[a-z0-9-]{3,60}"
              data-slug-from="name"
              {...invalid("slug")}
            />
          </Field>
          <Field id="modelYear" label="Model year" error={errors.modelYear}>
            <input
              id="modelYear"
              name="modelYear"
              value={values.modelYear}
              required
              maxlength={20}
              {...invalid("modelYear")}
            />
          </Field>
          <Field
            id="sortOrder"
            label="Sort order"
            error={errors.sortOrder}
            hint="Lower comes first."
          >
            <input
              id="sortOrder"
              name="sortOrder"
              type="number"
              step="1"
              value={values.sortOrder}
              {...invalid("sortOrder")}
            />
          </Field>
          <label class="admin-check">
            <input type="checkbox" name="visible" value="1" checked={values.visible} /> Model
            visible on the public site
          </label>

          <fieldset class="admin-fieldset">
            <legend>English manual</legend>
            <p class="muted">Language: English</p>
            <Field id="price" label="Price (ETB)" error={errors.price}>
              <input
                id="price"
                name="price"
                inputmode="decimal"
                value={values.price}
                required
                {...invalid("price")}
              />
            </Field>
            {!isNew && (
              <label class="admin-check">
                <input
                  type="checkbox"
                  name="versionVisible"
                  value="1"
                  checked={values.versionVisible}
                />{" "}
                Manual visible (it can be bought once a PDF is uploaded)
              </label>
            )}
            {!isNew && (
              <p class="muted">PDF: {hasPdf ? "uploaded" : "missing (shows Coming soon)"}</p>
            )}
          </fieldset>

          <button type="submit" class="btn btn-dark">
            {isNew ? "Create model" : "Save changes"}
          </button>
        </form>
      </section>
      {!isNew && <section id="uploads" class="card stack" aria-label="Uploads" />}
      <script type="module" src="/js/admin-slug.js" />
    </>
  );
}
