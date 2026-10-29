import type { AdminCatalogRow } from "../../lib/db/catalog";
import { santimToEtbLabel } from "../../lib/money";

const FLASH: Record<string, string> = { created: "Model created.", saved: "Changes saved." };

export function CatalogList({ rows, flash }: { rows: AdminCatalogRow[]; flash?: string }) {
  const message = flash ? FLASH[flash] : undefined;
  return (
    <section class="card stack" aria-labelledby="catalog-title">
      <div class="admin-head">
        <h1 class="card-title" id="catalog-title">
          Catalog
        </h1>
        <a class="btn btn-dark btn-sm" href="/admin/catalog/new">
          Add model
        </a>
      </div>
      {message && (
        <p class="notice-ok" role="status">
          {message}
        </p>
      )}
      <table class="admin-table">
        <thead>
          <tr>
            <th scope="col">Model</th>
            <th scope="col">Year</th>
            <th scope="col">Visible</th>
            <th scope="col">Sort</th>
            <th scope="col">Price</th>
            <th scope="col">PDF</th>
            <th scope="col">
              <span class="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr>
              <th scope="row">
                {row.name}
                <span class="muted mono admin-slug">{row.slug}</span>
              </th>
              <td>{row.modelYear}</td>
              <td>{row.visible ? "Yes" : "Hidden"}</td>
              <td>{row.sortOrder}</td>
              <td>
                {row.priceSantim === null ? "—" : santimToEtbLabel(row.priceSantim)}
                {row.versionId !== null && !row.versionVisible && " (hidden)"}
              </td>
              <td>{row.hasPdf ? "Uploaded" : "Missing"}</td>
              <td>
                <a href={`/admin/catalog/${row.id}`}>Edit</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
