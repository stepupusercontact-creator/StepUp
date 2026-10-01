
import { pipeline } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.16.1/dist/transformers.min.js';

const SUPABASE_URL = 'https://pzhtjegromovjbevyjki.supabase.co';
const SUPABASE_KEY = 'sb_publishable_G0r-QwmfkGyV32W08uxsgQ_amj0c-Fm';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let globalSchoolId = null;
let aiClassifier = null;
const unsupportedDirColumns = new Set();

let state = {
    user: null, 
    school: null,
    directory: { students: [], teachers: [] },
    backendData: {
        attendance: [],
        grades: [],
        assignments: [],
        submissions: []
    },
    timetables: {
        timeSlots: ["08:00-09:00", "09:00-10:00", "10:00-11:00", "11:00-11:30", "11:30-12:30"],
        currentDay: "Mon",
        data: {}
    },
    activeProfile: null, 
    timeScale: 'weekly', 
    timeOffset: 0,
    calendarDate: new Date(), 
    calendarEvents: [],
    selectedDateStr: null,
    charts: { 
        attendance: null, 
        grades: null, 
        assignments: null, 
        modalAtt: null, 
        modalPerf: null,
        analyticsCompare: null,
        analyticsDist: null
    },
    currentChatGroup: 'all',
    chatMessages: [],
    editingMessageId: null,
    pendingChatFile: null,
    directoryView: {
        activeType: 'student',
        searchQuery: '',
        gradeFilter: 'all',
        sectionFilter: 'all',
        deptFilter: 'all',
        sortBy: 'name-asc',
        limit: 12,
        page: 1
    },
    analyticsView: {
        activeMetric: 'attendance',
        selectedClass: null,
        classSearch: '',
        gradeFilter: 'all',
        classSortBy: 'metric-desc',
        studentSearch: '',
        studentSortBy: 'metric-desc'
    },
    archiveView: {
        records: [],
        filteredRecords: [],
        searchQuery: '',
        roleFilter: 'all',
        batchFilter: 'all'
    }
};

// ==========================================
// In-App Toast & Modal Notifications Engine
// ==========================================
function showToast(message, type = 'info', title = '') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const icons = {
        success: `<svg viewBox="0 0 24 24" class="toast-icon" style="color:var(--success)"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" stroke-width="2"></path><polyline points="22 4 12 14.01 9 11.01" stroke-width="2"></polyline></svg>`,
        error: `<svg viewBox="0 0 24 24" class="toast-icon" style="color:var(--danger)"><circle cx="12" cy="12" r="10" stroke-width="2"></circle><line x1="15" y1="9" x2="9" y2="15" stroke-width="2"></line><line x1="9" y1="9" x2="15" y2="15" stroke-width="2"></line></svg>`,
        warning: `<svg viewBox="0 0 24 24" class="toast-icon" style="color:var(--warning)"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" stroke-width="2"></path><line x1="12" y1="9" x2="12" y2="13" stroke-width="2"></line><line x1="12" y1="17" x2="12.01" y2="17" stroke-width="2"></line></svg>`,
        info: `<svg viewBox="0 0 24 24" class="toast-icon" style="color:var(--primary)"><circle cx="12" cy="12" r="10" stroke-width="2"></circle><line x1="12" y1="16" x2="12" y2="12" stroke-width="2"></line><line x1="12" y1="8" x2="12.01" y2="8" stroke-width="2"></line></svg>`
    };

    toast.innerHTML = `
        ${icons[type] || icons.info}
        <div class="toast-content flex-grow">
            ${title ? `<div class="toast-title">${title}</div>` : ''}
            <div class="toast-msg">${message}</div>
        </div>
        <button class="toast-close" aria-label="Close">&times;</button>
    `;

    container.appendChild(toast);
    toast.querySelector('.toast-close').addEventListener('click', () => toast.remove());
    
    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 300);
    }, 4500);
}

window.showConfirmDialog = ({ title, description, onConfirm }) => {
    const modal = document.getElementById('confirm-modal');
    document.getElementById('confirm-title').innerText = title;
    document.getElementById('confirm-desc').innerText = description;
    
    modal.classList.remove('hidden');

    const confirmBtn = document.getElementById('confirm-ok-btn');
    const cancelBtn = document.getElementById('confirm-cancel-btn');

    const cleanup = () => {
        modal.classList.add('hidden');
        confirmBtn.replaceWith(confirmBtn.cloneNode(true));
        cancelBtn.replaceWith(cancelBtn.cloneNode(true));
    };

    confirmBtn.onclick = async () => {
        const originalText = confirmBtn.innerText;
        confirmBtn.innerText = "Processing...";
        confirmBtn.disabled = true;
        try {
            if (onConfirm) await onConfirm();
        } finally {
            confirmBtn.innerText = originalText;
            confirmBtn.disabled = false;
            cleanup();
        }
    };
    
    cancelBtn.onclick = () => cleanup();
};

function showPromptDialog({ title, description, placeholder = '', defaultValue = '', onConfirm }) {
    const modal = document.getElementById('prompt-modal');
    document.getElementById('prompt-title').innerText = title;
    document.getElementById('prompt-desc').innerText = description || '';
    const input = document.getElementById('prompt-input');
    input.placeholder = placeholder;
    input.value = defaultValue;
    modal.classList.remove('hidden');
    input.focus();

    const confirmBtn = document.getElementById('prompt-confirm-btn');
    const cancelBtn = document.getElementById('prompt-cancel-btn');

    const cleanup = () => {
        modal.classList.add('hidden');
        confirmBtn.replaceWith(confirmBtn.cloneNode(true));
        cancelBtn.replaceWith(cancelBtn.cloneNode(true));
    };

    confirmBtn.onclick = () => {
        const val = input.value.trim();
        cleanup();
        if (onConfirm) onConfirm(val);
    };
    cancelBtn.onclick = () => cleanup();
}

// ==========================================
// Schema-Adaptive Safe Directory Persistence
// ==========================================
async function detectSupportedColumns() {
    try {
        const { error: emailErr } = await supabase.from('school_directory').select('email').limit(0);
        if (emailErr && (emailErr.message?.includes('email') || emailErr.details?.includes('email'))) {
            unsupportedDirColumns.add('email');
        }
        const { error: phoneErr } = await supabase.from('school_directory').select('phone').limit(0);
        if (phoneErr && (phoneErr.message?.includes('phone') || phoneErr.details?.includes('phone'))) {
            unsupportedDirColumns.add('phone');
        }
    } catch (e) {
        console.warn("Schema probe notice:", e);
    }
}

function sanitizeDirectoryPayload(record) {
    const clean = { ...record };
    unsupportedDirColumns.forEach(col => {
        delete clean[col];
    });
    return clean;
}

async function updateDirectoryRecord(id, payload) {
    let currentPayload = sanitizeDirectoryPayload(payload);

    for (let attempt = 0; attempt < 5; attempt++) {
        const { data, error } = await supabase.from('school_directory').update(currentPayload).eq('id', id);
        if (!error) {
            return { data, error: null };
        }

        const match = error.message?.match(/Could not find the '([^']+)' column of 'school_directory'/i) 
                   || error.message?.match(/column "([^"]+)" of relation "school_directory" does not exist/i)
                   || error.details?.match(/column "([^"]+)"/i);

        if (match && match[1]) {
            const missingCol = match[1];
            unsupportedDirColumns.add(missingCol);
            delete currentPayload[missingCol];
            continue;
        }

        return { data: null, error };
    }
    return { data: null, error: new Error("Failed to update directory record.") };
}

// ==========================================
// Robust Media Upload with Local Fallback
// ==========================================
async function uploadMediaFile(file, bucketName = 'media') {
    if (!file) return null;
    const cleanExt = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
    const safeName = `${bucketName}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${cleanExt}`;
    
    try {
        const { data, error } = await supabase.storage.from(bucketName).upload(safeName, file, {
            cacheControl: '3600',
            upsert: true,
            contentType: file.type || 'image/png'
        });
        if (!error && data) {
            const { data: pubData } = supabase.storage.from(bucketName).getPublicUrl(data.path || safeName);
            if (pubData?.publicUrl) return pubData.publicUrl;
        }
        console.warn(`Supabase Storage notice on bucket '${bucketName}':`, error?.message || error);
    } catch (err) {
        console.warn("Storage API notice:", err);
    }

    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => {
            console.error("FileReader failed");
            resolve(null);
        };
        reader.readAsDataURL(file);
    });
}

// ==========================================
// Self-Healing Initialization & Loop Prevention
// ==========================================
async function init() {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (!session || !session.user) {
        return window.location.replace('../../index.html');
    }
    
    state.user = session.user;
    
    let { data: profile } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
    globalSchoolId = profile?.school_id || session.user.user_metadata?.school_id;

    let school = null;
    if (globalSchoolId) {
        const { data: schoolData } = await supabase.from('schools').select('*').eq('id', globalSchoolId).maybeSingle();
        if (schoolData) {
            school = schoolData;
        } else {
            console.warn("School ID not found in database:", globalSchoolId);
            globalSchoolId = null;
        }
    }

    if (!globalSchoolId || !school) {
        console.warn("Missing valid school setup. Clearing stale session routing data.");
        try {
            await supabase.auth.updateUser({ data: { school_id: null, role: null } });
            if (profile) {
                await supabase.from('profiles').update({ school_id: null, role: null }).eq('id', session.user.id);
            }
        } catch(e) {}
        return window.location.replace('../../index.html');
    }

    if (!profile?.school_id || profile?.role !== 'admin') {
        try {
            await supabase.from('profiles').upsert({
                id: session.user.id,
                full_name: session.user.user_metadata?.full_name || profile?.full_name || 'Administrator',
                role: 'admin',
                school_id: globalSchoolId
            });
        } catch(e) { 
            console.warn("Profile auto-sync notice:", e); 
        }
    }

    state.school = school;

    const displayName = profile?.full_name || session.user.user_metadata?.full_name || 'Admin';
    const adminNameEl = document.getElementById('admin-name');
    const adminInitialEl = document.getElementById('admin-initial');
    if (adminNameEl) adminNameEl.innerText = displayName;
    if (adminInitialEl) adminInitialEl.innerText = displayName.charAt(0).toUpperCase();
    
    const schoolNameEl = document.getElementById('school-name-display');
    const schoolRegionEl = document.getElementById('school-region-display');
    if (schoolNameEl) schoolNameEl.innerText = school.name || 'School Workspace';
    
    if (schoolRegionEl) {
        const regionText = [school.district, school.state, school.country].filter(Boolean).join(', ');
        schoolRegionEl.innerText = regionText ? `Region: ${regionText}` : 'Regional Hub';
    }
    
    if (school.logo_url) {
        const logo = document.getElementById('school-logo-display');
        if (logo) {
            logo.src = school.logo_url;
            logo.classList.remove('hidden');
        }
        const preview = document.getElementById('set-school-logo-preview');
        if (preview) {
            preview.src = school.logo_url;
            preview.classList.remove('hidden');
        }
        document.getElementById('set-school-logo-placeholder')?.classList.add('hidden');
    }

    const sLabel = school.student_id_label || 'Admission Number';
    const tLabel = school.teacher_id_label || 'Employee ID';
    const cfgStudent = document.getElementById('cfg-student-id-label');
    const cfgTeacher = document.getElementById('cfg-teacher-id-label');
    if (cfgStudent) cfgStudent.value = sLabel;
    if (cfgTeacher) cfgTeacher.value = tLabel;
    updateIdentifierPreview(sLabel);
    
    await detectSupportedColumns();
    await checkExistingData();
    await fetchBackendMetrics();
    await fetchTimetableData();
    await fetchCalendarEvents();
    
    bindEvents();
    
    const today = new Date();
    const curMonth = String(today.getMonth() + 1).padStart(2, '0');
    const curDay = String(today.getDate()).padStart(2, '0');
    state.selectedDateStr = `${today.getFullYear()}-${curMonth}-${curDay}`;
    const dateInput = document.getElementById('event-date');
    if (dateInput) dateInput.value = state.selectedDateStr;

    renderCalendar();
    renderSubgroupFilters();
    loadChatMessages();
    renderDashboard();

    try {
        aiClassifier = await pipeline('zero-shot-classification', 'Xenova/mobilebert-uncased-mnli');
    } catch (err) {
        console.warn("Background heuristic fast-path active.", err);
    }
}

