"""
End-to-end browser test: Ops import + distribute workflow, then full academic cycle.

Run both tests (fresh data):
    cd /Users/qidicai/Workload/uwa-capstone-group19
    pytest e2e/ --headed --slowmo=800 -v

Run second test only (reuse existing distributed data):
    pytest e2e/ --headed --slowmo=800 -v -k test_open_academic_accounts
"""
import re
from playwright.sync_api import Page, expect

from conftest import BASE_URL, reset_academic_workflow, reset_all_workloads, set_staff_active

EXCEL_PATH = "/Users/qidicai/Documents/Workload_Template (20).xlsx"
PAUSE      = 2_000   # ms between major actions
TAB_SETTLE = 1_000   # ms after bringing a tab to the front
CONFIRMED_CELL_RE = re.compile(r"^\s*(?:✓\s*)?Confirmed\s*$")


# ── helpers ────────────────────────────────────────────────────────────────────

def _ops_distributed_check(ops_page: Page) -> None:
    """Switch to Ops Distributed tab, reload, then show for PAUSE ms."""
    ops_page.bring_to_front()
    ops_page.wait_for_timeout(TAB_SETTLE)
    ops_page.reload()
    ops_page.wait_for_timeout(TAB_SETTLE)
    distributed_btn = ops_page.locator("button", has_text=re.compile(r"Distributed \(\d+\)"))
    expect(distributed_btn.first).to_be_visible(timeout=10_000)
    distributed_btn.first.click()
    ops_page.wait_for_timeout(PAUSE)


def _expect_ops_confirmation(ops_page: Page, staff_name: str) -> None:
    row = ops_page.locator("table tbody tr", has_text=staff_name).first
    expect(row).to_be_visible(timeout=10_000)
    expect(row.locator("td").nth(5)).to_have_text(CONFIRMED_CELL_RE, timeout=10_000)


def _first_row_is_confirmed(page: Page) -> bool:
    text = page.locator("table tbody tr").first.locator("td").nth(5).inner_text().strip()
    return bool(CONFIRMED_CELL_RE.match(text))


def _submit_first_academic_request(page: Page, reason: str) -> None:
    page.bring_to_front()
    page.wait_for_timeout(TAB_SETTLE)
    page.locator("table tbody tr").first.locator("input[type='checkbox']").click()
    page.wait_for_timeout(PAUSE)
    page.get_by_role("button", name="Submit Request").click()
    expect(page.get_by_text("Submit Application")).to_be_visible(timeout=10_000)
    page.locator("textarea").fill(reason)
    with page.expect_response(
        lambda response: (
            "/api/academic/workload-requests/" in response.url
            and response.request.method == "POST"
        ),
        timeout=15_000,
    ) as submit_response:
        page.get_by_role("button", name="Submit", exact=True).click()
    response = submit_response.value
    assert response.ok, f"Submit request failed with {response.status}: {response.text()}"
    expect(page.locator("table tbody tr").first.locator("td").nth(3).get_by_text("Pending")).to_be_visible(timeout=15_000)
    page.wait_for_timeout(PAUSE)


