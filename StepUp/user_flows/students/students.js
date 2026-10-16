const SUPABASE_URL = 'https://pzhtjegromovjbevyjki.supabase.co';
const SUPABASE_KEY = 'sb_publishable_G0r-QwmfkGyV32W08uxsgQ_amj0c-Fm';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let state = {
    user: null,
    profile: null,
    dirRecord: null,
    schoolId: null,
    classSection: null,
    
    attendanceLogs: [],
    assignments: [],
    submissions: [],
    grades: [],
    schedule: [],
    
    // Social / Directory
    teachers: [],
    classmates: [],

    // Comms Active State
    activeChatType: 'class', // 'class' | 'teacher' | 'peer'
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
    const fullName = profile?.full_name || session.user.user_metadata?.full_name || 'Student';
    const identifier = profile?.unique_identifier;

    // Hard circuit-breaker prevents infinite loops
    if (!schoolId || role !== 'student') {
        return window.location.replace('../../index.html');
    }
    
    state.profile = profile || {};
    state.schoolId = schoolId;
    
    document.getElementById('student-name').innerText = fullName;
    document.getElementById('student-initial').innerText = fullName.charAt(0).toUpperCase();
    
    // Case-insensitive directory matching avoids single-record query crashes
    const { data: dirRecords } = await supabase
        .from('school_directory')
        .select('*')
        .eq('school_id', schoolId)
        .ilike('role', 'student');

    let dirData = null;
    if (dirRecords && dirRecords.length > 0) {
        if (identifier) {
            dirData = dirRecords.find(r => r.unique_id?.toLowerCase() === identifier.toLowerCase());
        }
        if (!dirData) {
            dirData = dirRecords.find(r => r.name?.toLowerCase().includes(fullName.toLowerCase()));
        }
    }
        
    if (dirData) {
        state.dirRecord = dirData;
        state.classSection = cleanClassName(`${dirData.grade_level || 'General'}-${dirData.section || 'A'}`);
        document.getElementById('header-class-info').innerText = `Class ${state.classSection} • ID: ${dirData.unique_id}`;
        await loadStudentData();
    } else {
        showToast("Your account isn't linked to an active student record. Please link your ID.", "warning");
        document.getElementById('link-profile-modal')?.classList.remove('hidden');
    }
    
    bindEvents();
}

async function loadStudentData() {
    if (!state.dirRecord) return;
    const sid = state.dirRecord.id;

    // 1. Fetch Timetable for this student's class
    const { data: sched } = await supabase.from('native_schedules')
        .select('*').eq('school_id', state.schoolId);
    
    // Filter schedule flexibly for formatting
    state.schedule = (sched || []).filter(s => cleanClassName(s.class_section) === state.classSection);

    // 2. Fetch Assignments for this class
    const { data: asgs } = await supabase.from('assignments')
        .select('*').eq('school_id', state.schoolId);
    
    state.assignments = (asgs || []).filter(a => cleanClassName(a.class_section) === state.classSection);

    // 3. Fetch Submissions, Grades, and Attendance for this student
    const [subRes, gradeRes, attRes] = await Promise.all([
        supabase.from('assignment_submissions').select('*').eq('student_id', sid),
        supabase.from('grades').select('*').eq('student_id', sid),
        supabase.from('attendance').select('*').eq('student_id', sid)
    ]);
    
    state.submissions = subRes.data || [];
    state.grades = gradeRes.data || [];
    state.attendanceLogs = attRes.data || [];

    // 4. Build Peer & Teacher Networks
    const { data: peers } = await supabase.from('school_directory')
        .select('id, name, unique_id')
        .eq('school_id', state.schoolId)
        .eq('role', 'student')
        .eq('grade_level', state.dirRecord.grade_level)
        .eq('section', state.dirRecord.section)
        .neq('id', sid);
    state.classmates = peers || [];

    const teacherIds = [...new Set(state.schedule.map(s => s.teacher_id).filter(Boolean))];
    if (teacherIds.length > 0) {
        const { data: teachers } = await supabase.from('school_directory')
            .select('id, name, department').in('id', teacherIds);
        state.teachers = teachers || [];
    }

    renderDashboard();
    renderAcademics();
    renderTimetable();
    renderSocialSidebar();
    loadChat();
}

