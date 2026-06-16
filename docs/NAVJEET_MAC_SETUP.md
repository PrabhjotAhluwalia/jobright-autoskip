# JobRight Auto-Skip: Mac Setup and Personalization Guide

This repository is private and shared for personal use. Do not redistribute it,
publish it, or add another collaborator without the repository owner's approval.

## Important: Do Not Apply Yet

The repository initially contains another candidate's resume, contact details,
career history, filters, and application-answer rules. Complete every item in
the personalization checklist before allowing JobRight to submit applications.

## 1. Accept Access and Download the Repository

1. Create or sign in to the GitHub account associated with
   the invited Georgia Tech GitHub account.
2. Accept the private-repository invitation from GitHub.
3. Open Terminal on the Mac.
4. Install Apple's command-line tools if Git is unavailable:

   ```bash
   xcode-select --install
   ```

5. Clone the repository:

   ```bash
   git clone https://github.com/PrabhjotAhluwalia/jobright-autoskip.git
   cd jobright-autoskip
   ```

## 2. Create a Personal Branch

Keep personal settings separate from the owner's `main` branch:

```bash
git switch -c navjeet/profile
```

Do not push personal OAuth secrets. The repository already ignores
`oauth_config.js`.

## 3. Mandatory Personalization Checklist

### A. Replace the system prompt

Edit `jobright_system_prompt.txt`. Replace every candidate-specific fact,
including:

- Full, first, and last name
- Citizenship and work-authorization status
- Whether sponsorship is required now or in the future
- Current city, relocation policy, commute radius, and onsite/hybrid policy
- Available start date
- Country, telephone country code, and age, if age is intentionally included
- Years of experience
- Employers, job titles, education, projects, certifications, and achievements
- Tools, languages, frameworks, cloud platforms, and engineering domains
- Salary expectations
- Referral and source-of-application answers
- Cover-letter narrative, accomplishments, and personal details

All answers must be truthful. Pay special attention to work authorization,
sponsorship, location, security clearance, criminal history, disability,
veteran status, demographic questions, conflicts of interest, and
certifications.

For a software-engineering profile, define factual answers for:

- Primary languages: Java, Python, JavaScript/TypeScript, C++, Go, etc.
- Frontend: React, Next.js, Angular, Vue, accessibility, browser APIs
- Backend: Node.js, Spring Boot, Django/FastAPI, REST, GraphQL, gRPC
- Data: SQL, PostgreSQL, MySQL, Redis, Kafka, Spark, warehouses
- Cloud: AWS, Azure, GCP, serverless, containers, Kubernetes
- DevOps: GitHub Actions, CI/CD, Docker, Terraform, observability
- Testing: unit, integration, end-to-end, performance, security testing
- System design: distributed systems, APIs, microservices, scalability
- AI/ML experience, only where supported by actual work or projects
- Exact years of experience for each important skill
- Preferred roles and levels: Software Engineer, Backend Engineer, Full Stack
  Engineer, ML Engineer, Platform Engineer, etc.

Remove blanket claims such as “expert in every tool” or fixed years for every
technology unless they are accurate for the candidate.

### B. Replace profile-correction constants

Edit `ats_content.js` and replace every value in `PROFILE_CORRECTIONS`:

```js
const PROFILE_CORRECTIONS = {
  fullName: 'YOUR FULL NAME',
  firstName: 'YOUR FIRST NAME',
  lastName: 'YOUR LAST NAME',
  email: 'YOUR EMAIL',
  phone: 'YOUR PHONE',
  linkedin: 'YOUR LINKEDIN URL',
};
```

The phone number should contain digits only.

### C. Replace the fallback resume

1. Delete the existing PDF from `assets/`.
2. Add the candidate's current software-engineering resume as a PDF.
3. Update both constants in `ats_content.js`:

   ```js
   const FALLBACK_RESUME_PATH = 'assets/YOUR_RESUME.pdf';
   const FALLBACK_RESUME_NAME = 'YOUR_RESUME.pdf';
   ```

