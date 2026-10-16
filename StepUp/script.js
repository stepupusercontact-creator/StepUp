/**
 * StepUp ERP - Production Front-End Controller
 */

const SUPABASE_URL = 'https://pzhtjegromovjbevyjki.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_G0r-QwmfkGyV32W08uxsgQ_amj0c-Fm';

// Complete Alphabetical List of World Countries
const COUNTRIES_LIST = [
    "Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Antigua and Barbuda", "Argentina", "Armenia", "Australia", 
    "Austria", "Azerbaijan", "Bahamas", "Bahrain", "Bangladesh", "Barbados", "Belarus", "Belgium", "Belize", "Benin", 
    "Bhutan", "Bolivia", "Bosnia and Herzegovina", "Botswana", "Brazil", "Brunei", "Bulgaria", "Burkina Faso", "Burundi", 
    "Cabo Verde", "Cambodia", "Cameroon", "Canada", "Central African Republic", "Chad", "Chile", "China", "Colombia", 
    "Comoros", "Congo", "Costa Rica", "Croatia", "Cuba", "Cyprus", "Czech Republic", "Denmark", "Djibouti", "Dominica", 
    "Dominican Republic", "Ecuador", "Egypt", "El Salvador", "Equatorial Guinea", "Eritrea", "Estonia", "Eswatini", 
    "Ethiopia", "Fiji", "Finland", "France", "Gabon", "Gambia", "Georgia", "Germany", "Ghana", "Greece", "Grenada", 
    "Guatemala", "Guinea", "Guinea-Bissau", "Guyana", "Haiti", "Honduras", "Hungary", "Iceland", "India", "Indonesia", 
    "Iran", "Iraq", "Ireland", "Israel", "Italy", "Jamaica", "Japan", "Jordan", "Kazakhstan", "Kenya", "Kiribati", 
    "Kuwait", "Kyrgyzstan", "Laos", "Latvia", "Lebanon", "Lesotho", "Liberia", "Libya", "Liechtenstein", "Lithuania", 
    "Luxembourg", "Madagascar", "Malawi", "Malaysia", "Maldives", "Mali", "Malta", "Marshall Islands", "Mauritania", 
    "Mauritius", "Mexico", "Micronesia", "Moldova", "Monaco", "Mongolia", "Montenegro", "Morocco", "Mozambique", 
    "Myanmar", "Namibia", "Nauru", "Nepal", "Netherlands", "New Zealand", "Nicaragua", "Niger", "Nigeria", "North Korea", 
    "North Macedonia", "Norway", "Oman", "Pakistan", "Palau", "Palestine", "Panama", "Papua New Guinea", "Paraguay", 
    "Peru", "Philippines", "Poland", "Portugal", "Qatar", "Romania", "Russia", "Rwanda", "Saint Kitts and Nevis", 
    "Saint Lucia", "Saint Vincent and the Grenadines", "Samoa", "San Marino", "Sao Tome and Principe", "Saudi Arabia", 
    "Senegal", "Serbia", "Seychelles", "Sierra Leone", "Singapore", "Slovakia", "Slovenia", "Solomon Islands", "Somalia", 
    "South Africa", "South Korea", "South Sudan", "Spain", "Sri Lanka", "Sudan", "Suriname", "Sweden", "Switzerland", 
    "Syria", "Taiwan", "Tajikistan", "Tanzania", "Thailand", "Timor-Leste", "Togo", "Tonga", "Trinidad and Tobago", 
    "Tunisia", "Turkey", "Turkmanistan", "Tuvalu", "Uganda", "Ukraine", "United Arab Emirates", "United Kingdom", 
    "United States", "Uruguay", "Uzbekistan", "Vanuatu", "Vatican City", "Venezuela", "Vietnam", "Yemen", "Zambia", "Zimbabwe"
];

let _supabaseClient = null;
function getSupabaseClient() {
    if (_supabaseClient) return _supabaseClient;
    try {
        const globalSupabase = window.supabase || (typeof supabase !== 'undefined' ? supabase : null);
        if (globalSupabase && typeof globalSupabase.createClient === 'function') {
            _supabaseClient = globalSupabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
                auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' }
            });
            return _supabaseClient;
        }
    } catch (err) { console.error("Supabase initialization error:", err); }
    return null;
}