// ==========================================
// Dashboard Calculations
// ==========================================
function renderDashboard() {
    const completedTasks = state.submissions.filter(s => s.status === 'submitted' || s.status === 'graded').length;
    const pendingTasks = state.assignments.filter(a => {
        const sub = state.submissions.find(s => s.assignment_id === a.id);
        return !sub || (sub.status !== 'submitted' && sub.status !== 'graded');
    });
    
    const taskBadge = document.getElementById('badge-tasks');
    document.getElementById('dash-pending-tasks').innerText = pendingTasks.length;
    if (pendingTasks.length > 0) {
        taskBadge.classList.remove('hidden');
        taskBadge.innerText = pendingTasks.length;
    } else {
        taskBadge.classList.add('hidden');
    }

    // Gamification level
    const level = Math.floor(completedTasks / 5) + 1;
    const xpPct = ((completedTasks % 5) / 5) * 100;
    document.getElementById('student-level').innerText = `Lvl ${level}`;
    document.getElementById('student-xp').style.width = `${xpPct}%`;

    // GPA calculations
    if (state.grades.length > 0) {
        const totalPct = state.grades.reduce((acc, curr) => acc + (((parseFloat(curr.score) || 0) / (curr.max_score || 100)) * 100), 0);
        const avg = Math.round(totalPct / state.grades.length);
        document.getElementById('dash-gpa').innerText = `${avg}%`;
    } else {
        document.getElementById('dash-gpa').innerText = `--%`;
    }

    // Attendance Streak & Chart
    const totalLogs = state.attendanceLogs.length;
    const presentLogs = state.attendanceLogs.filter(a => a.status?.toLowerCase() === 'present' || a.status?.toLowerCase() === 'late').length;
    const attPct = totalLogs > 0 ? Math.round((presentLogs / totalLogs) * 100) : 100;

    let streak = totalLogs > 0 ? presentLogs : 0;
    document.getElementById('dash-streak').innerHTML = `${streak} <span style="font-size:1rem;">🔥</span>`;
    
    const healthEl = document.getElementById('dash-attendance-health');
    if (attPct >= 90) { healthEl.innerText = "Health: Excellent"; healthEl.style.color = "var(--success)"; }
    else if (attPct >= 75) { healthEl.innerText = "Health: Good"; healthEl.style.color = "var(--warning)"; }
    else { healthEl.innerText = "Health: At Risk"; healthEl.style.color = "var(--danger)"; }

    const ctxAtt = document.getElementById('dash-attendance-chart');
    if (state.charts.att) state.charts.att.destroy();
    state.charts.att = new Chart(ctxAtt, {
        type: 'doughnut',
        data: {
            labels: ['Present', 'Missed'],
            datasets: [{ data: [attPct, 100 - attPct], backgroundColor: ['#10B981', '#EAEAEA'], borderWidth: 0 }]
        },
        options: { responsive: true, maintainAspectRatio: false, cutout: '75%', plugins: { legend: { display: false } } }
    });

    // Action Items Box
    const dashItems = document.getElementById('dash-action-items');
    if (pendingTasks.length === 0) {
        dashItems.innerHTML = `<p class="text-muted text-center py-4">No pending assignments! You're all caught up.</p>`;
    } else {
        dashItems.innerHTML = pendingTasks.slice(0, 3).map(a => {
            const due = new Date(a.due_date).toLocaleDateString();
            return `
                <div class="task-card">
                    <div>
                        <h4 style="color:var(--text-main); font-size:0.95rem; text-transform:none;">${a.title}</h4>
                        <p class="text-muted mt-1" style="font-size:0.8rem;">Due: <span class="text-primary" style="font-weight:600;">${due}</span></p>
                    </div>
                    <button class="btn btn-primary btn-sm" onclick="app.submitMockTask('${a.id}', this)">Turn In</button>
                </div>
            `;
        }).join('');
    }
}

