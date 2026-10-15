const SUPABASE_URL = 'https://pzhtjegromovjbevyjki.supabase.co';
const SUPABASE_KEY = 'sb_publishable_G0r-QwmfkGyV32W08uxsgQ_amj0c-Fm';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let state = {
    user: null,
    profile: null,
    schoolId: null,
    
    children: [], 
    activeChild: null, 
    
    // Active Child Data
    attendanceLogs: [],
    assignments: [],
    submissions: [],
    grades: [],
    schedule: [],
    teachers: [],

    // School Updates
    events: [],
    
    // Comms 
    activeChatType: 'broadcast', // 'broadcast' | 'teacher'
    activeChatTarget: 'all', 
    chatMessages: [],

    charts: { att: null, perf: null }
};

function showToast(message, type = 'info', title = '') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    const icons = {
        success: `<svg viewBox="0 0 24 24" class="toast-icon" style="color:var(--success)"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`,
        error: `<svg viewBox="0 0 24 24" class="toast-icon" style="color:var(--danger)"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`,
        info: `<svg viewBox="0 0 24 24" class="toast-icon" style="color:var(--primary)"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`
    };

    toast.innerHTML = `
        ${icons[type] || icons.info}
        <div class="flex-grow">
            ${title ? `<div class="toast-title">${title}</div>` : ''}
            <div class="toast-msg">${message}</div>
        </div>
        <button class="toast-close" onclick="this.parentElement.remove()">&times;</button>
    `;
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 4000);
}

function cleanClassName(str) {
    if (!str) return '';
    return str.replace(/^(grade|class)\s*/i, '').replace(/\s*-\s*/, '-').trim();
}

// ==========================================
// Initialization (Loop-Proof)
// ==========================================
async function init() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return window.location.replace('../../index.html');
    state.user = session.user;

    const { data: profile } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
    
    const schoolId = profile?.school_id || session.user.user_metadata?.school_id;
    const role = profile?.role || session.user.user_metadata?.role;
    const fullName = profile?.full_name || session.user.user_metadata?.full_name || 'Guardian';

    // Hard circuit-breaker prevents infinite login/logout loops
    if (!schoolId || role !== 'parent') {
        return window.location.replace('../../index.html');
    }
    
    state.profile = profile || {};
    state.schoolId = schoolId;
    
    document.getElementById('parent-name').innerText = fullName;
    document.getElementById('parent-initial').innerText = fullName.charAt(0).toUpperCase();
    
    await fetchLinkedChildren();
    await fetchSchoolEvents();
    
    bindEvents();
}

async function fetchLinkedChildren() {
    let linkedIds = JSON.parse(localStorage.getItem(`parent_links_${state.user.id}`) || '[]');
    
    // Always include the identifier provided during registration
    if (state.profile.unique_identifier && !linkedIds.includes(state.profile.unique_identifier)) {
        linkedIds.push(state.profile.unique_identifier);
    }

    // Fetch school students and match case-insensitively
    const { data: allStudents } = await supabase.from('school_directory')
        .select('*')
        .eq('school_id', state.schoolId)
        .ilike('role', 'student');

    if (allStudents && linkedIds.length > 0) {
        state.children = allStudents.filter(s => 
            linkedIds.some(id => 
                (s.unique_id && s.unique_id.toLowerCase() === id.toLowerCase()) || 
                (s.phone && s.phone === id)
            )
        );
    } else {
        state.children = [];
    }

    const selector = document.getElementById('child-selector');
    
    if (state.children.length === 0) {
        selector.innerHTML = `<option value="">No children linked yet</option>`;
        document.getElementById('header-child-info').innerText = `Viewing records for: None linked`;
        app.openLinkChildModal();
    } else {
        selector.innerHTML = state.children.map(c => `
            <option value="${c.id}">${c.name} (Grade ${c.grade_level}-${c.section})</option>
        `).join('');
        
        // Auto-select first child if none active
        if (!state.activeChild || !state.children.some(c => c.id === state.activeChild.id)) {
            state.activeChild = state.children[0];
        } else {
            selector.value = state.activeChild.id;
        }

        document.getElementById('header-child-info').innerText = `Viewing records for: ${state.activeChild.name}`;
        await loadActiveChildData();
    }
}

async function fetchSchoolEvents() {
    if (!state.schoolId) return;
    const { data } = await supabase.from('events')
        .select('*')
        .eq('school_id', state.schoolId)
        .order('date', { ascending: false })
        .limit(5);
    state.events = data || [];
}

