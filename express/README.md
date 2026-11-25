# ChowOnCampus Express

Independent, mobile-first ordering and operations platform for ChowOnCampus.

This application is being developed separately from the existing ChowOnCampus website. It will use GitHub for source control and a separately configured application host and PostgreSQL database.

## Planned interfaces

- Student: browse participating businesses and products, build a cart, submit delivery details, and track an order.
- Agent: receive and accept assignments, record purchase amounts, upload receipts, update delivery progress, and view delivery earnings.
- Admin: manage catalogue, businesses, students, agents, orders, exceptions, financial reconciliation, and daily reports.

## Operating rules captured so far

- Gate delivery: ₦300.
- Room delivery: ₦400 total (₦300 delivery + ₦100 room surcharge).
- Product prices are set by each participating business.
- Only participating campus businesses are listed.
- Room delivery uses the student's selected male/female agent preference; gate delivery does not require gender matching.
- Payment gateway is not required for the first version. The app records payment and reconciliation evidence; it does not move money.
- Any changed product price or unavailable item must be confirmed by the student before purchase.

## Financial control

Every order must have its own ledger. The system must distinguish:
- Amount collected from the student
- Actual purchase cost (supported by receipt)
- Delivery fee and room surcharge
- Agent delivery compensation
- Amount due to / remitted to ChowOnCampus
- Refunds, adjustments, and unresolved differences

A transfer is not considered verified solely because an agent marks it as paid. Admin reconciliation must record evidence and status.

## Local development

1. Create and activate a Python virtual environment.
2. Install dependencies from requirements.txt.
3. Initialize the Reflex project if the local Reflex CLI requires it.
4. Run reflex run.

The initial scaffold is intentionally small. Authentication, database models, migrations, file storage, dispatch logic, and reporting will be added in separate tested steps.

## Configuration

Use environment variables for database connection strings, session secrets, and storage credentials. Never commit credentials, bank account details, student personal data, or receipt images to GitHub.