// ==========================================
// Academics (Tasks & Grades)
// ==========================================
function renderAcademics() {
    const taskList = document.getElementById('full-tasks-list');
    
    if (state.assignments.length === 0) {
        taskList.innerHTML = `<p class="text-muted text-center py-4">No assignments allocated to your class yet.</p>`;
    } else {
        taskList.innerHTML = state.assignments.sort((a,b) => new Date(b.created_at) - new Date(a.created_at)).map(a => {
            const sub = state.submissions.find(s => s.assignment_id === a.id);
            const due = new Date(a.due_date).toLocaleDateString();
            
            let statusClass = '', statusText = 'Pending', actionBtn = '';
            
            if (!sub || sub.status === 'pending') {
                actionBtn = `
                    <button class="btn btn-outline-warning btn-sm" onclick="app.openExtensionModal('${a.id}')">Req. Extension</button>
                    <button class="btn btn-primary btn-sm ml-2" onclick="app.submitMockTask('${a.id}', this)">Turn In</button>
                `;
            } else if (sub.status === 'extension_requested') {
                statusClass = 'status-extension';
                statusText = 'Extension Pending Approval';
                actionBtn = `<button class="btn btn-primary btn-sm" onclick="app.submitMockTask('${a.id}', this)">Turn In</button>`;
            } else if (sub.status === 'submitted') {
                statusClass = 'status-submitted';
                statusText = 'Submitted • Awaiting Review';
                actionBtn = `<span style="font-size:0.85rem; font-weight:600; color:var(--success);">✓ Done</span>`;
            } else if (sub.status === 'graded') {
                statusClass = 'status-submitted';
                const g = state.grades.find(x => x.assignment_id === a.id);
                statusText = `Graded: ${g ? g.score : '--'} / ${g ? (g.max_score || 100) : 100}`;
                actionBtn = `<span class="text-primary" style="font-size:0.85rem; font-weight:600;">Evaluated</span>`;
            }

            return `
                <div class="task-card ${statusClass}">
                    <div>
                        <h4 style="color:var(--text-main); font-size:1rem; text-transform:none;">${a.title}</h4>
                        <p class="text-muted mt-1" style="font-size:0.8rem;">Status: <strong>${statusText}</strong> • Due: ${due}</p>
                    </div>
                    <div class="flex-row">${actionBtn}</div>
                </div>
            `;
        }).join('');
    }

    // Grades Table & Curve
    const tbody = document.getElementById('grades-tbody');
    const gradedAsgs = state.assignments.filter(a => state.grades.some(g => g.assignment_id === a.id));
    
    if (gradedAsgs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" class="text-center text-muted py-4">No grades posted yet.</td></tr>`;
    } else {
        tbody.innerHTML = gradedAsgs.map(a => {
            const g = state.grades.find(x => x.assignment_id === a.id);
            return `
                <tr>
                    <td><strong>${a.title}</strong></td>
                    <td>${new Date(g.created_at).toLocaleDateString()}</td>
                    <td style="text-align: right; font-weight:600; color:var(--primary);">${g.score} / ${g.max_score || 100}</td>
                </tr>
            `;
        }).join('');

        const ctxPerf = document.getElementById('performance-trend-chart');
        if (state.charts.perf) state.charts.perf.destroy();
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
                    borderColor: '#3B82F6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    fill: true,
                    tension: 0.3
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 100 } }, plugins: { legend: { display: false } } }
        });
    }
}

