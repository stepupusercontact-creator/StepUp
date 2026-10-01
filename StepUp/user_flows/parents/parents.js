
const SUPABASE_URL = 'https://pzhtjegromovjbevyjki.supabase.co';
const SUPABASE_KEY = 'sb_publishable_G0r-QwmfkGyV32W08uxsgQ_amj0c-Fm';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let state = {
    user: null,
    profile: null,
    schoolId: null,
    
    children: [], // Array of directory records representing linked kids
    activeChild: null, // Currently selected child record
    
    // Active Child's Data
    attendanceLogs: [],
    assignments: [],
    submissions: [],
    grades: [],
    schedule: [],
    teachers: [],

    // School Events
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

// ==========================================
// Initialization & Multi-Child Linking
// ==========================================
async function init() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return window.location.href = '../../index.html';
    state.user = session.user;

    const { data: profile } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
    if (!profile || !profile.school_id) {
        return window.location.href = '../../index.html';
    }
    
    state.profile = profile;
    state.schoolId = profile.school_id;
    document.getElementById('parent-name').innerText = profile.full_name || 'Guardian';
    document.getElementById('parent-initial').innerText = (profile.full_name || 'P').charAt(0).toUpperCase();
    
    await fetchLinkedChildren();
    await fetchSchoolEvents();
    
    bindEvents();
}

async function fetchLinkedChildren() {
    // Relying on the unique_identifier provided at signup (which acts as a link to child's ID or parent's phone)
    // For robust multi-child prototype without schema changes, we fetch students where unique_id matches 
    // OR we load from a local array mapped to this user's profile.
    
    // Check local storage for manually linked IDs
    let linkedIds = JSON.parse(localStorage.getItem(`parent_links_${state.user.id}`) || '[]');
    
    // Always include the identifier used at registration
    if (state.profile.unique_identifier && !linkedIds.includes(state.profile.unique_identifier)) {
        linkedIds.push(state.profile.unique_identifier);
    }

    if (linkedIds.length > 0) {
        const { data: kids } = await supabase.from('school_directory')
            .select('*').eq('school_id', state.schoolId).eq('role', 'student')
            .in('unique_id', linkedIds);
        
        state.children = kids || [];
    }

    const selector = document.getElementById('child-selector');
    
    if (state.children.length === 0) {
        selector.innerHTML = `<option value="">No children linked yet.</option>`;
        app.openLinkChildModal();
    } else {
        selector.innerHTML = state.children.map(c => `<option value="${c.id}">${c.name} (Grade ${c.grade_level}-${c.section})</option>`).join('');
        // Auto-select first child
        state.activeChild = state.children[0];
        document.getElementById('header-child-info').innerText = `Viewing records for: ${state.activeChild.name}`;
        await loadActiveChildData();
    }
}

async function fetchSchoolEvents() {
    if (!state.schoolId) return;
    const { data } = await supabase.from('events').select('*').eq('school_id', state.schoolId).order('date', { ascending: false }).limit(5);
    state.events = data || [];
}

async function loadActiveChildData() {
    if (!state.activeChild) return;
    const sid = state.activeChild.id;
    const classSection = `${state.activeChild.grade_level || 'General'}-${state.activeChild.section || 'A'}`;

    const [subRes, gradeRes, attRes, asgRes, schedRes] = await Promise.all([
        supabase.from('assignment_submissions').select('*').eq('student_id', sid),
        supabase.from('grades').select('*').eq('student_id', sid),
        supabase.from('attendance').select('*').eq('student_id', sid).order('date', { ascending: false }),
        supabase.from('assignments').select('*').eq('school_id', state.schoolId).eq('class_section', classSection),
        supabase.from('native_schedules').select('*').eq('school_id', state.schoolId).eq('class_section', classSection)
    ]);
    
    state.submissions = subRes.data || [];
    state.grades = gradeRes.data || [];
    state.attendanceLogs = attRes.data || [];
    state.assignments = asgRes.data || [];
    state.schedule = schedRes.data || [];

    // Extract teachers for this child
    const teacherIds = [...new Set(state.schedule.map(s => s.teacher_id).filter(Boolean))];
    if (teacherIds.length > 0) {
        const { data: teachers } = await supabase.from('school_directory').select('id, name, department').in('id', teacherIds);
        state.teachers = teachers || [];
    } else {
        state.teachers = [];
    }

    renderDashboard();
    renderAcademics();
    renderAttendance();
    renderCommsSidebar();
    loadChat(); // Reload active chat context
}

