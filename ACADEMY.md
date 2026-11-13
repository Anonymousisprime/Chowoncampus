# ChowOnCampus Academy — Basic Edition

## Included
- Shared Academy page at `/academy.html`, linked from student, restaurant, agent and admin dashboards.
- Six prepared lessons and ten approved FAQs for each student, restaurant and delivery-agent role.
- Role-scoped content returned by authenticated server endpoints.
- Search over approved FAQs.
- Three-question role-specific knowledge checks, graded on the server.
- Persistent lesson completion and quiz results using the app's existing JSON/PostgreSQL storage layer.
- Ultimate Admin-only lesson/FAQ create, edit, publish/unpublish and remove controls.

## Data and access
- Seed content lives in `academy-data.json` in the repository root (not the public static directory).
- The backend reads/writes it through the existing persistent storage abstraction.
- User progress is keyed by role and login username; APIs require an authenticated session.
- Only the Ultimate Admin can manage Academy content. Other admins cannot use content-management endpoints.
- The Academy is a learning and FAQ system, not a generative AI model. It uses approved prepared answers and keyword search; unknown questions are directed to support.

## Verification
Run `npm test` and `node --check server.js`. The Academy validation test checks lesson/FAQ coverage and quiz integrity.