// ==========================================
// Application Actions
// ==========================================
window.app = {
    goToTab: (tabId) => {
        document.querySelectorAll('.nav-btn[data-target]').forEach(b => b.classList.toggle('active', b.dataset.target === tabId));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
        document.getElementById(tabId)?.classList.remove('hidden');
    },

    openSettings: () => {
        const input = document.getElementById('link-student-id');
        if (input) input.value = state.profile?.unique_identifier || '';
        document.getElementById('link-profile-modal')?.classList.remove('hidden');
    },

    submitLinkProfile: async () => {
        const stuId = document.getElementById('link-student-id')?.value.trim();
        if (!stuId) return showToast("Enter a valid student identifier.", "warning");

        const { data: student } = await supabase.from('school_directory')
            .select('*').eq('school_id', state.schoolId).eq('role', 'student').ilike('unique_id', stuId).maybeSingle();

        if (!student) {
            return showToast("No student found with that identifier. Ask your admin to add you.", "error");
        }

        await supabase.from('profiles').update({ unique_identifier: stuId }).eq('id', state.user.id);
        
        document.getElementById('link-profile-modal')?.classList.add('hidden');
        showToast("Profile successfully linked!", "success");
        
        state.profile.unique_identifier = stuId;
        state.dirRecord = student;
        state.classSection = cleanClassName(`${student.grade_level || 'General'}-${student.section || 'A'}`);
        document.getElementById('header-class-info').innerText = `Class ${state.classSection} • ID: ${student.unique_id}`;
        
        await loadStudentData();
    },

    submitMockTask: async (asgId, btnElement) => {
        if (!state.dirRecord) return showToast("Student profile not linked.", "warning");
        
        if (btnElement) {
            btnElement.disabled = true;
            btnElement.innerText = "Submitting...";
        }

        const { error } = await supabase.from('assignment_submissions').upsert({
            school_id: state.schoolId,
            assignment_id: asgId,
            student_id: state.dirRecord.id,
            status: 'submitted'
        }, { onConflict: 'assignment_id, student_id' });

        if (error) {
            showToast("Failed to turn in assignment.", "error");
            if (btnElement) { btnElement.disabled = false; btnElement.innerText = "Turn In"; }
            return;
        }

        showToast("Task turned in successfully!", "success");
        await loadStudentData();
    },

    openExtensionModal: (asgId) => {
        document.getElementById('ext-asg-id').value = asgId;
        document.getElementById('extension-modal')?.classList.remove('hidden');
    },

    submitExtensionRequest: async () => {
        const asgId = document.getElementById('ext-asg-id').value;
        const reqDate = document.getElementById('ext-date').value;
        if (!reqDate) return showToast("Select a requested date.", "warning");

        const { error } = await supabase.from('assignment_submissions').upsert({
            school_id: state.schoolId,
            assignment_id: asgId,
            student_id: state.dirRecord.id,
            status: 'extension_requested',
            requested_extension_date: reqDate
        }, { onConflict: 'assignment_id, student_id' });

        if (error) return showToast("Failed to request extension.", "error");

        document.getElementById('extension-modal')?.classList.add('hidden');
        showToast("Extension requested. Awaiting teacher review.", "success");
        await loadStudentData();
    }
};

// ==========================================
// Timetable
// ==========================================
function renderTimetable() {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const slots = [...new Set(state.schedule.map(s => s.time_slot))].sort();
    
    const thead = document.getElementById('tt-header');
    thead.innerHTML = `<th>Day</th>` + slots.map(s => `<th>${s}</th>`).join('');

    const tbody = document.getElementById('tt-body');
    if (state.schedule.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${slots.length + 1 || 2}" class="text-center text-muted py-4">Timetable not configured for your class yet.</td></tr>`;
        return;
    }

    tbody.innerHTML = days.map(d => {
        const daySched = state.schedule.filter(s => s.day_of_week === d);
        if (daySched.length === 0) return '';
        
        return `
            <tr>
                <td style="font-weight:700;">${d}</td>
                ${slots.map(slot => {
                    const cls = daySched.find(s => s.time_slot === slot);
                    return cls ? `<td class="filled">${cls.teacher_name || 'Class'}</td>` : `<td class="empty">--</td>`;
                }).join('')}
            </tr>
        `;
    }).join('');
}