def _confirm_workload(page: Page) -> None:
    """
    Open the workload detail modal, click Confirmed → Yes, Confirm,
    wait 3 s so the confirmed state is visible.
    """
    page.bring_to_front()
    page.wait_for_timeout(TAB_SETTLE)
    page.locator("table tbody tr").first.locator("td").nth(2).click()
    # Wait for the modal to finish loading (async API call before setDetailId)
    confirmed_btn = page.get_by_role("button", name=re.compile(r"^Confirmed$"))
    expect(confirmed_btn).to_be_visible(timeout=15_000)
    # Scroll the modal's inner overflow container to the bottom so the button is fully in view
    page.evaluate("() => { const el = document.querySelector('.overflow-y-auto'); if (el) el.scrollTop = el.scrollHeight; }")
    page.wait_for_timeout(PAUSE)
    with page.expect_response(
        lambda response: (
            "/api/academic/workloads/" in response.url
            and response.url.endswith("/confirm/")
            and response.request.method == "POST"
        ),
        timeout=15_000,
    ) as confirm_response:
        page.evaluate("""
            () => new Promise((resolve, reject) => {
                const buttonLabel = (button) => button.textContent.replace(/\\s+/g, ' ').trim();
                const visibleEnabled = (button) => {
                    const style = window.getComputedStyle(button);
                    return !button.disabled && style.visibility !== 'hidden' && style.display !== 'none';
                };
                const findButton = (matcher) => Array.from(document.querySelectorAll('button'))
                    .find((button) => visibleEnabled(button) && matcher(buttonLabel(button)));

                const confirmed = findButton((label) => label === 'Confirmed');
                if (!confirmed) {
                    reject(new Error('Confirmed button not found'));
                    return;
                }
                confirmed.click();

                const started = Date.now();
                const timer = setInterval(() => {
                    const yes = findButton((label) => /^Yes\\s*,?\\s*Confirm$/i.test(label));
                    if (yes) {
                        clearInterval(timer);
                        yes.click();
                        resolve(true);
                        return;
                    }
                    if (Date.now() - started > 5000) {
                        clearInterval(timer);
                        const labels = Array.from(document.querySelectorAll('button')).map(buttonLabel);
                        reject(new Error(`Yes, Confirm button not found. Buttons: ${labels.join(' | ')}`));
                    }
                }, 50);
            })
        """)

    response = confirm_response.value
    assert response.ok, f"Confirm workload failed with {response.status}: {response.text()}"
    page.reload()
    expect(page.locator("table tbody tr").first.locator("td").nth(5)).to_have_text(CONFIRMED_CELL_RE, timeout=15_000)
    page.wait_for_timeout(PAUSE)  # see Confirmed state for 3 s
    # Yes, Confirm closes both the sub-dialog and detail modal automatically


def _open_hod_dashboard_from_role(page: Page) -> None:
    page.bring_to_front()
    page.wait_for_timeout(TAB_SETTLE)
    page.goto(f"{BASE_URL}/role")
    expect(page.get_by_text("Welcome, Rachel Li")).to_be_visible(timeout=15_000)
    expect(page.get_by_text("Computer Science & Software Engineering")).to_be_visible(timeout=15_000)
    page.get_by_role("button", name=re.compile(r"Review Department Workloads")).click()
    expect(page).to_have_url(re.compile(r"/department-head"), timeout=15_000)
    expect(page.get_by_text("HoD Dashboard")).to_be_visible(timeout=15_000)
    page.wait_for_timeout(PAUSE)


def _open_hod_academic_workload_from_role(page: Page) -> None:
    page.bring_to_front()
    page.wait_for_timeout(TAB_SETTLE)
    page.go_back()
    expect(page).to_have_url(re.compile(r"/role"), timeout=15_000)
    expect(page.get_by_text("Welcome, Rachel Li")).to_be_visible(timeout=15_000)
    page.wait_for_timeout(PAUSE)
    page.get_by_role("button", name=re.compile(r"Review My Workload")).click()
    expect(page).to_have_url(re.compile(r"/workload-platform"), timeout=15_000)
    expect(page.get_by_text("Academic Dashboard")).to_be_visible(timeout=15_000)
    row = page.locator("table tbody tr", has_text="Rachel Li").first
    expect(row).to_be_visible(timeout=15_000)
    expect(row.locator("td").nth(2)).to_contain_text("Rachel Li", timeout=15_000)
    page.wait_for_timeout(PAUSE)