async function checkExistingData() {
    if (!globalSchoolId) return;
    const { data, error } = await supabase.from('school_directory').select('*').eq('school_id', globalSchoolId);
    if (!error && data) {
        state.directory.students = data.filter(d => d.role === 'student');
        state.directory.teachers = data.filter(d => d.role === 'teacher');
        updateDirectoryFilterOptions();
        renderDirectory();
        renderMatrix();
        renderSubgroupFilters();
    }
}

// ==========================================
// Real Backend Metrics Synchronizer
// ==========================================
async function fetchBackendMetrics() {
    if (!globalSchoolId) return;

    try {
        const { data: att, error } = await supabase.from('attendance').select('*').eq('school_id', globalSchoolId);
        if (!error && att) state.backendData.attendance = att;
    } catch(e) { console.warn("Attendance query:", e); }

    try {
        const { data: grd, error } = await supabase.from('grades').select('*').eq('school_id', globalSchoolId);
        if (!error && grd) state.backendData.grades = grd;
    } catch(e) { console.warn("Grades query:", e); }

    try {
        const { data: asg, error: asgErr } = await supabase.from('assignments').select('*').eq('school_id', globalSchoolId);
        if (!asgErr && asg) state.backendData.assignments = asg;

        const { data: sub, error: subErr } = await supabase.from('assignment_submissions').select('*').eq('school_id', globalSchoolId);
        if (!subErr && sub) state.backendData.submissions = sub;
    } catch(e) { console.warn("Assignments query:", e); }
}

function renderDashboard() {
    const stuCountEl = document.getElementById('dash-total-students');
    const tchCountEl = document.getElementById('dash-total-teachers');
    if (stuCountEl) stuCountEl.innerText = state.directory.students.length || 0;
    if (tchCountEl) tchCountEl.innerText = state.directory.teachers.length || 0;
    
    const todayStr = new Date().toISOString().split('T')[0];
    const todayLogs = state.backendData.attendance.filter(a => a.date === todayStr);
    const hasTodayAttendance = todayLogs.length > 0;
    const allAttendanceLogs = state.backendData.attendance;

    const avgAttEl = document.getElementById('dash-avg-attendance');
    const attSubEl = document.getElementById('dash-attendance-sub');

    if (hasTodayAttendance) {
        const presentCount = todayLogs.filter(a => a.status?.toLowerCase() === 'present' || a.status?.toLowerCase() === 'late').length;
        const pct = Math.round((presentCount / todayLogs.length) * 100);
        if (avgAttEl) avgAttEl.innerText = `${pct}%`;
        if (attSubEl) attSubEl.innerText = `${presentCount} of ${todayLogs.length} logged today`;
    } else if (allAttendanceLogs.length > 0) {
        const presentTotal = allAttendanceLogs.filter(a => a.status?.toLowerCase() === 'present' || a.status?.toLowerCase() === 'late').length;
        const avgLifetime = Math.round((presentTotal / allAttendanceLogs.length) * 100);
        if (avgAttEl) avgAttEl.innerText = `${avgLifetime}%`;
        if (attSubEl) attSubEl.innerText = `Overall lifetime (${allAttendanceLogs.length} records)`;
    } else {
        if (avgAttEl) avgAttEl.innerText = `--`;
        if (attSubEl) attSubEl.innerText = "No records logged yet";
    }

    // Attendance Chart
    const ctxAtt = document.getElementById('dash-attendance-chart');
    const attEmptyOverlay = document.getElementById('dash-attendance-empty');
    if (ctxAtt) {
        if (state.charts.attendance) state.charts.attendance.destroy();
        const activeLogs = hasTodayAttendance ? todayLogs : allAttendanceLogs;
        if (activeLogs.length === 0) {
            if (attEmptyOverlay) attEmptyOverlay.classList.remove('hidden');
            state.charts.attendance = new Chart(ctxAtt, {
                type: 'doughnut',
                data: { labels: ['No Data'], datasets: [{ data: [1], backgroundColor: ['#E5E7EB'] }] },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { enabled: false } } }
            });
        } else {
            if (attEmptyOverlay) attEmptyOverlay.classList.add('hidden');
            const p = activeLogs.filter(a => a.status?.toLowerCase() === 'present').length;
            const a = activeLogs.filter(a => a.status?.toLowerCase() === 'absent').length;
            const l = activeLogs.filter(a => a.status?.toLowerCase() === 'late').length;
            state.charts.attendance = new Chart(ctxAtt, {
                type: 'doughnut',
                data: {
                    labels: ['Present', 'Absent', 'Late'],
                    datasets: [{ data: [p, a, l], backgroundColor: ['#10B981', '#EF4444', '#F59E0B'] }]
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
            });
        }
    }

    // Grades Chart
    const ctxGrd = document.getElementById('dash-grades-chart');
    const grdEmptyOverlay = document.getElementById('dash-grades-empty');
    if (ctxGrd) {
        if (state.charts.grades) state.charts.grades.destroy();
        const gradeRecords = state.backendData.grades;
        if (gradeRecords.length === 0) {
            if (grdEmptyOverlay) grdEmptyOverlay.classList.remove('hidden');
            state.charts.grades = new Chart(ctxGrd, {
                type: 'bar',
                data: { labels: ['A', 'B', 'C', 'D', 'F'], datasets: [{ data: [0, 0, 0, 0, 0], backgroundColor: '#E5E7EB' }] },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, max: 10 } } }
            });
        } else {
            if (grdEmptyOverlay) grdEmptyOverlay.classList.add('hidden');
            let dist = { A: 0, B: 0, C: 0, D: 0, F: 0 };
            gradeRecords.forEach(g => {
                const max = g.max_score || 100;
                const pct = (Number(g.score) / max) * 100;
                if (pct >= 90) dist.A++;
                else if (pct >= 80) dist.B++;
                else if (pct >= 70) dist.C++;
                else if (pct >= 60) dist.D++;
                else dist.F++;
            });
            state.charts.grades = new Chart(ctxGrd, {
                type: 'bar',
                data: {
                    labels: ['A (90-100)', 'B (80-89)', 'C (70-79)', 'D (60-69)', 'F (<60)'],
                    datasets: [{ label: 'Evaluations', data: [dist.A, dist.B, dist.C, dist.D, dist.F], backgroundColor: '#0056D2', borderRadius: 4 }]
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
            });
        }
    }

    // Assignments Chart
    const ctxAsn = document.getElementById('dash-assignments-chart');
    const asnEmptyOverlay = document.getElementById('dash-assignments-empty');
    if (ctxAsn) {
        if (state.charts.assignments) state.charts.assignments.destroy();
        const assignments = state.backendData.assignments;
        const submissions = state.backendData.submissions;

        if (assignments.length === 0) {
            if (asnEmptyOverlay) asnEmptyOverlay.classList.remove('hidden');
            state.charts.assignments = new Chart(ctxAsn, {
                type: 'line',
                data: { labels: ['Task 1', 'Task 2', 'Task 3', 'Task 4'], datasets: [{ data: [0, 0, 0, 0], borderColor: '#CBD5E1' }] },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, max: 100 } } }
            });
        } else {
            if (asnEmptyOverlay) asnEmptyOverlay.classList.add('hidden');
            state.charts.assignments = new Chart(ctxAsn, {
                type: 'line',
                data: {
                    labels: assignments.map((a, i) => a.title ? (a.title.length > 14 ? a.title.slice(0, 14) + '...' : a.title) : `Task ${i+1}`),
                    datasets: [{ 
                        label: 'Completion %', 
                        data: assignments.map(a => {
                            const subsForAsg = submissions.filter(s => s.assignment_id === a.id);
                            return Math.min(100, Math.round((subsForAsg.length / Math.max(1, state.directory.students.length)) * 100));
                        }), 
                        borderColor: '#0056D2', 
                        tension: 0.3, 
                        fill: true, 
                        backgroundColor: 'rgba(0, 86, 210, 0.08)' 
                    }]
                },
                options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 100 } } }
            });
        }
    }
}

// ==========================================
// Custom Identifier Preferences
// ==========================================
function updateIdentifierPreview(label) {
    const clean = label || "Admission Number";
    const lbl = document.getElementById('preview-student-label');
    const ph = document.getElementById('preview-student-placeholder');
    const hint = document.getElementById('preview-student-hint');
    if (lbl) lbl.innerText = `${clean} (or Email / Phone) *`;
    if (ph) ph.placeholder = `e.g. ${clean}`;
    if (hint) hint.innerText = `Enter your ${clean} as verified by your school.`;
}

document.getElementById('cfg-student-id-label')?.addEventListener('input', (e) => {
    updateIdentifierPreview(e.target.value);
});

