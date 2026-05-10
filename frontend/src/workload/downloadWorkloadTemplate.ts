import ExcelJS from "exceljs";

export const WORKLOAD_TEMPLATE_FILENAME = "Workload_Template.xlsx";

const PUBLIC_RELATIVE_PATH = `/templates/${WORKLOAD_TEMPLATE_FILENAME}`;

/** Rows to apply validation to (row 1 = header). */
const VALIDATION_ROW_COUNT = 500;

/**
 * Download the workload template from `public/templates/`, inject Excel data
 * validation rules, and return the modified blob.
 *
 * Validation rules applied:
 *  - Column B (Staff Name)   — required (non-empty text)
 *  - Column C (Staff Number) — required, exactly 8 numeric digits
 *  - Column F (HoD Review)   — if value is "Yes" (case-insensitive), Column E must be non-empty
 */
export async function fetchTrimmedWorkloadTemplateBlob(publicUrlPrefix = ""): Promise<Blob> {
  const url = `${publicUrlPrefix}${PUBLIC_RELATIVE_PATH}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Workload template file not available (${response.status}). Expected at public${PUBLIC_RELATIVE_PATH}`
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(arrayBuffer);

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    // Fallback: return raw blob if worksheet is missing
    return new Blob([arrayBuffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  }

  for (let row = 2; row <= VALIDATION_ROW_COUNT + 1; row++) {
    // Column B — Staff Name: must not be blank
    sheet.getCell(`B${row}`).dataValidation = {
      type: "textLength",
      operator: "greaterThan",
      formulae: [0],
      showErrorMessage: true,
      errorStyle: "stop",
      errorTitle: "Missing Staff Name",
      error: "Staff Name (Column B) is required.",
      showInputMessage: true,
      promptTitle: "Staff Name",
      prompt: "Enter the staff member's full name.",
    };

    // Column C — Staff Number: must be exactly 8 numeric digits (10000000–99999999)
    sheet.getCell(`C${row}`).dataValidation = {
      type: "whole",
      operator: "between",
      formulae: [10000000, 99999999],
      showErrorMessage: true,
      errorStyle: "stop",
      errorTitle: "Invalid staff_id",
      error: "staff_id must be exactly 8 digits.",
      showInputMessage: true,
      promptTitle: "Staff Number",
      prompt: "Enter the 8-digit staff number (e.g. 12345678).",
    };

    // Column F — HoD Review: if "Yes", Column E (Notes) must be filled
    sheet.getCell(`F${row}`).dataValidation = {
      type: "custom",
      // Formula adjusts relatively per row: F=YES → E must have content
      formulae: [`OR(UPPER(TRIM(F${row}))<>"YES",LEN(TRIM(E${row}))>0)`],
      showErrorMessage: true,
      errorStyle: "stop",
      errorTitle: "Notes Required",
      error: 'When HoD Review is "Yes", Notes (Column E) must be filled in first.',
    };
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