def _hos_reject_rachel_request(hos_page: Page) -> None:
    hos_page.bring_to_front()
    hos_page.wait_for_timeout(TAB_SETTLE)
    hos_page.goto(f"{BASE_URL}/school-head")
    expect(hos_page.get_by_text("HoS Dashboard")).to_be_visible(timeout=15_000)
    hos_page.wait_for_timeout(PAUSE)

    pending_btn = hos_page.get_by_role("button", name=re.compile(r"Pending"))
    expect(pending_btn).to_be_visible(timeout=10_000)
    pending_btn.click()

    row = hos_page.locator("table tbody tr", has_text="Rachel Li").first
    expect(row).to_be_visible(timeout=15_000)
    expect(row.locator("td").nth(4)).to_contain_text("plz check", timeout=15_000)
    row.click()

    expect(hos_page.get_by_text("Application Reasons")).to_be_visible(timeout=10_000)
    expect(hos_page.get_by_text("plz check")).to_be_visible(timeout=10_000)
    hos_page.get_by_role("button", name="Decline").click()
    expect(hos_page.get_by_text("Rejected Notes")).to_be_visible(timeout=10_000)
    hos_page.get_by_placeholder("Write your feedback...").fill("which one?")
    with hos_page.expect_response(
        lambda response: (
            "/api/hos/workload-requests/" in response.url
            and response.url.endswith("/decision/")
            and response.request.method == "POST"
        ),
        timeout=15_000,
    ) as reject_response:
        hos_page.get_by_role("button", name="Finished").click()
    response = reject_response.value
    assert response.ok, f"HoS reject failed with {response.status}: {response.text()}"

    completed = hos_page.get_by_role("button", name="Rejection Completed")
    if completed.count() > 0:
        completed.first.click()
    hos_page.wait_for_timeout(PAUSE)


def _hos_approve_rachel_with_computer_science_leader(hos_page: Page) -> None:
    hos_page.bring_to_front()
    hos_page.wait_for_timeout(TAB_SETTLE)
    hos_page.goto(f"{BASE_URL}/school-head")
    expect(hos_page.get_by_text("HoS Dashboard")).to_be_visible(timeout=15_000)
    hos_page.wait_for_timeout(PAUSE)

    pending_btn = hos_page.get_by_role("button", name=re.compile(r"Pending"))
    expect(pending_btn).to_be_visible(timeout=10_000)
    pending_btn.click()

    row = hos_page.locator("table tbody tr", has_text="Rachel Li").first
    expect(row).to_be_visible(timeout=15_000)
    expect(row.locator("td").nth(4)).to_contain_text("plz add computer science leader 50 hours", timeout=15_000)
    row.click()

    expect(hos_page.get_by_text("Application Reasons")).to_be_visible(timeout=10_000)
    expect(hos_page.get_by_text("plz add computer science leader 50 hours")).to_be_visible(timeout=10_000)
    hos_page.get_by_role("button", name="Assigned Roles").click()
    hos_page.wait_for_timeout(1_000)
    hos_page.get_by_role("button", name="Edit").click()
    hos_page.wait_for_timeout(1_000)
    hos_page.get_by_role("button", name="+ Add Row").click()

    inputs = hos_page.locator("tbody input")
    expect(inputs.first).to_be_visible(timeout=10_000)
    input_count = inputs.count()
    assert input_count >= 2, "Expected editable Assigned Roles inputs after adding a row"
    inputs.nth(input_count - 2).fill("Computer Science College Chair")
    inputs.nth(input_count - 1).fill("50")
    hos_page.wait_for_timeout(PAUSE)

    hos_page.get_by_role("button", name="Done").click()
    hos_page.wait_for_timeout(PAUSE)
    expect(hos_page.get_by_text("Computer Science College Chair")).to_be_visible(timeout=10_000)

    hos_page.get_by_role("button", name="Approve", exact=True).click()
    expect(hos_page.get_by_text("Approved Notes")).to_be_visible(timeout=10_000)
    hos_page.get_by_placeholder("Write your feedback...").fill("Assigned roles updated and workload approved")
    with hos_page.expect_response(
        lambda response: (
            "/api/hos/workload-requests/" in response.url
            and response.url.endswith("/decision/")
            and response.request.method == "POST"
        ),
        timeout=15_000,
    ) as approve_response:
        hos_page.get_by_role("button", name="Finished").click()
    response = approve_response.value
    assert response.ok, f"HoS approve failed with {response.status}: {response.text()}"

    completed = hos_page.get_by_role("button", name="Approval Completed")
    if completed.count() > 0:
        completed.first.click()
    hos_page.wait_for_timeout(PAUSE)


# ── Test 1: Import & Distribute ───────────────────────────────────────────────

