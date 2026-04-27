import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Label,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import DashboardHeader from "../components/common/DashboardHeader";
import FilterFormRow from "../components/common/FilterFormRow";
import InfoField from "../components/common/InfoField";
import PaginationControls from "../components/common/PaginationControls";
import ProfileModal from "../components/common/ProfileModal";
import SearchButton from "../components/common/SearchButton";
import SectionTabs from "../components/common/SectionTabs";
import SectionTitleBlock from "../components/common/SectionTitleBlock";
import StaffProfileModal, { type StaffProfileDraft } from "../components/common/StaffProfileModal";
import StatusPill from "../components/common/StatusPill";
import TemplateImportExportActions from "../components/common/TemplateImportExportActions";
import WorkHoursBadge from "../components/common/WorkHoursBadge";

type MockRequest = {
  id: number;
  studentId: string;
  semesterLabel: string;
  periodLabel: string;
  name: string;
  unit: string;
  description: string;
  requestReason?: string;
  title: string;
  department: string;
  rate: number;
  status: "pending" | "approved" | "rejected";
  hours: number;
  supervisorNote?: string;
};

type BreakdownCategory = "Teaching" | "Assigned Roles" | "HDR" | "Service";
type BreakdownEntry = { name: string; hours: number };
type BreakdownData = Record<BreakdownCategory, BreakdownEntry[]>;

const SUPERVISOR_DRAFT_KEY = "academic_to_supervisor_requests_v1";
const SUPERVISOR_STATE_KEY = "supervisor_requests_state_v1";
const ACADEMIC_STATUS_SYNC_KEY = "academic_status_sync_v1";
const ACADEMIC_NOTES_SYNC_KEY = "academic_notes_sync_v1";
const SUPERVISOR_SYNC_EVENT = "supervisor-status-updated";
const ACADEMIC_DRAFT_EVENT = "academic-drafts-updated";

function submittedTimeById(id: number) {
  const day = ((id - 1) % 28) + 1;
  const hour = 8 + (id % 9);
  return `2026-03-${String(day).padStart(2, "0")} ${String(hour).padStart(2, "0")}:00`;
}

function modifiedTimeById(id: number) {
  const day = ((id + 1) % 28) + 1;
  const hour = 9 + (id % 8);
  return `2026-03-${String(day).padStart(2, "0")} ${String(hour).padStart(2, "0")}:30`;
}

function readAcademicDrafts(): MockRequest[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SUPERVISOR_DRAFT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as MockRequest[];
  } catch {
    return [];
  }
}

function consumeAcademicDrafts(): MockRequest[] {
  if (typeof window === "undefined") return [];
  const drafts = readAcademicDrafts();
  window.localStorage.removeItem(SUPERVISOR_DRAFT_KEY);
  return drafts;
}

function readSupervisorState(): MockRequest[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SUPERVISOR_STATE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as MockRequest[];
  } catch {
    return [];
  }
}

function mergeDraftsIntoRequests(current: MockRequest[], drafts: MockRequest[]) {
  if (!drafts.length) return current;
  const existingIds = new Set(current.map((row) => row.id));
  const incoming = drafts.filter((row) => !existingIds.has(row.id));
  if (!incoming.length) return current;
  return [...incoming, ...current];
}

function breakdownById(id: number): BreakdownData {
  const patterns: BreakdownData[] = [
    {
      Teaching: [
        { name: "CITS2401", hours: 15 },
        { name: "CITS2200", hours: 5 },
      ],
      "Assigned Roles": [
        { name: "Program Chair", hours: 20 },
        { name: "Outreach Chair", hours: 10 },
      ],
      HDR: [
        { name: "Student A", hours: 2 },
        { name: "Student B", hours: 2 },
      ],
      Service: [{ name: "Committee support", hours: 10 }],
    },
    {
      Teaching: [{ name: "CITS3002", hours: 15 }],
      "Assigned Roles": [{ name: "Industry liaison", hours: 6 }],
      HDR: [
        { name: "Student D", hours: 3 },
        { name: "Student E", hours: 2 },
      ],
      Service: [{ name: "Peer review", hours: 4 }],
    },
  ];
  return patterns[id % patterns.length];
}

function extractRequestReason(description: string) {
  const marker = "Request reason:";
  const idx = description.indexOf(marker);
  if (idx === -1) return "";
  return description.slice(idx + marker.length).trim();
}

function cleanDescription(description: string) {
  const marker = "Request reason:";
  const idx = description.indexOf(marker);
  if (idx === -1) return description;
  return description.slice(0, idx).trim();
}

function shortDepartmentName(department: string) {
  if (department === "Computer Science & Software Engineering") return "CS&SE";
  if (department === "Mathematics & Statistics") return "Math&Stats";
  return department;
}

function departmentHighlightClass(department: string, isTop: boolean) {
  if (!isTop) return "bg-white font-semibold text-[#1f3b86]";
  if (department === "Computer Science & Software Engineering") return "bg-[#1f3b86] font-bold text-white";
  if (department === "Mathematics & Statistics") return "bg-[#4f75cf] font-bold text-white";
  return "bg-[#a9c4f7] font-bold text-[#0f172a]";
}

function maxValue(values: number[]) {
  if (values.length === 0) return Number.NEGATIVE_INFINITY;
  return Math.max(...values);
}