window.app = {
    authMode: 'signup',
    selectedRole: null,
    currentUser: null,
    _isRouting: false,
    registeredSchools: [],
    
    // Dynamic Geography Data
    countries: COUNTRIES_LIST,
    states: [],
    districts: [],

    async init() {
        const client = getSupabaseClient();
        if (!client) return;

        // Pre-fetch regions in the background
        this.loadRegions();

        if (window.location.hash.includes('access_token=') || window.location.search.includes('error=')) {
            window.history.replaceState(null, '', window.location.pathname);
        }

        client.auth.onAuthStateChange(async (event, session) => {
            if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session) {
                this.currentUser = session.user;
                await this.updateUserUI(session.user);
                
                if (!window.location.pathname.includes('/user_flows/')) {
                    await this.handlePostAuthRouting(session.user);
                }
            } else if (event === 'SIGNED_OUT') {
                this.currentUser = null;
                this.resetUserUI();
            }
        });
    },

    async loadRegions() {
        if (this.states.length > 0) return;

        const client = getSupabaseClient();
        if (!client) return;

        try {
            const [stRes, dtRes] = await Promise.all([
                client.from('states_provinces').select('*').order('name'),
                client.from('districts').select('*').order('name')
            ]);
            
            this.states = stRes.data || [];
            this.districts = dtRes.data || [];
        } catch (err) {
            console.error("Failed to load geographic regions:", err);
        }
    },

    goToRoute(path) {
        const targetUrl = `${window.location.origin}/${path}`;
        if (window.location.href === targetUrl) {
            this._isRouting = false;
            return;
        }
        window.location.assign(targetUrl);
    },

    getRouteForRole(role) {
        let normalizedRole = String(role).toLowerCase().trim();
        if (normalizedRole === 'administrator') normalizedRole = 'admin';

        const routes = {
            'admin': 'user_flows/admins/admins.html',
            'teacher': 'user_flows/teachers/teachers.html',
            'student': 'user_flows/students/students.html',
            'parent': 'user_flows/parents/parents.html'
        };
        return routes[normalizedRole] || null;
    },

    async handlePostAuthRouting(user) {
        if (this._isRouting) return; 
        this._isRouting = true;

        const client = getSupabaseClient();
        let role = user?.user_metadata?.role;
        let school_id = user?.user_metadata?.school_id;

        if ((!role || !school_id) && client) {
            try {
                const { data: profile } = await client.from('profiles').select('role, school_id').eq('id', user.id).maybeSingle();
                if (profile) {
                    if (profile.role) role = profile.role;
                    if (profile.school_id) school_id = profile.school_id;
                }
            } catch (err) {
                console.warn("Profile fetch bypassed.");
            }
        }

        const targetPath = this.getRouteForRole(role);

        if (!targetPath || !school_id) {
            this._isRouting = false;
            this.openModal('role-modal');
            document.getElementById('role-warning')?.classList.remove('hidden');
            return;
        }

        this.closeAllModals();
        this.goToRoute(targetPath);
    },

    // ==========================================
    // Authentication
    // ==========================================
    async handleAuth(e) {
        e.preventDefault();
        const btn = document.getElementById('auth-submit-btn');
        const originalText = btn.innerText;
        btn.innerText = 'Processing...'; 
        btn.disabled = true;

        const email = document.getElementById('auth-email').value;
        const password = document.getElementById('auth-password').value;
        const client = getSupabaseClient();

        try {
            const { data, error } = this.authMode === 'login' 
                ? await client.auth.signInWithPassword({ email, password })
                : await client.auth.signUp({ email, password });

            if (error) throw error;
            
            this.currentUser = data.user;
            await this.updateUserUI(data.user);
            await this.handlePostAuthRouting(data.user);

        } catch (err) {
            alert(err.message);
            btn.innerText = originalText;
            btn.disabled = false;
            this._isRouting = false;
        }
    },

    async handleGoogleAuth() {
        if (window.location.protocol === 'file:') return alert("Google Sign-In requires a web server.");
        try {
            const client = getSupabaseClient();
            await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.href }});
        } catch (err) { alert(err.message); }
    },

    // ==========================================
    // Onboarding with Country & Identifiers
    // ==========================================
    async handleAdminSetup(e) {
        e.preventDefault();
        const btn = document.getElementById('admin-submit-btn');
        const originalText = btn.innerText;
        btn.innerText = 'Setting up school...'; 
        btn.disabled = true;

        const client = getSupabaseClient();
        try {
            const schoolName = document.getElementById('admin-school-name')?.value?.trim();
            const country = document.getElementById('country-select')?.value;
            const state = document.getElementById('state-select')?.value;
            const district = document.getElementById('district-select')?.value;
            const block = document.getElementById('admin-school-block')?.value?.trim() || null;
            const email = document.getElementById('admin-school-email')?.value?.trim();
            const website = document.getElementById('admin-school-website')?.value?.trim() || null;
            const studentIdLabel = document.getElementById('admin-student-id-label')?.value?.trim() || 'Admission Number';
            const teacherIdLabel = document.getElementById('admin-teacher-id-label')?.value?.trim() || 'Employee ID';

            if (!schoolName || !country || !state || !district) {
                throw new Error("Please complete all required fields: School Name, Country, State, and District.");
            }

            // Client-side fallback UUID generation to guarantee non-null ID constraint
            const schoolId = (typeof crypto !== 'undefined' && crypto.randomUUID) 
                ? crypto.randomUUID() 
                : undefined;

            const insertPayload = {
                ...(schoolId ? { id: schoolId } : {}),
                name: schoolName, 
                country: country,
                state: state,
                district: district,
            };

            const { data: newSchool, error: schoolError } = await client
                .from('schools')
                .insert([insertPayload])
                .select()
                .single();

            if (schoolError) throw schoolError;

            if (newSchool) {
                await client.auth.updateUser({ 
                    data: { role: 'admin', school_id: newSchool.id, country: country } 
                });
                
                const { error: profileError } = await client.from('profiles').upsert([{ 
                    id: this.currentUser?.id, 
                    full_name: this.currentUser?.user_metadata?.full_name || 'Administrator',
                    role: 'admin', 
                    school_id: newSchool.id 
                }]);
                
                if (profileError) throw profileError;
            }

            this.closeAllModals();
            this.goToRoute('user_flows/admins/admins.html'); 

        } catch (err) {
            console.error("Admin setup notice:", err);
            alert("Setup failed: " + (err.message || "Please check your database constraints and RLS permissions."));
            btn.disabled = false;
            btn.innerText = originalText;
        }
    },

    async handleUserSetup(e) {
        e.preventDefault();
        const btn = document.getElementById('user-submit-btn');
        btn.innerText = 'Verifying with school...'; 
        btn.disabled = true;

        const client = getSupabaseClient();
        const schoolId = document.getElementById('user-school-select').value;
        const uniqueId = document.getElementById('user-identifier').value.trim();
        const fullName = document.getElementById('user-name').value.trim();

        if (!schoolId) {
            alert("Please pick your school from the directory list.");
            btn.disabled = false;
            btn.innerText = 'Access Dashboard';
            return;
        }

        try {
            let directoryMatch = null;
            const targetRole = this.selectedRole === 'parent' ? 'student' : this.selectedRole;
            const { data: matchedRecords, error: matchError } = await client.from('school_directory')
                .select('*')
                .eq('school_id', schoolId)
                .eq('role', targetRole);

            if (matchError) throw matchError;

            if (matchedRecords && matchedRecords.length > 0) {
                directoryMatch = matchedRecords.find(r => 
                    (r.unique_id && r.unique_id.toLowerCase() === uniqueId.toLowerCase()) ||
                    (r.email && r.email.toLowerCase() === uniqueId.toLowerCase()) ||
                    (r.phone && r.phone === uniqueId)
                );
            }

            if (!directoryMatch) {
                alert(`No official record found matching "${uniqueId}" in this school. Please verify your identifier or contact your school administrator.`);
                btn.disabled = false;
                btn.innerText = 'Access Dashboard';
                return;
            }

            if (this.selectedRole === 'parent') {
                let linkedIds = JSON.parse(localStorage.getItem(`parent_links_${this.currentUser.id}`) || '[]');
                if (!linkedIds.includes(directoryMatch.unique_id)) {
                    linkedIds.push(directoryMatch.unique_id);
                    localStorage.setItem(`parent_links_${this.currentUser.id}`, JSON.stringify(linkedIds));
                }
            }

            await client.auth.updateUser({ data: { role: this.selectedRole, school_id: schoolId } });

            const { error: profileError } = await client.from('profiles').upsert([{
                id: this.currentUser?.id, 
                full_name: this.selectedRole === 'parent' ? fullName : (directoryMatch?.name || fullName),
                role: this.selectedRole, 
                school_id: schoolId, 
                unique_identifier: directoryMatch?.unique_id || uniqueId
            }]);

            if (profileError) throw profileError;

            this.closeAllModals();
            const targetPath = this.getRouteForRole(this.selectedRole);
            this.goToRoute(targetPath);

        } catch (err) {
            console.error("User setup notice:", err);
            alert("An error occurred during verification. Please check your connection or contact an admin.");
            btn.disabled = false;
            btn.innerText = 'Access Dashboard';
        } 
    },

    // ==========================================
    // Country & Regional Discovery Setup
    // ==========================================
    async selectRole(role) {
        this.selectedRole = role;
        
        document.body.style.cursor = 'wait';
        await this.loadRegions();
        document.body.style.cursor = 'default';

        if (role === 'admin') {
            this.openModal('admin-setup-modal');
            this.populateAdminCountries();
            this.populateAdminStates();
        } else {
            this.openModal('user-setup-modal');
            this.populateUserCountries();
            this.populateUserRegions();
            await this.fetchSchools();
        }
    },

    populateAdminCountries() {
        const countrySelect = document.getElementById('country-select');
        if (!countrySelect) return;
        countrySelect.innerHTML = '<option value="">Select Country</option>' + 
            this.countries.map(c => `<option value="${c}" ${c === 'India' ? 'selected' : ''}>${c}</option>`).join('');
    },

    onAdminCountryChange() {
        const country = document.getElementById('country-select')?.value;
        const stateSelect = document.getElementById('state-select');
        const districtSelect = document.getElementById('district-select');

        if (country === 'India') {
            this.populateAdminStates();
        } else {
            // For other countries without predefined states table
            stateSelect.innerHTML = `
                <option value="Default / General State">General / National Region</option>
                <option value="Central">Central Region</option>
                <option value="Northern">Northern Region</option>
                <option value="Southern">Southern Region</option>
                <option value="Eastern">Eastern Region</option>
                <option value="Western">Western Region</option>
            `;
            districtSelect.innerHTML = `
                <option value="Main / Metro">Main / Metro District</option>
                <option value="City Center">City Center</option>
                <option value="Suburban">Suburban Area</option>
            `;
        }
    },

    populateAdminStates() {
        const stateSelect = document.getElementById('state-select');
        if (!stateSelect) return;
        stateSelect.innerHTML = '<option value="">Select State / UT / Region</option>' + 
            this.states.map(s => `<option value="${s.name}" data-id="${s.id}">${s.name}</option>`).join('');
    },

    onAdminStateChange() {
        const stateSelect = document.getElementById('state-select');
        const districtSelect = document.getElementById('district-select');
        
        const selectedOpt = stateSelect.options[stateSelect.selectedIndex];
        const stateId = selectedOpt ? selectedOpt.getAttribute('data-id') : null;

        if (!stateId) {
            districtSelect.innerHTML = '<option value="">Select District</option>';
            return;
        }
        
        const filteredDistricts = this.districts.filter(d => d.state_id === stateId);
        districtSelect.innerHTML = '<option value="">Select District</option>' + 
            filteredDistricts.map(d => `<option value="${d.name}">${d.name}</option>`).join('');
    },

    populateUserCountries() {
        const userCountrySelect = document.getElementById('user-country-select');
        if (!userCountrySelect) return;
        userCountrySelect.innerHTML = '<option value="">All Countries</option>' + 
            this.countries.map(c => `<option value="${c}">${c}</option>`).join('');
    },

    onUserCountryChange() {
        this.filterSchoolsList();
    },

    populateUserRegions() {
        const userStateSelect = document.getElementById('user-state-select');
        if (!userStateSelect) return;
        userStateSelect.innerHTML = '<option value="">All States / Regions</option>' + 
            this.states.map(s => `<option value="${s.name}" data-id="${s.id}">${s.name}</option>`).join('');
        document.getElementById('user-district-select').innerHTML = '<option value="">All Districts</option>';
    },

    onUserStateChange() {
        const stateSelect = document.getElementById('user-state-select');
        const districtSelect = document.getElementById('user-district-select');
        
        const selectedOpt = stateSelect.options[stateSelect.selectedIndex];
        const stateId = selectedOpt ? selectedOpt.getAttribute('data-id') : null;

        if (!stateId) {
            districtSelect.innerHTML = '<option value="">All Districts</option>';
        } else {
            const filteredDistricts = this.districts.filter(d => d.state_id === stateId);
            districtSelect.innerHTML = '<option value="">All Districts</option>' + 
                filteredDistricts.map(d => `<option value="${d.name}">${d.name}</option>`).join('');
        }
        this.filterSchoolsList();
    },

    onUserDistrictChange() {
        this.filterSchoolsList();
    },

    async fetchSchools() {
        const client = getSupabaseClient();
        if (!client) return;

        // Using select('*') prevents fatal crashes if a specific column is missing from the DB
        const { data: schools, error } = await client.from('schools').select('*');
        
        if (error) {
            console.error("School directory fetch error:", error.message);
        }

        this.registeredSchools = schools || [];
        this.filterSchoolsList();
    },

    filterSchoolsList() {
        const countryFilter = document.getElementById('user-country-select')?.value || '';
        const stateFilter = document.getElementById('user-state-select')?.value || '';
        const districtFilter = document.getElementById('user-district-select')?.value || '';
        const searchVal = (document.getElementById('user-school-search')?.value || '').toLowerCase().trim();

        const schoolSelect = document.getElementById('user-school-select');
        if (!schoolSelect) return;

        let filtered = this.registeredSchools.filter(s => {
            // Strict filtering: If a filter is selected, the school MUST have it and it MUST match.
            if (countryFilter && s.country !== countryFilter) return false;
            if (stateFilter && s.state !== stateFilter) return false;
            if (districtFilter && s.district !== districtFilter) return false;
            
            if (searchVal) {
                const combined = `${s.name} ${s.district || ''} ${s.state || ''} ${s.country || ''}`.toLowerCase();
                if (!combined.includes(searchVal)) return false;
            }
            return true;
        });

        if (filtered.length === 0) {
            schoolSelect.innerHTML = '<option value="">No registered schools found matching filters</option>';
            return;
        }

        schoolSelect.innerHTML = '<option value="">-- Choose your registered school --</option>' + 
            filtered.map(s => {
                const regionInfo = [s.district, s.state, s.country].filter(Boolean).join(', ');
                return `<option value="${s.id}">${s.name}${regionInfo ? ` (${regionInfo})` : ''}</option>`;
            }).join('');
    },

    onSchoolSelected() {
        const schoolId = document.getElementById('user-school-select')?.value;
        const school = this.registeredSchools.find(s => s.id === schoolId);
        
        const labelEl = document.getElementById('user-identifier-label');
        const hintEl = document.getElementById('user-identifier-hint');
        const inputEl = document.getElementById('user-identifier');

        if (!school) {
            labelEl.innerText = "Unique Identifier *";
            hintEl.innerText = "Enter your institutional identifier.";
            inputEl.placeholder = "Enter ID";
            return;
        }

        if (this.selectedRole === 'student') {
            const idName = school.student_id_label || "Admission Number";
            labelEl.innerText = `${idName} (or Email / Phone) *`;
            hintEl.innerText = `Enter your ${idName} (or registered email/phone) as recorded by ${school.name}.`;
            inputEl.placeholder = `e.g. ${idName} or student@school.com`;
        } else if (this.selectedRole === 'teacher') {
            const idName = school.teacher_id_label || "Employee ID";
            labelEl.innerText = `${idName} (or Email / Phone) *`;
            hintEl.innerText = `Enter your ${idName} (or registered staff email/phone) as provided by ${school.name}.`;
            inputEl.placeholder = `e.g. ${idName} or faculty@school.com`;
        } else {
            labelEl.innerText = "Student Roll / Admission No or Parent Mobile *";
            hintEl.innerText = `Enter your child's ${school.student_id_label || 'Admission Number'} or your registered phone number.`;
            inputEl.placeholder = "e.g. Child's ID or 9876543210";
        }
    },

    // ==========================================
    // UI Helpers
    // ==========================================
    async updateUserUI(user) {
        const authButtons = document.getElementById('auth-buttons');
        const userProfileMenu = document.getElementById('user-profile-menu');
        
        if (authButtons) authButtons.classList.add('hidden');
        if (userProfileMenu) userProfileMenu.classList.remove('hidden');

        const meta = user.user_metadata || {};
        const fullName = meta.full_name || meta.name || user.email.split('@')[0];
        
        const nameEl = document.getElementById('dropdown-user-name');
        const emailEl = document.getElementById('dropdown-user-email');
        const roleEl = document.getElementById('dropdown-user-role');
        
        if (nameEl) nameEl.innerText = fullName;
        if (emailEl) emailEl.innerText = user.email;
        if (roleEl && meta.role) roleEl.innerText = meta.role;

        const avatarImg = document.getElementById('user-avatar-img');
        const avatarInitial = document.getElementById('user-avatar-initial');
        if (meta.avatar_url && avatarImg) {
            avatarImg.src = meta.avatar_url;
            avatarImg.classList.remove('hidden');
            if (avatarInitial) avatarInitial.classList.add('hidden');
        } else if (avatarInitial) {
            if (avatarImg) avatarImg.classList.add('hidden');
            avatarInitial.classList.remove('hidden');
            avatarInitial.innerText = fullName.charAt(0).toUpperCase();
        }
    },

    resetUserUI() {
        document.getElementById('profile-dropdown-dialog')?.classList.remove('open');
        document.getElementById('auth-buttons')?.classList.remove('hidden');
        document.getElementById('user-profile-menu')?.classList.add('hidden');
    },

    toggleProfileDropdown(e) {
        if (e) e.stopPropagation();
        document.getElementById('profile-dropdown-dialog')?.classList.toggle('open');
    },

    async switchAccount() {
        const client = getSupabaseClient();
        if (client) await client.auth.signOut();
        this.openModal('auth-modal', 'login');
    },

    async logout() {
        const client = getSupabaseClient();
        if (client) await client.auth.signOut();
    },

    openModal(modalId, mode = null) {
        this.closeAllModals();
        if (modalId === 'auth-modal') {
            this.authMode = mode || 'signup';
            document.getElementById('auth-title').innerText = this.authMode === 'login' ? 'Welcome Back' : 'Create an Account';
            document.getElementById('auth-submit-btn').innerText = this.authMode === 'login' ? 'Log In' : 'Sign Up';
        }
        document.getElementById(modalId)?.classList.remove('hidden');
        document.getElementById('modal-overlay')?.classList.add('active');
        document.body.style.overflow = 'hidden';
    },

    closeAllModals() {
        document.querySelectorAll('.modal-content').forEach(el => el.classList.add('hidden'));
        document.getElementById('modal-overlay')?.classList.remove('active');
        document.body.style.overflow = 'auto';
        document.getElementById('role-warning')?.classList.add('hidden');
    }
};

document.addEventListener('DOMContentLoaded', () => {
    app.init();
    const overlay = document.getElementById('modal-overlay');
    if (overlay) overlay.addEventListener('click', (e) => { if (e.target === overlay) app.closeAllModals(); });
    
    document.addEventListener('click', (e) => {
        const menu = document.getElementById('user-profile-menu');
        const dialog = document.getElementById('profile-dropdown-dialog');
        if (menu && dialog && !menu.contains(e.target)) {
            dialog.classList.remove('open');
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') app.closeAllModals();
    });
});