4. Update the matching filename under `web_accessible_resources` in
   `manifest.json`.

Verify the PDF has the correct name, email, phone, LinkedIn/GitHub links,
education, work history, and project details.

### D. Customize target-job filters

Review:

- `jobright_excluded_job_titles.txt`
- `jobright_excluded_job_title_regexes.txt`
- `shared_blocklist.json`

For a software engineer, consider excluding roles outside the desired scope,
such as sales, marketing, product management, support, hardware, QA-only,
director/VP roles, or seniority levels that do not match the candidate.

Do not inherit another candidate's company blocklist without reviewing it.

### E. Review automated answers in `ats_content.js`

The extension currently automates:

- Sponsorship questions: `No`
- Work-authorization questions: `Yes`
- Hybrid, onsite, commute, local, and relocation questions: `Yes`
- Recruiter SMS opt-in: `No`
- Empty country controls: United States
- Mandatory terms/privacy/consent checkboxes
- Gmail OTP entry
- Fallback resume upload

Change or disable any rule that is not true for the candidate. In particular,
do not use the extension until sponsorship, work authorization, country, and
location answers are correct.

## 4. Optional Gmail OTP Setup

The repository does not include the owner's OAuth secret. Start without Gmail
OTP, or configure a separate Google Cloud OAuth application.

For personal OAuth:

1. Create a Google Cloud project.
2. Enable the Gmail API.
3. Configure the OAuth consent screen and add the candidate as a test user if
   the app remains in testing.
4. Create the required OAuth clients and authorized redirect URI.
5. Update the `oauth2.client_id` in `manifest.json` for Chrome.
6. Copy the local configuration template:

   ```bash
   cp oauth_config.example.js oauth_config.js
   ```

7. Put the non-Chrome Chromium OAuth client ID and secret in
   `oauth_config.js`.

Never commit `oauth_config.js`, access tokens, refresh tokens, passwords, or
one-time codes.

## 5. Load the Extension on macOS

1. Open Chrome.
2. Visit `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked**.
5. Select the cloned `jobright-autoskip` directory.
6. Pin **JobRight Auto-Skip** from Chrome's extensions menu.
7. Open JobRight and confirm the extension popup reports that it is active.

After any code or profile change:

1. Return to `chrome://extensions`.
2. Click the extension's reload button.
3. Refresh the JobRight page and any open application page.

## 6. Safe First-Run Test

Before starting a queue:

1. Use one test application.
2. Keep automatic submission paused.
3. Verify name, email, phone, LinkedIn, location, resume, salary, work
   authorization, sponsorship, and onsite/hybrid answers.
4. Confirm no selected option is toggled off by later scans.
5. Confirm a successful application is counted once.
6. Confirm failed or limited applications are not counted as successes.
7. Confirm the stuck-job timer saves a screenshot and skips only after 100
   seconds without visible progress.
8. Review the generated cover letter for factual accuracy.

Only enable hands-free use after the test application is fully correct.

## 7. Updating the Local Copy

To receive repository updates later:

```bash
git switch navjeet/profile
git fetch origin
git rebase origin/main
```

Resolve personalization conflicts carefully. Never replace the personalized
system prompt, resume, or profile constants with the owner's values.

## Troubleshooting

- Extension changes do not appear: reload the extension and refresh all related
  tabs.
- Gmail connection fails: verify the OAuth project, client ID, redirect URI,
  test-user access, and Gmail API status.
- Wrong answer selected: pause the queue, capture the complete question and
  options, and fix the rule before continuing.
- JobRight remains stuck: verify the active card exposes a `Skip` control and
  that JobRight still displays `Executing`.
- Resume upload fails: verify the PDF filename in the asset folder,
  `ats_content.js`, and `manifest.json` all match exactly.