async function loadActiveChildData() {
    if (!state.activeChild) return;
    const sid = state.activeChild.id;
    const childClassSection = cleanClassName(`${state.activeChild.grade_level || 'General'}-${state.activeChild.section || 'A'}`);

    const [subRes, gradeRes, attRes, asgRes, schedRes] = await Promise.all([
        supabase.from('assignment_submissions').select('*').eq('student_id', sid),
        supabase.from('grades').select('*').eq('student_id', sid),
        supabase.from('attendance').select('*').eq('student_id', sid).order('date', { ascending: false }),
        supabase.from('assignments').select('*').eq('school_id', state.schoolId),
        supabase.from('native_schedules').select('*').eq('school_id', state.schoolId)
    ]);
    
    state.submissions = subRes.data || [];
    state.grades = gradeRes.data || [];
    state.attendanceLogs = attRes.data || [];
    
    // Flexible class section filtering (handles "Grade 10-A" vs "10-A")
    state.assignments = (asgRes.data || []).filter(a => cleanClassName(a.class_section) === childClassSection);
    state.schedule = (schedRes.data || []).filter(s => cleanClassName(s.class_section) === childClassSection);

    // Extract teachers linked to this child's class
    const teacherIds = [...new Set(state.schedule.map(s => s.teacher_id).filter(Boolean))];
    if (teacherIds.length > 0) {
        const { data: teachers } = await supabase.from('school_directory')
            .select('id, name, department')
            .in('id', teacherIds);
        state.teachers = teachers || [];
    } else {
        state.teachers = [];
    }

    renderDashboard();
    renderAcademics();
    renderAttendance();
    renderCommsSidebar();
    loadChat();
}

// ==========================================
// Dashboard / Overview
// ==========================================
function renderDashboard() {
    // 1. GPA
    if (state.grades.length > 0) {
        const totalPct = state.grades.reduce((acc, curr) => acc + (((parseFloat(curr.score) || 0) / (curr.max_score || 100)) * 100), 0);
        const avg = Math.round(totalPct / state.grades.length);
        document.getElementById('dash-gpa').innerText = `${avg}%`;
    } else {
        document.getElementById('dash-gpa').innerText = `--%`;
    }

    // 2. Attendance
    const totalLogs = state.attendanceLogs.length;
    let attPct = 100;
    if (totalLogs > 0) {
        const presentLogs = state.attendanceLogs.filter(a => a.status?.toLowerCase() === 'present' || a.status?.toLowerCase() === 'late').length;
        attPct = Math.round((presentLogs / totalLogs) * 100);
        document.getElementById('dash-attendance').innerText = `${attPct}%`;
    } else {
        document.getElementById('dash-attendance').innerText = `100%`;
    }
    
    const healthEl = document.getElementById('dash-att-status');
    if (attPct >= 90) { healthEl.innerText = "Health: Excellent"; healthEl.style.color = "var(--success)"; }
    else if (attPct >= 75) { healthEl.innerText = "Health: Good"; healthEl.style.color = "var(--warning)"; }
    else { healthEl.innerText = "Health: Requires Review"; healthEl.style.color = "var(--danger)"; }

    // 3. Pending Tasks
    const pendingTasks = state.assignments.filter(a => {
        const sub = state.submissions.find(s => s.assignment_id === a.id);
        return !sub || (sub.status !== 'submitted' && sub.status !== 'graded');
    });
    document.getElementById('dash-pending-tasks').innerText = pendingTasks.length;

    // 4. Events
    const eventsList = document.getElementById('events-list');
    if (state.events.length === 0) {
        eventsList.innerHTML = `<p class="text-muted text-center py-4">No recent events or announcements.</p>`;
    } else {
        eventsList.innerHTML = state.events.map(e => `
            <div class="event-card">
                <h4>${e.title}</h4>
                <p class="text-muted mt-1" style="font-size:0.8rem;">Date: <strong>${new Date(e.date).toLocaleDateString()}</strong> • Type: <span style="text-transform:capitalize;">${e.type}</span></p>
            </div>
        `).join('');
    }

    // 5. Recent Activity
    const activityList = document.getElementById('dash-activity-list');
    let activities = [];
    
    state.grades.forEach(g => {
        const asg = state.assignments.find(a => a.id === g.assignment_id);
        if (asg) activities.push({ date: new Date(g.created_at), text: `Evaluated: ${asg.title} (${g.score}/${g.max_score || 100})` });
    });

    state.attendanceLogs.filter(a => a.status?.toLowerCase() === 'absent').forEach(a => {
        activities.push({ date: new Date(a.date), text: `Marked Absent for the day.` });
    });

    activities.sort((a,b) => b.date - a.date);

    if (activities.length === 0) {
        activityList.innerHTML = `<p class="text-muted text-center py-4">No recent activity found.</p>`;
    } else {
        activityList.innerHTML = activities.slice(0, 5).map(act => `
            <div class="timeline-item">
                <div class="tl-time">${act.date.toLocaleDateString([], {month:'short', day:'numeric'})}</div>
                <div class="tl-line"></div>
                <div class="tl-content"><p>${act.text}</p></div>
            </div>
        `).join('');
    }
}

