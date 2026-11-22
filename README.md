# 🇮🇳 NamMakkal
### AI-Powered Civic Issue Intelligence & Resolution Platform

**From citizen complaints to verified civic solutions.**

NamMakkal is an AI-powered civic engagement platform that connects citizens, government administrators, and field officers through a unified public issue management system.

It helps citizens report civic problems, enables administrators to coordinate issue resolution, and assists authorities in prioritizing public concerns using Artificial Intelligence.

---

## 🌟 Key Features

### 👥 Citizen Portal
- Secure account registration and email OTP verification.
- Report civic issues with descriptions, photographs, and location details.
- Track complaint status and resolution progress.
- Receive notifications and administrative updates.
- Submit suggestions and support requests.
- Access the platform in English and Tamil.

### 🤖 AI-Powered Intelligence
- Automatically classify civic complaints.
- Identify relevant government departments.
- Assess complaint severity and potential public safety risks.
- Detect potential duplicate complaints.
- Provide AI-assisted duplicate review for administrators.
- Support human review when AI confidence or available information is insufficient.

### 🏛️ Administrative Dashboard
- Centralized complaint management.
- Citizen and officer account management.
- Ward and team management.
- Assign complaints to responsible officers.
- Review AI assessments and duplicate reports.
- Manage suggestions, reported problems, and support requests.
- Monitor complaint progress and administrative actions.

### 👷 Officer Portal
- View assigned complaints.
- Inspect reported civic issues.
- Submit inspection details and action plans.
- Update complaint progress.
- Upload repair evidence and completion updates.
- Manage assigned work through a structured workflow.

### 🔔 Notification System
- Complaint status notifications.
- Administrative updates.
- Officer-related updates.
- Support request notifications.
- Email OTP verification and password reset.

### 🔐 Security
- Password hashing using bcrypt.
- JWT-based authentication with secure HTTP-only cookies.
- Email OTP verification for account registration and sign-in.
- Role-based access control.
- Request validation using Zod.
- Authentication rate limiting.
- Protected API routes and origin validation.

---

## 🧠 How NamMakkal Works

1. **Report:** A citizen submits a civic complaint with a description, photograph, and location.
2. **Assess:** AI analyzes the complaint and suggests its category, department, and severity.
3. **Detect:** The system identifies potentially duplicate complaints for administrative review.
4. **Assign:** An administrator reviews the complaint and assigns it to the responsible officer or team.
5. **Resolve:** The officer inspects the issue, performs the required work, and submits progress updates and evidence.
6. **Verify:** Citizens can follow the resolution process and review the submitted updates.

---

## 🛠️ Technology Stack

| Layer | Technologies |
|---|---|
| Frontend | React 19, Vite |
| Styling | Tailwind CSS 4 |
| Routing | React Router |
| API Communication | Axios |
| Backend | Node.js, Express.js |
| Database | SQLite, better-sqlite3 |
| AI Integration | Google Gemini API |
| Authentication | JWT, bcryptjs, Email OTP |
| Email Delivery | Brevo API |
| File Storage | Supabase Storage |
| Validation | Zod |
| Maps | Leaflet, React Leaflet |
| Frontend Hosting | Firebase Hosting |
| Backend Hosting | Railway |

---

## 🏗️ Project Architecture

```text
NamMakkal/
│
├── client/
│   ├── public/
│   ├── src/
│   │   ├── api/
│   │   ├── assets/
│   │   ├── components/
│   │   ├── context/
│   │   ├── hooks/
│   │   ├── i18n/
│   │   ├── layouts/
│   │   ├── pages/
│   │   │   ├── admin/
│   │   │   ├── auth/
│   │   │   ├── citizen/
│   │   │   └── officer/
│   │   ├── routes/
│   │   └── utils/
│   └── package.json
│
└── server/
    ├── scripts/
    ├── src/
    │   ├── config/
    │   ├── database/
    │   │   └── migrations/
    │   ├── middleware/
    │   ├── modules/
    │   │   ├── admin/
    │   │   ├── announcements/
    │   │   ├── auth/
    │   │   ├── complaints/
    │   │   ├── intelligence/
    │   │   ├── notifications/
    │   │   └── officer/
    │   ├── services/
    │   ├── app.js
    │   └── server.js
    ├── test/
    └── package.json
```

---

## ⚙️ Local Installation & Setup

### Prerequisites

- Node.js 20 or later
- npm
- Git

### 1. Clone the repository

```bash
git clone https://github.com/Gurusrepo/NamMakkal.git
cd NamMakkal
```

### 2. Configure the backend

```bash
cd server
npm install
```

Create a `.env` file inside the `server` directory:

```env
NODE_ENV=development
PORT=3000

DATABASE_PATH=./data/civicpulse.sqlite

JWT_SECRET=your_secure_random_secret_at_least_32_characters
JWT_EXPIRES_IN=1d

CORS_ORIGINS=http://localhost:5173

BREVO_API_KEY=your_brevo_api_key
BREVO_SENDER_EMAIL=your_verified_sender_email

OTP_SECRET=your_separate_secure_secret_at_least_32_characters

SUPABASE_URL=your_supabase_project_url
SUPABASE_SECRET_KEY=your_supabase_secret_key

GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-3.5-flash-lite

CITIZEN_ELIGIBILITY_MIN_AGE=18
SENIOR_CITIZEN_MIN_AGE=60
```

Generate separate, strong random values for `JWT_SECRET` and `OTP_SECRET`. Never commit actual credentials to GitHub.

The production environment requires Brevo credentials and `OTP_SECRET`. Configure the Supabase Storage bucket `civicpulse-media` as required by the application.

### 3. Start the backend

```bash
npm run dev
```

Backend development server:

```text
http://localhost:3000
```

Health check:

```text
http://localhost:3000/api/health
```

### 4. Configure the frontend

Open another terminal:

```bash
cd client
npm install
```

Create a `.env.local` file inside the `client` directory:

```env
VITE_API_BASE_URL=http://localhost:3000/api
```

### 5. Start the frontend

```bash
npm run dev
```

Frontend development server:

```text
http://localhost:5173
```

---

## 🧪 Testing

Run backend tests:

```bash
cd server
npm test
```

Run frontend production build:

```bash
cd client
npm run build
```

---

## 🚀 Deployment

NamMakkal uses separate hosting for its frontend and backend.

| Component | Deployment Platform |
|---|---|
| Frontend | Firebase Hosting |
| Backend API | Railway |
| Database | SQLite with persistent storage |
| Media Storage | Supabase Storage |
| AI Services | Google Gemini API |
| Email Delivery | Brevo |

Production environment variables and persistent database storage must be configured before deployment.

---

## 🎯 Project Objective

NamMakkal aims to make civic issue reporting more accessible, public service delivery more transparent, and complaint resolution more accountable.

By combining AI-assisted assessment, location-aware issue management, structured officer workflows, and citizen-facing progress updates, the platform provides a foundation for smarter and more responsive local governance.

---

## 🔮 Future Scope

- Advanced ward-level civic analytics.
- Improved geographic visualization of recurring public issues.
- Predictive identification of civic problem hotspots.
- Integration with official municipal systems.
- Multilingual accessibility improvements.
- Data-driven public infrastructure planning.

---

## 👨‍💻 Developed With

Built with the goal of using technology and Artificial Intelligence to solve real-world civic problems.

**NamMakkal — We work towards better communities.**

GitHub: https://github.com/Gurusrepo/NamMakkal

NamMakkal : https://nam-makkal.web.app/
