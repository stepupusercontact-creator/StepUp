const SUPABASE_URL = 'https://pzhtjegromovjbevyjki.supabase.co';
const SUPABASE_KEY = 'sb_publishable_G0r-QwmfkGyV32W08uxsgQ_amj0c-Fm';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let state = {
    user: null,
    profile: null,
    schoolId: null,
    myClasses: [], 
    students: [],  
    schedule: [],  
    attendanceDate: new Date().toISOString().split('T')[0],
    assignments: [],
    submissions: [],
    communications: [],
    extensions: [],
    chart: null,
    chatClass: null
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
// Initialization
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
    document.getElementById('teacher-name').innerText = profile.full_name || 'Professor';
    document.getElementById('teacher-initial').innerText = (profile.full_name || 'T').charAt(0).toUpperCase();
    
    const identifier = profile.unique_identifier;
    let query = supabase.from('school_directory').select('*').eq('school_id', state.schoolId).eq('role', 'teacher');
    if (identifier) query = query.eq('unique_id', identifier);
    else query = query.ilike('name', `%${profile.full_name}%`);

    const { data: dirData } = await query.maybeSingle();
        
    if (dirData) {
        document.getElementById('teacher-dept').innerText = dirData.department || 'Faculty';
        await loadTeacherData(dirData.id);
    } else {
        showToast("You are not officially registered in this school's directory. Redirecting...", "error");
        
        await supabase.from('profiles').update({ school_id: null, role: null }).eq('id', session.user.id);
        await supabase.auth.updateUser({ data: { school_id: null, role: null }});
        
        setTimeout(() => {
            window.location.href = '../../index.html';
        }, 1500);
        return;
    }
    
    bindEvents();
    document.getElementById('att-date').value = state.attendanceDate;
}

async function loadTeacherData(directoryId) {
    // 1. Fetch Schedule
    const { data: sched } = await supabase.from('native_schedules')
        .select('*').eq('school_id', state.schoolId).eq('teacher_id', directoryId);
    
    state.schedule = sched || [];
    state.myClasses = [...new Set(state.schedule.map(s => s.class_section).filter(Boolean))].sort();

    // 2. Fetch Students for these classes
    if (state.myClasses.length > 0) {
        const classConditions = state.myClasses.map(c => {
            const parts = c.split('-');
            if(parts.length===2) return `and(grade_level.eq.${parts[0]},section.eq.${parts[1]})`;
            return `grade_level.eq.${c}`;
        }).join(',');

        const { data: students } = await supabase.from('school_directory')
            .select('*').eq('school_id', state.schoolId).eq('role', 'student').or(classConditions);
        state.students = students || [];
    }

    // 3. Fetch Assignments & Submissions
    const { data: asgs } = await supabase.from('assignments').select('*').eq('teacher_id', state.user.id);
    state.assignments = asgs || [];
    
    if (state.assignments.length > 0) {
        const { data: subs } = await supabase.from('assignment_submissions')
            .select('*').in('assignment_id', state.assignments.map(a => a.id));
        state.submissions = subs || [];
    }

    // Populate dropdowns
    const classOpts = '<option value="">Select a class...</option>' + state.myClasses.map(c => `<option value="${c}">Class ${c}</option>`).join('');
    document.getElementById('quick-att-class').innerHTML = classOpts;
    document.getElementById('att-class-select').innerHTML = classOpts;
    document.getElementById('task-class').innerHTML = classOpts;
    
    document.getElementById('chat-classes-list').innerHTML = state.myClasses.map(c => `<li class="chat-group" data-class="${c}">Class ${c}</li>`).join('');

    renderDashboard();
    renderScheduleTab();
    renderTasksList();
    renderExtensions();
}