// ==========================================
// Dashboard / Overview
// ==========================================
function renderDashboard() {
    // 1. GPA
    if (state.grades.length > 0) {
        const totalPct = state.grades.reduce((acc, curr) => acc + ((curr.score / (curr.max_score || 100)) * 100), 0);
        const avg = Math.round(totalPct / state.grades.length);
        document.getElementById('dash-gpa').innerText = `${avg}%`;
    } else {
        document.getElementById('dash-gpa').innerText = `--%`;
    }

    // 2. Attendance
    const totalLogs = state.attendanceLogs.length;
    let attPct = 100;
    if (totalLogs > 0) {
        const presentLogs = state.attendanceLogs.filter(a => a.status === 'present' || a.status === 'late').length;
        attPct = Math.round((presentLogs / totalLogs) * 100);
        document.getElementById('dash-attendance').innerText = `${attPct}%`;
    } else {
        document.getElementById('dash-attendance').innerText = `--%`;
    }
    
    const healthEl = document.getElementById('dash-att-status');
    if(attPct >= 90) { healthEl.innerText = "Health: Excellent"; healthEl.style.color = "var(--text-muted)"; }
    else if(attPct >= 75) { healthEl.innerText = "Health: Warning"; healthEl.style.color = "var(--warning)"; }
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

    // 5. Recent Activity (Grades & Absences mixed)
    const activityList = document.getElementById('dash-activity-list');
    let activities = [];
    
    // Add recent grades
    state.grades.forEach(g => {
        const asg = state.assignments.find(a => a.id === g.assignment_id);
        if (asg) activities.push({ date: new Date(g.created_at), text: `Graded: ${asg.title} - ${g.score}/${g.max_score||100}` });
    });

    // Add absences
    state.attendanceLogs.filter(a => a.status === 'absent').forEach(a => {
        activities.push({ date: new Date(a.date), text: `Marked Absent for the day.` });
    });

    activities.sort((a,b) => b.date - a.date); // Newest first

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
    // Grades Table
    const tbody = document.getElementById('grades-tbody');
    if (state.assignments.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted py-4">No academic records available yet.</td></tr>`;
    } else {
        tbody.innerHTML = state.assignments.sort((a,b) => new Date(b.created_at) - new Date(a.created_at)).map(a => {
            const sub = state.submissions.find(s => s.assignment_id === a.id);
            const grade = state.grades.find(g => g.assignment_id === a.id);
            
            let statusHTML = `<span class="status-pill status-missing">Missing</span>`;
            let scoreHTML = `--`;
            let dateHTML = new Date(a.due_date).toLocaleDateString();

            if (grade) {
                statusHTML = `<span class="status-pill status-graded">Graded</span>`;
                scoreHTML = `<strong>${grade.score}</strong> / ${grade.max_score||100}`;
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

    // Pending Tasks 
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
                        return Math.round((g.score / (g.max_score||100))*100);
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
        if(a.status === 'present') present++;
        else if(a.status === 'absent') absent++;
        else late++;
    });

    const attPct = totalLogs > 0 ? Math.round(((present+late) / totalLogs) * 100) : 100;

    const ctxAtt = document.getElementById('attendance-pie-chart');
    if (state.charts.att) state.charts.att.destroy();
    
    if (totalLogs === 0) {
        state.charts.att = new Chart(ctxAtt, {
            type: 'doughnut',
            data: { labels: ['No Data'], datasets: [{ data: [1], backgroundColor: ['#EAEAEA'] }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: {enabled: false} } }
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
    const misses = state.attendanceLogs.filter(a => a.status === 'absent' || a.status === 'late');
    
    if (misses.length === 0) {
        logTbody.innerHTML = `<tr><td colspan="2" class="text-center text-muted py-4">Perfect attendance! No missed days.</td></tr>`;
    } else {
        logTbody.innerHTML = misses.map(a => {
            const color = a.status === 'absent' ? 'var(--danger)' : 'var(--warning)';
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
// Comms & Direct Messaging
// ==========================================
function renderCommsSidebar() {
    const list = document.getElementById('chat-teachers-list');
    if (state.teachers.length === 0) {
        list.innerHTML = '<li class="text-muted ml-2" style="font-size:0.8rem;">No teachers linked to this class.</li>';
        return;
    }

    list.innerHTML = state.teachers.map(t => `
        <li class="chat-group" data-chat-type="teacher" data-target-id="${t.id}">
            <div class="avatar-sm">${(t.name||'T').charAt(0)}</div> 
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
            
            if(state.activeChatType === 'broadcast') {
                document.getElementById('chat-active-title').innerText = "School Broadcasts";
                document.getElementById('chat-active-subtitle').innerText = "Official announcements from administrators";
                document.getElementById('chat-input-container').style.display = 'none'; // Read-only
            } else {
                const tName = state.teachers.find(t => t.id === state.activeChatTarget)?.name || 'Teacher';
                document.getElementById('chat-active-title').innerText = tName;
                document.getElementById('chat-active-subtitle').innerText = `Discussing ${state.activeChild.name}'s progress`;
                document.getElementById('chat-input-container').style.display = 'block'; // DM capable
            }

            loadChat();
        });
    });
}

async function loadChat() {
    const history = document.getElementById('chat-history');
    history.innerHTML = '';

    let query = supabase.from('communications').select('*').eq('school_id', state.schoolId);

    if (state.activeChatType === 'broadcast') {
        // Fetch broadcasts for parents generally, or specific to this child's class
        const classStr = `section:${state.activeChild?.grade_level || 'General'}-${state.activeChild?.section || 'A'}`;
        query = query.in('target_group', ['parents', 'all']).or(`target_subgroups.cs.{${classStr}},target_subgroups.is.null,target_subgroups.eq.{}`, { foreignTable: '' }); 
        // Note: For prototype simplicity, let's fetch all parents/all broadcasts.
        query = supabase.from('communications').select('*').eq('school_id', state.schoolId).in('target_group', ['parents', 'all']);
    } else {
        query = query.eq('target_group', 'direct');
    }

    const { data } = await query.order('created_at', { ascending: true });
    
    if(!data || data.length === 0) {
        history.innerHTML = `<p class="text-muted text-center py-4">No messages yet.</p>`;
        return;
    }

    let filteredData = data;
    if (state.activeChatType !== 'broadcast') {
        // Direct messages between parent auth user and selected teacher directory ID
        filteredData = data.filter(m => 
            (m.target_subgroups?.includes(state.activeChatTarget) && m.sender_id === state.user.id) ||
            (m.target_subgroups?.includes(state.user.id)) // If teacher replied to parent
        );
    }

    if(filteredData.length === 0) {
        history.innerHTML = `<p class="text-muted text-center py-4">Start the conversation!</p>`;
        return;
    }

    history.innerHTML = filteredData.map(msg => {
        const isSent = msg.sender_id === state.user.id;
        const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return `
            <div class="msg-bubble ${isSent ? 'sent' : 'received'}">
                <span class="msg-meta">${isSent ? 'You' : (state.activeChatType==='broadcast' ? 'School Admin' : 'Teacher')} • ${time}</span>
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
        document.getElementById(tabId).classList.remove('hidden');
    },

    switchChild: async () => {
        const sid = document.getElementById('child-selector').value;
        if (!sid) return;
        state.activeChild = state.children.find(c => c.id === sid);
        document.getElementById('header-child-info').innerText = `Viewing records for: ${state.activeChild.name}`;
        await loadActiveChildData();
    },

    openLinkChildModal: () => {
        document.getElementById('link-child-id').value = '';
        document.getElementById('link-child-modal').classList.remove('hidden');
    },

    submitLinkChild: async () => {
        const childId = document.getElementById('link-child-id').value.trim();
        if (!childId) return showToast("Enter a valid identifier.", "warning");

        const { data: child } = await supabase.from('school_directory')
            .select('*').eq('school_id', state.schoolId).eq('role', 'student').eq('unique_id', childId).maybeSingle();

        if (!child) {
            return showToast("No student found with that identifier in this school.", "error");
        }

        // Check if already linked
        if (state.children.find(c => c.id === child.id)) {
            document.getElementById('link-child-modal').classList.add('hidden');
            return showToast("Child is already linked to your profile.", "info");
        }

        // Save link to local storage (prototype logic)
        let linkedIds = JSON.parse(localStorage.getItem(`parent_links_${state.user.id}`) || '[]');
        linkedIds.push(child.unique_id);
        localStorage.setItem(`parent_links_${state.user.id}`, JSON.stringify(linkedIds));

        document.getElementById('link-child-modal').classList.add('hidden');
        showToast("Child successfully linked!", "success");
        await fetchLinkedChildren(); // Refresh the list
    },

    sendChatMessage: async () => {
        const input = document.getElementById('chat-msg-input');
        const content = input.value.trim();
        if(!content || state.activeChatType === 'broadcast') return;

        await supabase.from('communications').insert([{
            school_id: state.schoolId,
            sender_id: state.user.id,
            target_group: 'direct',
            target_subgroups: [state.activeChatTarget],
            msg_type: 'text',
            content: content
        }]);

        input.value = '';
        loadChat();
    }
};

function bindEvents() {
    document.querySelectorAll('.nav-btn[data-target]').forEach(btn => {
        btn.addEventListener('click', (e) => app.goToTab(e.currentTarget.dataset.target));
    });

    document.getElementById('logout-btn').addEventListener('click', async () => {
        await supabase.auth.signOut();
        window.location.href = '../../index.html';
    });
}

document.addEventListener('DOMContentLoaded', init);
