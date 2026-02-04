# VulnPkg Dashboard - Complete Guide

## 🚀 Quick Start

The dashboard is now running at: **http://localhost:4000/dashboard**

## 📊 Dashboard Features

### 1. **Main Dashboard Section**
- **6 KPI Cards** showing real-time metrics:
  - Active Machines
  - Total Alerts
  - Critical Vulnerabilities
  - Monitored Packages
  - Protected Processes
  - Risk Score

- **Interactive Charts**:
  - Vulnerability Severity Distribution (Doughnut Chart)
  - Alerts Timeline (Line/Area Chart - toggleable)
  - Vulnerabilities by Ecosystem (Bar Chart)
  - Top Vulnerable Packages (Horizontal Bar Chart)

- **Recent Activity Feed**: Live feed of all system events
- **Recent Alerts Table**: Quick view of latest security alerts

### 2. **Machines Section**
- Grid view of all registered machines
- Search and filter by status (Online/Offline)
- Click any machine card to see detailed information
- Real-time status indicators

### 3. **Alerts Section**
- Complete list of all security alerts
- Search by package name, CVE ID, or machine ID
- Filter by severity (Critical, High, Medium, Low)
- Export alerts to CSV
- Click "View Details" for full alert information

### 4. **Packages Section**
- Complete package inventory
- Shows all packages across all machines
- Vulnerability count per package
- Search and filter by ecosystem (npm, PyPI)
- Check package button to manually trigger vulnerability scan

### 5. **Analytics Section**
- Vulnerability Trends (Last 30 Days) - Multi-line chart
- Severity Breakdown (Pie Chart)
- Ecosystem Distribution (Doughnut Chart)
- Machine Health Status metrics

### 6. **Settings Section**
- Configure alert refresh interval (5s, 10s, 30s, 1min)
- Enable/disable alert sounds
- Enable/disable browser notifications
- Theme selection (Dark/Light)
- Chart animation toggle

## 🎨 UI Features

### Navigation
- **Sidebar Navigation**: Click any section to switch views
- **Badge Counters**: See machine and alert counts in navigation
- **Connection Status**: Real-time WebSocket connection indicator
- **Last Update Time**: Shows when data was last refreshed

### Interactive Elements
- **Search Bars**: Search across all sections
- **Filter Dropdowns**: Filter by various criteria
- **Export Buttons**: Export data in JSON or CSV format
- **Refresh Button**: Manually refresh all data
- **Fullscreen Button**: Toggle fullscreen mode

### Visual Indicators
- **Status Badges**: Color-coded severity indicators
- **Online/Offline Status**: Real-time machine status
- **KPI Change Indicators**: Shows increase/decrease with arrows
- **Activity Icons**: Different icons for different event types

## 🔄 Real-Time Updates

- **WebSocket Connection**: Live updates when new alerts are detected
- **Auto-Refresh**: Automatically refreshes every 5 seconds (configurable)
- **Live Activity Feed**: Shows events as they happen
- **Connection Status**: Visual indicator of WebSocket connection

## 📱 Responsive Design

- Works on desktop, tablet, and mobile devices
- Adaptive grid layouts
- Touch-friendly interface
- Optimized for all screen sizes

## 🎯 Key Interactions

1. **View Alert Details**: Click the eye icon in any alert row
2. **View Machine Details**: Click on any machine card
3. **Switch Sections**: Click navigation items in sidebar
4. **Search**: Type in any search box to filter results
5. **Export Data**: Click export buttons to download data
6. **Refresh**: Click refresh icon to manually update

## 🔧 Technical Details

- **Frontend**: Vanilla JavaScript with Chart.js
- **Backend**: Express.js with WebSocket support
- **Charts**: Chart.js 4.4.0 with date adapter
- **Styling**: Modern CSS with CSS Variables
- **Icons**: Font Awesome 6.4.0

## 📈 Data Visualization

All charts are interactive:
- Hover to see detailed tooltips
- Click legend items to toggle data series
- Responsive to window resizing
- Smooth animations and transitions

## 🎨 Color Scheme

- **Critical**: Red (#ef4444)
- **High**: Orange (#f97316)
- **Medium**: Yellow (#eab308)
- **Low**: Gray (#94a3b8)
- **Online**: Green (#22c55e)
- **Primary**: Blue (#3b82f6)

## 🚨 Alert System

Alerts are displayed with:
- Severity badges
- Package information (ecosystem:name@version)
- CVE ID
- Machine ID
- Fix version (if available)
- Timestamp

## 💡 Tips

1. Use the search functionality to quickly find specific items
2. Filter by severity to focus on critical issues
3. Export data for reporting and analysis
4. Check the activity feed for recent system events
5. Use the analytics section for trend analysis

Enjoy your professional security dashboard! 🎉