// ==========================================
// Academics & Tasks
// ==========================================
function renderAcademics() {
    const tbody = document.getElementById('grades-tbody');
    if (state.assignments.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted py-4">No academic records available yet.</td></tr>`;
    } else {
        tbody.innerHTML = state.assignments.sort((a,b) => new Date(b.created_at) - new Date(a.created_at)).map(a => {
            const sub = state.submissions.find(s => s.assignment_id === a.id);
            const grade = state.grades.find(g => g.assignment_id === a.id);
            
            let statusHTML = `<span class="status-pill status-missing">Pending</span>`;
            let scoreHTML = `--`;
            let dateHTML = new Date(a.due_date).toLocaleDateString();

            if (grade) {
                statusHTML = `<span class="status-pill status-graded">Graded</span>`;
                scoreHTML = `<strong>${grade.score}</strong> / ${grade.max_score || 100}`;
            } else if (sub && (sub.status === 'submitted' || sub.status === 'extension_requested')) {
                statusHTML = `<span class="status-pill status-pending">Turned In</span>`;
            }

            return `
                <tr>
                    <td><strong>${a.title}</strong></td>
                    <td>${statusHTML}</td>
                    <td>${dateHTML}</td>
                    <td style="text-align: right; color:var(--primary);">${scoreHTML}</td>
                </tr>
            `;
        }).join('');
    }

    const pendingTasksList = document.getElementById('pending-tasks-list');
    const pendingTasks = state.assignments.filter(a => {
        const sub = state.submissions.find(s => s.assignment_id === a.id);
        return !sub || (sub.status !== 'submitted' && sub.status !== 'graded');
    });

    if (pendingTasks.length === 0) {
        pendingTasksList.innerHTML = `<p class="text-muted text-center py-4">No pending coursework. Child is up to date.</p>`;
    } else {
        pendingTasksList.innerHTML = pendingTasks.map(a => `
            <div class="task-card">
                <div>
                    <h4>${a.title}</h4>
                    <p class="text-muted mt-1" style="font-size:0.8rem;">Due Date: <strong>${new Date(a.due_date).toLocaleDateString()}</strong></p>
                </div>
            </div>
        `).join('');
    }

    // Chart
    const gradedAsgs = state.assignments.filter(a => state.grades.some(g => g.assignment_id === a.id));
    const ctxPerf = document.getElementById('performance-trend-chart');
    if (state.charts.perf) state.charts.perf.destroy();
    
    if (gradedAsgs.length > 0) {
        state.charts.perf = new Chart(ctxPerf, {
            type: 'line',
            data: {
                labels: gradedAsgs.map((a,i) => `Task ${i+1}`),
                datasets: [{
                    label: 'Score %',
                    data: gradedAsgs.map(a => {
                        const g = state.grades.find(x => x.assignment_id === a.id);
                        return Math.round(((parseFloat(g.score) || 0) / (g.max_score || 100)) * 100);
                    }),
                    borderColor: '#0056D2',
                    backgroundColor: 'rgba(0, 86, 210, 0.05)',
                    fill: true,
                    tension: 0.3
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 100 } }, plugins: { legend: { display: false } } }
        });
    } else {
        state.charts.perf = new Chart(ctxPerf, {
            type: 'line',
            data: { labels: ['No Data'], datasets: [{ data: [0], borderColor: '#EAEAEA' }] },
            options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 100 } }, plugins: { legend: { display: false } } }
        });
    }
}