def test_ops_import_and_distribute(ops_page: Page) -> None:
    reset_all_workloads()

    page = ops_page

    page.bring_to_front()
    page.wait_for_timeout(TAB_SETTLE)
    page.goto(f"{BASE_URL}/school-operations")
    expect(page.get_by_text("School Operations Dashboard")).to_be_visible()
    page.wait_for_timeout(PAUSE)

    with page.expect_file_chooser() as fc:
        page.get_by_role("button", name="Import Workload").click()
    fc.value.set_files(EXCEL_PATH)

    expect(page.get_by_text("Import Completed Summary")).to_be_visible(timeout=30_000)
    page.wait_for_timeout(PAUSE)

    view_btn = page.locator("button", has_text=re.compile(r"View Invalid Records"))
    if view_btn.count() > 0:
        view_btn.first.click()
        expect(page.locator("text=/Invalid Records.*error/")).to_be_visible()
        page.wait_for_timeout(PAUSE)
        page.locator('[aria-label="Close"]').last.click()
        page.wait_for_timeout(PAUSE)

    expect(page.get_by_text("4/4 (100%)")).to_be_visible(timeout=10_000)
    enter_pending_btn = page.get_by_role("button", name="Enter Pending List")
    expect(enter_pending_btn).to_be_enabled(timeout=10_000)
    review_again_btn = page.get_by_role("button", name="Review Excel Again")
    expect(review_again_btn).to_be_visible(timeout=10_000)

    enter_pending_btn.click()
    expect(page.get_by_text("Import Completed Summary")).not_to_be_visible(timeout=15_000)
    page.wait_for_timeout(PAUSE)

    pending_btn = page.locator("button", has_text=re.compile(r"Pending Distribution"))
    expect(pending_btn).to_be_visible()
    pending_text = pending_btn.inner_text()
    count = int(re.search(r"\((\d+)\)", pending_text).group(1))
    assert count > 0, f"Expected pending items after import, got: {pending_text}"
    page.wait_for_timeout(PAUSE)

    page.get_by_label("Select all pending").click()
    page.wait_for_timeout(PAUSE)

    page.get_by_role("button", name="Distribute Workload").click()
    expect(page.locator("div.text-base.font-bold", has_text="Distribute Workload")).to_be_visible()
    page.wait_for_timeout(PAUSE)

    page.get_by_role("button", name="Confirm").click()

    distributed_btn = page.locator("button", has_text=re.compile(r"Distributed \([1-9]"))
    expect(distributed_btn).to_be_visible(timeout=60_000)
    page.wait_for_timeout(PAUSE)

    success_overlay = page.locator("div.fixed.inset-0")
    if success_overlay.count() > 0:
        close_btn = success_overlay.locator('[aria-label="Close"]')
        if close_btn.count() > 0:
            close_btn.first.click()
        else:
            success_overlay.first.click(position={"x": 10, "y": 10})
        page.wait_for_timeout(1_000)

    distributed_btn.click()
    page.wait_for_timeout(PAUSE)
    assert page.locator("button", has_text=re.compile(r"Distributed \([1-9]")).is_visible()
    page.wait_for_timeout(PAUSE)


# ── Test 2: Full academic workflow ────────────────────────────────────────────