window.app = {
    ...window.app,

    saveIdentifierConfig: async () => {
        const sLabel = document.getElementById('cfg-student-id-label')?.value?.trim() || 'Admission Number';
        const tLabel = document.getElementById('cfg-teacher-id-label')?.value?.trim() || 'Employee ID';

        if (!globalSchoolId) return;
        try {
            await supabase.from('schools').update({
                student_id_label: sLabel,
                teacher_id_label: tLabel
            }).eq('id', globalSchoolId);

            if (state.school) {
                state.school.student_id_label = sLabel;
                state.school.teacher_id_label = tLabel;
            }

            showToast(`Identifier names saved! Students will now be asked for "${sLabel}" during onboarding.`, "success");
        } catch(err) {
            showToast("Failed to save identifier settings.", "error");
        }
    },

    openGranularAnalytics: (metricType = 'attendance') => {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
        
        document.getElementById('nav-btn-analytics')?.classList.add('active');
        document.getElementById('analytics-tab')?.classList.remove('hidden');
        
        app.switchAnalyticsMetric(metricType);
    },

    backToDashboard: () => {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
        document.getElementById('nav-btn-dashboard')?.classList.add('active');
        document.getElementById('dashboard-tab')?.classList.remove('hidden');
        renderDashboard();
    },

    switchAnalyticsMetric: (metric) => {
        state.analyticsView.activeMetric = metric;
        state.analyticsView.selectedClass = null;

        ['attendance', 'grades', 'assignments'].forEach(m => {
            document.getElementById(`tab-analytics-${m}`)?.classList.toggle('active', m === metric);
        });

        const metricLabels = {
            attendance: 'Attendance Analytics',
            grades: 'Grade Distribution & Academics',
            assignments: 'Assignment Completion'
        };
        const titleEl = document.getElementById('analytics-breadcrumb-metric');
        if (titleEl) titleEl.innerText = metricLabels[metric];
        document.getElementById('analytics-breadcrumb-class')?.classList.add('hidden');

        app.renderGranularView();
    },

    selectAnalyticsClass: (classKey) => {
        state.analyticsView.selectedClass = classKey;
        const bClass = document.getElementById('analytics-breadcrumb-class');
        if (bClass) {
            bClass.innerText = `Class ${classKey}`;
            bClass.classList.remove('hidden');
        }

        document.getElementById('analytics-class-view')?.classList.add('hidden');
        document.getElementById('analytics-student-view')?.classList.remove('hidden');
        const heading = document.getElementById('analytics-selected-class-title');
        if (heading) heading.innerText = `Class ${classKey}: Student Roster`;

        app.renderStudentsInClass(classKey);
    },

    clearAnalyticsClassSelection: () => {
        state.analyticsView.selectedClass = null;
        document.getElementById('analytics-breadcrumb-class')?.classList.add('hidden');
        document.getElementById('analytics-class-view')?.classList.remove('hidden');
        document.getElementById('analytics-student-view')?.classList.add('hidden');
        app.renderGranularView();
    },

    renderGranularView: () => {
        const metric = state.analyticsView.activeMetric;
        const kpiGrid = document.getElementById('analytics-kpi-grid');
        const metricTh = document.getElementById('th-analytics-metric-name');

        const classMap = {};
        state.directory.students.forEach(s => {
            const key = `${s.grade_level || 'General'}-${s.section || 'A'}`;
            if (!classMap[key]) {
                classMap[key] = {
                    key,
                    grade: s.grade_level || 'General',
                    section: s.section || 'A',
                    students: []
                };
            }
            classMap[key].students.push(s);
        });

        const classList = Object.values(classMap);
        const gradeFilter = document.getElementById('analytics-grade-filter');
        if (gradeFilter) {
            const distinctGrades = [...new Set(classList.map(c => c.grade))].sort();
            gradeFilter.innerHTML = '<option value="all">All Grades</option>' + distinctGrades.map(g => `<option value="${g}" ${state.analyticsView.gradeFilter === g ? 'selected' : ''}>Grade ${g}</option>`).join('');
        }

        if (kpiGrid) {
            if (metric === 'attendance') {
                if (metricTh) metricTh.innerText = "Attendance Rate";
                const totalLogs = state.backendData.attendance.length;
                const presentLogs = state.backendData.attendance.filter(a => a.status?.toLowerCase() === 'present' || a.status?.toLowerCase() === 'late').length;
                const overallRate = totalLogs > 0 ? Math.round((presentLogs / totalLogs) * 100) : 0;

                kpiGrid.innerHTML = `
                    <div class="metric-card centered">
                        <h4>Overall Attendance</h4>
                        <h2>${totalLogs > 0 ? `${overallRate}%` : '--'}</h2>
                        <span class="text-muted" style="font-size:0.75rem;">${totalLogs} logs evaluated</span>
                    </div>
                    <div class="metric-card centered">
                        <h4>Monitored Classes</h4>
                        <h2>${classList.length}</h2>
                        <span class="text-muted" style="font-size:0.75rem;">Active class groups</span>
                    </div>
                    <div class="metric-card centered">
                        <h4>Enrolled Students</h4>
                        <h2>${state.directory.students.length}</h2>
                        <span class="text-muted" style="font-size:0.75rem;">Total student registry</span>
                    </div>
                    <div class="metric-card centered">
                        <h4>Action Required</h4>
                        <h2 class="text-danger" style="color:var(--danger);">${classList.filter(c => getClassMetric(c, 'attendance') < 80).length}</h2>
                        <span class="text-muted" style="font-size:0.75rem;">Classes below 80%</span>
                    </div>
                `;
            } else if (metric === 'grades') {
                if (metricTh) metricTh.innerText = "Academic Average";
                const gradeList = state.backendData.grades;
                let avgScore = 0;
                if (gradeList.length > 0) {
                    const totalPct = gradeList.reduce((acc, curr) => acc + ((Number(curr.score) / (curr.max_score || 100)) * 100), 0);
                    avgScore = Math.round(totalPct / gradeList.length);
                }

                kpiGrid.innerHTML = `
                    <div class="metric-card centered">
                        <h4>School Average</h4>
                        <h2>${gradeList.length > 0 ? `${avgScore}%` : '--'}</h2>
                        <span class="text-muted" style="font-size:0.75rem;">${gradeList.length} scores entered</span>
                    </div>
                    <div class="metric-card centered">
                        <h4>Honor Roll (&gt;90%)</h4>
                        <h2 style="color:var(--success);">${gradeList.filter(g => ((g.score / (g.max_score||100))*100) >= 90).length}</h2>
                        <span class="text-muted" style="font-size:0.75rem;">Distinction students</span>
                    </div>
                    <div class="metric-card centered">
                        <h4>Passing Rate</h4>
                        <h2>${gradeList.length > 0 ? Math.round((gradeList.filter(g => ((g.score/(g.max_score||100))*100)>=60).length / gradeList.length)*100) : 0}%</h2>
                        <span class="text-muted" style="font-size:0.75rem;">Score &ge; 60%</span>
                    </div>
                    <div class="metric-card centered">
                        <h4>At-Risk (&lt;60%)</h4>
                        <h2 style="color:var(--danger);">${gradeList.filter(g => ((g.score / (g.max_score||100))*100) < 60).length}</h2>
                        <span class="text-muted" style="font-size:0.75rem;">Academic follow-ups</span>
                    </div>
                `;
            } else {
                if (metricTh) metricTh.innerText = "Task Completion";
                const asgs = state.backendData.assignments;
                const subs = state.backendData.submissions;

                kpiGrid.innerHTML = `
                    <div class="metric-card centered">
                        <h4>Active Tasks</h4>
                        <h2>${asgs.length}</h2>
                        <span class="text-muted" style="font-size:0.75rem;">Assigned by faculty</span>
                    </div>
                    <div class="metric-card centered">
                        <h4>Total Submissions</h4>
                        <h2>${subs.length}</h2>
                        <span class="text-muted" style="font-size:0.75rem;">Handed in</span>
                    </div>
                    <div class="metric-card centered">
                        <h4>Graded Work</h4>
                        <h2>${subs.filter(s => s.status === 'graded').length}</h2>
                        <span class="text-muted" style="font-size:0.75rem;">Reviewed by teachers</span>
                    </div>
                    <div class="metric-card centered">
                        <h4>Pending Tasks</h4>
                        <h2 style="color:var(--warning);">${Math.max(0, (asgs.length * state.directory.students.length) - subs.length)}</h2>
                        <span class="text-muted" style="font-size:0.75rem;">Unsubmitted student work</span>
                    </div>
                `;
            }
        }

        app.renderAnalyticsCharts(classList, metric);

        let filteredClasses = classList.filter(c => {
            const matchesQuery = !state.analyticsView.classSearch || c.key.toLowerCase().includes(state.analyticsView.classSearch.toLowerCase());
            const matchesGrade = state.analyticsView.gradeFilter === 'all' || c.grade === state.analyticsView.gradeFilter;
            return matchesQuery && matchesGrade;
        });

        filteredClasses.sort((a, b) => {
            const valA = getClassMetric(a, metric);
            const valB = getClassMetric(b, metric);
            switch(state.analyticsView.classSortBy) {
                case 'metric-desc': return valB - valA;
                case 'metric-asc': return valA - valB;
                case 'name-asc': return a.key.localeCompare(b.key);
                case 'students-desc': return b.students.length - a.students.length;
                default: return 0;
            }
        });

        const badgeEl = document.getElementById('analytics-class-count-badge');
        if (badgeEl) badgeEl.innerText = `${filteredClasses.length} Classes`;

        const tbody = document.getElementById('analytics-class-tbody');
        if (!tbody) return;

        if (filteredClasses.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted" style="padding: 24px;">No matching classes found.</td></tr>`;
            return;
        }

        tbody.innerHTML = filteredClasses.map(c => {
            const metricVal = getClassMetric(c, metric);
            const hasData = hasClassData(c, metric);
            const statusBadge = getStatusBadge(metricVal, hasData);
            const color = metricVal >= 85 ? '#10B981' : (metricVal >= 65 ? '#F59E0B' : '#EF4444');

            return `
                <tr onclick="app.selectAnalyticsClass('${c.key}')">
                    <td><strong>Grade ${c.grade} - Section ${c.section}</strong></td>
                    <td>${c.students.length} Students</td>
                    <td><strong>${hasData ? `${metricVal}%` : '--'}</strong></td>
                    <td>
                        <div class="meter-bg"><div class="meter-fill" style="width: ${hasData ? metricVal : 0}%; background-color: ${color};"></div></div>
                        <span style="font-size:0.75rem; color:var(--text-muted);">${hasData ? `${metricVal}%` : 'No logs'}</span>
                    </td>
                    <td>${statusBadge}</td>
                    <td style="text-align: right;">
                        <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); app.selectAnalyticsClass('${c.key}')">
                            Explore Students &rarr;
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    },

    renderStudentsInClass: (classKey) => {
        const metric = state.analyticsView.activeMetric;
        const students = state.directory.students.filter(s => `${s.grade_level || 'General'}-${s.section || 'A'}` === classKey);

        let filtered = students.filter(s => {
            const q = state.analyticsView.studentSearch.toLowerCase();
            return !q || (s.name && s.name.toLowerCase().includes(q)) || (s.unique_id && s.unique_id.toLowerCase().includes(q));
        });

        filtered.sort((a, b) => {
            const valA = getStudentMetric(a.id, metric);
            const valB = getStudentMetric(b.id, metric);
            switch(state.analyticsView.studentSortBy) {
                case 'metric-desc': return valB - valA;
                case 'metric-asc': return valA - valB;
                case 'name-asc': return (a.name || '').localeCompare(b.name || '');
                case 'id-asc': return (a.unique_id || '').localeCompare(b.unique_id || '');
                default: return 0;
            }
        });

        const badge = document.getElementById('analytics-student-count-badge');
        if (badge) badge.innerText = `${filtered.length} Students`;
        const metricTh = document.getElementById('th-student-metric-val');
        if (metricTh) metricTh.innerText = metric === 'attendance' ? 'Attendance Rate' : (metric === 'grades' ? 'GPA / Score' : 'Completed Work');

        const tbody = document.getElementById('analytics-student-tbody');
        if (!tbody) return;

        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted" style="padding: 24px;">No student records found in this section.</td></tr>`;
            return;
        }

        tbody.innerHTML = filtered.map(s => {
            const val = getStudentMetric(s.id, metric);
            const hasData = hasStudentData(s.id, metric);
            const statusBadge = getStatusBadge(val, hasData);

            return `
                <tr onclick="window.openProfile('${s.id}')">
                    <td>
                        <div class="flex-row">
                            <div class="avatar" style="width:32px;height:32px;font-size:0.8rem;">${(s.name || 'S').charAt(0).toUpperCase()}</div>
                            <strong>${s.name}</strong>
                        </div>
                    </td>
                    <td><code>${s.unique_id}</code></td>
                    <td>Grade ${s.grade_level}-${s.section}</td>
                    <td><strong>${hasData ? `${val}%` : '--'}</strong></td>
                    <td>${statusBadge}</td>
                    <td style="text-align: right;">
                        <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); window.openProfile('${s.id}')">
                            Dossier &rarr;
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    },

    renderAnalyticsCharts: (classList, metric) => {
        const ctxCmp = document.getElementById('analytics-compare-chart');
        const ctxDst = document.getElementById('analytics-dist-chart');
        if (!ctxCmp || !ctxDst) return;

        if (state.charts.analyticsCompare) state.charts.analyticsCompare.destroy();
        if (state.charts.analyticsDist) state.charts.analyticsDist.destroy();

        const labels = classList.map(c => `Class ${c.key}`);
        const dataVals = classList.map(c => getClassMetric(c, metric));

        state.charts.analyticsCompare = new Chart(ctxCmp, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: `${metric.toUpperCase()} %`,
                    data: dataVals,
                    backgroundColor: dataVals.map(v => v >= 85 ? '#10B981' : (v >= 65 ? '#F59E0B' : '#EF4444')),
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: { y: { beginAtZero: true, max: 100 } },
                plugins: { legend: { display: false } }
            }
        });

        const high = dataVals.filter(v => v >= 85).length;
        const mid = dataVals.filter(v => v >= 65 && v < 85).length;
        const low = dataVals.filter(v => v < 65).length;

        state.charts.analyticsDist = new Chart(ctxDst, {
            type: 'doughnut',
            data: {
                labels: ['High (>85%)', 'Moderate (65-84%)', 'Needs Attention (<65%)'],
                datasets: [{ data: [high, mid, low], backgroundColor: ['#10B981', '#F59E0B', '#EF4444'] }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom' } }
            }
        });
    },

    exportAnalyticsReport: () => {
        const metric = state.analyticsView.activeMetric;
        let rows = [];

        if (state.analyticsView.selectedClass) {
            const students = state.directory.students.filter(s => `${s.grade_level || 'General'}-${s.section || 'A'}` === state.analyticsView.selectedClass);
            rows = students.map(s => ({
                "Student Name": s.name,
                "Unique ID": s.unique_id,
                "Grade Level": s.grade_level,
                "Section": s.section,
                "Metric Evaluated": metric,
                "Performance Score (%)": getStudentMetric(s.id, metric)
            }));
        } else {
            const classMap = {};
            state.directory.students.forEach(s => {
                const key = `${s.grade_level || 'General'}-${s.section || 'A'}`;
                if (!classMap[key]) classMap[key] = { key, grade: s.grade_level, section: s.section, students: [] };
                classMap[key].students.push(s);
            });
            rows = Object.values(classMap).map(c => ({
                "Class & Section": `Grade ${c.grade}-${c.section}`,
                "Total Students": c.students.length,
                "Metric Evaluated": metric,
                "Aggregate Rate (%)": getClassMetric(c, metric)
            }));
        }

        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Analytics Report");
        XLSX.writeFile(wb, `StepUp_${metric}_report_${Date.now()}.xlsx`);
        showToast("Exported report successfully.", "success");
    },

    // ==========================================
    // Historical Archives Methods
    // ==========================================
    openArchivesModal: async () => {
        document.getElementById('archives-modal')?.classList.remove('hidden');
        await app.fetchArchiveData();
    },

    closeArchivesModal: () => {
        document.getElementById('archives-modal')?.classList.add('hidden');
    },

    fetchArchiveData: async () => {
        if (!globalSchoolId) return;
        const tbody = document.getElementById('archive-tbody');
        if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted" style="padding: 24px;">Loading archive records...</td></tr>`;

        const { data, error } = await supabase
            .from('school_directory_archives')
            .select('*')
            .eq('school_id', globalSchoolId)
            .order('archived_at', { ascending: false });

        if (error) {
            showToast("Failed to fetch archives: " + error.message, "error");
            return;
        }

        state.archiveView.records = data || [];
        
        const batchSelect = document.getElementById('archive-batch-filter');
        if (batchSelect) {
            const uniqueBatches = [];
            const seen = new Set();
            (data || []).forEach(r => {
                if (!seen.has(r.archive_batch_id)) {
                    seen.add(r.archive_batch_id);
                    const formattedDate = new Date(r.archived_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
                    uniqueBatches.push({ id: r.archive_batch_id, label: formattedDate });
                }
            });
            batchSelect.innerHTML = `<option value="all">All Archival Dates (${uniqueBatches.length} batches)</option>` +
                uniqueBatches.map(b => `<option value="${b.id}">${b.label}</option>`).join('');
        }

        app.renderArchives();
    },

    renderArchives: () => {
        const { records, searchQuery, roleFilter, batchFilter } = state.archiveView;
        const q = searchQuery.toLowerCase();

        const filtered = records.filter(r => {
            const matchQ = !q || 
                (r.name && r.name.toLowerCase().includes(q)) ||
                (r.unique_id && r.unique_id.toLowerCase().includes(q)) ||
                (r.email && r.email.toLowerCase().includes(q)) ||
                (r.phone && r.phone.includes(q));

            const matchRole = roleFilter === 'all' || r.role === roleFilter;
            const matchBatch = batchFilter === 'all' || r.archive_batch_id === batchFilter;

            return matchQ && matchRole && matchBatch;
        });

        state.archiveView.filteredRecords = filtered;

        const infoEl = document.getElementById('archive-count-info');
        if (infoEl) infoEl.innerText = `Showing ${filtered.length} of ${records.length} archived records`;

        const tbody = document.getElementById('archive-tbody');
        if (!tbody) return;

        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted" style="padding: 24px;">No historical archives matching your criteria.</td></tr>`;
            return;
        }

        tbody.innerHTML = filtered.map(item => {
            const dateStr = new Date(item.archived_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
            const groupInfo = item.role === 'student' 
                ? `Grade ${item.grade_level || '-'}-${item.section || '-'}` 
                : (item.department || 'General');

            return `
                <tr>
                    <td><small class="text-muted">${dateStr}</small></td>
                    <td><span class="status-pill ${item.role === 'student' ? 'neutral' : 'warning'}" style="text-transform: capitalize;">${item.role}</span></td>
                    <td><strong>${item.name}</strong></td>
                    <td><code>${item.unique_id}</code></td>
                    <td>${groupInfo}</td>
                    <td><small class="text-muted">${[item.email, item.phone].filter(Boolean).join(' • ') || '--'}</small></td>
                    <td style="text-align: right;">
                        <button class="btn btn-secondary btn-sm" onclick="app.restoreArchivedRecord('${item.id}')" title="Restore back to active directory">
                            Restore
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    },

    restoreArchivedRecord: (archiveId) => {
        const record = state.archiveView.records.find(r => r.id === archiveId);
        if (!record) return;

        window.showConfirmDialog({
            title: `Restore ${record.name}?`,
            description: `This will place ${record.name} (${record.unique_id}) back into the active roster.`,
            onConfirm: async () => {
                const payload = sanitizeDirectoryPayload({
                    school_id: record.school_id,
                    role: record.role,
                    name: record.name,
                    unique_id: record.unique_id,
                    email: record.email,
                    phone: record.phone,
                    grade_level: record.grade_level,
                    section: record.section,
                    department: record.department
                });

                const { error: insErr } = await supabase.from('school_directory').insert([payload]);
                if (insErr) {
                    return showToast("Failed to restore: " + insErr.message, "error");
                }

                await supabase.from('school_directory_archives').delete().eq('id', archiveId);

                showToast(`Restored ${record.name} to active roster.`, "success");
                await app.fetchArchiveData();
                await checkExistingData();
            }
        });
    },

    exportArchiveData: () => {
        const rows = state.archiveView.filteredRecords.map(r => ({
            "Archived Date": new Date(r.archived_at).toLocaleString(),
            "Role": r.role,
            "Full Name": r.name,
            "Unique ID": r.unique_id,
            "Email": r.email || '',
            "Phone": r.phone || '',
            "Grade Level": r.grade_level || '',
            "Section": r.section || '',
            "Department": r.department || ''
        }));

        if (rows.length === 0) return showToast("No records to export.", "warning");

        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Archives");
        XLSX.writeFile(wb, `StepUp_Archives_${Date.now()}.xlsx`);
        showToast("Exported archives successfully.", "success");
    }
};

function getClassMetric(c, metric) {
    const studentIds = c.students.map(s => s.id);
    if (metric === 'attendance') {
        const logs = state.backendData.attendance.filter(a => studentIds.includes(a.student_id));
        if (logs.length === 0) return 0;
        const present = logs.filter(a => a.status?.toLowerCase() === 'present' || a.status?.toLowerCase() === 'late').length;
        return Math.round((present / logs.length) * 100);
    } else if (metric === 'grades') {
        const scores = state.backendData.grades.filter(g => studentIds.includes(g.student_id));
        if (scores.length === 0) return 0;
        const total = scores.reduce((acc, curr) => acc + ((Number(curr.score) / (curr.max_score || 100)) * 100), 0);
        return Math.round(total / scores.length);
    } else {
        const asgs = state.backendData.assignments.filter(a => a.grade_level == c.grade);
        const subs = state.backendData.submissions.filter(s => studentIds.includes(s.student_id));
        if (asgs.length === 0) return 0;
        return Math.min(100, Math.round((subs.length / Math.max(1, asgs.length * c.students.length)) * 100));
    }
}

function hasClassData(c, metric) {
    const studentIds = c.students.map(s => s.id);
    if (metric === 'attendance') return state.backendData.attendance.some(a => studentIds.includes(a.student_id));
    if (metric === 'grades') return state.backendData.grades.some(g => studentIds.includes(g.student_id));
    return state.backendData.assignments.some(a => a.grade_level == c.grade);
}

function getStudentMetric(studentId, metric) {
    if (metric === 'attendance') {
        const logs = state.backendData.attendance.filter(a => a.student_id === studentId);
        if (logs.length === 0) return 0;
        const present = logs.filter(a => a.status?.toLowerCase() === 'present' || a.status?.toLowerCase() === 'late').length;
        return Math.round((present / logs.length) * 100);
    } else if (metric === 'grades') {
        const grades = state.backendData.grades.filter(g => g.student_id === studentId);
        if (grades.length === 0) return 0;
        const total = grades.reduce((acc, curr) => acc + ((Number(curr.score) / (curr.max_score || 100)) * 100), 0);
        return Math.round(total / grades.length);
    } else {
        const subs = state.backendData.submissions.filter(s => s.student_id === studentId);
        const total = state.backendData.assignments.length;
        if (total === 0) return 0;
        return Math.min(100, Math.round((subs.length / total) * 100));
    }
}

function hasStudentData(studentId, metric) {
    if (metric === 'attendance') return state.backendData.attendance.some(a => a.student_id === studentId);
    if (metric === 'grades') return state.backendData.grades.some(g => g.student_id === studentId);
    return state.backendData.submissions.some(s => s.student_id === studentId);
}

function getStatusBadge(val, hasData) {
    if (!hasData) return `<span class="status-pill neutral">No Records</span>`;
    if (val >= 85) return `<span class="status-pill success">Excellent</span>`;
    if (val >= 65) return `<span class="status-pill warning">On Track</span>`;
    return `<span class="status-pill danger">Needs Attention</span>`;
}

// ==========================================
// Settings & School Profile
// ==========================================
app.openAdminSettings = () => {
    const adminNameInput = document.getElementById('set-admin-name');
    const schoolNameInput = document.getElementById('set-school-name');
    const schoolStateInput = document.getElementById('set-school-state');
    const schoolDistrictInput = document.getElementById('set-school-district');
    const studentLabelInput = document.getElementById('set-student-id-label');
    const teacherLabelInput = document.getElementById('set-teacher-id-label');

    if (adminNameInput) adminNameInput.value = state.user?.user_metadata?.full_name || document.getElementById('admin-name')?.innerText || 'Admin';
    if (schoolNameInput) schoolNameInput.value = state.school?.name || '';
    if (schoolStateInput) schoolStateInput.value = state.school?.state || '';
    if (schoolDistrictInput) schoolDistrictInput.value = state.school?.district || '';
    if (studentLabelInput) studentLabelInput.value = state.school?.student_id_label || 'Admission Number';
    if (teacherLabelInput) teacherLabelInput.value = state.school?.teacher_id_label || 'Employee ID';

    document.getElementById('admin-settings-modal')?.classList.remove('hidden');
};

let pendingLogoFile = null;
document.getElementById('set-school-logo-file')?.addEventListener('change', (e) => {
    pendingLogoFile = e.target.files?.[0];
    if (pendingLogoFile) {
        const preview = document.getElementById('set-school-logo-preview');
        if (preview) {
            preview.src = URL.createObjectURL(pendingLogoFile);
            preview.classList.remove('hidden');
        }
        document.getElementById('set-school-logo-placeholder')?.classList.add('hidden');
    }
});

document.getElementById('save-admin-settings')?.addEventListener('click', async () => {
    const name = document.getElementById('set-admin-name')?.value?.trim();
    const sName = document.getElementById('set-school-name')?.value?.trim();
    const sState = document.getElementById('set-school-state')?.value?.trim();
    const sDistrict = document.getElementById('set-school-district')?.value?.trim();
    const sStudentIdLabel = document.getElementById('set-student-id-label')?.value?.trim() || 'Admission Number';
    const sTeacherIdLabel = document.getElementById('set-teacher-id-label')?.value?.trim() || 'Employee ID';
    let finalLogoUrl = state.school?.logo_url;

    const btn = document.getElementById('save-admin-settings');
    btn.disabled = true;
    btn.innerText = "Saving...";

    try {
        if (pendingLogoFile && globalSchoolId) {
            finalLogoUrl = await uploadMediaFile(pendingLogoFile, 'media');
        }

        if (state.user?.id) {
            await supabase.auth.updateUser({ data: { full_name: name } });
            await supabase.from('profiles').update({ full_name: name }).eq('id', state.user.id);
        }
        if (globalSchoolId) {
            await supabase.from('schools').update({ 
                name: sName, 
                state: sState,
                district: sDistrict,
                student_id_label: sStudentIdLabel,
                teacher_id_label: sTeacherIdLabel,
                logo_url: finalLogoUrl 
            }).eq('id', globalSchoolId);
        }
        showToast("Profile and identifier settings updated.", "success");
        setTimeout(() => window.location.reload(), 800);
    } catch(err) {
        showToast("Error updating settings.", "error");
        btn.disabled = false;
        btn.innerText = "Save Changes";
    }
});

// ==========================================
// Intelligent Spreadsheet Identifier Extraction & Archival Replacement
// ==========================================
function heuristicMatch(rawHeader) {
    if (!rawHeader) return null;
    const str = String(rawHeader).trim().toLowerCase().replace(/[^a-z0-9]/g, '');

    if (['name', 'fullname', 'studentname', 'teachername', 'candidate', 'pupil', 'facultyname', 'instructor', 'person'].some(k => str.includes(k))) return 'Name';
    if (['firstname', 'fname', 'first'].some(k => str === k || str.startsWith(k))) return 'FirstName';
    if (['lastname', 'lname', 'surname', 'last'].some(k => str === k || str.startsWith(k))) return 'LastName';
    
    // Identifiers
    if (['admissionno', 'admissionnumber', 'admno', 'rollno', 'rollnumber', 'roll', 'scholarno', 'regno', 'registration', 'uniqueid', 'uid', 'empid', 'employeeid', 'staffid', 'facultycode', 'code'].some(k => str.includes(k))) {
        return 'Unique ID';
    }
    
    // Secondary Identifiers
    if (['email', 'emailaddress', 'mail'].some(k => str.includes(k))) return 'Email';
    if (['phone', 'mobile', 'contact', 'cell', 'whatsapp'].some(k => str.includes(k))) return 'Phone';

    if (['grade', 'class', 'standard', 'std', 'gradelevel', 'year', 'level'].some(k => str.includes(k))) return 'Grade';
    if (['section', 'sec', 'division', 'div', 'batch'].some(k => str.includes(k))) return 'Section';
    if (['department', 'dept', 'subject', 'discipline', 'stream'].some(k => str.includes(k))) return 'Department';

    return null;
}

function extractGradeAndSection(valStr) {
    if (!valStr) return { grade: null, section: null };
    const clean = String(valStr).trim();
    const match = clean.match(/^(?:grade|class|std)?\s*(\d{1,2}|[a-zA-Z]+)\s*[-/_\s]\s*([a-zA-Z0-9]+)$/i);
    if (match) {
        return { grade: match[1].trim(), section: match[2].trim().toUpperCase() };
    }
    return { grade: clean, section: null };
}

async function verifyColumnWithAI(header, sampleValues = []) {
    const heuristic = heuristicMatch(header);
    if (heuristic) return heuristic;

    const sampleJoined = sampleValues.slice(0, 3).filter(Boolean).join(' ');
    const testString = `${header}: ${sampleJoined}`;

    if (aiClassifier) {
        try {
            const candidateLabels = ['person name', 'admission roll code', 'contact email phone', 'class grade level', 'academic department'];
            const res = await aiClassifier(testString, candidateLabels);
            if (res && res.labels && res.scores && res.scores[0] > 0.35) {
                const top = res.labels[0];
                if (top.includes('name')) return 'Name';
                if (top.includes('code')) return 'Unique ID';
                if (top.includes('email') || top.includes('phone')) return 'Phone';
                if (top.includes('grade')) return 'Grade';
                if (top.includes('department')) return 'Department';
            }
        } catch (e) {
            console.warn("AI classifier notice:", e);
        }
    }
    return null;
}

async function processSpreadsheet(file, roleAssumed) {
    if (!file) return;
    if (!globalSchoolId) {
        showToast("School identifier missing. Please reload.", "error");
        return;
    }

    showToast("Analyzing file and extracting identifier requirements...", "info");

    const reader = new FileReader();
    reader.onerror = () => showToast("Could not read uploaded file.", "error");
    
    reader.onload = async (event) => {
        try {
            const workbook = XLSX.read(new Uint8Array(event.target.result), { type: 'array' });
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            if (!firstSheet) return showToast("Spreadsheet appears to be empty.", "warning");

            const json = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' });
            if (!json || json.length < 2) return showToast("No record rows found in spreadsheet.", "warning");

            let headerRowIndex = 0;
            for (let i = 0; i < Math.min(5, json.length); i++) {
                if (json[i] && json[i].some(cell => String(cell).trim().length > 0)) {
                    headerRowIndex = i;
                    break;
                }
            }

            const rawHeaders = json[headerRowIndex];
            const colMap = {};
            let detectedIdentifierHeader = null;

            for (let idx = 0; idx < rawHeaders.length; idx++) {
                const h = rawHeaders[idx];
                const sampleVals = json.slice(headerRowIndex + 1, headerRowIndex + 4).map(r => r[idx]);
                const verifiedLabel = await verifyColumnWithAI(h, sampleVals);
                if (verifiedLabel && colMap[verifiedLabel] === undefined) {
                    colMap[verifiedLabel] = idx;
                    if (verifiedLabel === 'Unique ID' && h) {
                        detectedIdentifierHeader = String(h).trim();
                    }
                }
            }

            if (detectedIdentifierHeader) {
                const updatePayload = roleAssumed === 'student' 
                    ? { student_id_label: detectedIdentifierHeader } 
                    : { teacher_id_label: detectedIdentifierHeader };

                await supabase.from('schools').update(updatePayload).eq('id', globalSchoolId);
                if (state.school) {
                    if (roleAssumed === 'student') state.school.student_id_label = detectedIdentifierHeader;
                    else state.school.teacher_id_label = detectedIdentifierHeader;
                }
                const cfgInp = document.getElementById(roleAssumed === 'student' ? 'cfg-student-id-label' : 'cfg-teacher-id-label');
                if (cfgInp) cfgInp.value = detectedIdentifierHeader;
                updateIdentifierPreview(detectedIdentifierHeader);
                showToast(`Identified "${detectedIdentifierHeader}" column. Updated school registration requirement!`, "success", "Requirement Detected");
            }

            const toInsert = [];
            const timestamp = Date.now();

            for (let i = headerRowIndex + 1; i < json.length; i++) {
                const row = json[i];
                if (!row || !row.some(cell => cell !== null && cell !== undefined && String(cell).trim() !== '')) {
                    continue;
                }

                let name = '';
                if (colMap['Name'] !== undefined && row[colMap['Name']]) {
                    name = String(row[colMap['Name']]).trim();
                } else if (colMap['FirstName'] !== undefined) {
                    const first = String(row[colMap['FirstName']] || '').trim();
                    const last = colMap['LastName'] !== undefined ? String(row[colMap['LastName']] || '').trim() : '';
                    name = `${first} ${last}`.trim();
                }

                if (!name) {
                    for (let c = 0; c < row.length; c++) {
                        const cellVal = String(row[c] || '').trim();
                        if (cellVal.length > 1 && isNaN(cellVal)) {
                            name = cellVal;
                            break;
                        }
                    }
                }
                if (!name) name = `Member ${i}`;

                let uniqueId = '';
                if (colMap['Unique ID'] !== undefined && row[colMap['Unique ID']]) {
                    uniqueId = String(row[colMap['Unique ID']]).trim();
                } else {
                    for (let c = 0; c < row.length; c++) {
                        const cellVal = String(row[c] || '').trim();
                        if (cellVal && cellVal.length >= 3 && cellVal !== name && isNaN(cellVal) === false) {
                            uniqueId = cellVal;
                            break;
                        }
                    }
                }
                if (!uniqueId) uniqueId = `${roleAssumed === 'student' ? 'STU' : 'TCH'}-${timestamp}-${i}`;

                const emailVal = colMap['Email'] !== undefined && row[colMap['Email']] ? String(row[colMap['Email']]).trim() : null;
                const phoneVal = colMap['Phone'] !== undefined && row[colMap['Phone']] ? String(row[colMap['Phone']]).trim() : null;

                let grade = null;
                let section = null;

                if (roleAssumed === 'student') {
                    if (colMap['Grade'] !== undefined && row[colMap['Grade']]) {
                        const parsed = extractGradeAndSection(row[colMap['Grade']]);
                        grade = parsed.grade;
                        if (parsed.section) section = parsed.section;
                    }
                    if (colMap['Section'] !== undefined && row[colMap['Section']]) {
                        section = String(row[colMap['Section']]).trim().toUpperCase();
                    }
                    grade = grade || 'General';
                    section = section || 'A';
                }

                let department = null;
                if (roleAssumed === 'teacher') {
                    if (colMap['Department'] !== undefined && row[colMap['Department']]) {
                        department = String(row[colMap['Department']]).trim();
                    }
                    department = department || 'General';
                }

                toInsert.push({
                    school_id: globalSchoolId,
                    role: roleAssumed,
                    name: name,
                    unique_id: uniqueId,
                    email: emailVal,
                    phone: phoneVal,
                    grade_level: grade,
                    section: section,
                    department: department
                });
            }

            if (toInsert.length === 0) {
                return showToast("No valid rows could be extracted from the file.", "warning");
            }

            // Atomic database archival and active replacement RPC
            const { data: rpcData, error: rpcErr } = await supabase.rpc('replace_school_roster', {
                p_school_id: String(globalSchoolId),
                p_role: roleAssumed,
                p_new_records: toInsert
            });

            if (rpcErr) {
                return showToast(`Import failed: ${rpcErr.message || 'Database error'}`, "error");
            }

            await checkExistingData();
            showToast(
                `Roster updated! Replaced ${rpcData.inserted_count} active records. ${rpcData.archived_count} previous unique records moved to archives.`,
                "success"
            );

        } catch (err) {
            showToast(`Failed to parse file: ${err.message}`, "error");
        }
    };

    reader.readAsArrayBuffer(file);
}

document.getElementById('student-upload')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (file) await processSpreadsheet(file, 'student');
    e.target.value = '';
});

document.getElementById('teacher-upload')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (file) await processSpreadsheet(file, 'teacher');
    e.target.value = '';
});

// ==========================================
// Directory CRUD & View Logic
// ==========================================
app.openEditDirectoryModal = (role) => {
    document.getElementById('edit-dir-form')?.reset();
    document.getElementById('edit-dir-id').value = '';
    document.getElementById('edit-dir-role').value = role;
    
    const idLabel = role === 'student' 
        ? (state.school?.student_id_label || 'Admission Number')
        : (state.school?.teacher_id_label || 'Employee ID');

    document.getElementById('edit-dir-uid-label').innerText = `${idLabel} *`;
    document.getElementById('edit-dir-title').innerText = `Add ${role === 'student' ? 'Student' : 'Teacher'}`;
    
    if (role === 'student') {
        document.getElementById('edit-dir-student-fields')?.classList.remove('hidden');
        document.getElementById('edit-dir-teacher-fields')?.classList.add('hidden');
    } else {
        document.getElementById('edit-dir-student-fields')?.classList.add('hidden');
        document.getElementById('edit-dir-teacher-fields')?.classList.remove('hidden');
    }
    
    document.getElementById('edit-directory-modal')?.classList.remove('hidden');
};

app.closeEditDirModal = () => {
    document.getElementById('edit-dir-form')?.reset();
    document.getElementById('edit-dir-id').value = '';
    document.getElementById('edit-directory-modal')?.classList.add('hidden');
};

app.editDirectoryRecord = (id) => {
    const person = [...state.directory.students, ...state.directory.teachers].find(p => p.id === id);
    if (!person) return;
    document.getElementById('edit-dir-id').value = person.id;
    document.getElementById('edit-dir-role').value = person.role;
    document.getElementById('edit-dir-name').value = person.name;
    document.getElementById('edit-dir-uid').value = person.unique_id;
    document.getElementById('edit-dir-email').value = person.email || '';
    document.getElementById('edit-dir-phone').value = person.phone || '';
    
    if (person.role === 'student') {
        document.getElementById('edit-dir-student-fields')?.classList.remove('hidden');
        document.getElementById('edit-dir-teacher-fields')?.classList.add('hidden');
        document.getElementById('edit-dir-grade').value = person.grade_level || '';
        document.getElementById('edit-dir-section').value = person.section || '';
    } else {
        document.getElementById('edit-dir-student-fields')?.classList.add('hidden');
        document.getElementById('edit-dir-teacher-fields')?.classList.remove('hidden');
        document.getElementById('edit-dir-dept').value = person.department || '';
    }
    
    document.getElementById('edit-dir-title').innerText = "Edit Record";
    document.getElementById('edit-directory-modal')?.classList.remove('hidden');
};

app.deleteDirectoryRecord = (id, role) => {
    window.showConfirmDialog({
        title: "Delete Record",
        description: "Are you sure you want to remove this profile? This action is irreversible.",
        onConfirm: async () => {
            await supabase.from('school_directory').delete().eq('id', id);
            showToast("Record deleted.", "success");
            await checkExistingData();
        }
    });
};

app.clearRoster = (role) => {
    window.showConfirmDialog({
        title: `Clear ${role.charAt(0).toUpperCase() + role.slice(1)} Roster`,
        description: `This will permanently delete all ${role} records for the school. This action cannot be undone.`,
        onConfirm: async () => {
            await supabase.from('school_directory').delete().eq('school_id', globalSchoolId).eq('role', role);
            showToast(`${role} roster cleared successfully.`, "success");
            await checkExistingData();
        }
    });
};

document.getElementById('edit-dir-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('edit-dir-id').value;
    const role = document.getElementById('edit-dir-role').value;
    const name = document.getElementById('edit-dir-name').value;
    const uid = document.getElementById('edit-dir-uid').value;
    const email = document.getElementById('edit-dir-email').value.trim() || null;
    const phone = document.getElementById('edit-dir-phone').value.trim() || null;
    
    let payload = { name, unique_id: uid, email, phone, role, school_id: globalSchoolId };
    if (role === 'student') {
        payload.grade_level = document.getElementById('edit-dir-grade').value || 'General';
        payload.section = document.getElementById('edit-dir-section').value || 'A';
    } else {
        payload.department = document.getElementById('edit-dir-dept').value || 'General';
    }
    
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    
    try {
        if (id) {
            const { error } = await updateDirectoryRecord(id, payload);
            if (error) throw error;
            showToast("Record updated.", "success");
        } else {
            const sanitized = sanitizeDirectoryPayload(payload);
            const { error } = await supabase.from('school_directory').insert([sanitized]);
            if (error) throw error;
            showToast("Record added.", "success");
        }
        app.closeEditDirModal();
        await checkExistingData();
    } catch(err) {
        showToast(`An error occurred: ${err.message || 'Operation failed'}`, "error");
    } finally {
        btn.disabled = false;
    }
});

function updateDirectoryFilterOptions() {
    const gradeSelect = document.getElementById('dir-grade-select');
    if (gradeSelect) {
        const grades = [...new Set(state.directory.students.map(s => s.grade_level).filter(Boolean))].sort();
        gradeSelect.innerHTML = '<option value="all">All Grades</option>' + grades.map(g => `<option value="${g}">Grade ${g}</option>`).join('');
    }

    const sectionSelect = document.getElementById('dir-section-select');
    if (sectionSelect) {
        const sections = [...new Set(state.directory.students.map(s => s.section).filter(Boolean))].sort();
        sectionSelect.innerHTML = '<option value="all">All Sections</option>' + sections.map(s => `<option value="${s}">Section ${s}</option>`).join('');
    }

    const deptSelect = document.getElementById('dir-dept-select');
    if (deptSelect) {
        const depts = [...new Set(state.directory.teachers.map(t => t.department).filter(Boolean))].sort();
        deptSelect.innerHTML = '<option value="all">All Departments</option>' + depts.map(d => `<option value="${d}">${d}</option>`).join('');
    }
}

function getFilteredDirectoryData() {
    const isStudent = state.directoryView.activeType === 'student';
    const sourceData = isStudent ? state.directory.students : state.directory.teachers;
    const q = state.directoryView.searchQuery.toLowerCase();

    let filtered = sourceData.filter(item => {
        const matchQuery = !q || 
            (item.name && item.name.toLowerCase().includes(q)) || 
            (item.unique_id && item.unique_id.toLowerCase().includes(q)) || 
            (item.email && item.email.toLowerCase().includes(q)) || 
            (item.phone && item.phone.includes(q)) || 
            (item.grade_level && item.grade_level.toLowerCase().includes(q)) || 
            (item.department && item.department.toLowerCase().includes(q));
        if (!matchQuery) return false;

        if (isStudent) {
            if (state.directoryView.gradeFilter !== 'all' && item.grade_level !== state.directoryView.gradeFilter) return false;
            if (state.directoryView.sectionFilter !== 'all' && item.section !== state.directoryView.sectionFilter) return false;
        } else {
            if (state.directoryView.deptFilter !== 'all' && item.department !== state.directoryView.deptFilter) return false;
        }
        return true;
    });

    filtered.sort((a, b) => {
        switch (state.directoryView.sortBy) {
            case 'name-asc': return (a.name || '').localeCompare(b.name || '');
            case 'name-desc': return (b.name || '').localeCompare(a.name || '');
            case 'id-asc': return (a.unique_id || '').localeCompare(b.unique_id || '');
            case 'grade-asc':
                const attrA = isStudent ? (a.grade_level || '') : (a.department || '');
                const attrB = isStudent ? (b.grade_level || '') : (b.department || '');
                return attrA.localeCompare(attrB);
            default: return 0;
        }
    });

    return filtered;
}

function renderDirectory() {
    const grid = document.getElementById('directory-list');
    if (!grid) return;

    const isStudent = state.directoryView.activeType === 'student';
    const filteredData = getFilteredDirectoryData();
    const totalCount = filteredData.length;

    const totalBadge = document.getElementById('directory-total-badge');
    if (totalBadge) totalBadge.innerText = `${totalCount} ${isStudent ? 'Students' : 'Teachers'}`;

    const limit = state.directoryView.limit === 'all' ? totalCount : parseInt(state.directoryView.limit);
    const totalPages = Math.ceil(totalCount / limit) || 1;

    if (state.directoryView.page > totalPages) state.directoryView.page = totalPages;
    if (state.directoryView.page < 1) state.directoryView.page = 1;

    const startIdx = (state.directoryView.page - 1) * limit;
    const endIdx = state.directoryView.limit === 'all' ? totalCount : Math.min(startIdx + limit, totalCount);
    const paginatedData = filteredData.slice(startIdx, endIdx);

    document.getElementById('tab-btn-students')?.classList.toggle('active', isStudent);
    document.getElementById('tab-btn-teachers')?.classList.toggle('active', !isStudent);
    document.getElementById('student-filters-group')?.classList.toggle('hidden', !isStudent);
    document.getElementById('teacher-filters-group')?.classList.toggle('hidden', isStudent);

    if (paginatedData.length === 0) {
        grid.innerHTML = `<p class="text-muted" style="grid-column: 1/-1; padding: 24px 0; text-align:center;">No matching records found.</p>`;
    } else {
        grid.innerHTML = paginatedData.map(person => `
            <div class="profile-card">
                <div class="avatar" onclick="window.openProfile('${person.id}')">${(person.name || 'U').charAt(0).toUpperCase()}</div>
                <div class="flex-grow" onclick="window.openProfile('${person.id}')">
                    <h4 style="color:var(--text-main); font-size:0.95rem; text-transform:none; font-weight:600;">${person.name}</h4>
                    <p class="text-muted" style="text-transform:uppercase; font-size:0.75rem;">${person.unique_id} • ${isStudent ? `${person.grade_level}-${person.section}` : person.department}</p>
                    ${person.email || person.phone ? `<p class="text-muted" style="font-size:0.72rem;">${[person.email, person.phone].filter(Boolean).join(' • ')}</p>` : ''}
                </div>
                <div class="profile-actions">
                    <button class="btn-icon" onclick="app.editDirectoryRecord('${person.id}')" title="Edit"><svg viewBox="0 0 24 24" width="18" height="18" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg></button>
                    <button class="btn-icon text-danger" onclick="app.deleteDirectoryRecord('${person.id}', '${person.role}')" title="Delete"><svg viewBox="0 0 24 24" width="18" height="18" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>
                </div>
            </div>
        `).join('');
    }

    const infoEl = document.getElementById('pagination-info');
    if (infoEl) infoEl.innerText = totalCount === 0 ? 'Showing 0 to 0 of 0 records' : `Showing ${startIdx + 1} to ${endIdx} of ${totalCount} records`;

    const pageInd = document.getElementById('page-indicator');
    if (pageInd) pageInd.innerText = `Page ${state.directoryView.page} of ${totalPages}`;
    
    const prevBtn = document.getElementById('btn-page-prev');
    const nextBtn = document.getElementById('btn-page-next');
    if (prevBtn) prevBtn.disabled = state.directoryView.page <= 1;
    if (nextBtn) nextBtn.disabled = state.directoryView.page >= totalPages;
}

// ==========================================
// Unified Timetable Matrix with Slot Editing
// ==========================================
async function fetchTimetableData() {
    if (!globalSchoolId) return;
    const { data } = await supabase.from('native_schedules').select('*').eq('school_id', globalSchoolId);
    if (data) {
        data.forEach(row => {
            if (!state.timetables.data[row.day_of_week]) state.timetables.data[row.day_of_week] = {};
            if (!state.timetables.data[row.day_of_week][row.teacher_id]) state.timetables.data[row.day_of_week][row.teacher_id] = {};
            if (!state.timetables.timeSlots.includes(row.time_slot)) state.timetables.timeSlots.push(row.time_slot);
            state.timetables.data[row.day_of_week][row.teacher_id][row.time_slot] = row.class_section;
        });
        state.timetables.timeSlots.sort();
        renderMatrix();
    }
}

function renderMatrix() {
    const day = state.timetables.currentDay;
    const headerRow = document.getElementById('tt-header-row');
    const tBody = document.getElementById('tt-body');
    if (!headerRow || !tBody) return;
    
    document.querySelectorAll('.day-toggle').forEach(b => {
        b.classList.toggle('active', b.dataset.day === day);
    });

    headerRow.innerHTML = '<th>Teacher</th>' + state.timetables.timeSlots.map(ts => `
        <th class="th-slot">
            <div class="slot-header-flex">
                <span class="slot-title">${ts}</span>
                <div class="slot-actions">
                    <button type="button" class="btn-slot-icon" onclick="app.editTimeSlot('${ts}')" title="Edit slot time">
                        <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                    </button>
                    <button type="button" class="btn-slot-icon text-danger" onclick="app.deleteTimeSlot('${ts}')" title="Remove slot">
                        <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>
            </div>
        </th>
    `).join('');
    
    const dayData = state.timetables.data[day] || {};
    tBody.innerHTML = state.directory.teachers.map(teacher => {
        const teacherSlots = dayData[teacher.id] || {};
        return `
            <tr>
                <td>${teacher.name}</td>
                ${state.timetables.timeSlots.map(ts => `
                    <td>
                        <input type="text" placeholder="Free/Class" 
                            data-tid="${teacher.id}" data-slot="${ts}" 
                            value="${teacherSlots[ts] || ''}" onchange="updateMatrixState(this)">
                    </td>
                `).join('')}
            </tr>
        `;
    }).join('');
}

window.updateMatrixState = (el) => {
    const day = state.timetables.currentDay;
    const tid = el.dataset.tid;
    const slot = el.dataset.slot;
    if (!state.timetables.data[day]) state.timetables.data[day] = {};
    if (!state.timetables.data[day][tid]) state.timetables.data[day][tid] = {};
    state.timetables.data[day][tid][slot] = el.value.trim();
};

app.editTimeSlot = (oldSlot) => {
    showPromptDialog({
        title: "Edit Time Slot",
        description: `Update time interval for "${oldSlot}" (e.g. 08:30-09:30):`,
        defaultValue: oldSlot,
        placeholder: "08:30-09:30",
        onConfirm: async (newSlot) => {
            if (!newSlot || newSlot === oldSlot) return;
            const trimmed = newSlot.trim();
            if (state.timetables.timeSlots.includes(trimmed)) {
                return showToast("A slot with this time period already exists.", "warning");
            }

            const idx = state.timetables.timeSlots.indexOf(oldSlot);
            if (idx !== -1) state.timetables.timeSlots[idx] = trimmed;

            Object.keys(state.timetables.data).forEach(d => {
                Object.keys(state.timetables.data[d] || {}).forEach(tid => {
                    if (state.timetables.data[d][tid][oldSlot] !== undefined) {
                        state.timetables.data[d][tid][trimmed] = state.timetables.data[d][tid][oldSlot];
                        delete state.timetables.data[d][tid][oldSlot];
                    }
                });
            });

            if (globalSchoolId) {
                await supabase.from('native_schedules')
                    .update({ time_slot: trimmed })
                    .eq('school_id', globalSchoolId)
                    .eq('time_slot', oldSlot);
            }

            renderMatrix();
            showToast(`Time slot updated to "${trimmed}".`, "success");
        }
    });
};

app.deleteTimeSlot = (slot) => {
    window.showConfirmDialog({
        title: `Remove Slot "${slot}"?`,
        description: "This will remove the column and clear scheduled allocations assigned to this period.",
        onConfirm: async () => {
            state.timetables.timeSlots = state.timetables.timeSlots.filter(s => s !== slot);
            Object.keys(state.timetables.data).forEach(d => {
                Object.keys(state.timetables.data[d] || {}).forEach(tid => {
                    delete state.timetables.data[d][tid][slot];
                });
            });

            if (globalSchoolId) {
                await supabase.from('native_schedules')
                    .delete()
                    .eq('school_id', globalSchoolId)
                    .eq('time_slot', slot);
            }

            renderMatrix();
            showToast(`Removed time slot "${slot}".`, "success");
        }
    });
};

document.getElementById('add-time-slot-btn')?.addEventListener('click', () => {
    showPromptDialog({
        title: "Add Timetable Period",
        description: "Specify the start and end time for this class slot.",
        placeholder: "e.g. 13:00-14:00",
        onConfirm: (newSlot) => {
            if (newSlot && !state.timetables.timeSlots.includes(newSlot.trim())) {
                state.timetables.timeSlots.push(newSlot.trim());
                state.timetables.timeSlots.sort();
                renderMatrix();
                showToast(`Added period: ${newSlot.trim()}`, "success");
            }
        }
    });
});

document.getElementById('save-matrix')?.addEventListener('click', async () => {
    const toInsert = [];
    Object.keys(state.timetables.data).forEach(day => {
        Object.keys(state.timetables.data[day]).forEach(tId => {
            const tObj = state.directory.teachers.find(t => t.id === tId);
            Object.keys(state.timetables.data[day][tId]).forEach(slot => {
                const val = state.timetables.data[day][tId][slot];
                if (val && val.trim() !== '') {
                    toInsert.push({ 
                        school_id: globalSchoolId, 
                        day_of_week: day, 
                        time_slot: slot, 
                        teacher_id: tId, 
                        teacher_name: tObj?.name || 'Faculty', 
                        class_section: val 
                    });
                }
            });
        });
    });
    
    await supabase.from('native_schedules').delete().eq('school_id', globalSchoolId);
    if (toInsert.length > 0) await supabase.from('native_schedules').insert(toInsert);
    showToast("Timetable allocations saved successfully.", "success");
});

// ==========================================
// Communications & Broadcasts
// ==========================================
function renderSubgroupFilters() {
    const container = document.getElementById('chat-subgroup-filters');
    if (!container) return;
    container.innerHTML = '';
    
    let chips = [];
    if (state.currentChatGroup === 'teachers') {
        const departments = [...new Set(state.directory.teachers.map(t => t.department).filter(Boolean))].sort();
        chips = departments.map(d => ({ label: `Dept: ${d}`, value: `dept:${d}` }));
    } else if (state.currentChatGroup === 'students' || state.currentChatGroup === 'parents') {
        const grades = [...new Set(state.directory.students.map(s => s.grade_level).filter(Boolean))].sort();
        const sections = [...new Set(state.directory.students.map(s => `${s.grade_level}-${s.section}`).filter(Boolean))].sort();
        
        grades.forEach(g => chips.push({ label: `All Grade ${g}`, value: `grade:${g}` }));
        sections.forEach(sec => chips.push({ label: `Class ${sec}`, value: `section:${sec}` }));
    }

    if (chips.length > 0) {
        container.classList.remove('hidden');
        container.innerHTML = chips.map(chip => `
            <label class="filter-chip">
                <input type="checkbox" value="${chip.value}" class="subgroup-cb"> ${chip.label}
            </label>
        `).join('');
    } else {
        container.classList.add('hidden');
    }
}

async function loadChatMessages() {
    if (!globalSchoolId) return;
    const { data } = await supabase.from('communications')
        .select('*')
        .eq('school_id', globalSchoolId)
        .eq('target_group', state.currentChatGroup)
        .order('created_at', { ascending: true });
        
    state.chatMessages = data || [];
    const history = document.getElementById('chat-history');
    if (!history) return;
    history.innerHTML = '';
    
    if (!data || data.length === 0) {
        history.innerHTML = '<p class="text-muted text-center" style="margin-top:auto; margin-bottom:auto; font-size:0.85rem;">No broadcasts in this group yet.</p>';
        return;
    }
    
    data.forEach(msg => {
        const isSent = msg.sender_id === state.user.id;
        const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        let subText = "";
        if (msg.target_subgroups && msg.target_subgroups.length > 0) {
            subText = ` to [${msg.target_subgroups.map(s => s.replace('dept:', 'Dept: ').replace('grade:', 'Grade ').replace('section:', 'Class ')).join(', ')}]`;
        }
        
        let contentHtml = `<span class="msg-meta">${isSent ? 'You' : 'Admin'}${subText} • ${time}</span>`;
        
        if (msg.msg_type === 'text') {
            contentHtml += `<p>${msg.content}</p>`;
        } else if (msg.msg_type === 'image') {
            contentHtml += `${msg.content ? `<p>${msg.content}</p>` : ''}<a href="${msg.media_url}" target="_blank"><img src="${msg.media_url}" class="msg-img" alt="Broadcast Media"></a>`;
        } else if (msg.msg_type === 'poll') {
            const pollData = msg.poll_data || {};
            const opts = pollData.options || [];
            const totalVotes = opts.reduce((acc, curr) => acc + (curr.votes?.length || 0), 0);
            
            contentHtml += `<p><strong>[Poll] ${msg.content}</strong></p><div class="msg-poll">`;
            opts.forEach(opt => {
                const v = opt.votes?.length || 0;
                const pct = totalVotes === 0 ? 0 : Math.round((v / totalVotes) * 100);
                contentHtml += `
                    <div class="poll-opt">
                        <input type="${pollData.multi ? 'checkbox' : 'radio'}" disabled>
                        <label>${opt.text} (${pct}%)</label>
                    </div>
                    <div class="poll-bar-bg"><div class="poll-bar-fill" style="width: ${pct}%"></div></div>
                `;
            });
            contentHtml += `<div class="mt-1 text-muted" style="font-size:0.72rem;">Status: ${pollData.closed ? 'Closed' : 'Active'}</div></div>`;
        }
        
        let actionsHtml = isSent ? `
            <div class="msg-actions">
                <button class="btn-icon btn-icon-sm" onclick="app.editMessage('${msg.id}')" title="Edit Text"><svg viewBox="0 0 24 24" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg></button>
                <button class="btn-icon btn-icon-sm text-danger" onclick="app.deleteMessage('${msg.id}')" title="Delete"><svg viewBox="0 0 24 24" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>
            </div>
        ` : '';

        history.innerHTML += `<div class="msg-bubble ${isSent ? 'sent' : 'received'}">${contentHtml}${actionsHtml}</div>`;
    });
    history.scrollTop = history.scrollHeight;
}

app.editMessage = (id) => {
    const msg = state.chatMessages.find(m => m.id === id);
    if (!msg) return;
    if (msg.msg_type === 'poll') return showToast("Poll questions cannot be edited once broadcasted.", "warning");
    
    state.editingMessageId = id;
    const input = document.getElementById('chat-msg-input');
    if (input) {
        input.value = msg.content || '';
        input.focus();
    }
    showToast("Editing broadcast message...", "info");
};

app.deleteMessage = (id) => {
    window.showConfirmDialog({
        title: "Delete Broadcast",
        description: "Are you sure you want to delete this message? It will be removed for everyone in the group.",
        onConfirm: async () => {
            await supabase.from('communications').delete().eq('id', id);
            showToast("Message deleted.", "success");
            await loadChatMessages();
        }
    });
};

document.getElementById('chat-file-upload')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) {
        state.pendingChatFile = file;
        const previewUrl = URL.createObjectURL(file);
        const area = document.getElementById('chat-preview-area');
        if (area) {
            area.innerHTML = `
                <div class="preview-item">
                    <img src="${previewUrl}" alt="Preview">
                    <button class="btn-icon text-danger" onclick="app.clearChatPreview(event)">&times;</button>
                </div>
            `;
            area.classList.remove('hidden');
        }
    }
});

app.clearChatPreview = (e) => {
    if(e) e.preventDefault();
    state.pendingChatFile = null;
    const fileInput = document.getElementById('chat-file-upload');
    if (fileInput) fileInput.value = '';
    const area = document.getElementById('chat-preview-area');
    if (area) {
        area.classList.add('hidden');
        area.innerHTML = '';
    }
};

document.getElementById('btn-add-poll-opt')?.addEventListener('click', () => {
    const container = document.getElementById('poll-options-container');
    if (!container) return;
    const div = document.createElement('div');
    div.className = "poll-opt-row mb-2";
    div.innerHTML = `
        <input type="text" class="input-field poll-opt-input" placeholder="Option ${container.children.length + 1}">
        <button class="btn-icon text-danger remove-opt">
            <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
    `;
    container.appendChild(div);
    div.querySelector('.remove-opt').addEventListener('click', () => div.remove());
});

document.getElementById('btn-cancel-poll')?.addEventListener('click', () => {
    document.getElementById('poll-creator')?.classList.add('hidden');
    const q = document.getElementById('poll-q');
    if (q) q.value = '';
});

document.getElementById('chat-msg-input')?.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('btn-send-msg')?.click();
    }
});

document.getElementById('btn-send-msg')?.addEventListener('click', async () => {
    const input = document.getElementById('chat-msg-input')?.value?.trim();
    const pollQ = document.getElementById('poll-q')?.value?.trim();
    
    let msgType = 'text', content = input, mediaUrl = null, pollObj = null;
    
    if (pollQ && !document.getElementById('poll-creator')?.classList.contains('hidden')) {
        msgType = 'poll'; 
        content = pollQ;
        const optInputs = document.querySelectorAll('.poll-opt-input');
        const options = Array.from(optInputs).map((inp, idx) => ({ id: idx, text: inp.value.trim(), votes: [] })).filter(o => o.text !== '');
        if (options.length < 2) return showToast("Poll requires at least 2 options.", "warning");
        
        pollObj = {
            options,
            multi: document.getElementById('poll-multi')?.checked || false,
            hours: document.getElementById('poll-hours')?.value || 24,
            closed: false
        };
    } else if (state.pendingChatFile) {
        msgType = 'image';
        mediaUrl = await uploadMediaFile(state.pendingChatFile, 'media');
    }
    
    if (!content && !mediaUrl && !pollObj) return;
    
    const subgroups = Array.from(document.querySelectorAll('.subgroup-cb:checked')).map(cb => cb.value);
    const btn = document.getElementById('btn-send-msg');
    btn.disabled = true;

    try {
        if (state.editingMessageId) {
            await supabase.from('communications').update({ content: content }).eq('id', state.editingMessageId);
            state.editingMessageId = null;
            showToast("Message updated.", "success");
        } else {
            await supabase.from('communications').insert({
                school_id: globalSchoolId, 
                sender_id: state.user.id, 
                target_group: state.currentChatGroup, 
                target_subgroups: subgroups,
                msg_type: msgType, 
                content: content, 
                media_url: mediaUrl, 
                poll_data: pollObj
            });
        }
        
        const msgInp = document.getElementById('chat-msg-input');
        if (msgInp) msgInp.value = '';
        const pollInp = document.getElementById('poll-q');
        if (pollInp) pollInp.value = '';
        document.querySelectorAll('.poll-opt-input').forEach((i, idx) => { if(idx>1) i.closest('.poll-opt-row')?.remove(); else i.value = ''; });
        app.clearChatPreview();
        document.getElementById('poll-creator')?.classList.add('hidden');
        await loadChatMessages();
    } catch (err) {
        showToast("Error sending message.", "error");
    } finally {
        btn.disabled = false;
        if(state.editingMessageId) state.editingMessageId = null;
    }
});

// ==========================================
// Calendar & Events
// ==========================================
async function fetchCalendarEvents() {
    if (!globalSchoolId) return;
    const { data } = await supabase.from('events').select('*').eq('school_id', globalSchoolId);
    state.calendarEvents = data || [];
}

function renderCalendar() {
    const y = state.calendarDate.getFullYear(), m = state.calendarDate.getMonth();
    const monthYearEl = document.getElementById('cal-month-year');
    if (monthYearEl) monthYearEl.innerText = state.calendarDate.toLocaleString('default', { month: 'long', year: 'numeric' });
    
    let firstDay = new Date(y, m, 1).getDay();
    firstDay = firstDay === 0 ? 6 : firstDay - 1;
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const grid = document.getElementById('cal-grid');
    if (!grid) return;
    grid.innerHTML = '';
    
    for (let i = 0; i < firstDay; i++) grid.innerHTML += '<div></div>';
    
    for (let d = 1; d <= daysInMonth; d++) {
        const currentDateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const hasEvent = state.calendarEvents.some(e => e.date === currentDateStr && e.type === 'event');
        const isHoliday = state.calendarEvents.some(e => e.date === currentDateStr && e.type === 'holiday');
        const isSelected = state.selectedDateStr === currentDateStr;
        
        let classes = 'cal-day';
        if (hasEvent) classes += ' event-day';
        if (isHoliday) classes += ' holiday-day';
        if (isSelected) classes += ' selected';

        grid.innerHTML += `<div class="${classes}" data-date="${currentDateStr}" onclick="selectDate('${currentDateStr}', this)">${d}</div>`;
    }
}

window.selectDate = (dateStr, el) => {
    state.selectedDateStr = dateStr;
    document.querySelectorAll('.cal-day').forEach(cell => cell.classList.remove('selected'));
    if (el) el.classList.add('selected');
    
    const dateInput = document.getElementById('event-date');
    if (dateInput) dateInput.value = dateStr;
};

// ==========================================
// Event Bindings
// ==========================================
function bindEvents() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
        if (btn.id === 'logout-btn') return;
        btn.addEventListener('click', (e) => {
            const target = e.currentTarget.dataset.target;
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
            e.currentTarget.classList.add('active');
            document.getElementById(target)?.classList.remove('hidden');
            if (target === 'dashboard-tab') renderDashboard();
            if (target === 'analytics-tab') app.renderGranularView();
        });
    });

    document.getElementById('logout-btn')?.addEventListener('click', async () => {
        await supabase.auth.signOut();
        window.location.replace('../../index.html');
    });

    document.getElementById('tab-btn-students')?.addEventListener('click', () => {
        state.directoryView.activeType = 'student';
        state.directoryView.page = 1;
        renderDirectory();
    });
    document.getElementById('tab-btn-teachers')?.addEventListener('click', () => {
        state.directoryView.activeType = 'teacher';
        state.directoryView.page = 1;
        renderDirectory();
    });

    document.getElementById('dir-search-input')?.addEventListener('input', (e) => {
        state.directoryView.searchQuery = e.target.value.trim();
        state.directoryView.page = 1;
        renderDirectory();
    });

    document.getElementById('dir-grade-select')?.addEventListener('change', (e) => {
        state.directoryView.gradeFilter = e.target.value;
        state.directoryView.page = 1;
        renderDirectory();
    });

    document.getElementById('dir-section-select')?.addEventListener('change', (e) => {
        state.directoryView.sectionFilter = e.target.value;
        state.directoryView.page = 1;
        renderDirectory();
    });

    document.getElementById('dir-dept-select')?.addEventListener('change', (e) => {
        state.directoryView.deptFilter = e.target.value;
        state.directoryView.page = 1;
        renderDirectory();
    });

    document.getElementById('dir-sort-select')?.addEventListener('change', (e) => {
        state.directoryView.sortBy = e.target.value;
        renderDirectory();
    });

    document.getElementById('dir-limit-select')?.addEventListener('change', (e) => {
        state.directoryView.limit = e.target.value;
        state.directoryView.page = 1;
        renderDirectory();
    });

    document.getElementById('btn-page-prev')?.addEventListener('click', () => {
        if (state.directoryView.page > 1) {
            state.directoryView.page--;
            renderDirectory();
        }
    });

    document.getElementById('btn-page-next')?.addEventListener('click', () => {
        state.directoryView.page++;
        renderDirectory();
    });

    document.getElementById('analytics-class-search')?.addEventListener('input', (e) => {
        state.analyticsView.classSearch = e.target.value.trim();
        app.renderGranularView();
    });

    document.getElementById('analytics-grade-filter')?.addEventListener('change', (e) => {
        state.analyticsView.gradeFilter = e.target.value;
        app.renderGranularView();
    });

    document.getElementById('analytics-class-sort')?.addEventListener('change', (e) => {
        state.analyticsView.classSortBy = e.target.value;
        app.renderGranularView();
    });

    document.getElementById('analytics-student-search')?.addEventListener('input', (e) => {
        state.analyticsView.studentSearch = e.target.value.trim();
        if (state.analyticsView.selectedClass) {
            app.renderStudentsInClass(state.analyticsView.selectedClass);
        }
    });

    document.getElementById('analytics-student-sort')?.addEventListener('change', (e) => {
        state.analyticsView.studentSortBy = e.target.value;
        if (state.analyticsView.selectedClass) {
            app.renderStudentsInClass(state.analyticsView.selectedClass);
        }
    });

    // Historical Archives Toolbar Listeners
    document.getElementById('archive-search-input')?.addEventListener('input', (e) => {
        state.archiveView.searchQuery = e.target.value.trim();
        app.renderArchives();
    });

    document.getElementById('archive-role-filter')?.addEventListener('change', (e) => {
        state.archiveView.roleFilter = e.target.value;
        app.renderArchives();
    });

    document.getElementById('archive-batch-filter')?.addEventListener('change', (e) => {
        state.archiveView.batchFilter = e.target.value;
        app.renderArchives();
    });

    document.querySelectorAll('.day-toggle').forEach(btn => {
        btn.addEventListener('click', (e) => {
            state.timetables.currentDay = e.target.dataset.day;
            renderMatrix();
        });
    });

    document.querySelectorAll('.sub-tab[data-ec-type]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.sub-tab[data-ec-type]').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            document.querySelectorAll('.ec-pane').forEach(p => p.classList.add('hidden'));
            document.getElementById(`ec-${e.target.dataset.ecType}`)?.classList.remove('hidden');
        });
    });

    document.querySelectorAll('.chat-group').forEach(el => {
        el.addEventListener('click', (e) => {
            document.querySelectorAll('.chat-group').forEach(c => c.classList.remove('active'));
            e.target.classList.add('active');
            state.currentChatGroup = e.target.dataset.group;
            const titleEl = document.getElementById('current-chat-title');
            if (titleEl) titleEl.innerText = e.target.innerText;
            renderSubgroupFilters();
            loadChatMessages();
        });
    });

    document.getElementById('btn-create-poll')?.addEventListener('click', () => {
        document.getElementById('poll-creator')?.classList.toggle('hidden');
    });
    
    document.getElementById('btn-attach-img')?.addEventListener('click', () => {
        document.getElementById('chat-file-upload')?.click();
    });

    document.getElementById('cal-prev')?.addEventListener('click', () => { 
        state.calendarDate.setMonth(state.calendarDate.getMonth() - 1); 
        renderCalendar(); 
    });
    document.getElementById('cal-next')?.addEventListener('click', () => { 
        state.calendarDate.setMonth(state.calendarDate.getMonth() + 1); 
        renderCalendar(); 
    });

    document.getElementById('add-event-btn')?.addEventListener('click', async () => {
        const title = document.getElementById('event-title')?.value?.trim();
        const dateStr = document.getElementById('event-date')?.value;
        const type = document.getElementById('event-type')?.value;
        const repeat = parseInt(document.getElementById('event-repeat')?.value) || 0;
        
        if (!title || !dateStr) return showToast("Please provide both event title and date.", "warning");
        
        const eventsToInsert = [];
        let baseDate = new Date(dateStr);
        const parentId = repeat > 0 ? crypto.randomUUID() : null;
        
        for (let i = 0; i < (repeat > 0 ? 10 : 1); i++) {
            const d = new Date(baseDate);
            d.setDate(d.getDate() + (i * repeat));
            const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
            eventsToInsert.push({ 
                school_id: globalSchoolId, 
                title, 
                date: `${y}-${m}-${day}`, 
                type, 
                parent_event_id: parentId 
            });
        }
        
        await supabase.from('events').insert(eventsToInsert);
        showToast("Event registered.", "success");
        const tInput = document.getElementById('event-title');
        if (tInput) tInput.value = '';
        await fetchCalendarEvents();
        renderCalendar();
    });

    document.querySelectorAll('.modal-overlay').forEach(modal => {
        modal.addEventListener('mousedown', (e) => {
            if (e.target === modal && modal.id !== 'prompt-modal' && modal.id !== 'confirm-modal') {
                modal.classList.add('hidden');
            }
        });
    });

    document.querySelectorAll('.close-modal').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const modal = e.target.closest('.modal-overlay');
            if (modal?.id === 'edit-directory-modal') {
                app.closeEditDirModal();
            } else if (modal?.id === 'archives-modal') {
                app.closeArchivesModal();
            } else if (modal) {
                modal.classList.add('hidden');
            }
        });
    });
}

window.openProfile = async (id) => {
    const person = [...state.directory.students, ...state.directory.teachers].find(p => p.id === id);
    if (!person) return;
    state.activeProfile = person;
    const nameEl = document.getElementById('pm-name');
    const metaEl = document.getElementById('pm-meta');
    const initEl = document.getElementById('pm-initial');
    if (nameEl) nameEl.innerText = person.name;
    if (metaEl) metaEl.innerText = `ID: ${person.unique_id} | ${person.role.toUpperCase()}`;
    if (initEl) initEl.innerText = (person.name || 'U').charAt(0).toUpperCase();
    document.getElementById('profile-modal')?.classList.remove('hidden');
};

document.addEventListener('DOMContentLoaded', init);
