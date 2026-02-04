# Multi-Tenant Dashboard System

## 🎯 Overview

The system now supports **two distinct dashboard views**:

1. **Master Dashboard (Admin)** - System-wide monitoring
2. **User Dashboard** - Individual user's machine monitoring

## 🔐 Authentication System

### Login Credentials

**Admin Access:**
- Email: `admin@vulnpkg.com`
- Password: `admin`
- Role: `admin`
- Access: Full system view + user management

**User Access:**
- Email: Any email (e.g., `user@example.com`)
- Password: Any password
- Role: `user`
- Access: Only their own machines and alerts

### How It Works

1. **Simple Auth** - Currently uses basic token-based auth
2. **User Context** - React Context API manages user state
3. **Role-Based Routing** - Different views based on user role
4. **Data Filtering** - API endpoints filter by `user_id`

## 📊 Master Dashboard (Admin)

### Features

- **System-Wide Metrics:**
  - Total Users
  - All Active Machines
  - Total Alerts (across all users)
  - Critical Vulnerabilities
  - Monitored Packages
  - System Risk Score

- **User Distribution Chart** - Shows machines per user
- **All Users View** - See all registered users
- **User Management** - Manage users and their access
- **Global Analytics** - System-wide trends and insights

### Navigation

- Master Dashboard
- Users (user management)
- Machines (all machines)
- Alerts (all alerts)
- Packages (all packages)
- Analytics (system-wide)

## 👤 User Dashboard

### Features

- **Personal Metrics:**
  - My Active Machines
  - My Alerts
  - My Critical Vulnerabilities
  - My Monitored Packages
  - My Protected Processes
  - My Risk Score

- **Filtered Data** - Only shows data for user's machines
- **Personal Analytics** - User-specific trends

### Navigation

- Dashboard (personal view)
- My Machines
- My Alerts
- My Packages
- Analytics (personal)

## 🔧 API Endpoints

### Authentication

```
POST /api/auth/login
Body: { email, password }
Returns: { user, token }

GET /api/auth/me
Headers: { Authorization: Bearer <token> }
Returns: { user }
```

### User-Scoped Data

```
GET /alerts?user_id=<userId>
GET /machines?user_id=<UserId>
```

- Admin: No `user_id` parameter = all data
- User: `user_id` parameter = filtered data

### Admin Only

```
GET /api/users
Headers: { Authorization: Bearer admin-token }
Returns: { users: [...] }
```

## 🏗 Architecture

### Components

```
src/
├── contexts/
│   └── AuthContext.jsx      # Authentication state
├── components/
│   ├── Login.jsx            # Login page
│   ├── MasterDashboard.jsx  # Admin dashboard
│   ├── Dashboard.jsx        # User dashboard
│   ├── UserManagement.jsx   # User management (admin)
│   ├── TopNav.jsx           # Navigation (role-aware)
│   └── ...                  # Other components
└── App.jsx                  # Main app (role routing)
```

### Data Flow

1. **User Logs In** → Token stored in localStorage
2. **App Loads** → Checks token, fetches user data
3. **Role Determined** → Admin or User
4. **Data Fetched** → Filtered by user_id if not admin
5. **Views Rendered** → Different components based on role

## 🚀 Usage

### Starting the System

```bash
cd cloud
npm run build  # Build React app
npm start      # Start server
```

### Accessing Dashboards

1. **Admin Dashboard:**
   - Go to http://localhost:4000
   - Login with `admin@vulnpkg.com` / `admin`
   - See master dashboard with all users/machines

2. **User Dashboard:**
   - Go to http://localhost:4000
   - Login with any email / any password
   - See personal dashboard with only your machines

## 🔒 Security Notes

**Current Implementation:**
- Simple token-based auth (demo)
- User filtering at API level
- Role-based UI routing

**Production Recommendations:**
- Integrate Supabase Auth
- JWT tokens with expiration
- Role-based access control (RBAC)
- API rate limiting
- HTTPS enforcement

## 📈 Future Enhancements

- [ ] Supabase Auth integration
- [ ] User registration flow
- [ ] Password reset
- [ ] Email verification
- [ ] Team/organization support
- [ ] User permissions granularity
- [ ] Audit logs
- [ ] API key management

## 🎨 UI Differences

### Admin View
- "Master Dashboard" title
- "Users" navigation item
- System-wide metrics
- User distribution charts
- User management table
- "ADMIN" badge in nav

### User View
- "Dashboard" title
- "My Machines" / "My Alerts" labels
- Personal metrics only
- No user management
- No admin badge

## 🔄 Real-Time Updates

Both dashboards support:
- WebSocket connections
- Real-time alert updates
- Live machine status
- Auto-refresh every 5 seconds

The system automatically filters updates based on user role.