def test_open_academic_accounts(
    ops_page: Page,
    doe_john_page: Page,
    patel_lina_page: Page,
    dias_jack_page: Page,
    hod_page: Page,
    hos_page: Page,
) -> None:
    """
    Full academic cycle:
      John self-confirms and closes his tab.
      Jack and Lina submit requests.
      Rachel Li enters HoD mode, approves Jack and Lina.
      Jack and Lina self-confirm after approval.
      Rachel Li enters Academic mode, submits her own workload to HoS.
      HoS rejects Rachel's unclear request.
      Rachel resubmits with the missing role details.
      HoS edits Assigned Roles, approves, Rachel self-confirms.
      Ops verifies all distributed workloads are confirmed.
    """

    # Reset so this test is idempotent (can be re-run without first test)
    reset_academic_workflow([
        "211528745@qq.com",       # Doe John
        "stitchy.cai@gmail.com",  # Patel Lina
        "2079674537@qq.com",      # Dias Jack
        "mrcaiqidi@outlook.com",  # Rachel Li (HoD self-workload)
    ])

    # ── 0. Open Ops → Distributed tab ────────────────────────────────────────
    ops_page.bring_to_front()
    ops_page.wait_for_timeout(TAB_SETTLE)
    ops_page.goto(f"{BASE_URL}/school-operations")
    expect(ops_page.get_by_text("School Operations Dashboard")).to_be_visible()
    ops_page.wait_for_timeout(1_000)
    ops_page.locator("button", has_text=re.compile(r"Distributed \(\d+\)")).first.click()
    ops_page.wait_for_timeout(PAUSE)

    # ── 1. Doe John: self-confirm ─────────────────────────────────────────────
    doe_john_page.bring_to_front()
    doe_john_page.wait_for_timeout(TAB_SETTLE)
    doe_john_page.goto(f"{BASE_URL}/workload-platform")
    expect(doe_john_page).to_have_url(re.compile(r"/workload-platform"), timeout=15_000)
    doe_john_page.wait_for_timeout(PAUSE)

    already_confirmed = _first_row_is_confirmed(doe_john_page)
    if not already_confirmed:
        _confirm_workload(doe_john_page)

    doe_john_page.close()

    # Ops check: John confirmed → Distributed tab
    _ops_distributed_check(ops_page)
    _expect_ops_confirmation(ops_page, "Doe John")

    # ── 2. Dias Jack: submit request via UI ──────────────────────────────────
    dias_jack_page.bring_to_front()
    dias_jack_page.wait_for_timeout(TAB_SETTLE)
    dias_jack_page.goto(f"{BASE_URL}/workload-platform")
    expect(dias_jack_page).to_have_url(re.compile(r"/workload-platform"), timeout=15_000)
    dias_jack_page.wait_for_timeout(PAUSE)

    jack_pending = dias_jack_page.locator("table tbody tr").first.locator("td").nth(3).get_by_text("Pending").count() > 0
    if not jack_pending:
        _submit_first_academic_request(dias_jack_page, "Check course name plz")

    # Ops check: Jack initial → pending
    _ops_distributed_check(ops_page)

    # ── 3. Patel Lina: submit request via UI ─────────────────────────────────
    patel_lina_page.bring_to_front()
    patel_lina_page.wait_for_timeout(TAB_SETTLE)
    patel_lina_page.goto(f"{BASE_URL}/workload-platform")
    expect(patel_lina_page).to_have_url(re.compile(r"/workload-platform"), timeout=15_000)
    patel_lina_page.wait_for_timeout(PAUSE)

    lina_pending = patel_lina_page.locator("table tbody tr").first.locator("td").nth(3).get_by_text("Pending").count() > 0
    if not lina_pending:
        _submit_first_academic_request(patel_lina_page, "Check CITS2200 hours plz")

    # Ops check: Lina initial → pending
    _ops_distributed_check(ops_page)

    # ── 4. Rachel Li: enter HoD role and approve Jack ────────────────────────
    _open_hod_dashboard_from_role(hod_page)

    for _ in range(3):
        if hod_page.locator("table tbody tr", has_text="Dias Jack").count() > 0:
            break
        hod_page.reload()
        hod_page.wait_for_timeout(PAUSE)

    hod_page.locator("table tbody tr", has_text="Dias Jack").first.click()
    expect(hod_page.get_by_text("CITS2002")).to_be_visible(timeout=10_000)
    hod_page.wait_for_timeout(PAUSE)

    hod_page.get_by_role("button", name="Edit").click()
    hod_page.wait_for_timeout(1_000)

    course_input = hod_page.locator("input[value='CITS2002']")
    course_input.click(click_count=3)
    course_input.fill("CITS2020")
    hod_page.wait_for_timeout(PAUSE)

    hod_page.get_by_role("button", name="Done").click()
    hod_page.wait_for_timeout(PAUSE)

    hod_page.get_by_role("button", name="Approve", exact=True).click()
    expect(hod_page.get_by_text("Approved Notes")).to_be_visible(timeout=10_000)
    hod_page.wait_for_timeout(1_000)
    hod_page.get_by_placeholder("Write your feedback...").fill("Changed course code to CITS2020 as requested")
    hod_page.get_by_role("button", name="Finished").click()
    hod_page.wait_for_timeout(PAUSE)

    # ── 5. Rachel Li: approve Lina (CITS2200 hours → 200) ────────────────────
    hod_page.bring_to_front()
    for _ in range(3):
        if hod_page.locator("table tbody tr", has_text="Patel Lina").count() > 0:
            break
        hod_page.reload()
        hod_page.wait_for_timeout(PAUSE)

    hod_page.locator("table tbody tr", has_text="Patel Lina").first.click()
    expect(hod_page.get_by_role("cell", name="CITS2200", exact=True)).to_be_visible(timeout=10_000)
    hod_page.wait_for_timeout(PAUSE)

    hod_page.get_by_role("button", name="Edit").click()
    hod_page.wait_for_timeout(1_000)

    hours_input = hod_page.locator("tr").filter(
        has=hod_page.locator("input[value='CITS2200']")
    ).locator("input[inputmode='decimal']")
    hours_input.click(click_count=3)
    hours_input.fill("200")
    hod_page.wait_for_timeout(PAUSE)

    hod_page.get_by_role("button", name="Done").click()
    hod_page.wait_for_timeout(PAUSE)

    hod_page.get_by_role("button", name="Approve", exact=True).click()
    expect(hod_page.get_by_text("Approved Notes")).to_be_visible(timeout=10_000)
    hod_page.wait_for_timeout(1_000)
    hod_page.get_by_placeholder("Write your feedback...").fill("Confirmed CITS2200 hours changed to 200")
    hod_page.get_by_role("button", name="Finished").click()
    hod_page.wait_for_timeout(PAUSE)

    # ── 6. Dias Jack: self-confirm after HoD approval ────────────────────────
    dias_jack_page.bring_to_front()
    dias_jack_page.wait_for_timeout(TAB_SETTLE)
    for _ in range(5):
        dias_jack_page.reload()
        dias_jack_page.wait_for_timeout(2_000)
        if dias_jack_page.locator("table tbody tr").first.get_by_text("Approved", exact=True).count() > 0:
            break
    dias_jack_page.wait_for_timeout(PAUSE)

    jack_confirmed = _first_row_is_confirmed(dias_jack_page)
    if not jack_confirmed:
        _confirm_workload(dias_jack_page)

    dias_jack_page.close()

    # Ops check: Jack confirmed → Distributed tab
    _ops_distributed_check(ops_page)
    _expect_ops_confirmation(ops_page, "Dias Jack")

    # ── 7. Patel Lina: self-confirm after HoD approval ───────────────────────
    patel_lina_page.bring_to_front()
    patel_lina_page.wait_for_timeout(TAB_SETTLE)
    for _ in range(5):
        patel_lina_page.reload()
        patel_lina_page.wait_for_timeout(2_000)
        if patel_lina_page.locator("table tbody tr").first.get_by_text("Approved", exact=True).count() > 0:
            break
    patel_lina_page.wait_for_timeout(PAUSE)

    lina_confirmed = _first_row_is_confirmed(patel_lina_page)
    if not lina_confirmed:
        _confirm_workload(patel_lina_page)

    patel_lina_page.close()

    # Final Ops check: Lina confirmed → Distributed tab
    _ops_distributed_check(ops_page)
    _expect_ops_confirmation(ops_page, "Dias Jack")
    _expect_ops_confirmation(ops_page, "Patel Lina")

    # ── 8. Rachel Li: Academic role submits own workload to HoS ──────────────
    _open_hod_academic_workload_from_role(hod_page)
    rachel_pending = hod_page.locator("table tbody tr").first.locator("td").nth(3).get_by_text("Pending").count() > 0
    if not rachel_pending:
        _submit_first_academic_request(hod_page, "plz check")

    # ── 9. HoS: sees Rachel's reason and rejects with note ───────────────────
    _hos_reject_rachel_request(hos_page)

    # ── 10. Rachel Li: sees rejected status in Academic workload page ────────
    hod_page.bring_to_front()
    hod_page.wait_for_timeout(TAB_SETTLE)
    for _ in range(5):
        hod_page.reload()
        hod_page.wait_for_timeout(2_000)
        if hod_page.locator("table tbody tr").first.get_by_text("Rejected", exact=True).count() > 0:
            break
    expect(hod_page.locator("table tbody tr").first.locator("td").nth(3).get_by_text("Rejected")).to_be_visible(timeout=15_000)
    hod_page.wait_for_timeout(PAUSE)

    # ── 11. Rachel Li: resubmits with clear assigned-role details ────────────
    _submit_first_academic_request(hod_page, "plz add computer science leader 50 hours")

    # ── 12. HoS: edit Assigned Roles, add 50 hours, then approve ─────────────
    _hos_approve_rachel_with_computer_science_leader(hos_page)

    # ── 13. Rachel Li: receives approved status and self-confirms ────────────
    hod_page.bring_to_front()
    hod_page.wait_for_timeout(TAB_SETTLE)
    for _ in range(5):
        hod_page.reload()
        hod_page.wait_for_timeout(2_000)
        if hod_page.locator("table tbody tr").first.get_by_text("Approved", exact=True).count() > 0:
            break
    expect(hod_page.locator("table tbody tr").first.locator("td").nth(3).get_by_text("Approved")).to_be_visible(timeout=15_000)
    hod_page.wait_for_timeout(PAUSE)

    rachel_confirmed = _first_row_is_confirmed(hod_page)
    if not rachel_confirmed:
        _confirm_workload(hod_page)
    hod_page.close()

    # ── 14. Ops: final confirmation check for all distributed workloads ──────
    _ops_distributed_check(ops_page)
    _expect_ops_confirmation(ops_page, "Rachel Li")
    _expect_ops_confirmation(ops_page, "Dias Jack")
    _expect_ops_confirmation(ops_page, "Doe John")
    _expect_ops_confirmation(ops_page, "Patel Lina")
    ops_page.wait_for_timeout(PAUSE)
    ops_page.close()


