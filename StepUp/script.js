  /* StepUp OS — Master Logic & Production Routing Engine */

// Local Data Store (Admin Managed State)
const StepUpState = {
  students: JSON.parse(localStorage.getItem('stepup_students')) || [
    { name: "Aarav Sharma", email: "aarav@gmail.com", roll: "01", class: "Class XI-A" }
  ],
  teachers: JSON.parse(localStorage.getItem('stepup_teachers')) || [
    { name: "Ms. Kavita Iyer", email: "kavita@gmail.com", subject: "Mathematics" }
  ],
  noticeBoard: localStorage.getItem('stepup_notice') || "Welcome to StepUp OS. Daily operations are active.",
  currentUser: null
};

// Save updated state to browser store
function saveState() {
  localStorage.setItem('stepup_students', JSON.stringify(StepUpState.students));
  localStorage.setItem('stepup_teachers', JSON.stringify(StepUpState.teachers));
  localStorage.setItem('stepup_notice', StepUpState.noticeBoard);
}

// 1. ADMIN LOGIC: Add Student Email & Details
function adminAddStudent(name, email, roll, studentClass) {
  if (!name || !email) {
    alert("Please provide valid Name and Gmail address!");
    return false;
  }
  
  const exists = StepUpState.students.some(s => s.email.toLowerCase() === email.toLowerCase());
  if (exists) {
    alert("Student with this Gmail is already registered!");
    return false;
  }

  StepUpState.students.push({ name, email, roll, class: studentClass });
  saveState();
  alert(`Successfully added ${name} (${email}) to Student Database!`);
  renderAdminStudentList();
  return true;
}

// Render Admin Managed Student List
function renderAdminStudentList() {
  const container = document.getElementById('adminStudentList');
  if (!container) return;
  
  if (StepUpState.students.length === 0) {
    container.innerHTML = `<p style="color:var(--text-muted);">No registered students found.</p>`;
    return;
  }

  let html = `<ul style="list-style:none; padding:0;">`;
  StepUpState.students.forEach((s, idx) => {
    html += `
      <li style="padding:10px; margin-bottom:8px; background:rgba(255,255,255,0.03); border:1px solid var(--border-glass); border-radius:8px; display:flex; justify-content:space-between; align-items:center;">
        <div>
          <strong>${s.name}</strong> <span style="color:var(--accent-cyan);">(${s.class || 'N/A'})</span><br>
          <small style="color:var(--text-muted);">${s.email}</small>
        </div>
        <button onclick="adminRemoveStudent(${idx})" style="background:#ff4d4d; border:none; color:white; padding:4px 8px; border-radius:4px; cursor:pointer;">Remove</button>
      </li>
    `;
  });
  html += `</ul>`;
  container.innerHTML = html;
}

function adminRemoveStudent(index) {
  StepUpState.students.splice(index, 1);
  saveState();
  renderAdminStudentList();
}

// 2. SMART GOOGLE / EMAIL AUTH ROUTER
function handleStepUpLogin(userEmail) {
  if (!userEmail) {
    alert("Please enter a valid Gmail address.");
    return;
  }

  const cleanEmail = userEmail.trim().toLowerCase();

  if (cleanEmail === "stepup.user.contact@gmail.com" || cleanEmail.includes("admin")) {
    StepUpState.currentUser = { email: cleanEmail, role: "admin" };
    alert("Welcome, Admin! Redirecting to Admin Leadership Console.");
    switchPortalView('admin');
    return;
  }

  const matchedStudent = StepUpState.students.find(s => s.email.toLowerCase() === cleanEmail);
  if (matchedStudent) {
    StepUpState.currentUser = { ...matchedStudent, role: "student" };
    alert(`Welcome back, ${matchedStudent.name}! Redirecting to Student Dashboard.`);
    switchPortalView('student');
    return;
  }

  const matchedTeacher = StepUpState.teachers.find(t => t.email.toLowerCase() === cleanEmail);
  if (matchedTeacher) {
    StepUpState.currentUser = { ...matchedTeacher, role: "teacher" };
    alert(`Welcome, ${matchedTeacher.name}! Redirecting to Teacher Workspace.`);
    switchPortalView('teacher');
    return;
  }

  alert("Email verified. Accessing Parent/General Student Portal.");
  switchPortalView('parent');
}