export default function Admin() {
  type ChatMessage = {
    sender: "Sam" | "Admin";
    message: string;
    time: string;
    date: string;
  };
  type AssignRole = "HoD" | "Admin";
  type AssignDepartment =
    | "Physics"
    | "Mathematics & Statistics"
    | "Computer Science & Software Engineering"
    | "Senior School Coordinator";
  type AssignablePerson = {
    id: number;
    staffId: string;
    firstName: string;
    lastName: string;
    email: string;
    title: string;
    currentDepartment: string;
    isActive: boolean;
  };
  type RoleAssignment = {
    id: number;
    staffId: string;
    name: string;
    role: AssignRole;
    department: AssignDepartment;
    permissions: string[];
    assignedAt: string;
    status: "active" | "disabled";
  };

  const user = {
    surname: "Sam",
    firstName: "Yaka",
    employeeId: "2345678",
    title: "Head of School",
    department: "School of Physics, Mathematics and Computing",
  };

  const [hasNewMessage, setHasNewMessage] = useState(true);
  const [messagePanelOpen, setMessagePanelOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [avatarSrc, setAvatarSrc] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([
    { sender: "Sam", message: "I have a question about workload item #11.", time: "09:10", date: "2026-04-22" },
    { sender: "Admin", message: "Please check the teaching hours again.", time: "09:16", date: "2026-04-22" },
    { sender: "Sam", message: "Thank you, I will update it.", time: "09:18", date: "2026-04-23" },
  ]);
  const [selectedChatDate, setSelectedChatDate] = useState("2026-04-23");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState("2026-04");
  const [activeSection, setActiveSection] = useState<
    "approval" | "admin" | "visualization" | "export"
  >("approval");
  const sectionTabs = [
    { key: "approval", label: "Workload Management" },
    { key: "admin", label: "Employee Management" },
    { key: "visualization", label: "Visualization" },
    { key: "export", label: "Export Excel" },
  ];
  const availableChatDates = useMemo(() => new Set(chatHistory.map((entry) => entry.date)), [chatHistory]);
  const visibleChatHistory = useMemo(
    () => chatHistory.filter((entry) => entry.date === selectedChatDate),
    [chatHistory, selectedChatDate]
  );
  const currentYear = useMemo(() => new Date().getFullYear(), []);

  const [loading] = useState(false);
  const [pending, setPending] = useState<MockRequest[]>(() => {
    const saved = readSupervisorState();
    if (saved.length > 0) {
      const drafts = consumeAcademicDrafts();
      return mergeDraftsIntoRequests(saved, drafts);
    }

    // Fake data (plus requests submitted from Academic page via localStorage)
    const base: MockRequest[] = [
      {
        id: 1,
        studentId: "2345678",
        semesterLabel: "Sem1",
        periodLabel: "2025-1",
        name: "Ann Culhane",
        unit: "CITS 2206",
        description:
          "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla...",
        title: "Professor",
        department: "Computer Science",
        rate: 70,
        status: "pending",
        hours: 10,
      },
      {
        id: 2,
        studentId: "2345679",
        semesterLabel: "Sem1",
        periodLabel: "2025-1",
        name: "Ahmed Adhyyasar",
        unit: "CITS 1201",
        description:
          "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla...",
        title: "Professor",
        department: "Computer Science",
        rate: 70,
        status: "pending",
        hours: 20,
      },
      {
        id: 3,
        studentId: "2345680",
        semesterLabel: "Sem1",
        periodLabel: "2025-1",
        name: "Mary Smith",
        unit: "CITS 1302",
        description:
          "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla...",
        title: "Professor",
        department: "Computer Science",
        rate: 70,
        status: "rejected",
        hours: 5,
      },
      {
        id: 4,
        studentId: "2345681",
        semesterLabel: "Sem1",
        periodLabel: "2025-1",
        name: "John Doe",
        unit: "CITS 2103",
        description:
          "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla...",
        title: "Professor",
        department: "Computer Science",
        rate: 70,
        status: "approved",
        hours: 15,
      },
      {
        id: 5,
        studentId: "2345682",
        semesterLabel: "Sem1",
        periodLabel: "2025-1",
        name: "Lisa Brown",
        unit: "CITS 2304",
        description:
          "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla...",
        title: "Professor",
        department: "Computer Science",
        rate: 70,
        status: "pending",
        hours: 8,
      },
      {
        id: 6,
        studentId: "2345683",
        semesterLabel: "Sem1",
        periodLabel: "2025-1",
        name: "Chris Martin",
        unit: "CITS 3401",
        description:
          "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla...",
        title: "Professor",
        department: "Computer Science",
        rate: 70,
        status: "pending",
        hours: 12,
      },
      {
        id: 7,
        studentId: "2345684",
        semesterLabel: "Sem1",
        periodLabel: "2025-1",
        name: "Emma Wilson",
        unit: "CITS 3100",
        description:
          "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla...",
        title: "Professor",
        department: "Computer Science",
        rate: 70,
        status: "pending",
        hours: 6,
      },
      {
        id: 8,
        studentId: "2345685",
        semesterLabel: "Sem1",
        periodLabel: "2025-1",
        name: "Oliver Stone",
        unit: "CITS 4202",
        description:
          "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla...",
        title: "Professor",
        department: "Computer Science",
        rate: 70,
        status: "pending",
        hours: 18,
      },
      {
        id: 9,
        studentId: "2345686",
        semesterLabel: "Sem1",
        periodLabel: "2025-1",
        name: "Sophia Lee",
        unit: "CITS 2008",
        description:
          "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla...",
        title: "Professor",
        department: "Computer Science",
        rate: 70,
        status: "pending",
        hours: 9,
      },
      {
        id: 10,
        studentId: "2345687",
        semesterLabel: "Sem1",
        periodLabel: "2025-1",
        name: "Daniel Smith",
        unit: "CITS 2601",
        description:
          "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla...",
        title: "Professor",
        department: "Computer Science",
        rate: 70,
        status: "pending",
        hours: 11,
      },
      {
        id: 11,
        studentId: "2345688",
        semesterLabel: "Sem1",
        periodLabel: "2025-1",
        name: "Grace Taylor",
        unit: "CITS 2803",
        description:
          "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla...",
        title: "Professor",
        department: "Computer Science",
        rate: 70,
        status: "pending",
        hours: 7,
      },
      {
        id: 12,
        studentId: "2345689",
        semesterLabel: "Sem1",
        periodLabel: "2025-1",
        name: "Henry Clark",
        unit: "CITS 1500",
        description:
          "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla...",
        title: "Professor",
        department: "Computer Science",
        rate: 70,
        status: "rejected",
        hours: 14,
      },
      {
        id: 13,
        studentId: "2345690",
        semesterLabel: "Sem1",
        periodLabel: "2025-1",
        name: "Ava Robinson",
        unit: "CITS 4101",
        description:
          "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla...",
        title: "Professor",
        department: "Computer Science",
        rate: 70,
        status: "approved",
        hours: 8,
      },
    ];
    const drafts = consumeAcademicDrafts();
    return [...drafts, ...base];
  });

  useEffect(() => {
    function mergeLatestDrafts() {
      const drafts = consumeAcademicDrafts();
      if (!drafts.length) return;
      setPending((prev) => mergeDraftsIntoRequests(prev, drafts));
    }

    function onStorage(e: StorageEvent) {
      if (e.key === SUPERVISOR_DRAFT_KEY) mergeLatestDrafts();
    }

    function onDraftEvent() {
      mergeLatestDrafts();
    }

    window.addEventListener("storage", onStorage);
    window.addEventListener(ACADEMIC_DRAFT_EVENT, onDraftEvent as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(ACADEMIC_DRAFT_EVENT, onDraftEvent as EventListener);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SUPERVISOR_STATE_KEY, JSON.stringify(pending));
  }, [pending]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync: Record<string, "pending" | "approved" | "rejected"> = {};
    const notesSync: Record<string, string> = {};
    pending.forEach((row) => {
      if (row.studentId) sync[row.studentId] = row.status;
      if (row.studentId && row.supervisorNote) notesSync[row.studentId] = row.supervisorNote;
    });
    window.localStorage.setItem(ACADEMIC_STATUS_SYNC_KEY, JSON.stringify(sync));
    window.localStorage.setItem(ACADEMIC_NOTES_SYNC_KEY, JSON.stringify(notesSync));
    window.dispatchEvent(new Event(SUPERVISOR_SYNC_EVENT));
  }, [pending]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [page, setPage] = useState(1);
  const pageSize = 10; // Items per page
  const [submitting, setSubmitting] = useState(false);

  const [statusFilter, setStatusFilter] = useState<
    "all" | "pending" | "approved" | "rejected"
  >("all");

  const [popup, setPopup] = useState<{
    open: boolean;
    title: string;
    message: string;
    status: "pending" | "approved" | "rejected";
  }>({
    open: false,
    title: "",
    message: "",
    status: "pending",
  });

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsItem, setDetailsItem] = useState<MockRequest | null>(null);
  const [detailsBreakdown, setDetailsBreakdown] = useState<BreakdownData | null>(null);
  const [detailsTab, setDetailsTab] = useState<BreakdownCategory>("Teaching");
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteError, setNoteError] = useState("");
  const [noteDecision, setNoteDecision] = useState<"approve" | "reject">("approve");
  const [noteTargetId, setNoteTargetId] = useState<number | null>(null);
  const [distributeModalOpen, setDistributeModalOpen] = useState(false);
  const [distributeYearInput, setDistributeYearInput] = useState(String(currentYear));
  const [distributeSemesterInput, setDistributeSemesterInput] = useState<"S1" | "S2">("S1");
  const [distributeError, setDistributeError] = useState("");

  const [searchEmployeeIdInput, setSearchEmployeeIdInput] = useState("");
  const [searchLastNameInput, setSearchLastNameInput] = useState("");
  const [searchFirstNameInput, setSearchFirstNameInput] = useState("");
  const [searchTitleInput, setSearchTitleInput] = useState("");
  const [searchDepartmentInput, setSearchDepartmentInput] = useState("");
  const [searchYearInput, setSearchYearInput] = useState("");
  const [searchSemesterInput, setSearchSemesterInput] = useState<"" | "S1" | "S2">("");
  const [searchFilters, setSearchFilters] = useState({
    employeeId: "",
    lastName: "",
    firstName: "",
    title: "",
    department: "",
    year: "",
    semester: "",
  });
  const [adminSearchFirstNameInput, setAdminSearchFirstNameInput] = useState("");
  const [adminSearchLastNameInput, setAdminSearchLastNameInput] = useState("");
  const [adminSearchStaffIdInput, setAdminSearchStaffIdInput] = useState("");
  const [adminSearchFilters, setAdminSearchFilters] = useState({
    firstName: "",
    lastName: "",
    staffId: "",
  });
  const [adminPage, setAdminPage] = useState(1);
  const [selectedPerson, setSelectedPerson] = useState<AssignablePerson | null>(null);
  const [assignRole, setAssignRole] = useState<AssignRole>("HoD");
  const [assignDepartment, setAssignDepartment] = useState<AssignDepartment>("Physics");
  const rolePermissionMap: Record<AssignRole, string[]> = {
    HoD: ["View Workload", "Approve Workload", "Update Workload"],
    Admin: ["Distribute Workload to Departments", "Edit Employee Information"],
  };
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>(rolePermissionMap.HoD);
  const [roleAssignments, setRoleAssignments] = useState<RoleAssignment[]>([]);
  const [assignMessage, setAssignMessage] = useState("");
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [cancelTargetId, setCancelTargetId] = useState<number | null>(null);
  const [bindingSource, setBindingSource] = useState<"role" | "department" | null>(null);
  const isRoleLocked = bindingSource === "department";
  const isDepartmentLocked = bindingSource === "role";
  const adminBoundDepartment: AssignDepartment = "Senior School Coordinator";
  const currentSemester: "S1" | "S2" = new Date().getMonth() < 6 ? "S1" : "S2";
  const defaultVisualFromYear = currentYear - 2;
  const [visualYearFromInput, setVisualYearFromInput] = useState(String(defaultVisualFromYear));
  const [visualYearToInput, setVisualYearToInput] = useState(String(currentYear));
  const [visualSemesterInput, setVisualSemesterInput] = useState<"All" | "S1" | "S2">("All");
  const [visualDepartmentInput, setVisualDepartmentInput] = useState<string>("All Departments");
  const [visualFilterError, setVisualFilterError] = useState("");
  const [exportYearFromInput, setExportYearFromInput] = useState("");
  const [exportYearToInput, setExportYearToInput] = useState("");
  const [exportSemesterInput, setExportSemesterInput] = useState<"All" | "S1" | "S2">("All");
  const [exportDepartmentInput, setExportDepartmentInput] = useState<string>("All Departments");
  const [visualFilters, setVisualFilters] = useState<{
    fromYear: string;
    toYear: string;
    semester: "All" | "S1" | "S2";
    department: string;
  }>({
    fromYear: String(defaultVisualFromYear),
    toYear: String(currentYear),
    semester: "All",
    department: "All Departments",
  });

  const availableDepartments: AssignDepartment[] = [
    "Physics",
    "Mathematics & Statistics",
    "Computer Science & Software Engineering",
    "Senior School Coordinator",
  ];
  const availablePermissions = rolePermissionMap[assignRole];
  const initialAssignablePeople: AssignablePerson[] = [
    {
      id: 1,
      staffId: "50123451",
      firstName: "Ann",
      lastName: "Culhane",
      email: "ann.culhane@uwa.edu.au",
      title: "Professor",
      currentDepartment: "Physics",
      isActive: true,
    },
    {
      id: 2,
      staffId: "50123462",
      firstName: "Oliver",
      lastName: "Stone",
      email: "oliver.stone@uwa.edu.au",
      title: "Associate Professor",
      currentDepartment: "Mathematics & Statistics",
      isActive: true,
    },
    {
      id: 3,
      staffId: "50123473",
      firstName: "Ahmed",
      lastName: "Adhyyasar",
      email: "ahmed.adhyyasar@uwa.edu.au",
      title: "Professor",
      currentDepartment: "Computer Science & Software Engineering",
      isActive: true,
    },
    {
      id: 4,
      staffId: "50123484",
      firstName: "Lisa",
      lastName: "Brown",
      email: "lisa.brown@uwa.edu.au",
      title: "",
      currentDepartment: "",
      isActive: true,
    },
    {
      id: 5,
      staffId: "50123495",
      firstName: "Mary",
      lastName: "Smith",
      email: "mary.smith@uwa.edu.au",
      title: "Lecturer",
      currentDepartment: "Computer Science & Software Engineering",
      isActive: true,
    },
    {
      id: 6,
      staffId: "50123506",
      firstName: "Chris",
      lastName: "Martin",
      email: "chris.martin@uwa.edu.au",
      title: "Senior Lecturer",
      currentDepartment: "Physics",
      isActive: true,
    },
    {
      id: 7,
      staffId: "50123517",
      firstName: "Tom",
      lastName: "Lee",
      email: "tom.lee@uwa.edu.au",
      title: "Lecturer",
      currentDepartment: "Mathematics & Statistics",
      isActive: true,
    },
    {
      id: 8,
      staffId: "50123528",
      firstName: "Rachel",
      lastName: "Green",
      email: "rachel.green@uwa.edu.au",
      title: "Professor",
      currentDepartment: "Physics",
      isActive: true,
    },
    {
      id: 9,
      staffId: "50123539",
      firstName: "David",
      lastName: "Hall",
      email: "david.hall@uwa.edu.au",
      title: "Professor",
      currentDepartment: "Computer Science & Software Engineering",
      isActive: true,
    },
    {
      id: 10,
      staffId: "50123540",
      firstName: "Emily",
      lastName: "Wong",
      email: "emily.wong@uwa.edu.au",
      title: "Lecturer",
      currentDepartment: "Physics",
      isActive: false,
    },
    {
      id: 11,
      staffId: "50123551",
      firstName: "Jack",
      lastName: "Wilson",
      email: "jack.wilson@uwa.edu.au",
      title: "Senior Lecturer",
      currentDepartment: "Mathematics & Statistics",
      isActive: true,
    },
  ];
  const [assignablePeople, setAssignablePeople] = useState<AssignablePerson[]>(initialAssignablePeople);
  const [importMessage, setImportMessage] = useState("");
  const [staffModalOpen, setStaffModalOpen] = useState(false);
  const [staffDraft, setStaffDraft] = useState<StaffProfileDraft | null>(null);
  const [staffModalError, setStaffModalError] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const workloadImportInputRef = useRef<HTMLInputElement | null>(null);
  const selectedYear = Number(searchYearInput) || currentYear;
  const yearOptions = useMemo(
    () => Array.from({ length: 11 }, (_, i) => String(selectedYear - 5 + i)),
    [selectedYear]
  );

  const itemsForFilter = useMemo(() => {
    const byStatus =
      statusFilter === "all"
        ? pending
        : pending.filter((it) => it.status === statusFilter);

    const hasSearchFilter = Object.values(searchFilters).some((value) => value);
    if (!hasSearchFilter) return byStatus;

    return byStatus.filter((it) => {
      const fullName = it.name.toLowerCase();
      const nameParts = it.name.trim().toLowerCase().split(/\s+/);
      const firstName = nameParts[0] || "";
      const lastName = nameParts[nameParts.length - 1] || "";

      if (
        searchFilters.employeeId &&
        !it.studentId.toLowerCase().includes(searchFilters.employeeId)
      ) {
        return false;
      }

      if (searchFilters.firstName && !firstName.includes(searchFilters.firstName)) {
        return false;
      }

      if (searchFilters.lastName && !lastName.includes(searchFilters.lastName)) {
        return false;
      }

      if (searchFilters.title && !it.title.toLowerCase().includes(searchFilters.title)) {
        return false;
      }

      if (searchFilters.department) {
        const departmentText = it.department.toLowerCase();
        const normalizedSearch = searchFilters.department.replace("school", "").trim();
        if (!departmentText.includes(searchFilters.department) && (!normalizedSearch || !departmentText.includes(normalizedSearch))) {
          return false;
        }
      }

      const submittedText = submittedTimeById(it.id);
      const submittedDate = new Date(submittedText.replace(" ", "T"));
      const hasValidSubmittedDate = !Number.isNaN(submittedDate.getTime());
      const selectedYear = Number(searchFilters.year);

      if (searchFilters.year && Number.isFinite(selectedYear) && hasValidSubmittedDate) {
        if (searchFilters.semester === "s1") {
          // S1: [YYYY-01-01, YYYY-07-01)
          const s1Start = new Date(selectedYear, 0, 1);
          const s1End = new Date(selectedYear, 6, 1);
          if (!(submittedDate >= s1Start && submittedDate < s1End)) return false;
        } else if (searchFilters.semester === "s2") {
          // S2: [YYYY-07-01, YYYY+1-01-01)
          const s2Start = new Date(selectedYear, 6, 1);
          const s2End = new Date(selectedYear + 1, 0, 1);
          if (!(submittedDate >= s2Start && submittedDate < s2End)) return false;
        } else if (submittedDate.getFullYear() !== selectedYear) {
          return false;
        }
      }

      return fullName.length > 0;
    });
  }, [pending, statusFilter, searchFilters]);
  const adminSearchResults = useMemo(() => {
    const hasFilter = Object.values(adminSearchFilters).some((value) => value);
    if (!hasFilter) return assignablePeople;
    return assignablePeople.filter((person) => {
      if (
        adminSearchFilters.staffId &&
        !person.staffId.toLowerCase().includes(adminSearchFilters.staffId)
      ) {
        return false;
      }
      if (
        adminSearchFilters.firstName &&
        !person.firstName.toLowerCase().includes(adminSearchFilters.firstName)
      ) {
        return false;
      }
      if (
        adminSearchFilters.lastName &&
        !person.lastName.toLowerCase().includes(adminSearchFilters.lastName)
      ) {
        return false;
      }
      return true;
    });
  }, [adminSearchFilters, assignablePeople]);
  const adminPageSize = 10;
  const adminTotalPages = Math.max(1, Math.ceil(adminSearchResults.length / adminPageSize));
  const adminPageItems = useMemo(() => {
    const start = (adminPage - 1) * adminPageSize;
    return adminSearchResults.slice(start, start + adminPageSize);
  }, [adminPage, adminSearchResults]);
  useEffect(() => {
    if (adminPage > adminTotalPages) {
      setAdminPage(adminTotalPages);
    }
  }, [adminPage, adminTotalPages]);

  const departmentStats = useMemo(
    () => [
      {
        department: "Computer Science & Software Engineering",
        totalHours: 430,
        academics: 27,
        pending: 17,
        approved: 8,
        rejected: 2,
      },
      {
        department: "Mathematics & Statistics",
        totalHours: 318,
        academics: 19,
        pending: 7,
        approved: 10,
        rejected: 2,
      },
      {
        department: "Physics",
        totalHours: 264,
        academics: 14,
        pending: 5,
        approved: 7,
        rejected: 2,
      },
    ],
    []
  );
  const filteredDepartmentStats = useMemo(() => {
    if (visualFilters.department === "All Departments") return departmentStats;
    return departmentStats.filter((item) => item.department === visualFilters.department);
  }, [departmentStats, visualFilters.department]);

  const totalWorkHoursByDepartment = useMemo(
    () =>
      filteredDepartmentStats.map((item) => ({
        department: item.department,
        departmentShort:
          item.department === "Computer Science & Software Engineering"
            ? "CS&SE"
            : item.department === "Mathematics & Statistics"
              ? "Math&Stats"
              : item.department === "Physics"
                ? "Physics"
                : item.department,
        totalWorkHours: Number(item.totalHours.toFixed(1)),
      })),
    [filteredDepartmentStats]
  );

  const averageWorkHoursByDepartment = useMemo(
    () =>
      filteredDepartmentStats.map((item) => ({
        department: item.department,
        departmentShort:
          item.department === "Computer Science & Software Engineering"
            ? "CS&SE"
            : item.department === "Mathematics & Statistics"
              ? "Math&Stats"
              : item.department === "Physics"
                ? "Physics"
                : item.department,
        averageWorkHours: Number((item.totalHours / Math.max(1, item.academics)).toFixed(1)),
      })),
    [filteredDepartmentStats]
  );

  const approvalStatusByDepartment = useMemo(
    () =>
      filteredDepartmentStats.map((item) => ({
        department: item.department,
        departmentShort:
          item.department === "Computer Science & Software Engineering"
            ? "CS&SE"
            : item.department === "Mathematics & Statistics"
              ? "Math&Stats"
              : item.department === "Physics"
                ? "Physics"
                : item.department,
        pending: item.pending,
        approved: item.approved,
        rejected: item.rejected,
      })),
    [filteredDepartmentStats]
  );

  const workloadTrendBySemester = useMemo(() => {
    const startYear = currentYear - 5;
    const endYear = currentYear + 5;
    const currentMonth = new Date().getMonth();
    const hasReachedS2 = currentMonth >= 6;
    const rows: Array<Record<string, string | number | null>> = [];
    for (let year = startYear; year <= endYear; year += 1) {
      const offset = year - startYear;
      rows.push({
        semester: `${year} S1`,
        "Computer Science & Software Engineering": 178 + offset * 8,
        "Mathematics & Statistics": 128 + offset * 6,
        Physics: 104 + offset * 5,
      });
      rows.push({
        semester: `${year} S2`,
        "Computer Science & Software Engineering":
          year === currentYear && !hasReachedS2 ? null : 186 + offset * 9,
        "Mathematics & Statistics": year === currentYear && !hasReachedS2 ? null : 136 + offset * 7,
        Physics: year === currentYear && !hasReachedS2 ? null : 111 + offset * 6,
      });
    }
    return rows;
  }, [currentYear]);

  const schoolSummary = useMemo(() => {
    const totalAcademics = filteredDepartmentStats.reduce((sum, item) => sum + item.academics, 0);
    const totalWorkHours = filteredDepartmentStats.reduce((sum, item) => sum + item.totalHours, 0);
    const pendingRequests = filteredDepartmentStats.reduce((sum, item) => sum + item.pending, 0);
    const approvedRequests = filteredDepartmentStats.reduce((sum, item) => sum + item.approved, 0);
    const rejectedRequests = filteredDepartmentStats.reduce((sum, item) => sum + item.rejected, 0);
    return {
      totalDepartments: filteredDepartmentStats.length,
      totalAcademics,
      totalWorkHours: Number(totalWorkHours.toFixed(1)),
      pendingRequests,
      approvedRequests,
      rejectedRequests,
    };
  }, [filteredDepartmentStats]);
  const workloadPerAcademicByDepartment = useMemo(
    () =>
      filteredDepartmentStats.map((item) => ({
        department: item.department,
        value: Number((item.totalHours / Math.max(1, item.academics)).toFixed(1)),
      })),
    [filteredDepartmentStats]
  );
  const averageWorkloadPerAcademicOverall = useMemo(() => {
    const totalHours = filteredDepartmentStats.reduce((sum, item) => sum + item.totalHours, 0);
    const totalAcademics = filteredDepartmentStats.reduce((sum, item) => sum + item.academics, 0);
    return Number((totalHours / Math.max(1, totalAcademics)).toFixed(1));
  }, [filteredDepartmentStats]);
  const filteredTrendData = useMemo(() => {
    const from = Number(visualFilters.fromYear);
    const to = Number(visualFilters.toYear);
    const minYear = Number.isFinite(from) && Number.isFinite(to) ? Math.min(from, to) : currentYear;
    const maxYear = Number.isFinite(from) && Number.isFinite(to) ? Math.max(from, to) : currentYear;
    const rows = workloadTrendBySemester.filter((row) => {
      const semesterKey = String(row.semester);
      const [year, sem] = semesterKey.split(" ");
      const yearNumber = Number(year);
      if (yearNumber < minYear || yearNumber > maxYear) return false;
      // Semester filter applies to the whole selected year range.
      if (visualFilters.semester !== "All" && sem !== visualFilters.semester) return false;
      return true;
    });
    const latestRows = rows.slice(-6);
    if (visualFilters.department === "All Departments") return latestRows;
    return latestRows.map((row) => {
      const filteredRow: Record<string, string | number | null> = { semester: String(row.semester) };
      filteredRow[visualFilters.department] = row[visualFilters.department] ?? null;
      return filteredRow;
    });
  }, [workloadTrendBySemester, visualFilters, currentYear]);
  const reportingPeriodLabel = useMemo(() => {
    const yearLabel =
      visualFilters.fromYear === visualFilters.toYear
        ? visualFilters.fromYear
        : `${visualFilters.fromYear}-${visualFilters.toYear}`;
    if (visualFilters.semester === "All") {
      return `${yearLabel} All Semesters`;
    }
    return `${yearLabel} ${visualFilters.semester}`;
  }, [visualFilters]);
  const scopeLabel = useMemo(
    () => (visualFilters.department === "All Departments" ? "All Departments" : visualFilters.department),
    [visualFilters.department]
  );
  const departmentColorMap: Record<string, string> = {
    "Computer Science & Software Engineering": "#1f3b86",
    "Mathematics & Statistics": "#4f75cf",
    Physics: "#a9c4f7",
  };
  const chartTickStyle = { fontFamily: "Inter, Arial, sans-serif", fontSize: 12, fill: "#334155" };
  const axisLabelStyle = {
    fontFamily: "Inter, Arial, sans-serif",
    fontSize: 12,
    fontWeight: 600,
    fill: "#1e293b",
  };
  const currentSemesterLabel = `${currentYear} ${currentSemester}`;

  function handleApplyVisualizationFilter() {
    const fromYear = Number(visualYearFromInput);
    const toYear = Number(visualYearToInput);
    if (!Number.isFinite(fromYear) || !Number.isFinite(toYear)) {
      setVisualFilterError("Please enter valid year values.");
      return;
    }
    const startYear = Math.min(fromYear, toYear);
    const endYear = Math.max(fromYear, toYear);
    const yearSpan = endYear - startYear;
    const maxYearSpan = 2;
    if (yearSpan > maxYearSpan) {
      setVisualFilterError("Maximum range is 3 years.");
      return;
    }
    setVisualFilterError("");
    setVisualFilters({
      fromYear: String(startYear),
      toYear: String(endYear),
      semester: visualSemesterInput,
      department: visualDepartmentInput,
    });
  }
  const legendStyle = { fontFamily: "Inter, Arial, sans-serif", fontSize: 12 };

  useEffect(() => {
    setSelectedPermissions(rolePermissionMap[assignRole]);
  }, [assignRole]);

  const totalPages = Math.max(1, Math.ceil(itemsForFilter.length / pageSize));
  const pageItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return itemsForFilter.slice(start, start + pageSize);
  }, [itemsForFilter, page]);

  function toggleSelected(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function statusLabel(status: string) {
    if (status === "pending") return "Pending";
    if (status === "approved") return "Approved";
    if (status === "rejected") return "Rejected";
    return status;
  }

  const canSubmit =
    statusFilter === "pending" && selectedIds.size > 0 && !submitting;

  async function handleDecision(kind: "approve" | "reject") {
    if (!canSubmit) return;
    setSubmitting(true);

    // Fake: update status locally
    const nextStatus: MockRequest["status"] =
      kind === "approve" ? "approved" : "rejected";
    const count = selectedIds.size;
    const next: MockRequest[] = pending.map((it) => {
      if (!selectedIds.has(it.id)) return it;
      return { ...it, status: nextStatus };
    });

    // Small delay to feel like a real request
    await new Promise((r) => setTimeout(r, 300));
    setPending(next);
    setSelectedIds(new Set());
    setSubmitting(false);

    setPopup({
      open: true,
      title: kind === "approve" ? "Approved" : "Rejected",
      message:
        count === 1
          ? `1 request has been marked as ${kind === "approve" ? "Approved" : "Rejected"}.`
          : `${count} requests have been marked as ${
              kind === "approve" ? "Approved" : "Rejected"
            }.`,
      status: kind === "approve" ? "approved" : "rejected",
    });
  }

  async function handleDecisionForId(kind: "approve" | "reject", id: number, note: string) {
    setSubmitting(true);
    try {
      const nextStatus: MockRequest["status"] =
        kind === "approve" ? "approved" : "rejected";
      setPending((prev) =>
        prev.map((it) =>
          it.id === id
            ? { ...it, status: nextStatus, supervisorNote: note.trim() }
            : it
        )
      );
      // Clear selection if it contains the same row.
      setSelectedIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } finally {
      setSubmitting(false);
    }

    setPopup({
      open: true,
      title: kind === "approve" ? "Approved" : "Rejected",
      message: `The request has been marked as ${
        kind === "approve" ? "Approved" : "Rejected"
      }.`,
      status: kind === "approve" ? "approved" : "rejected",
    });
  }

  function openNoteModal(kind: "approve" | "reject", id: number) {
    setNoteDecision(kind);
    setNoteTargetId(id);
    setNoteDraft("");
    setNoteError("");
    setNoteModalOpen(true);
  }

  async function handleFinishNote() {
    const trimmed = noteDraft.trim();
    if (!trimmed) {
      setNoteError("Supervisor note is required.");
      return;
    }
    if (trimmed.length > 240) {
      setNoteError("Supervisor note must be 240 characters or less.");
      return;
    }
    if (noteTargetId === null) return;
    await handleDecisionForId(noteDecision, noteTargetId, trimmed);
    setNoteModalOpen(false);
    closeDetails();
  }

  function handleSearch() {
    setSearchFilters({
      employeeId: searchEmployeeIdInput.trim().toLowerCase(),
      lastName: searchLastNameInput.trim().toLowerCase(),
      firstName: searchFirstNameInput.trim().toLowerCase(),
      title: searchTitleInput.trim().toLowerCase(),
      department: searchDepartmentInput.trim().toLowerCase(),
      year: searchYearInput.trim().toLowerCase(),
      semester: searchSemesterInput.trim().toLowerCase(),
    });
    setPage(1);
    setSelectedIds(new Set());
    setDetailsOpen(false);
    setDetailsItem(null);
    setDetailsBreakdown(null);
  }

  function openDistributeModal() {
    setDistributeYearInput(String(currentYear));
    setDistributeSemesterInput("S1");
    setDistributeError("");
    setDistributeModalOpen(true);
  }

  function closeDistributeModal() {
    setDistributeModalOpen(false);
    setDistributeError("");
  }

  function handleConfirmDistributeWorkload() {
    const parsedYear = Number(distributeYearInput);
    if (!Number.isFinite(parsedYear) || parsedYear < 2000 || parsedYear > 2100) {
      setDistributeError("Please enter a valid year.");
      return;
    }
    setDistributeModalOpen(false);
    setPopup({
      open: true,
      title: "Workload Distributed",
      message: `Workload distributed for ${parsedYear} ${distributeSemesterInput}.`,
      status: "approved",
    });
  }

  function handleAdminSearch() {
    setAdminSearchFilters({
      firstName: adminSearchFirstNameInput.trim().toLowerCase(),
      lastName: adminSearchLastNameInput.trim().toLowerCase(),
      staffId: adminSearchStaffIdInput.trim().toLowerCase(),
    });
    setAdminPage(1);
  }

  function handlePersonDepartmentChange(personId: number, nextDepartment: string) {
    setAssignablePeople((prev) =>
      prev.map((person) =>
        person.id === personId
          ? {
              ...person,
              currentDepartment: nextDepartment,
            }
          : person
      )
    );
    if (selectedPerson?.id === personId) {
      setSelectedPerson((prev) => (prev ? { ...prev, currentDepartment: nextDepartment } : prev));
      if (availableDepartments.includes(nextDepartment as AssignDepartment)) {
        setAssignDepartment(nextDepartment as AssignDepartment);
      }
    }
  }

  function openStaffModal(person: AssignablePerson) {
    setStaffDraft({
      id: person.id,
      staffId: person.staffId,
      firstName: person.firstName,
      lastName: person.lastName,
      email: person.email,
      title: person.title,
      department: person.currentDepartment,
      isActive: person.isActive ? "Active" : "Inactive",
    });
    setStaffModalError("");
    setStaffModalOpen(true);
  }

  function closeStaffModal() {
    setStaffModalOpen(false);
    setStaffDraft(null);
    setStaffModalError("");
  }

  function handleUpdateStaffDraft() {
    if (!staffDraft) return;
    const allowedDepartments = new Set([
      "Physics",
      "Mathematics & Statistics",
      "Computer Science & Software Engineering",
      "Senior School Coordinator",
    ]);
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!/^\d{8}$/.test(staffDraft.staffId.trim())) {
      setStaffModalError("staff_id must be exactly 8 digits.");
      return;
    }
    if (!staffDraft.firstName.trim() || !staffDraft.lastName.trim()) {
      setStaffModalError("first_name and last_name are required.");
      return;
    }
    if (!emailPattern.test(staffDraft.email.trim())) {
      setStaffModalError("email format is invalid.");
      return;
    }
    if (!allowedDepartments.has(staffDraft.department.trim())) {
      setStaffModalError("department must be one of the 4 allowed schools.");
      return;
    }
    if (staffDraft.isActive !== "Active" && staffDraft.isActive !== "Inactive") {
      setStaffModalError("Active Status must be Active or Inactive.");
      return;
    }

    const updatedPerson: AssignablePerson = {
      id: staffDraft.id,
      staffId: staffDraft.staffId.trim(),
      firstName: staffDraft.firstName.trim(),
      lastName: staffDraft.lastName.trim(),
      email: staffDraft.email.trim(),
      title: staffDraft.title.trim(),
      currentDepartment: staffDraft.department.trim(),
      isActive: staffDraft.isActive === "Active",
    };

    setAssignablePeople((prev) => prev.map((person) => (person.id === updatedPerson.id ? updatedPerson : person)));
    if (selectedPerson?.id === updatedPerson.id) {
      setSelectedPerson(updatedPerson);
      if (availableDepartments.includes(updatedPerson.currentDepartment as AssignDepartment)) {
        setAssignDepartment(updatedPerson.currentDepartment as AssignDepartment);
      }
    }
    setImportMessage(`Updated staff profile for ${updatedPerson.firstName} ${updatedPerson.lastName}.`);
    closeStaffModal();
  }

  async function handleDownloadTemplate() {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("staff_import_template");

    worksheet.columns = [
      { header: "staff_id", key: "staff_id", width: 14 },
      { header: "first_name", key: "first_name", width: 16 },
      { header: "last_name", key: "last_name", width: 16 },
      { header: "email", key: "email", width: 28 },
      { header: "title", key: "title", width: 18 },
      { header: "department", key: "department", width: 40 },
      { header: "active_status", key: "active_status", width: 16 },
    ];

    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE5E7EB" },
      };
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        right: { style: "thin" },
        bottom: { style: "thin" },
      };
    });

    worksheet.addRow({
      staff_id: "50199999",
      first_name: "Jane",
      last_name: "Doe",
      email: "jane.doe@uwa.edu.au",
      title: "Lecturer",
      department: "Physics",
      active_status: "Active",
    });

    // Apply data validation to a practical import range.
    for (let row = 2; row <= 1000; row += 1) {
      worksheet.getCell(`A${row}`).dataValidation = {
        type: "custom",
        allowBlank: false,
        formulae: [`AND(ISNUMBER(A${row}),LEN(A${row}&\"\")=8)`],
        showErrorMessage: true,
        errorTitle: "Invalid staff_id",
        error: "staff_id must be exactly 8 digits.",
      };
      worksheet.getCell(`B${row}`).dataValidation = {
        type: "custom",
        allowBlank: false,
        formulae: [`LEN(TRIM(B${row}))>0`],
        showErrorMessage: true,
        errorTitle: "Missing first_name",
        error: "first_name is required.",
      };
      worksheet.getCell(`C${row}`).dataValidation = {
        type: "custom",
        allowBlank: false,
        formulae: [`LEN(TRIM(C${row}))>0`],
        showErrorMessage: true,
        errorTitle: "Missing last_name",
        error: "last_name is required.",
      };
      worksheet.getCell(`D${row}`).dataValidation = {
        type: "custom",
        allowBlank: false,
        formulae: [
          `AND(ISNUMBER(SEARCH("@",D${row})),ISNUMBER(SEARCH(".",D${row})),FIND("@",D${row})>1,FIND("@",D${row})<LEN(D${row}))`,
        ],
        showErrorMessage: true,
        errorTitle: "Invalid email",
        error: "Please enter a valid email format.",
      };
      worksheet.getCell(`F${row}`).dataValidation = {
        type: "list",
        allowBlank: false,
        formulae: ['"Physics,Mathematics & Statistics,Computer Science & Software Engineering,Senior School Coordinator"'],
        showErrorMessage: true,
        errorTitle: "Invalid department",
        error:
          "Department must be one of: Physics, Mathematics & Statistics, Computer Science & Software Engineering, Senior School Coordinator.",
      };
      worksheet.getCell(`G${row}`).dataValidation = {
        type: "list",
        allowBlank: false,
        formulae: ['"Yes,No"'],
        showErrorMessage: true,
        errorTitle: "Invalid Active Status",
        error: "Active Status must be Active or Inactive.",
      };
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "Staff_Template.xlsx";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function handleOpenImport() {
    fileInputRef.current?.click();
  }

  function handleDownloadWorkloadTemplate() {
    const sheet = XLSX.utils.json_to_sheet([
      {
        employee_id: "",
        name: "",
        description: "",
        total_work_hours: "",
        status: "",
      },
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "workload_import_template");
    XLSX.writeFile(workbook, "Workload_Template.xlsx");
  }

  function handleOpenWorkloadImport() {
    workloadImportInputRef.current?.click();
  }

  function handleImportWorkload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const isXlsx =
      file.name.toLowerCase().endsWith(".xlsx") ||
      file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    if (!isXlsx) {
      setPopup({
        open: true,
        title: "Import Failed",
        message: "Please upload an .xlsx file.",
        status: "rejected",
      });
      event.target.value = "";
      return;
    }
    setPopup({
      open: true,
      title: "Import Received",
      message: `${file.name} uploaded successfully.`,
      status: "approved",
    });
    event.target.value = "";
  }

  function parseActiveStatus(value: string) {
    const normalized = value.trim().toLowerCase();
    if (normalized === "active" || normalized === "yes" || normalized === "true") return true;
    if (normalized === "inactive" || normalized === "no" || normalized === "false") return false;
    return null;
  }

  function handleImportTemplate(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const allowedDepartments = new Set([
          "Physics",
          "Mathematics & Statistics",
          "Computer Science & Software Engineering",
          "Senior School Coordinator",
        ]);
        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const binary = reader.result;
        const workbook = XLSX.read(binary, { type: "array" });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: "" });

        if (rows.length === 0) {
          setImportMessage("Import failed: file is empty.");
          return;
        }

        const parsed: AssignablePerson[] = [];
        for (let i = 0; i < rows.length; i += 1) {
          const row = rows[i];
          const staffId = String(row.staff_id ?? "").trim();
          const firstName = String(row.first_name ?? "").trim();
          const lastName = String(row.last_name ?? "").trim();
          const email = String(row.email ?? "").trim();
          const title = String(row.title ?? "").trim();
          const department = String(row.department ?? "").trim();
          const isActiveRaw = String(row.active_status ?? row.is_active ?? "").trim();
          const isActive = parseActiveStatus(isActiveRaw);
          const rowNumber = i + 2;

          if (!/^\d{8}$/.test(staffId)) {
            setImportMessage(`Import failed: row ${rowNumber} staff_id must be exactly 8 digits.`);
            return;
          }
          if (!firstName) {
            setImportMessage(`Import failed: row ${rowNumber} first_name is required.`);
            return;
          }
          if (!lastName) {
            setImportMessage(`Import failed: row ${rowNumber} last_name is required.`);
            return;
          }
          if (!emailPattern.test(email)) {
            setImportMessage(`Import failed: row ${rowNumber} email format is invalid.`);
            return;
          }
          if (!allowedDepartments.has(department)) {
            setImportMessage(`Import failed: row ${rowNumber} department must be one of the 4 allowed schools.`);
            return;
          }
          if (isActive === null) {
            setImportMessage(`Import failed: row ${rowNumber} Active Status must be Active or Inactive.`);
            return;
          }

          parsed.push({
            id: i + 1,
            staffId,
            firstName,
            lastName,
            email,
            title,
            currentDepartment: department,
            isActive,
          });
        }

        setAssignablePeople(parsed);
        setSelectedPerson(null);
        setImportMessage(`Imported ${parsed.length} staff records from Staff_Template.xlsx.`);
      } catch {
        setImportMessage("Import failed: please upload a valid .xlsx template file.");
      }
    };
    reader.readAsArrayBuffer(file);
    event.target.value = "";
  }

  function handleAssignRole() {
    if (!selectedPerson) {
      setAssignMessage("Please select a person first.");
      return;
    }
    if (selectedPermissions.length === 0) {
      setAssignMessage("Please select at least one permission.");
      return;
    }
    const now = new Date();
    const assignedAt = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
      now.getDate()
    ).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const next: RoleAssignment = {
      id: Date.now(),
      staffId: selectedPerson.staffId,
      name: `${selectedPerson.firstName} ${selectedPerson.lastName}`,
      role: assignRole,
      department: assignDepartment,
      permissions: selectedPermissions,
      assignedAt,
      status: "active",
    };
    setRoleAssignments((prev) => [next, ...prev]);
    setAssignMessage(`Assigned ${assignRole} role to ${next.name} (${assignDepartment}).`);
  }

  function requestCancelPermission(assignmentId: number) {
    setCancelTargetId(assignmentId);
    setCancelConfirmOpen(true);
  }

  function confirmCancelPermission() {
    if (cancelTargetId === null) return;
    setRoleAssignments((prev) =>
      prev.map((item) => {
        if (item.id !== cancelTargetId) return item;
        setAssignMessage(`Disabled ${item.role} permission for ${item.name}.`);
        return { ...item, status: "disabled" };
      })
    );
    setCancelConfirmOpen(false);
    setCancelTargetId(null);
  }

  function closeCancelConfirm() {
    setCancelConfirmOpen(false);
    setCancelTargetId(null);
  }

  function openDetails(item: MockRequest) {
    setDetailsItem(item);
    setDetailsBreakdown(breakdownById(item.id));
    setDetailsOpen(true);
    setDescriptionExpanded(false);
  }

  function closeDetails() {
    setDetailsOpen(false);
    setDetailsItem(null);
    setDetailsBreakdown(null);
    setNoteModalOpen(false);
    setNoteDraft("");
    setNoteError("");
    setNoteTargetId(null);
  }

  function updateBreakdownRow(tab: BreakdownCategory, idx: number, field: "name" | "hours", value: string) {
    setDetailsBreakdown((prev) => {
      if (!prev) return prev;
      const nextRows = prev[tab].map((row, rowIdx) => {
        if (rowIdx !== idx) return row;
        if (field === "name") return { ...row, name: value };
        const parsedHours = Number.parseFloat(value);
        const normalizedHours = Number.isFinite(parsedHours) ? parsedHours : 0;
        return { ...row, hours: normalizedHours };
      });
      return { ...prev, [tab]: nextRows };
    });
  }

  function handleYearWheel(event: React.WheelEvent<HTMLSelectElement>) {
    event.preventDefault();
    const delta = event.deltaY > 0 ? 1 : -1;
    const nextYear = (Number(searchYearInput) || currentYear) + delta;
    setSearchYearInput(String(nextYear));
  }

  function handleSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      handleSearch();
    }
  }

  function openMessagePanel() {
    setMessagePanelOpen(true);
    setHasNewMessage(false);
  }

  function handleSendMessage() {
    const trimmed = chatInput.trim();
    if (!trimmed) return;
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const today = now.toISOString().slice(0, 10);
    setChatHistory((prev) => [
      ...prev,
      { sender: "Sam", message: trimmed, time: `${hh}:${mm}`, date: today },
    ]);
    setSelectedChatDate(today);
    setCalendarMonth(today.slice(0, 7));
    setChatInput("");
  }

  function handleAvatarUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") setAvatarSrc(result);
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  }

  function changeCalendarMonth(offset: number) {
    const [yearStr, monthStr] = calendarMonth.split("-");
    const date = new Date(Number(yearStr), Number(monthStr) - 1 + offset, 1);
    setCalendarMonth(
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
    );
  }

  return (
    <div className="min-h-screen bg-[#f3f4f6] font-serif">
      <div className="mx-auto max-w-7xl px-3 pb-10 pt-8">
        <DashboardHeader
          title="Admin Dashboard"
          hasNewMessage={hasNewMessage}
          onMessageClick={openMessagePanel}
          onAvatarClick={() => setProfileOpen(true)}
          avatarSrc={avatarSrc}
        />

        {messagePanelOpen && (
          <div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 p-4"
            onClick={() => setMessagePanelOpen(false)}
          >
            <div
              className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-slate-50 p-6 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-4 flex items-center justify-between">
                <div className="text-3xl font-semibold text-slate-800">Contact Admin</div>
                <button
                  type="button"
                  aria-label="Close"
                  className="rounded p-1 text-slate-500 hover:bg-slate-200"
                  onClick={() => setMessagePanelOpen(false)}
                >
                  ✕
                </button>
              </div>

              <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4">
                <div className="mb-3 flex items-center gap-3">
                  <div className="text-sm font-semibold text-slate-700">Chat Record Date</div>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setCalendarOpen((v) => !v)}
                      className="inline-flex items-center gap-2 rounded border border-slate-300 bg-white px-3 py-1 text-sm text-slate-800"
                    >
                      {selectedChatDate}
                      <span aria-hidden="true">📅</span>
                    </button>
                    {calendarOpen && (
                      <div className="absolute z-20 mt-2 w-72 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
                        <div className="mb-2 flex items-center justify-between">
                          <button
                            type="button"
                            onClick={() => changeCalendarMonth(-1)}
                            className="rounded px-2 py-1 text-sm hover:bg-slate-100"
                          >
                            ‹
                          </button>
                          <div className="text-sm font-semibold text-slate-700">{calendarMonth}</div>
                          <button
                            type="button"
                            onClick={() => changeCalendarMonth(1)}
                            className="rounded px-2 py-1 text-sm hover:bg-slate-100"
                          >
                            ›
                          </button>
                        </div>

                        <div className="mb-1 grid grid-cols-7 gap-1 text-center text-xs font-semibold text-slate-500">
                          {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                            <div key={d}>{d}</div>
                          ))}
                        </div>

                        <div className="grid grid-cols-7 gap-1">
                          {(() => {
                            const [yearStr, monthStr] = calendarMonth.split("-");
                            const year = Number(yearStr);
                            const month = Number(monthStr) - 1;
                            const firstDay = new Date(year, month, 1).getDay();
                            const totalDays = new Date(year, month + 1, 0).getDate();
                            const cells = [];

                            for (let i = 0; i < firstDay; i += 1) {
                              cells.push(<div key={`empty-${i}`} />);
                            }

                            for (let day = 1; day <= totalDays; day += 1) {
                              const dateKey = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(
                                2,
                                "0"
                              )}`;
                              const selectable = availableChatDates.has(dateKey);
                              const isSelected = selectedChatDate === dateKey;

                              cells.push(
                                <button
                                  key={dateKey}
                                  type="button"
                                  disabled={!selectable}
                                  onClick={() => {
                                    setSelectedChatDate(dateKey);
                                    setCalendarOpen(false);
                                  }}
                                  className={`h-8 rounded text-xs ${
                                    !selectable
                                      ? "cursor-not-allowed bg-slate-100 text-slate-300"
                                      : isSelected
                                        ? "bg-[#2f4d9c] text-white"
                                        : "text-slate-700 hover:bg-slate-100"
                                  }`}
                                >
                                  {day}
                                </button>
                              );
                            }

                            return cells;
                          })()}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div className="max-h-72 space-y-2 overflow-y-auto pr-1 font-mono text-[15px] leading-6 text-slate-800">
                  {visibleChatHistory.length > 0 ? (
                    visibleChatHistory.map((entry, idx) => (
                      <div key={idx}>
                        <span className="text-slate-500">[{entry.time}]</span>{" "}
                        <span className="font-semibold">{entry.sender}:</span> {entry.message}
                      </div>
                    ))
                  ) : (
                    <div className="text-sm text-slate-500">No chat records for this date.</div>
                  )}
                </div>
              </div>

              <div className="flex items-end gap-3">
                <textarea
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Write your message..."
                  className="h-16 flex-1 resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-800 outline-none focus:border-[#2f4d9c]"
                />
                <button
                  type="button"
                  onClick={handleSendMessage}
                  className="rounded-lg bg-[#2f4d9c] px-5 py-2 text-sm font-semibold text-white hover:bg-[#264183]"
                >
                  Send
                </button>
              </div>
            </div>
          </div>
        )}

        <ProfileModal
          open={profileOpen}
          onClose={() => setProfileOpen(false)}
          avatarSrc={avatarSrc}
          onAvatarUpload={handleAvatarUpload}
          user={user}
          departmentLabel="School"
          titleLabel="Role"
          titleBeforeDepartment
          departmentFullWidth
        />

        <div className="mt-6 rounded-md bg-white p-4 shadow-sm">
          <SectionTabs
            tabs={sectionTabs}
            activeKey={activeSection}
            onChange={(key) => setActiveSection(key as "approval" | "admin" | "visualization" | "export")}
          />

          {activeSection === "approval" && (
            <div className="rounded-md bg-white p-4">
              {popup.open && (
                <div
                  className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
                  onClick={() => setPopup((p) => ({ ...p, open: false }))}
                >
                  <div
                    className="w-full max-w-lg overflow-hidden rounded-lg bg-white shadow-lg"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center justify-between bg-[#2f4d9c] px-5 py-3 text-white">
                      <div className="text-lg font-extrabold">{popup.title}</div>
                      <button
                        type="button"
                        aria-label="Close"
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-white/10 text-white hover:bg-white/20"
                        onClick={() => setPopup((p) => ({ ...p, open: false }))}
                      >
                        <span className="text-xl leading-none">×</span>
                      </button>
                    </div>
                    <div className="px-5 py-4">
                      <div className="text-base text-slate-800">{popup.message}</div>
                      <div className="mt-4 flex justify-center">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedIds(new Set());
                            setPage(1);
                            setDetailsOpen(false);
                            setDetailsItem(null);
                            setPopup((p) => ({ ...p, open: false }));
                          }}
                          className={`rounded-md px-5 py-2 text-sm font-semibold text-white hover:brightness-95 ${
                            popup.status === "approved"
                              ? "bg-[#16a34a]"
                              : popup.status === "rejected"
                                ? "bg-[#dc2626]"
                                : "bg-[#d97706]"
                          }`}
                        >
                          {popup.status === "approved"
                            ? "Approval Completed"
                            : popup.status === "rejected"
                              ? "Rejection Completed"
                              : "Back to Pending List"}
                        </button>
                      </div>
                    </div>
                    <div className="h-1.5 w-full bg-[#2f4d9c]" />
                  </div>
                </div>
              )}

              <div className="mt-4 rounded-md bg-[#f4f7ff] p-4">
                <div className="grid grid-cols-3 gap-6">
                  <div className="flex flex-col gap-1">
                    <div className="w-fit rounded bg-[#2f4d9c] px-3 py-1 text-xs font-bold text-white">First name</div>
                    <input
                      value={searchFirstNameInput}
                      onChange={(e) => setSearchFirstNameInput(e.target.value)}
                      onKeyDown={handleSearchKeyDown}
                      className="rounded border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="w-fit rounded bg-[#2f4d9c] px-3 py-1 text-xs font-bold text-white">Last name</div>
                    <input
                      value={searchLastNameInput}
                      onChange={(e) => setSearchLastNameInput(e.target.value)}
                      onKeyDown={handleSearchKeyDown}
                      className="rounded border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="w-fit rounded bg-[#2f4d9c] px-3 py-1 text-xs font-bold text-white">Staff ID</div>
                    <input
                      value={searchEmployeeIdInput}
                      onChange={(e) => setSearchEmployeeIdInput(e.target.value)}
                      onKeyDown={handleSearchKeyDown}
                      className="rounded border border-slate-300 px-3 py-2 text-sm tabular-nums font-sans"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="w-fit rounded bg-[#2f4d9c] px-3 py-1 text-xs font-bold text-white">Title</div>
                    <input
                      value={searchTitleInput}
                      onChange={(e) => setSearchTitleInput(e.target.value)}
                      onKeyDown={handleSearchKeyDown}
                      className="rounded border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="w-fit rounded bg-[#2f4d9c] px-3 py-1 text-xs font-bold text-white">
                      Department / School
                    </div>
                    <input
                      value={searchDepartmentInput}
                      onChange={(e) => setSearchDepartmentInput(e.target.value)}
                      onKeyDown={handleSearchKeyDown}
                      className="rounded border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="w-fit rounded bg-[#2f4d9c] px-3 py-1 text-xs font-bold text-white">Year & Semester</div>
                    <div className="flex items-center gap-2">
                      <select
                        value={searchYearInput}
                        onChange={(e) => setSearchYearInput(e.target.value)}
                        onKeyDown={handleSearchKeyDown}
                        onWheel={handleYearWheel}
                        className="w-full rounded border border-slate-300 px-2 py-2 text-sm"
                      >
                        <option value="">Year</option>
                        {yearOptions.map((year) => (
                          <option key={year} value={year}>
                            {year}
                          </option>
                        ))}
                      </select>
                      <select
                        value={searchSemesterInput}
                        onChange={(e) => setSearchSemesterInput(e.target.value as "" | "S1" | "S2")}
                        onKeyDown={handleSearchKeyDown}
                        className="w-full rounded border border-slate-300 px-2 py-2 text-sm"
                      >
                        <option value="">Semester</option>
                        <option value="S1">S1</option>
                        <option value="S2">S2</option>
                      </select>
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex justify-center">
                  <SearchButton onClick={handleSearch} />
                </div>
              </div>

              <div className="mt-6 flex items-center justify-between gap-3">
                <div className="text-lg font-semibold text-slate-700">Workload Report Sem 1 - 2025</div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleDownloadWorkloadTemplate}
                    className="rounded border border-[#2f4d9c] bg-white px-4 py-2 text-sm font-semibold text-[#2f4d9c] hover:bg-[#eef2ff]"
                  >
                    Download Template
                  </button>
                  <button
                    type="button"
                    onClick={handleOpenWorkloadImport}
                    className="rounded bg-[#2f4d9c] px-4 py-2 text-sm font-semibold text-white hover:bg-[#264183]"
                  >
                    Import Workload
                  </button>
                  <input
                    ref={workloadImportInputRef}
                    type="file"
                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    onChange={handleImportWorkload}
                    className="hidden"
                  />
                </div>
              </div>
              <div className="mt-6 rounded-md bg-[#f4f7ff] p-4">
                <div className="max-h-[460px] overflow-x-auto overflow-y-auto pr-1">
                  <table className="min-w-full border-separate border-spacing-y-0">
                    <thead>
                      <tr className="text-left text-sm font-extrabold uppercase tracking-wide text-slate-700">
                        <th className="w-10 px-2 py-2"></th>
                        <th className="w-14 px-2 py-2">#</th>
                        <th className="px-3 py-2">NAME</th>
                        <th className="px-3 py-2">DESCRIPTION</th>
                        <th className="px-3 py-2 text-center">STATUS</th>
                        <th className="px-3 py-2 text-center whitespace-nowrap">TOTAL WORK HOURS</th>
                        <th className="px-3 py-2">CONFIRMATION</th>
                        <th className="px-3 py-2 text-right whitespace-nowrap">PUSHED TIME</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white">
                      {loading && (
                        <tr>
                          <td colSpan={8} className="px-3 py-6 text-center text-sm text-slate-500">
                            Loading...
                          </td>
                        </tr>
                      )}
                      {!loading && pageItems.length === 0 && (
                        <tr>
                          <td colSpan={8} className="px-3 py-6 text-center text-sm text-slate-500">
                            {statusFilter === "pending" ? "No pending requests" : "No items found"}
                          </td>
                        </tr>
                      )}
                      {!loading &&
                        pageItems.map((item, idx) => {
                          const isSelected = selectedIds.has(item.id);
                          const rowIndex = (page - 1) * pageSize + idx + 1;
                          return (
                            <tr
                              key={item.id}
                              className={`cursor-pointer text-sm hover:bg-slate-50 ${
                                isSelected ? "border-l-4 border-[#2f4d9c] bg-[#e9f2ff]" : ""
                              }`}
                              onClick={() => openDetails(item)}
                            >
                              <td className="px-2 py-3">
                                {statusFilter === "pending" ? (
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={(e) => {
                                      e.stopPropagation();
                                      toggleSelected(item.id);
                                    }}
                                    className="h-4 w-4 accent-[#2f4d9c]"
                                  />
                                ) : (
                                  <input
                                    type="checkbox"
                                    checked={false}
                                    disabled
                                    className="h-4 w-4 accent-[#2f4d9c] opacity-40"
                                  />
                                )}
                              </td>
                              <td className="px-2 py-3 text-center text-sm tabular-nums font-sans text-slate-600">
                                {rowIndex}
                              </td>
                              <td className="px-3 py-3 font-medium text-slate-700">
                                <div>{item.name}</div>
                                <div className="text-xs text-slate-400">{item.studentId}</div>
                              </td>
                              <td className="px-3 py-3 text-slate-600">{item.description}</td>
                              <td className="px-3 py-3 text-center">
                                <StatusPill status={item.status} variant="supervisor" />
                              </td>
                              <td className="px-3 py-3 text-center">
                                <WorkHoursBadge hours={item.hours} />
                              </td>
                              <td className="px-3 py-3">
                                {item.status === "approved" ? (
                                  <span className="inline-flex items-center gap-2 text-xs font-semibold text-[#15803d]">
                                    <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-[#15803d] bg-[#15803d] text-[10px] text-white">
                                      ✓
                                    </span>
                                    Confirmed
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-2 text-xs font-semibold text-[#c2410c]">
                                    <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-[#c2410c] bg-white text-[10px] text-[#c2410c]">
                                      ○
                                    </span>
                                    Unconfirmed
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-3 text-right tabular-nums font-sans font-semibold text-slate-800">
                                {submittedTimeById(item.id)}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
                <PaginationControls
                  page={page}
                  totalPages={totalPages}
                  onPrev={() => setPage((p) => Math.max(1, p - 1))}
                  onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disablePrev={page <= 1 || submitting}
                  disableNext={page >= totalPages || submitting}
                />
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    onClick={openDistributeModal}
                    className="rounded bg-[#2f4d9c] px-4 py-2 text-sm font-semibold text-white hover:bg-[#264183]"
                  >
                    Distribute Workload
                  </button>
                </div>
              </div>

              {detailsOpen && detailsItem && (
                <div
                  className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
                  onClick={closeDetails}
                >
                  <div
                    className="w-full max-w-2xl rounded-sm bg-white p-0 shadow"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="rounded-sm border border-black">
                      <div className="flex items-center justify-between gap-4 border-b border-black/30 bg-white px-5 py-3">
                        <div className="rounded-sm bg-[#2f4d9c] px-4 py-2 text-sm font-bold text-white tabular-nums font-sans">
                          {detailsItem.studentId}-{detailsItem.semesterLabel}
                          {detailsItem.periodLabel}
                        </div>
                        <div className="flex items-center gap-3 text-sm font-semibold text-slate-800">
                          <span className="text-base">{statusLabel(detailsItem.status)}</span>
                          <button
                            type="button"
                            onClick={closeDetails}
                            className="rounded bg-slate-200 px-3 py-1 text-xs font-bold text-slate-700 hover:bg-slate-300"
                          >
                            Close
                          </button>
                        </div>
                      </div>

                      <div className="space-y-4 px-5 py-4">
                        <div className="grid grid-cols-2 gap-4">
                          <InfoField label="Name" value={detailsItem.name} />
                          <InfoField label="Employee ID" value={detailsItem.studentId} />
                          <InfoField
                            label="Total Work Hours"
                            value={String(
                              detailsBreakdown
                                ? (["Teaching", "Assigned Roles", "HDR", "Service"] as BreakdownCategory[]).reduce(
                                    (tabSum, tab) => tabSum + detailsBreakdown[tab].reduce((sum, row) => sum + row.hours, 0),
                                    0
                                  )
                                : detailsItem.hours
                            )}
                            className="tabular-nums font-sans"
                          />
                          <InfoField label="Status" value={statusLabel(detailsItem.status)} />
                        </div>
                        <div>
                          <div className="text-xs font-semibold uppercase text-slate-500">Workload Breakdown</div>
                          <div className="mt-1 overflow-hidden rounded border border-slate-300">
                            <div className="flex flex-wrap gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
                              {(["Teaching", "Assigned Roles", "HDR", "Service"] as BreakdownCategory[]).map((tab) => (
                                <button
                                  key={tab}
                                  type="button"
                                  onClick={() => setDetailsTab(tab)}
                                  className={`rounded px-3 py-1 text-xs font-semibold ${
                                    detailsTab === tab
                                      ? "bg-[#2f4d9c] text-white"
                                      : "bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-100"
                                  }`}
                                >
                                  {tab}
                                </button>
                              ))}
                            </div>
                            <table className="min-w-full">
                              <thead className="bg-white">
                                <tr className="text-left text-xs font-semibold uppercase text-slate-600">
                                  <th className="px-3 py-2">{detailsTab}</th>
                                  <th className="px-3 py-2 text-right">Hours</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-200 bg-white text-sm text-slate-700">
                                {(detailsBreakdown?.[detailsTab] ?? breakdownById(detailsItem.id)[detailsTab]).map((row, idx) => (
                                  <tr key={`${detailsItem.id}-${detailsTab}-${idx}`}>
                                    <td className="px-3 py-2">{row.name}</td>
                                    <td className="px-3 py-2 text-right tabular-nums font-sans">{row.hours}</td>
                                  </tr>
                                ))}
                                <tr className="bg-slate-50">
                                  <td className="px-3 py-2 font-semibold">Total</td>
                                  <td className="px-3 py-2 text-right font-semibold tabular-nums font-sans">
                                    {(detailsBreakdown?.[detailsTab] ?? breakdownById(detailsItem.id)[detailsTab]).reduce(
                                      (sum, row) => sum + row.hours,
                                      0
                                    )}
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-semibold uppercase text-slate-500">Description</div>
                          <textarea
                            readOnly
                            value={cleanDescription(detailsItem.description)}
                            className="mt-1 h-24 w-full resize-none rounded border border-slate-300 px-3 py-2 text-sm"
                          />
                        </div>
                        <div className="flex items-center justify-center pt-1">
                          <button
                            type="button"
                            onClick={closeDetails}
                            className={`rounded-md px-6 py-2 text-sm font-semibold ${
                              detailsItem.status === "approved"
                                ? "bg-[#16a34a] text-white"
                                : "bg-[#2f4d9c] text-white hover:bg-[#29458c]"
                            }`}
                          >
                            Confirmed
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {distributeModalOpen && (
                <div className="fixed inset-0 z-[82] flex items-center justify-center bg-black/40 p-4">
                  <div className="w-full max-w-md rounded-md bg-white shadow-lg">
                    <div className="flex items-center justify-between rounded-t-md bg-[#2f4d9c] px-5 py-3 text-white">
                      <div className="text-base font-bold">Distribute Workload</div>
                      <button
                        type="button"
                        className="inline-flex h-8 w-8 items-center justify-center rounded bg-white/10 text-lg hover:bg-white/20"
                        onClick={closeDistributeModal}
                      >
                        ×
                      </button>
                    </div>
                    <div className="space-y-4 p-5">
                      <div>
                        <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Year</div>
                        <input
                          type="number"
                          value={distributeYearInput}
                          onChange={(e) => setDistributeYearInput(e.target.value)}
                          className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                          placeholder="Year"
                        />
                      </div>
                      <div>
                        <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Semester</div>
                        <select
                          value={distributeSemesterInput}
                          onChange={(e) => setDistributeSemesterInput(e.target.value as "S1" | "S2")}
                          className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                        >
                          <option value="S1">S1</option>
                          <option value="S2">S2</option>
                        </select>
                      </div>
                      {distributeError && <div className="text-sm font-semibold text-[#dc2626]">{distributeError}</div>}
                      <div className="flex items-center justify-end gap-3 pt-1">
                        <button
                          type="button"
                          onClick={closeDistributeModal}
                          className="rounded bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-300"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handleConfirmDistributeWorkload}
                          className="rounded bg-[#2f4d9c] px-4 py-2 text-sm font-semibold text-white hover:bg-[#264183]"
                        >
                          Confirm
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {noteModalOpen && (
                <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4">
                  <div className="w-full max-w-lg rounded-md bg-white shadow-lg">
                    <div className="flex items-center justify-between rounded-t-md bg-[#2f4d9c] px-5 py-3 text-white">
                      <div className="text-base font-bold">
                        {noteDecision === "approve" ? "Approved Notes" : "Rejected Notes"}
                      </div>
                      <button
                        type="button"
                        className="inline-flex h-8 w-8 items-center justify-center rounded bg-white/10 text-lg hover:bg-white/20"
                        onClick={() => {
                          setNoteModalOpen(false);
                          setNoteError("");
                        }}
                      >
                        ×
                      </button>
                    </div>
                    <div className="space-y-3 p-5">
                      <div className="text-sm font-semibold text-slate-700">Notes for Academic</div>
                      <textarea
                        value={noteDraft}
                        onChange={(e) => {
                          setNoteDraft(e.target.value);
                          if (noteError) setNoteError("");
                        }}
                        maxLength={240}
                        placeholder="Write your feedback..."
                        className="h-32 w-full resize-none rounded border border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none focus:border-[#2f4d9c]"
                      />
                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <span>{noteError ? <span className="text-[#dc2626]">{noteError}</span> : " "}</span>
                        <span>{noteDraft.length}/240</span>
                      </div>
                      <div className="flex justify-center">
                        <button
                          type="button"
                          onClick={handleFinishNote}
                          className="rounded bg-[#2f4d9c] px-6 py-2 text-sm font-semibold text-white hover:bg-[#264183]"
                        >
                          Finished
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeSection === "admin" && (
            <div className="rounded-md bg-white p-8">
              <SectionTitleBlock
                title="Employee Management"
                description="Search staff members, import templates, and review latest profile update times."
                rightSlot={
                  <TemplateImportExportActions
                    onDownload={handleDownloadTemplate}
                    onOpenImport={handleOpenImport}
                    fileInputRef={fileInputRef}
                    onImportChange={handleImportTemplate}
                  />
                }
              />
              {importMessage && <div className="mt-3 text-sm font-semibold text-[#2f4d9c]">{importMessage}</div>}

              <div className="mt-6 rounded-md border border-slate-200 bg-slate-50 p-4">
                <FilterFormRow
                  fields={[
                    {
                      key: "firstName",
                      label: "First name",
                      input: (
                        <input
                          value={adminSearchFirstNameInput}
                          onChange={(e) => setAdminSearchFirstNameInput(e.target.value)}
                          className="rounded border border-slate-300 bg-white px-3 py-2 text-sm"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              handleAdminSearch();
                            }
                          }}
                        />
                      ),
                    },
                    {
                      key: "lastName",
                      label: "Last name",
                      input: (
                        <input
                          value={adminSearchLastNameInput}
                          onChange={(e) => setAdminSearchLastNameInput(e.target.value)}
                          className="rounded border border-slate-300 bg-white px-3 py-2 text-sm"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              handleAdminSearch();
                            }
                          }}
                        />
                      ),
                    },
                    {
                      key: "staffId",
                      label: "Staff ID",
                      input: (
                        <input
                          value={adminSearchStaffIdInput}
                          onChange={(e) => setAdminSearchStaffIdInput(e.target.value)}
                          className="rounded border border-slate-300 bg-white px-3 py-2 text-sm tabular-nums font-sans"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              handleAdminSearch();
                            }
                          }}
                        />
                      ),
                    },
                  ]}
                  action={
                    <button
                      type="button"
                      onClick={handleAdminSearch}
                      className="w-24 rounded bg-[#2f4d9c] px-5 py-2 text-sm font-semibold text-white hover:bg-[#264183]"
                    >
                      Search
                    </button>
                  }
                />

                <div className="mt-4 rounded border border-slate-200 bg-white">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-100 text-slate-700">
                      <tr>
                        <th className="px-3 py-2 text-left">Staff ID</th>
                        <th className="px-3 py-2 text-left">Name</th>
                        <th className="px-3 py-2 text-left">Title</th>
                        <th className="px-3 py-2 text-left">Department</th>
                        <th className="px-3 py-2 text-right">Modified Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adminPageItems.map((person) => (
                        <tr
                          key={person.id}
                          className={`border-t border-slate-100 ${
                            person.isActive ? "cursor-pointer hover:bg-slate-50" : "bg-slate-100/70 text-slate-400"
                          }`}
                          onClick={() => openStaffModal(person)}
                        >
                          <td className="px-3 py-2 tabular-nums font-sans">{person.staffId}</td>
                          <td className="px-3 py-2">
                            {person.firstName} {person.lastName}
                          </td>
                          <td className="px-3 py-2">{person.title || "-"}</td>
                          <td className="px-3 py-2">{person.currentDepartment || "-"}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-sans text-slate-700">
                            {modifiedTimeById(person.id)}
                          </td>
                        </tr>
                      ))}
                      {adminPageItems.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-3 py-4 text-center text-slate-500">
                            No staff found.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <PaginationControls
                  page={adminPage}
                  totalPages={adminTotalPages}
                  onPrev={() => setAdminPage((p) => Math.max(1, p - 1))}
                  onNext={() => setAdminPage((p) => Math.min(adminTotalPages, p + 1))}
                  disablePrev={adminPage <= 1}
                  disableNext={adminPage >= adminTotalPages}
                />
              </div>
              <StaffProfileModal
                open={staffModalOpen}
                draft={staffDraft}
                departments={availableDepartments}
                error={staffModalError}
                onClose={closeStaffModal}
                onFieldChange={(field, value) => {
                  setStaffDraft((prev) => {
                    if (!prev) return prev;
                    if (field === "id") return prev;
                    return {
                      ...prev,
                      [field]: value,
                    };
                  });
                }}
                onUpdate={handleUpdateStaffDraft}
              />

              {cancelConfirmOpen && (
                <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4">
                  <div className="w-full max-w-md rounded-md bg-white p-5 shadow-lg">
                    <div className="text-base font-semibold text-slate-800">Cancel this role permission?</div>
                    <div className="mt-5 flex items-center justify-end gap-3">
                      <button
                        type="button"
                        onClick={closeCancelConfirm}
                        className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        No
                      </button>
                      <button
                        type="button"
                        onClick={confirmCancelPermission}
                        className="rounded bg-[#dc2626] px-4 py-2 text-sm font-semibold text-white hover:bg-[#b91c1c]"
                      >
                        Yes
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeSection === "visualization" && (
            <div className="rounded-md bg-white p-8">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="pt-3">
                  <div className="text-2xl font-semibold text-slate-800">Visualization</div>
                  <div className="mt-3 text-sm text-slate-600">
                    School-level and department-level workload analytics for HoS.
                  </div>
                </div>
                <div className="w-full max-w-[280px] rounded-md border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase text-[#1e3a8a]">Total Departments</div>
                  <div className="mt-1 text-2xl font-bold text-slate-800">{schoolSummary.totalDepartments}</div>
                  <div className="mt-2 flex flex-nowrap gap-1.5 text-xs">
                    {filteredDepartmentStats.map((item) => (
                      <span
                        key={`header-dept-${item.department}`}
                        className={`whitespace-nowrap rounded-md px-2 py-1 font-semibold ${
                          item.department === "Computer Science & Software Engineering"
                            ? "bg-[#1f3b86] text-white"
                            : item.department === "Mathematics & Statistics"
                              ? "bg-[#4f75cf] text-white"
                              : "bg-[#a9c4f7] text-[#0f172a]"
                        }`}
                      >
                        {shortDepartmentName(item.department)}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="text-2xl font-semibold text-[#2f4d9c]">Reporting Filter</div>
                    <div className="mt-3 text-sm text-[#2f4d9c]">
                      Select year and semester to update the reporting window for all charts.
                    </div>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <div>
                    <div className="mb-1 w-fit rounded bg-[#2f4d9c] px-3 py-1 text-xs font-bold text-white">Year</div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={visualYearFromInput}
                        onChange={(e) => setVisualYearFromInput(e.target.value)}
                        className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                        placeholder="From"
                      />
                      <span className="text-sm text-slate-500">to</span>
                      <input
                        type="number"
                        value={visualYearToInput}
                        onChange={(e) => setVisualYearToInput(e.target.value)}
                        className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                        placeholder="To"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="mb-1 w-fit rounded bg-[#2f4d9c] px-3 py-1 text-xs font-bold text-white">Semester</div>
                    <select
                      value={visualSemesterInput}
                      onChange={(e) => setVisualSemesterInput(e.target.value as "All" | "S1" | "S2")}
                      className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                    >
                      <option value="All">All</option>
                      <option value="S1">S1</option>
                      <option value="S2">S2</option>
                    </select>
                  </div>

                  <div>
                    <div className="mb-1 w-fit rounded bg-[#2f4d9c] px-3 py-1 text-xs font-bold text-white">
                      Department
                    </div>
                    <select
                      value={visualDepartmentInput}
                      onChange={(e) => setVisualDepartmentInput(e.target.value)}
                      className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                    >
                      <option value="All Departments">All Departments</option>
                      {departmentStats.map((item) => (
                        <option key={item.department} value={item.department}>
                          {item.department}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={handleApplyVisualizationFilter}
                      className="w-full rounded bg-[#2f4d9c] px-4 py-2 text-sm font-semibold text-white hover:bg-[#264183]"
                    >
                      Apply
                    </button>
                  </div>
                </div>
                <div className="mt-3 text-sm font-semibold text-[#2f4d9c]">
                  For readability, the dashboard displays up to 3 full academic years at a time. You can export more
                  data in the Export Excel tab.
                </div>
                {visualFilterError && (
                  <div className="mt-3 text-sm font-semibold text-[#dc2626]">{visualFilterError}</div>
                )}
              </div>
              <div className="mt-3">
                <div className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-5 py-2 text-base text-slate-800 shadow-sm">
                  <span className="text-[#1e3a8a]">Reporting Period:</span>
                  <span className="rounded-md border border-[#93c5fd] bg-[#eff6ff] px-2.5 py-1 font-bold text-[#1e3a8a]">
                    {reportingPeriodLabel}
                  </span>
                  <span className="text-[#93c5fd]">|</span>
                  <span className="text-[#1e3a8a]">Scope:</span>
                  <span className="rounded-md border border-[#93c5fd] bg-[#eff6ff] px-2.5 py-1 font-bold text-[#1e3a8a]">
                    {scopeLabel}
                  </span>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
                <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase text-[#1e3a8a]">Total Academics</div>
                  <div className="mt-1 text-2xl font-bold text-slate-800">{schoolSummary.totalAcademics}</div>
                  <div className="mt-2 flex flex-nowrap gap-1.5 text-xs">
                    {(() => {
                      const top = maxValue(filteredDepartmentStats.map((item) => item.academics));
                      return filteredDepartmentStats.map((item) => (
                        <span
                          key={`acad-${item.department}`}
                          className={`whitespace-nowrap rounded-md px-2 py-1 ${departmentHighlightClass(item.department, item.academics === top)}`}
                        >
                        {shortDepartmentName(item.department)}: {item.academics}
                        </span>
                      ));
                    })()}
                  </div>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase text-[#1e3a8a]">Total Work Hours</div>
                  <div className="mt-1 text-2xl font-bold text-slate-800">{schoolSummary.totalWorkHours}</div>
                  <div className="mt-2 flex flex-nowrap gap-1.5 text-xs">
                    {(() => {
                      const top = maxValue(filteredDepartmentStats.map((item) => item.totalHours));
                      return filteredDepartmentStats.map((item) => (
                        <span
                          key={`hours-${item.department}`}
                          className={`whitespace-nowrap rounded-md px-2 py-1 ${departmentHighlightClass(item.department, item.totalHours === top)}`}
                        >
                        {shortDepartmentName(item.department)}: {item.totalHours}
                        </span>
                      ));
                    })()}
                  </div>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase text-[#1e3a8a]">Work Hours per Academic</div>
                  <div className="mt-1 text-2xl font-bold text-slate-800">{averageWorkloadPerAcademicOverall}</div>
                  <div className="mt-2 flex flex-nowrap gap-1.5 text-xs">
                    {(() => {
                      const top = maxValue(workloadPerAcademicByDepartment.map((item) => item.value));
                      return workloadPerAcademicByDepartment.map((item) => (
                        <span
                          key={`per-capita-${item.department}`}
                          className={`whitespace-nowrap rounded-md px-2 py-1 ${departmentHighlightClass(item.department, item.value === top)}`}
                        >
                          {shortDepartmentName(item.department)}: {item.value}
                        </span>
                      ));
                    })()}
                  </div>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase text-[#1e3a8a]">Pending Requests</div>
                  <div className="mt-1 text-2xl font-bold text-[#d97706]">{schoolSummary.pendingRequests}</div>
                  <div className="mt-2 flex flex-nowrap gap-1.5 text-xs">
                    {(() => {
                      const top = maxValue(filteredDepartmentStats.map((item) => item.pending));
                      return filteredDepartmentStats.map((item) => (
                        <span
                          key={`pend-${item.department}`}
                          className={`whitespace-nowrap rounded-md px-2 py-1 ${departmentHighlightClass(item.department, item.pending === top)}`}
                        >
                        {shortDepartmentName(item.department)}: {item.pending}
                        </span>
                      ));
                    })()}
                  </div>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase text-[#1e3a8a]">Approved Requests</div>
                  <div className="mt-1 text-2xl font-bold text-[#16a34a]">{schoolSummary.approvedRequests}</div>
                  <div className="mt-2 flex flex-nowrap gap-1.5 text-xs">
                    {(() => {
                      const top = maxValue(filteredDepartmentStats.map((item) => item.approved));
                      return filteredDepartmentStats.map((item) => (
                        <span
                          key={`appr-${item.department}`}
                          className={`whitespace-nowrap rounded-md px-2 py-1 ${departmentHighlightClass(item.department, item.approved === top)}`}
                        >
                        {shortDepartmentName(item.department)}: {item.approved}
                        </span>
                      ));
                    })()}
                  </div>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase text-[#1e3a8a]">Rejected Requests</div>
                  <div className="mt-1 text-2xl font-bold text-[#dc2626]">{schoolSummary.rejectedRequests}</div>
                  <div className="mt-2 flex flex-nowrap gap-1.5 text-xs">
                    {(() => {
                      const top = maxValue(filteredDepartmentStats.map((item) => item.rejected));
                      return filteredDepartmentStats.map((item) => (
                        <span
                          key={`rej-${item.department}`}
                          className={`whitespace-nowrap rounded-md px-2 py-1 ${departmentHighlightClass(item.department, item.rejected === top)}`}
                        >
                        {shortDepartmentName(item.department)}: {item.rejected}
                        </span>
                      ));
                    })()}
                  </div>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-2">
                <div className="h-[380px] rounded-md border border-slate-200 p-4">
                  <div className="mb-3 text-sm font-semibold text-slate-700">Department Total Workload</div>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={totalWorkHoursByDepartment} margin={{ left: 8, right: 8, top: 8, bottom: 28 }}>
                        <CartesianGrid stroke="#cbd5e1" strokeOpacity={0.45} strokeDasharray="3 3" />
                        <XAxis dataKey="departmentShort" tick={chartTickStyle}>
                          <Label value="Department" offset={-5} position="insideBottomRight" style={axisLabelStyle} />
                        </XAxis>
                        <YAxis tick={chartTickStyle}>
                          <Label
                            value="Total Work Hours"
                            angle={-90}
                            position="insideLeft"
                            style={axisLabelStyle}
                          />
                        </YAxis>
                        <Tooltip
                          formatter={(value: number) => [`${value} hours`, ""]}
                          labelFormatter={(label: string) => label}
                          contentStyle={{ fontSize: 12, fontFamily: "Inter, Arial, sans-serif" }}
                          itemStyle={{ color: "#1e293b" }}
                        />
                        <Bar dataKey="totalWorkHours" radius={[4, 4, 0, 0]} barSize={30}>
                          {totalWorkHoursByDepartment.map((item) => (
                            <Cell
                              key={`total-${item.department}`}
                              fill={departmentColorMap[item.department] || "#1e3a8a"}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="h-[380px] rounded-md border border-slate-200 p-4">
                  <div className="mb-3 text-sm font-semibold text-slate-700">Average Workload per Department</div>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={averageWorkHoursByDepartment} margin={{ left: 24, right: 8, top: 8, bottom: 28 }}>
                        <CartesianGrid stroke="#cbd5e1" strokeOpacity={0.45} strokeDasharray="3 3" />
                        <XAxis dataKey="departmentShort" tick={chartTickStyle}>
                          <Label value="Department" offset={-5} position="insideBottomRight" style={axisLabelStyle} />
                        </XAxis>
                        <YAxis tick={chartTickStyle}>
                          <Label
                            value="Average Hours"
                            angle={-90}
                            position="insideLeft"
                            style={axisLabelStyle}
                          />
                        </YAxis>
                        <Tooltip
                          formatter={(value: number) => [`${value} hours`, ""]}
                          labelFormatter={(label: string) => label}
                          contentStyle={{ fontSize: 12, fontFamily: "Inter, Arial, sans-serif" }}
                          itemStyle={{ color: "#1e293b" }}
                        />
                        <Bar dataKey="averageWorkHours" radius={[4, 4, 0, 0]} barSize={30}>
                          {averageWorkHoursByDepartment.map((item) => (
                            <Cell
                              key={`avg-${item.department}`}
                              fill={departmentColorMap[item.department] || "#3b82f6"}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="h-[380px] rounded-md border border-slate-200 p-4">
                  <div className="mb-3 text-sm font-semibold text-slate-700">Approval Progress by Department</div>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={approvalStatusByDepartment} margin={{ left: 40, right: 8, top: 8, bottom: 28 }}>
                        <CartesianGrid stroke="#cbd5e1" strokeOpacity={0.45} strokeDasharray="3 3" />
                        <XAxis dataKey="departmentShort" tick={chartTickStyle}>
                          <Label value="Department" offset={-5} position="insideBottomRight" style={axisLabelStyle} />
                        </XAxis>
                        <YAxis tick={chartTickStyle}>
                          <Label
                            value="Records"
                            angle={-90}
                            position="insideLeft"
                            offset={12}
                            style={axisLabelStyle}
                          />
                        </YAxis>
                        <Tooltip
                          labelFormatter={(label: string) => label}
                          contentStyle={{ fontSize: 12, fontFamily: "Inter, Arial, sans-serif" }}
                        />
                        <Legend verticalAlign="top" align="right" wrapperStyle={legendStyle} />
                        <Bar dataKey="pending" name="Pending" stackId="status" fill="#f59e0b" barSize={30} />
                        <Bar dataKey="approved" name="Approved" stackId="status" fill="#22c55e" barSize={30} />
                        <Bar dataKey="rejected" name="Rejected" stackId="status" fill="#ef4444" barSize={30} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="h-[380px] rounded-md border border-slate-200 p-4">
                  <div className="mb-3 text-sm font-semibold text-slate-700">Department Workload Trend</div>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={filteredTrendData} margin={{ left: 8, right: 8, top: 8, bottom: 28 }}>
                        <CartesianGrid stroke="#cbd5e1" strokeOpacity={0.45} strokeDasharray="3 3" />
                        <XAxis dataKey="semester" tick={chartTickStyle}>
                          <Label value="Semester" offset={-5} position="insideBottomRight" style={axisLabelStyle} />
                        </XAxis>
                        <YAxis tick={chartTickStyle}>
                          <Label
                            value="Total Work Hours"
                            angle={-90}
                            position="insideLeft"
                            style={axisLabelStyle}
                          />
                        </YAxis>
                        <Tooltip
                          formatter={(value: number, name: string) => [`${value} hours`, name]}
                          contentStyle={{ fontSize: 12, fontFamily: "Inter, Arial, sans-serif" }}
                        />
                        <ReferenceLine
                          x={currentSemesterLabel}
                          stroke="#0f172a"
                          strokeOpacity={0.35}
                          strokeDasharray="4 4"
                          ifOverflow="extendDomain"
                        />
                        <Legend
                          verticalAlign="top"
                          align="right"
                          wrapperStyle={legendStyle}
                          formatter={(value: string) => {
                            if (value === "Computer Science & Software Engineering") return "CS&SE";
                            if (value === "Mathematics & Statistics") return "Math&Stats";
                            return value;
                          }}
                        />
                        {filteredDepartmentStats.map((item) => (
                          <Line
                            key={item.department}
                            type="monotone"
                            dataKey={item.department}
                            stroke={departmentColorMap[item.department] || "#1e3a8a"}
                            strokeWidth={2}
                            dot={(props: any) => {
                              const isCurrentSemester = props?.payload?.semester === currentSemesterLabel;
                              return (
                                <circle
                                  cx={props.cx}
                                  cy={props.cy}
                                  r={isCurrentSemester ? 6 : 3}
                                  fill={departmentColorMap[item.department] || "#1e3a8a"}
                                  stroke="#ffffff"
                                  strokeWidth={isCurrentSemester ? 2 : 1}
                                />
                              );
                            }}
                          />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeSection === "export" && (
            <div className="rounded-md bg-white p-8">
              <div className="text-2xl font-semibold text-slate-800">Export Excel</div>
              <div className="mt-3 text-sm text-slate-600">
                Configure optional filters to export more complete historical workload data to Excel.
              </div>

              <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div>
                  <div className="mb-1 w-fit rounded bg-[#2f4d9c] px-3 py-1 text-xs font-bold text-white">Year</div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={exportYearFromInput}
                      onChange={(e) => setExportYearFromInput(e.target.value)}
                      className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                      placeholder="From"
                    />
                    <span className="text-sm text-slate-500">to</span>
                    <input
                      type="number"
                      value={exportYearToInput}
                      onChange={(e) => setExportYearToInput(e.target.value)}
                      className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                      placeholder="To"
                    />
                  </div>
                </div>

                <div>
                  <div className="mb-1 w-fit rounded bg-[#2f4d9c] px-3 py-1 text-xs font-bold text-white">Semester</div>
                  <select
                    value={exportSemesterInput}
                    onChange={(e) => setExportSemesterInput(e.target.value as "All" | "S1" | "S2")}
                    className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                  >
                    <option value="All">All</option>
                    <option value="S1">S1</option>
                    <option value="S2">S2</option>
                  </select>
                </div>

                <div>
                  <div className="mb-1 w-fit rounded bg-[#2f4d9c] px-3 py-1 text-xs font-bold text-white">
                    Department
                  </div>
                  <select
                    value={exportDepartmentInput}
                    onChange={(e) => setExportDepartmentInput(e.target.value)}
                    className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                  >
                    <option value="All Departments">All Departments</option>
                    {departmentStats.map((item) => (
                      <option key={`export-dept-${item.department}`} value={item.department}>
                        {item.department}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-end">
                  <button
                    type="button"
                    className="w-full rounded bg-[#2f4d9c] px-4 py-2 text-sm font-semibold text-white hover:bg-[#264183]"
                  >
                    Export Excel
                  </button>
                </div>
              </div>
              <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                If both years are blank, export all years. If only <span className="font-semibold">From</span> is
                blank, export from the earliest available year to <span className="font-semibold">To</span>. If only{" "}
                <span className="font-semibold">To</span> is blank, export from <span className="font-semibold">From</span>{" "}
                to the latest available year.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