// ==========================================
// Attendance
// ==========================================
function renderAttendance() {
    const totalLogs = state.attendanceLogs.length;
    let present = 0, absent = 0, late = 0;
    
    state.attendanceLogs.forEach(a => {
        const s = a.status?.toLowerCase();
        if (s === 'present') present++;
        else if (s === 'absent') absent++;
        else late++;
    });

    const ctxAtt = document.getElementById('attendance-pie-chart');
    if (state.charts.att) state.charts.att.destroy();
    
    if (totalLogs === 0) {
        state.charts.att = new Chart(ctxAtt, {
            type: 'doughnut',
            data: { labels: ['No Logs Recorded'], datasets: [{ data: [1], backgroundColor: ['#EAEAEA'] }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { enabled: false } } }
        });
    } else {
        state.charts.att = new Chart(ctxAtt, {
            type: 'doughnut',
            data: {
                labels: ['Present', 'Absent', 'Late'],
                datasets: [{ data: [present, absent, late], backgroundColor: ['#10B981', '#EF4444', '#F59E0B'], borderWidth: 0 }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
        });
    }

    // Absence Log
    const logTbody = document.getElementById('attendance-log-tbody');
    const misses = state.attendanceLogs.filter(a => a.status?.toLowerCase() === 'absent' || a.status?.toLowerCase() === 'late');
    
    if (misses.length === 0) {
        logTbody.innerHTML = `<tr><td colspan="2" class="text-center text-muted py-4">Perfect attendance! No missed days.</td></tr>`;
    } else {
        logTbody.innerHTML = misses.map(a => {
            const color = a.status?.toLowerCase() === 'absent' ? 'var(--danger)' : 'var(--warning)';
            return `
                <tr>
                    <td><strong>${new Date(a.date).toLocaleDateString()}</strong></td>
                    <td style="color:${color}; text-transform:capitalize; font-weight:600;">${a.status}</td>
                </tr>
            `;
        }).join('');
    }
}

// ==========================================
// Comms & Direct Messaging (Leak-Proof)
// ==========================================
function renderCommsSidebar() {
    const list = document.getElementById('chat-teachers-list');
    if (state.teachers.length === 0) {
        list.innerHTML = '<li class="text-muted ml-2" style="font-size:0.8rem;">No teachers linked to this class.</li>';
        return;
    }

    list.innerHTML = state.teachers.map(t => `
        <li class="chat-group" data-chat-type="teacher" data-target-id="${t.id}">
            <div class="avatar-sm">${(t.name || 'T').charAt(0)}</div> 
            ${t.name} <span class="text-muted" style="font-size:0.7rem; margin-left:4px;">(${t.department || 'Faculty'})</span>
        </li>
    `).join('');

    document.querySelectorAll('.chat-group').forEach(el => {
        el.addEventListener('click', (e) => {
            const targetEl = e.currentTarget;
            document.querySelectorAll('.chat-group').forEach(c => c.classList.remove('active'));
            targetEl.classList.add('active');
            
            state.activeChatType = targetEl.dataset.chatType;
            state.activeChatTarget = targetEl.dataset.targetId;
            
            if (state.activeChatType === 'broadcast') {
                document.getElementById('chat-active-title').innerText = "School Broadcasts";
                document.getElementById('chat-active-subtitle').innerText = "Official announcements from administrators";
                document.getElementById('chat-input-container').style.display = 'none'; // Read-only
            } else {
                const tName = state.teachers.find(t => t.id === state.activeChatTarget)?.name || 'Teacher';
                document.getElementById('chat-active-title').innerText = tName;
                document.getElementById('chat-active-subtitle').innerText = `Discussing ${state.activeChild?.name || 'child'}'s progress`;
                document.getElementById('chat-input-container').style.display = 'block'; // DM capable
            }

            loadChat();
        });
    });
}

async function loadChat() {
    const history = document.getElementById('chat-history');
    if (!history) return;
    history.innerHTML = '';

    const { data } = await supabase.from('communications')
        .select('*')
        .eq('school_id', state.schoolId)
        .order('created_at', { ascending: true });
    
    if (!data || data.length === 0) {
        history.innerHTML = `<p class="text-muted text-center py-4">No messages yet.</p>`;
        return;
    }

    let filteredData = [];
    if (state.activeChatType === 'broadcast') {
        const childClass = cleanClassName(`${state.activeChild?.grade_level || 'General'}-${state.activeChild?.section || 'A'}`);
        filteredData = data.filter(m => 
            m.target_group === 'all' || 
            (m.target_group === 'parents' && (!m.target_subgroups || m.target_subgroups.length === 0 || m.target_subgroups.includes(`section:${childClass}`)))
        );
    } else {
        // Strict Direct Message Isolation: Only show chats between THIS parent and THIS specific teacher
        filteredData = data.filter(m => {
            if (m.target_group !== 'direct') return false;
            const sentByMeToTeacher = m.sender_id === state.user.id && m.target_subgroups?.includes(state.activeChatTarget);
            const sentByTeacherToMe = m.sender_id === state.activeChatTarget && m.target_subgroups?.includes(state.user.id);
            return sentByMeToTeacher || sentByTeacherToMe;
        });
    }

    if (filteredData.length === 0) {
        history.innerHTML = `<p class="text-muted text-center py-4">No messages in this channel.</p>`;
        return;
    }

    history.innerHTML = filteredData.map(msg => {
        const isSent = msg.sender_id === state.user.id;
        const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return `
            <div class="msg-bubble ${isSent ? 'sent' : 'received'}">
                <span class="msg-meta">${isSent ? 'You' : (state.activeChatType === 'broadcast' ? 'School Admin' : 'Teacher')} • ${time}</span>
                <p>${msg.content}</p>
            </div>
        `;
    }).join('');
    history.scrollTop = history.scrollHeight;
}

// Global actions exposed to window.app
window.app = {
    goToTab: (tabId) => {
        document.querySelectorAll('.nav-btn[data-target]').forEach(b => b.classList.toggle('active', b.dataset.target === tabId));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
        document.getElementById(tabId)?.classList.remove('hidden');
    },

    switchChild: async () => {
        const sid = document.getElementById('child-selector').value;
        if (!sid) return;
        state.activeChild = state.children.find(c => c.id === sid);
        if (state.activeChild) {
            document.getElementById('header-child-info').innerText = `Viewing records for: ${state.activeChild.name}`;
            await loadActiveChildData();
        }
    },

    openLinkChildModal: () => {
        const input = document.getElementById('link-child-id');
        if (input) input.value = '';
        document.getElementById('link-child-modal')?.classList.remove('hidden');
    },

    submitLinkChild: async () => {
        const childId = document.getElementById('link-child-id')?.value.trim();
        if (!childId) return showToast("Enter a valid student identifier.", "warning");

        const { data: students } = await supabase.from('school_directory')
            .select('*')
            .eq('school_id', state.schoolId)
            .ilike('role', 'student');

        const child = students?.find(s => s.unique_id?.toLowerCase() === childId.toLowerCase());

        if (!child) {
            return showToast("No student found with that identifier in this school.", "error");
        }

        if (state.children.some(c => c.id === child.id)) {
            document.getElementById('link-child-modal')?.classList.add('hidden');
            return showToast("Child is already linked to your profile.", "info");
        }

        let linkedIds = JSON.parse(localStorage.getItem(`parent_links_${state.user.id}`) || '[]');
        if (!linkedIds.includes(child.unique_id)) {
            linkedIds.push(child.unique_id);
            localStorage.setItem(`parent_links_${state.user.id}`, JSON.stringify(linkedIds));
        }

        document.getElementById('link-child-modal')?.classList.add('hidden');
        showToast(`Linked ${child.name} successfully!`, "success");
        await fetchLinkedChildren();
    },

    sendChatMessage: async () => {
        const input = document.getElementById('chat-msg-input');
        const content = input?.value.trim();
        if (!content || state.activeChatType === 'broadcast') return;

        await supabase.from('communications').insert([{
            school_id: state.schoolId,
            sender_id: state.user.id,
            target_group: 'direct',
            target_subgroups: [state.activeChatTarget, state.user.id],
            msg_type: 'text',
            content: content
        }]);

        if (input) input.value = '';
        loadChat();
    }
};

function bindEvents() {
    document.querySelectorAll('.nav-btn[data-target]').forEach(btn => {
        btn.addEventListener('click', (e) => app.goToTab(e.currentTarget.dataset.target));
    });

    // Close modals on outside backdrop click
    document.querySelectorAll('.modal-overlay').forEach(modal => {
        modal.addEventListener('mousedown', (e) => {
            if (e.target === modal) modal.classList.add('hidden');
        });
    });

    document.getElementById('logout-btn')?.addEventListener('click', async () => {
        await supabase.auth.signOut();
        window.location.replace('../../index.html');
    });
}

document.addEventListener('DOMContentLoaded', init);