// ==========================================
// Social & Comms (Leak-Proof)
// ==========================================
function renderSocialSidebar() {
    // Teachers
    document.getElementById('chat-teachers-list').innerHTML = state.teachers.map(t => `
        <li class="chat-group" data-chat-type="teacher" data-target-id="${t.id}">
            <div class="avatar-sm" style="background:var(--blue);">${(t.name || 'T').charAt(0)}</div> 
            ${t.name}
        </li>
    `).join('') || '<li class="text-muted ml-2" style="font-size:0.8rem;">No teachers assigned</li>';

    // Classmates
    document.getElementById('chat-peers-list').innerHTML = state.classmates.map(p => `
        <li class="chat-group" data-chat-type="peer" data-target-id="${p.id}">
            <div class="avatar-sm" style="background:#CBD5E1; color:#333;">${(p.name || 'S').charAt(0)}</div> 
            ${p.name}
        </li>
    `).join('') || '<li class="text-muted ml-2" style="font-size:0.8rem;">No classmates found</li>';

    // Click bindings for contacts
    document.querySelectorAll('.chat-group').forEach(el => {
        el.addEventListener('click', (e) => {
            const targetEl = e.currentTarget;
            document.querySelectorAll('.chat-group').forEach(c => c.classList.remove('active'));
            targetEl.classList.add('active');
            
            state.activeChatType = targetEl.dataset.chatType;
            state.activeChatTarget = targetEl.dataset.targetId;
            
            document.getElementById('chat-active-title').innerText = targetEl.innerText.trim();
            
            if (state.activeChatType === 'class') {
                document.getElementById('chat-active-subtitle').innerText = "Broadcasts from admins and teachers";
                document.getElementById('chat-input-container').style.display = 'none'; // Read-only broadcasts
            } else {
                document.getElementById('chat-active-subtitle').innerText = "Direct Conversation";
                document.getElementById('chat-input-container').style.display = 'block'; // DM reply allowed
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
    if (state.activeChatType === 'class') {
        // Class broadcasts include school-wide announcements OR class section announcements
        filteredData = data.filter(m => 
            m.target_group === 'all' || 
            (m.target_group === 'students' && (!m.target_subgroups || m.target_subgroups.length === 0 || m.target_subgroups.includes(`section:${state.classSection}`)))
        );
    } else {
        // Direct conversation (ensures messages don't cross between different contacts)
        filteredData = data.filter(m => {
            if (m.target_group !== 'direct') return false;
            const involvesTarget = m.target_subgroups?.includes(state.activeChatTarget);
            const involvesMe = m.sender_id === state.user.id || m.target_subgroups?.includes(state.dirRecord?.id);
            return involvesTarget && involvesMe;
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
                <span class="msg-meta">${isSent ? 'You' : (state.activeChatType === 'class' ? 'Faculty' : 'Direct Message')} • ${time}</span>
                <p>${msg.content}</p>
            </div>
        `;
    }).join('');
    history.scrollTop = history.scrollHeight;
}

app.sendChatMessage = async () => {
    const input = document.getElementById('chat-msg-input');
    const content = input?.value.trim();
    if (!content || state.activeChatType === 'class') return;

    await supabase.from('communications').insert([{
        school_id: state.schoolId,
        sender_id: state.user.id,
        target_group: 'direct',
        target_subgroups: [state.activeChatTarget, state.dirRecord?.id],
        msg_type: 'text',
        content: content
    }]);

    if (input) input.value = '';
    loadChat();
};

// ==========================================
// Event Bindings
// ==========================================
function bindEvents() {
    // 1. Sidebar Nav Switching (Fixes broken navigation)
    document.querySelectorAll('.nav-btn[data-target]').forEach(btn => {
        btn.addEventListener('click', (e) => app.goToTab(e.currentTarget.dataset.target));
    });

    // 2. Sub-tabs inside Academics
    document.querySelectorAll('.sub-tab').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const group = e.target.parentElement;
            group.querySelectorAll('.sub-tab').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            
            if (e.target.dataset.acadType) {
                document.querySelectorAll('.acad-pane').forEach(p => p.classList.add('hidden'));
                document.getElementById(`acad-${e.target.dataset.acadType}`)?.classList.remove('hidden');
            }
        });
    });

    // 3. Modals backdrop click
    document.querySelectorAll('.modal-overlay').forEach(modal => {
        modal.addEventListener('mousedown', (e) => {
            if (e.target === modal) modal.classList.add('hidden');
        });
    });

    // 4. Logout
    document.getElementById('logout-btn')?.addEventListener('click', async () => {
        await supabase.auth.signOut();
        window.location.replace('../../index.html');
    });
}

document.addEventListener('DOMContentLoaded', init);