// ==========================================
// Dashboard
// ==========================================
function renderDashboard() {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const todayStr = days[new Date().getDay()];
    
    document.getElementById('header-date').innerText = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

    const todayClasses = state.schedule.filter(s => s.day_of_week === todayStr).sort((a,b) => a.time_slot.localeCompare(b.time_slot));
    document.getElementById('dash-today-classes').innerText = todayClasses.length;

    const timeline = document.getElementById('dash-timeline');
    if (todayClasses.length === 0) {
        timeline.innerHTML = `<p class="text-muted text-center py-4">No classes scheduled for today.</p>`;
    } else {
        timeline.innerHTML = todayClasses.map(c => `
            <div class="timeline-item">
                <div class="tl-time">${c.time_slot}</div>
                <div class="tl-line"></div>
                <div class="tl-content">
                    <h4>Class ${c.class_section}</h4>
                </div>
            </div>
        `).join('');
    }

    // Calculate pending grading
    const totalExpected = state.assignments.reduce((acc, a) => {
        const studentCount = state.students.filter(s => `${s.grade_level}-${s.section}` === a.class_section).length;
        return acc + studentCount;
    }, 0);
    const graded = state.submissions.filter(s => s.status === 'graded').length;
    document.getElementById('dash-pending-grading').innerText = Math.max(0, totalExpected - graded);

    // Extensions
    const extensions = state.submissions.filter(s => s.status === 'extension_requested');
    document.getElementById('dash-extensions').innerText = extensions.length;
}

// ==========================================
// Attendance
// ==========================================
document.getElementById('quick-att-class').addEventListener('change', (e) => {
    if(e.target.value) {
        document.getElementById('att-class-select').value = e.target.value;
        app.goToTab('attendance-tab');
        app.loadAttendanceGrid();
        e.target.value = ''; 
    }
});

document.getElementById('att-class-select').addEventListener('change', () => app.loadAttendanceGrid());
document.getElementById('att-date').addEventListener('change', (e) => { state.attendanceDate = e.target.value; app.loadAttendanceGrid(); });