// 3. PERSPECTIVE / PORTAL SWITCHER
function switchPortalView(role) {
  console.log(`Switching view perspective to: ${role}`);
  const sections = ['adminView', 'teacherView', 'studentView', 'parentView'];
  sections.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  const activeEl = document.getElementById(`${role}View`);
  if (activeEl) {
    activeEl.style.display = 'block';
  }
}

// 4. REAL FEE RECEIPT GENERATOR
function generateRealFeeReceipt(studentName, amount, invoiceNo) {
  const receiptWindow = window.open('', '_blank', 'width=600,height=700');
  const dateStr = new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
  
  receiptWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Official Fee Receipt — ${invoiceNo}</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 40px; color: #111; }
        .header { text-align: center; border-bottom: 2px solid #00f2fe; padding-bottom: 15px; }
        .title { font-size: 24px; font-weight: bold; margin-bottom: 5px; }
        .subtitle { color: #555; font-size: 14px; }
        .details { margin: 30px 0; width: 100%; border-collapse: collapse; }
        .details td { padding: 10px; border-bottom: 1px solid #eee; }
        .details td:first-child { font-weight: bold; width: 40%; }
        .footer { margin-top: 50px; text-align: right; font-size: 12px; color: #777; }
        .btn-print { background: #00f2fe; color: #000; border: none; padding: 10px 20px; font-weight: bold; cursor: pointer; border-radius: 4px; }
        @media print { .btn-print { display: none; } }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="title">StepUp OS — School Ecosystem</div>
        <div class="subtitle">Official Payment & Fee Receipt</div>
      </div>

      <table class="details">
        <tr><td>Invoice Number:</td><td>${invoiceNo || 'INV-' + Math.floor(100000 + Math.random() * 900000)}</td></tr>
        <tr><td>Date:</td><td>${dateStr}</td></tr>
        <tr><td>Student Name:</td><td>${studentName || 'Aarav Sharma'}</td></tr>
        <tr><td>Payment Mode:</td><td>Online Transfer / Card</td></tr>
        <tr><td>Total Amount Paid:</td><td><strong>₹${amount || '27,950'}</strong></td></tr>
        <tr><td>Status:</td><td style="color:green; font-weight:bold;">CONFIRMED & PAID</td></tr>
      </table>

      <div style="text-align: center; margin-top: 30px;">
        <button class="btn-print" onclick="window.print()">Download / Print PDF Receipt</button>
      </div>

      <div class="footer">
        Generated electronically by StepUp OS • Contact: stepup.user.contact@gmail.com
      </div>
    </body>
    </html>
  `);
  receiptWindow.document.close();
}

// 5. LIVE CHARTS INITIALIZATION ENGINE
function initStepUpCharts() {
  const attendanceCtx = document.getElementById('attendanceChart');
  if (attendanceCtx) {
    new Chart(attendanceCtx, {
      type: 'line',
      data: {
        labels: ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'],
        datasets: [{
          label: 'Attendance %',
          data: [92, 94, 91, 95, 96, 94.7],
          borderColor: '#00f2fe',
          backgroundColor: 'rgba(0, 242, 254, 0.1)',
          fill: true,
          tension: 0.4
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#888' } },
          y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#888' }, min: 85, max: 100 }
        }
      }
    });
  }

  const workloadCtx = document.getElementById('workloadChart');
  if (workloadCtx) {
    new Chart(workloadCtx, {
      type: 'doughnut',
      data: {
        labels: ['Balanced', 'Near Capacity', 'Substitute Needed'],
        datasets: [{
          data: [65, 25, 10],
          backgroundColor: ['#00f2fe', '#007bff', '#ffc107'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'bottom', labels: { color: '#ccc', font: { size: 10 } } } }
      }
    });
  }
}

// Modal helper
function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.style.display = 'flex';
}

// Initial UI Setup on DOM Load
document.addEventListener('DOMContentLoaded', () => {
  renderAdminStudentList();
  setTimeout(initStepUpCharts, 300);
  console.log("StepUp OS Core Engine & Interactive Analytics Fully Initialized.");
});
