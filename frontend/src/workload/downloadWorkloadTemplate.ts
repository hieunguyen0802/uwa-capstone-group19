export const WORKLOAD_TEMPLATE_FILENAME = "Workload_Template.xlsx";

const PUBLIC_RELATIVE_PATH = `/templates/${WORKLOAD_TEMPLATE_FILENAME}`;

/**
 * Download the workload template from `public/templates/`.
 * The committed `.xlsx` is header-only (no sample rows) and is **not** re-written in the browser,
 * so Excel does not show repair warnings from an extra save round-trip.
 */
export async function fetchTrimmedWorkloadTemplateBlob(publicUrlPrefix = ""): Promise<Blob> {
  const url = `${publicUrlPrefix}${PUBLIC_RELATIVE_PATH}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Workload template file not available (${response.status}). Expected at public${PUBLIC_RELATIVE_PATH}`);
  }
  return response.blob();
}
