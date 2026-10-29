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

/** Current files for the upload controls (edit page only). */
export type UploadState = {
  versionId: number | null;
  pdfKey: string | null;
  pdfSize: number | null;
  imageKey: string | null;
};

function sizeLabel(bytes: number | null): string {
  if (bytes === null) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileName(key: string | null): string {
  return key ? (key.split("/").pop() ?? key) : "";
}

function UploadControl({
  id,
  label,
  url,
  accept,
  current,
  hint,
}: {
  id: string;
  label: string;
  url: string;
  accept: string;
  current: string | null;
  hint: string;
}) {
  return (
    <div class="admin-field admin-upload">
      <label for={id}>{current ? `Replace ${label}` : `Upload ${label}`}</label>
      <p class="muted">{current ? `Current: ${current}` : `No ${label} yet.`}</p>
      <input id={id} type="file" accept={accept} data-upload-url={url} />
      <span class="field-hint">{hint}</span>
      <progress class="admin-progress" max="100" value="0" hidden />
      <span class="admin-upload__status" aria-live="polite" />
    </div>
  );
}

function Uploads({ modelId, uploads }: { modelId: number; uploads: UploadState }) {
  const pdf = uploads.pdfKey ? `${fileName(uploads.pdfKey)} (${sizeLabel(uploads.pdfSize)})` : null;
  return (
    <section id="uploads" class="card stack" aria-labelledby="uploads-title">
      <h2 class="card-title" id="uploads-title">
        Files
      </h2>
      {uploads.versionId === null ? (
        <p class="muted">Save a price first to create the English manual, then upload its PDF.</p>
      ) : (
        <UploadControl
          id="upload-pdf"
          label="PDF"
          url={`/admin/uploads/manual/${uploads.versionId}`}
          accept="application/pdf,.pdf"
          current={pdf}
          hint="PDF, up to 100 MB. The manual can be bought as soon as it is uploaded."
        />
      )}
      <UploadControl
        id="upload-image"
        label="car image"
        url={`/admin/uploads/image/${modelId}`}
        accept="image/jpeg,image/png,image/webp"
        current={uploads.imageKey ? fileName(uploads.imageKey) : null}
        hint="JPEG, PNG or WebP, up to 5 MB. Shown on the catalog card."
      />
      <noscript>
        <p class="field-hint">Uploading needs JavaScript.</p>
      </noscript>
    </section>
  );
}

export function CatalogEdit({
  modelId,
  values,
  errors = {},
  hasPdf = false,
  uploads,
}: {
  /** null = new model. */
  modelId: number | null;
  values: CatalogFormValues;
  errors?: CatalogFormErrors;
  hasPdf?: boolean;
  uploads?: UploadState;
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
      {!isNew && uploads && <Uploads modelId={modelId} uploads={uploads} />}
      <script type="module" src="/js/admin-slug.js" />
      {!isNew && <script type="module" src="/js/admin-upload.js" />}
    </>
  );
}