# ── Test 3: Partial distribution failure → Failed tab ────────────────────────

def test_ops_distribution_failure_shows_failed_list(ops_page: Page) -> None:
    """
    Import a clean workbook, then force one selected workload to fail during
    distribution so School Ops lands on the Failed tab with that row visible.
    """
    reset_all_workloads()

    page = ops_page
    forced_failed_staff = "22222221"  # Doe John

    try:
        page.goto(f"{BASE_URL}/school-operations")
        expect(page.get_by_text("School Operations Dashboard")).to_be_visible()
        page.wait_for_timeout(PAUSE)

        with page.expect_file_chooser() as fc:
            page.get_by_role("button", name="Import Workload").click()
        fc.value.set_files(EXCEL_PATH)

        expect(page.get_by_text("Import Completed Summary")).to_be_visible(timeout=30_000)
        page.wait_for_timeout(PAUSE)

        expect(page.get_by_text("4/4 (100%)")).to_be_visible(timeout=10_000)
        enter_pending_btn = page.get_by_role("button", name="Enter Pending List")
        expect(enter_pending_btn).to_be_enabled(timeout=10_000)
        enter_pending_btn.click()
        expect(page.get_by_text("Import Completed Summary")).not_to_be_visible(timeout=15_000)
        page.wait_for_timeout(PAUSE)

        pending_btn = page.locator("button", has_text=re.compile(r"Pending Distribution"))
        expect(pending_btn).to_be_visible()
        expect(pending_btn).to_have_text(re.compile(r"Pending Distribution \(4\)"), timeout=10_000)

        # Force one backend validation failure without breaking the other rows.
        set_staff_active(forced_failed_staff, False)

        page.get_by_label("Select all pending").click()
        page.wait_for_timeout(PAUSE)

        page.get_by_role("button", name="Distribute Workload").click()
        expect(page.locator("div.text-base.font-bold", has_text="Distribute Workload")).to_be_visible()
        page.wait_for_timeout(PAUSE)
        page.get_by_role("button", name="Confirm").click()

        failed_btn = page.locator("button", has_text=re.compile(r"Failed \([1-9]\d*\)"))
        expect(failed_btn).to_be_visible(timeout=60_000)
        expect(failed_btn).to_contain_text("Failed (1)", timeout=10_000)

        # After partial failure the page auto-switches to the Failed tab.
        failed_row = page.locator("table tbody tr", has_text="Doe John").first
        expect(failed_row).to_be_visible(timeout=15_000)
        expect(page.locator("table tbody tr").filter(has_text="Doe John")).to_have_count(1, timeout=10_000)
        expect(page.get_by_role("button", name="Export failed tasks")).to_be_visible(timeout=10_000)
        page.wait_for_timeout(PAUSE)
    finally:
        set_staff_active(forced_failed_staff, True)
