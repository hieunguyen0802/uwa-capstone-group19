/**
 * School of Operations contact: in-app message + email notification.
 * Backend: implement the HTTP handler and point `submitContactSchoolOfOperations` at it.
 */

export type ContactSchoolOfOperationsSender = {
  employeeId: string;
  surname: string;
  firstName: string;
  email?: string;
};

export type ContactSchoolOfOperationsPayload = {
  /** Plain-text message from the academic user */
  messageBody: string;
  sender: ContactSchoolOfOperationsSender;
};

export type ContactSchoolOfOperationsResult = {
  ok: boolean;
  /** Optional id from messaging / ticketing system */
  referenceId?: string;
};

// const API_BASE = process.env.REACT_APP_API_BASE_URL ?? "";

/**
 * Sends the message to School of Operations and triggers the operational email workflow.
 *
 * Expected backend contract (adjust path and auth as needed):
 * `POST /api/academic/contact-school-of-operations`
 * Body: JSON matching {@link ContactSchoolOfOperationsPayload}
 * Response: JSON matching {@link ContactSchoolOfOperationsResult}
 */
export async function submitContactSchoolOfOperations(
  payload: ContactSchoolOfOperationsPayload
): Promise<ContactSchoolOfOperationsResult> {
  // TODO(backend): replace stub with real request, e.g.:
  // const response = await fetch(`${API_BASE}/api/academic/contact-school-of-operations`, {
  //   method: "POST",
  //   headers: {
  //     "Content-Type": "application/json",
  //     // Authorization: `Bearer ${token}`,
  //   },
  //   body: JSON.stringify(payload),
  // });
  // if (!response.ok) {
  //   const detail = await response.text();
  //   throw new Error(detail || `Request failed (${response.status})`);
  // }
  // return (await response.json()) as ContactSchoolOfOperationsResult;

  console.info("[submitContactSchoolOfOperations] stub — wire to backend:", payload);
  return { ok: true, referenceId: "stub" };
}