window.app = {
    goToTab: (tabId) => {
        document.querySelectorAll('.nav-btn[data-target]').forEach(b => b.classList.toggle('active', b.dataset.target === tabId));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
        document.getElementById(tabId).classList.remove('hidden');
        if (tabId === 'attendance-tab') app.loadAttendanceGrid();
    },

    loadAttendanceGrid: async () => {
        const cls = document.getElementById('att-class-select').value;
        const tbody = document.getElementById('attendance-tbody');
        
        if (!cls) {
            tbody.innerHTML = `<tr><td colspan="3" class="text-center text-muted py-4">Select a class to load roster.</td></tr>`;
            return;
        }

        const classStudents = state.students.filter(s => `${s.grade_level}-${s.section}` === cls);
        if(classStudents.length === 0) {
            tbody.innerHTML = `<tr><td colspan="3" class="text-center text-muted py-4">No students found in this class.</td></tr>`;
            return;
        }

        const { data: existing } = await supabase.from('attendance')
            .select('*').eq('school_id', state.schoolId).eq('date', state.attendanceDate);

        tbody.innerHTML = classStudents.map(s => {
            const record = existing?.find(a => a.student_id === s.id);
            const status = record ? record.status.toLowerCase() : 'present'; 

            return `
                <tr data-sid="${s.id}">
                    <td><code>${s.unique_id}</code></td>
                    <td><strong>${s.name}</strong></td>
                    <td style="text-align: right;">
                        <div class="att-toggle-group">
                            <button class="att-btn ${status==='present'?'active':''}" data-val="present" onclick="app.toggleAtt(this)">Present</button>
                            <button class="att-btn ${status==='late'?'active':''}" data-val="late" onclick="app.toggleAtt(this)">Late</button>
                            <button class="att-btn ${status==='absent'?'active':''}" data-val="absent" onclick="app.toggleAtt(this)">Absent</button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    },

    toggleAtt: (btn) => {
        const group = btn.closest('.att-toggle-group');
        group.querySelectorAll('.att-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    },

    saveAttendance: async () => {
        const cls = document.getElementById('att-class-select').value;
        if (!cls) return showToast("Select a class first.", "warning");

        const rows = document.querySelectorAll('#attendance-tbody tr[data-sid]');
        const upserts = Array.from(rows).map(r => {
            const sid = r.dataset.sid;
            const status = r.querySelector('.att-btn.active').dataset.val;
            return {
                school_id: state.schoolId,
                student_id: sid,
                date: state.attendanceDate,
                status: status,
                class_section: cls
            };
        });

        const { error } = await supabase.from('attendance').upsert(upserts, { onConflict: 'student_id, date' });
        if (error) showToast("Error saving attendance.", "error");
        else showToast(`Attendance for Class ${cls} saved. Synced with admins.`, "success");
    },

    // ==========================================
    // Grading & Assignments
    // ==========================================
    createTask: async () => {
        const title = document.getElementById('task-title').value.trim();
        const cls = document.getElementById('task-class').value;
        const due = document.getElementById('task-due').value;
        const max = document.getElementById('task-max-score').value || 100;

        if(!title || !cls || !due) return showToast("Fill all required fields.", "warning");

        const { data, error } = await supabase.from('assignments').insert([{
            school_id: state.schoolId,
            teacher_id: state.user.id,
            title: title,
            class_section: cls,
            due_date: due
        }]).select().single();

        if(!error && data) {
            state.assignments.push(data);
            showToast("Task assigned.", "success");
            document.getElementById('task-title').value = '';
            document.getElementById('task-due').value = '';
            renderTasksList();
            app.updateGradingDropdown();
        }
    },

    updateGradingDropdown: () => {
        const select = document.getElementById('grade-task-select');
        select.innerHTML = '<option value="">Select Assignment to Grade...</option>' + 
            state.assignments.map(a => `<option value="${a.id}">${a.title} (${a.class_section})</option>`).join('');
    }
};

function renderTasksList() {
    const list = document.getElementById('tasks-list');
    if(state.assignments.length === 0) {
        list.innerHTML = `<p class="text-muted text-center py-4">No tasks assigned yet.</p>`;
        return;
    }
    
    list.innerHTML = state.assignments.sort((a,b) => new Date(b.created_at) - new Date(a.created_at)).map(a => {
        const due = new Date(a.due_date).toLocaleDateString();
        return `
            <div class="pane-box" style="padding: 16px;">
                <div class="flex-row-between">
                    <div>
                        <h4 style="color:var(--text-main); font-size:1rem; text-transform:none;">${a.title}</h4>
                        <p class="text-muted" style="font-size:0.8rem;">Class ${a.class_section} • Due: ${due}</p>
                    </div>
                    <button class="btn btn-secondary btn-sm" onclick="app.openGradeTask('${a.id}')">Grade</button>
                </div>
            </div>
        `;
    }).join('');
    app.updateGradingDropdown();
}

app.openGradeTask = (id) => {
    document.querySelector('.sub-tab[data-grad-type="grading"]').click();
    document.getElementById('grade-task-select').value = id;
    app.loadGradingGrid();
};

document.getElementById('grade-task-select').addEventListener('change', () => app.loadGradingGrid());

app.loadGradingGrid = async () => {
    const aid = document.getElementById('grade-task-select').value;
    const tbody = document.getElementById('grading-tbody');
    if(!aid) {
        tbody.innerHTML = `<tr><td colspan="3" class="text-center text-muted py-4">Select an assignment.</td></tr>`;
        if(state.chart) state.chart.destroy();
        return;
    }

    const asg = state.assignments.find(a => a.id === aid);
    const classStudents = state.students.filter(s => `${s.grade_level}-${s.section}` === asg.class_section);

    // Fetch grades for this assignment
    const { data: grades } = await supabase.from('grades').select('*').eq('assignment_id', aid);

    tbody.innerHTML = classStudents.map(s => {
        const sub = state.submissions.find(x => x.assignment_id === aid && x.student_id === s.id);
        const grade = grades?.find(g => g.student_id === s.id);
        let statusText = sub ? (sub.status==='extension_requested' ? 'Extension Pending' : sub.status) : 'Pending';
        let statusColor = sub?.status === 'submitted' ? 'color:var(--primary)' : 'color:var(--text-muted)';
        
        return `
            <tr data-sid="${s.id}">
                <td>${s.name} <br><small class="text-muted">${s.unique_id}</small></td>
                <td style="${statusColor}; font-weight:500; text-transform:capitalize;">${statusText}</td>
                <td><input type="number" class="grade-input" placeholder="--" value="${grade ? grade.score : ''}"></td>
            </tr>
        `;
    }).join('');

    renderGradeCurve(grades || []);
};

app.saveGrades = async () => {
    const aid = document.getElementById('grade-task-select').value;
    if(!aid) return;

    const rows = document.querySelectorAll('#grading-tbody tr[data-sid]');
    const gradeUpserts = [];
    const subUpserts = [];

    rows.forEach(r => {
        const sid = r.dataset.sid;
        const scoreStr = r.querySelector('.grade-input').value;
        if(scoreStr.trim() !== '') {
            gradeUpserts.push({ school_id: state.schoolId, assignment_id: aid, student_id: sid, score: parseFloat(scoreStr), max_score: 100 });
            subUpserts.push({ school_id: state.schoolId, assignment_id: aid, student_id: sid, status: 'graded' });
        }
    });

    if(gradeUpserts.length > 0) {
        await supabase.from('grades').upsert(gradeUpserts, { onConflict: 'assignment_id, student_id' });
        await supabase.from('assignment_submissions').upsert(subUpserts, { onConflict: 'assignment_id, student_id' });
        
        // Refresh submissions state
        const { data: subs } = await supabase.from('assignment_submissions').select('*').in('assignment_id', state.assignments.map(a => a.id));
        state.submissions = subs || [];
        
        showToast("Scores saved and synced.", "success");
        app.loadGradingGrid();
        renderDashboard();
    }
};

function renderGradeCurve(grades) {
    const ctx = document.getElementById('grade-curve-chart');
    if(state.chart) state.chart.destroy();
    
    if(!grades || grades.length === 0) {
        state.chart = new Chart(ctx, { type:'bar', data:{labels:['No Grades'],datasets:[{data:[1], backgroundColor:'#EAEAEA'}]}, options:{plugins:{legend:{display:false}}} });
        return;
    }

    let dist = { A:0, B:0, C:0, D:0, F:0 };
    grades.forEach(g => {
        const pct = (g.score / (g.max_score||100)) * 100;
        if(pct>=90) dist.A++; else if(pct>=80) dist.B++; else if(pct>=70) dist.C++; else if(pct>=60) dist.D++; else dist.F++;
    });

    state.chart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['A', 'B', 'C', 'D', 'F'],
            datasets: [{ label: 'Students', data: [dist.A, dist.B, dist.C, dist.D, dist.F], backgroundColor: '#0056D2', borderRadius: 4 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
}

// ==========================================
// Timetable / Schedule
// ==========================================
function renderScheduleTab() {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const slots = [...new Set(state.schedule.map(s => s.time_slot))].sort();
    
    const thead = document.getElementById('tt-header');
    thead.innerHTML = `<th>Day</th>` + slots.map(s => `<th>${s}</th>`).join('');

    const tbody = document.getElementById('tt-body-full');
    tbody.innerHTML = days.map(d => {
        const daySched = state.schedule.filter(s => s.day_of_week === d);
        if(daySched.length === 0) return '';
        
        return `
            <tr>
                <td style="font-weight:600;">${d}</td>
                ${slots.map(slot => {
                    const cls = daySched.find(s => s.time_slot === slot);
                    return cls ? `<td class="filled">Class ${cls.class_section}</td>` : `<td>--</td>`;
                }).join('')}
            </tr>
        `;
    }).join('');
}

// ==========================================
// Comms & Deadline Extensions
// ==========================================
document.getElementById('chat-classes-list').addEventListener('click', (e) => {
    if(e.target.classList.contains('chat-group')) {
        document.querySelectorAll('.chat-group').forEach(c => c.classList.remove('active'));
        e.target.classList.add('active');
        state.chatClass = e.target.dataset.class;
        document.getElementById('chat-active-title').innerText = `Class ${state.chatClass}`;
        loadChat();
    }
});

async function loadChat() {
    if(!state.chatClass) return;
    const { data } = await supabase.from('communications')
        .select('*').eq('school_id', state.schoolId).contains('target_subgroups', [`section:${state.chatClass}`]).order('created_at', { ascending: true });
        
    const history = document.getElementById('chat-history');
    if(!data || data.length===0) {
        history.innerHTML = `<p class="text-muted text-center py-4">No messages yet.</p>`;
        return;
    }

    history.innerHTML = data.map(msg => {
        const isSent = msg.sender_id === state.user.id;
        const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return `
            <div class="msg-bubble ${isSent ? 'sent' : 'received'}">
                <span class="msg-meta">${isSent ? 'You' : 'Admin'} • ${time}</span>
                <p>${msg.content}</p>
            </div>
        `;
    }).join('');
    history.scrollTop = history.scrollHeight;
}

app.sendChatMessage = async () => {
    const input = document.getElementById('chat-msg-input');
    const content = input.value.trim();
    if(!content || !state.chatClass) return;

    await supabase.from('communications').insert([{
        school_id: state.schoolId,
        sender_id: state.user.id,
        target_group: 'students',
        target_subgroups: [`section:${state.chatClass}`],
        msg_type: 'text',
        content: content
    }]);

    input.value = '';
    loadChat();
};

// Extension Requests Flow
function renderExtensions() {
    const reqs = state.submissions.filter(s => s.status === 'extension_requested');
    const grid = document.getElementById('extensions-grid');
    const badge = document.getElementById('tab-badge-ext');
    
    if(reqs.length > 0) {
        badge.innerText = reqs.length;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }

    if(reqs.length === 0) {
        grid.innerHTML = `<p class="text-muted text-center py-4">No pending extension requests.</p>`;
        return;
    }

    grid.innerHTML = reqs.map(r => {
        const student = state.students.find(s => s.id === r.student_id);
        const asg = state.assignments.find(a => a.id === r.assignment_id);
        if(!student || !asg) return '';

        const newDate = r.requested_extension_date ? new Date(r.requested_extension_date).toLocaleDateString() : 'Unspecified';

        return `
            <div class="ext-card" id="ext-${r.id}">
                <div class="flex-row-between">
                    <div>
                        <h4>${student.name} <span class="text-muted" style="text-transform:none; font-weight:400;">(${student.unique_id})</span></h4>
                        <p class="mt-1" style="font-size:0.9rem; font-weight:600;">${asg.title}</p>
                        <p class="text-muted" style="font-size:0.8rem;">Requested Deadline: <span class="text-primary" style="font-weight:600;">${newDate}</span></p>
                    </div>
                    <div class="flex-col gap-2">
                        <button class="btn btn-success-outline btn-sm" onclick="app.resolveExtension('${r.id}', 'pending')">Approve Extension</button>
                        <button class="btn btn-danger-outline btn-sm" onclick="app.resolveExtension('${r.id}', 'rejected')">Reject</button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

app.resolveExtension = async (subId, newStatus) => {
    await supabase.from('assignment_submissions').update({ status: newStatus }).eq('id', subId);
    
    // update local state
    const sub = state.submissions.find(s => s.id === subId);
    if(sub) sub.status = newStatus;
    
    showToast(`Extension ${newStatus === 'pending' ? 'approved' : 'rejected'}.`, 'success');
    renderExtensions();
    renderDashboard();
};

// ==========================================
// Bindings
// ==========================================
function bindEvents() {
    document.querySelectorAll('.nav-btn[data-target]').forEach(btn => {
        btn.addEventListener('click', (e) => app.goToTab(e.currentTarget.dataset.target));
    });

    document.querySelectorAll('.sub-tab').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const group = e.target.parentElement;
            group.querySelectorAll('.sub-tab').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            
            if(e.target.dataset.gradType) {
                document.querySelectorAll('.grad-pane').forEach(p => p.classList.add('hidden'));
                document.getElementById(`grad-${e.target.dataset.gradType}`).classList.remove('hidden');
            }
            if(e.target.dataset.commsType) {
                document.querySelectorAll('.comms-pane').forEach(p => p.classList.add('hidden'));
                document.getElementById(`comms-${e.target.dataset.commsType}`).classList.remove('hidden');
            }
        });
    });

    document.getElementById('logout-btn').addEventListener('click', async () => {
        await supabase.auth.signOut();
        window.location.href = '../../index.html';
    });
}

document.addEventListener('DOMContentLoaded', init);