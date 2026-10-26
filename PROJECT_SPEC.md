# Smart Railway Pantry Coordination & Inventory System

## Product Requirements, Technical Blueprint & Development Guide

**Document version:** 1.0\
**Project type:** Full-stack, mobile-first web application\
**Primary users:** Railway passengers, pantry staff, pantry
administrators\
**Status:** Initial implementation specification\
**Working title:** Smart Railway Pantry

------------------------------------------------------------------------

## 1. Project Overview

The Smart Railway Pantry Coordination & Inventory System is a web-based
platform for coordinating food and beverage requests, pantry staff
movement, and stock management within a train.

Passengers use a compartment-specific QR code to view the products
available for their journey and submit requests from a predefined
catalogue. The system groups demand by compartment so staff can serve
several passengers efficiently. Pantry staff use their own authenticated
interface and dedicated QR workflows to identify the items they are
carrying and report their current compartment. Administrators manage the
catalogue, daily stock, staff, compartments, QR codes, requests,
assignments, and inventory from a central dashboard.

The platform must be a real, database-backed application. QR codes,
scanning, authentication, request handling, staff tracking, and stock
updates must work end to end. A polished interface alone is not a
completed implementation.

### 1.1 Core product goals

1.  Make it easy for passengers to request available pantry products
    using a phone.
2.  Reduce unnecessary movement by grouping demand by compartment.
3.  Give administrators a live operational view of requests, staff, and
    inventory.
4.  Give pantry staff a simple workflow for carrying items, locating
    themselves, and completing service.
5.  Keep stock accurate and prevent overselling.
6.  Generate and validate all project QR codes within this application.
7.  Provide a professional, colourful, accessible, responsive
    railway-oriented experience.

### 1.2 Design principle

Build a railway operations platform, not a generic food-delivery clone.
Do not copy Swiggy, Zomato, or quick-commerce patterns. Passenger
ordering should be simple, while administration and staff workflows
should reflect train compartments, service operations, stock, and staff
coordination.

------------------------------------------------------------------------

## 2. User Roles and Permissions

Use role-based access control (RBAC). Every protected API endpoint must
verify the authenticated user and their role on the server. Hiding a
button in the frontend is not security.

### 2.1 Passenger

Passengers do not need access to staff or admin functions.

-   Open a compartment QR link.
-   See the train/service context and compartment identifier.
-   Browse the products enabled for the current service.
-   View product name, image, category, price, and availability.
-   Submit a request for one or more predefined products.
-   See a request confirmation and reference number.
-   View request status using a secure session or request reference.
-   See availability updates where appropriate.
-   Receive clear messages if an item is unavailable or a request cannot
    be accepted.

Do not expose staff personal information, internal stock adjustments,
other passengers' details, or administrative data.

### 2.2 Pantry staff

Staff must sign in using an account created or approved by an
administrator.

-   View their assigned service and staff profile.
-   View current assigned tasks and compartment demand.
-   Register the items they are carrying using the item-carrying QR
    workflow.
-   Update their current compartment using the compartment-location QR
    workflow.
-   View the items and quantities they are authorised to carry.
-   View requests assigned to them.
-   Mark a request as accepted, in progress, delivered, or unable to
    fulfil, subject to the defined workflow.
-   Record the actual quantity sold or delivered.
-   See clear validation and error messages.

Staff must not be able to create admin accounts, change product prices,
change opening stock, or modify another staff member's records unless an
administrator grants a specific permission.

### 2.3 Administrator

Administrators manage the service and operational configuration.

-   Create and manage train/service records and compartments.
-   Create, edit, activate, deactivate, and archive products.
-   Manage categories, product images, prices, and descriptions.
-   Set daily/service-specific opening quantities.
-   Register, edit, activate, deactivate, and assign pantry staff.
-   Generate, view, download, print, revoke, and regenerate QR codes.
-   View incoming passenger requests grouped by compartment.
-   Assign requests or compartment demand to staff.
-   See staff-reported current locations and carried items.
-   Track requests, fulfilment, sales, stock movements, and remaining
    stock.
-   View operational summaries and audit history.
-   Correct data through controlled adjustment workflows with a reason
    recorded.

Use a protected initial administrator setup process. Do not hardcode
production admin credentials.

------------------------------------------------------------------------

## 3. Core Functional Modules

### 3.1 Passenger experience

The passenger interface is the highest-priority mobile experience
because passengers are expected to be the largest user group.

**Passenger flow**

1.  Passenger scans the QR code displayed for their compartment.
2.  The QR opens a route belonging to this website.
3.  The backend validates the QR token and resolves the correct
    train/service and compartment.
4.  The passenger sees the products enabled for that service.
5.  The passenger selects products and quantities.
6.  The backend validates product availability and creates the request.
7.  The passenger receives a confirmation and request reference.
8.  The request appears in the administrator dashboard under the correct
    compartment.
9.  The administrator coordinates staff fulfilment.
10. The passenger can see the request status.

**Passenger interface requirements**

-   Mobile-first layout with large tap targets.
-   Simple category navigation and readable product cards.
-   Clear price and availability labels.
-   Quantity controls that work well on touch screens.
-   Cart/request summary that remains easy to reach.
-   Loading, empty, success, unavailable, and error states.
-   Do not imply a payment has been made unless a payment gateway is
    actually integrated and payment is confirmed.
-   Do not allow free-text ordering if the operational rule is a
    predefined catalogue.

### 3.2 Product and daily inventory management

Administrators create the master product catalogue and configure which
products are available for each service/day.

Each product should support:

-   Product name
-   Category
-   Description
-   Image
-   Price and currency
-   Active/inactive state
-   Optional SKU or internal code

Each service inventory record should support:

-   Service/train reference
-   Product reference
-   Opening quantity
-   Reserved quantity, if reservations are used
-   Sold/delivered quantity
-   Adjustments
-   Remaining/available quantity
-   Last updated timestamp

**Inventory formula**

`Available quantity = Opening quantity + Stock additions + Positive adjustments - Reserved quantity - Sold quantity - Negative adjustments`

Choose one reservation model and implement it consistently. If requests
reserve stock, release reservations when requests are cancelled or
expire. If requests do not reserve stock, re-check stock atomically at
assignment/fulfilment. Never rely only on a frontend availability
number.

### 3.3 Compartment-wise request aggregation

The system must group demand by service and compartment.

Example:

-   Passenger A in S2 requests 2 water bottles.
-   Passenger B in S2 requests 1 water bottle.
-   Passenger C in S2 requests 1 juice.
-   The admin dashboard shows S2 demand as 3 water bottles and 1 juice,
    while retaining each individual request for traceability.

Aggregation is a dashboard and operational view. Do not destroy
individual request records or passenger request references.

The aggregation must be filterable by:

-   Service/train
-   Date or service run
-   Compartment
-   Product/category
-   Request status

### 3.4 Pantry staff management

Staff records should include only information necessary for operations,
for example:

-   Staff display name
-   Staff identifier
-   Login identity
-   Role
-   Active status
-   Assigned service/shift
-   Contact field only if operationally required and access-controlled

Do not put personal details inside a QR code. A QR code should contain
an opaque identifier or signed/unguessable token that the backend
resolves.

### 3.5 Staff item-carrying QR

Each staff member has a workflow to register which items and quantities
they are carrying.

Recommended flow:

1.  Staff signs in.
2.  Staff opens the "My carried items" workflow.
3.  Staff scans the item-carrying QR associated with an item/batch or
    opens the relevant item from their authorised list.
4.  Website validates the QR and staff permissions.
5.  Staff confirms the item and quantity being taken.
6.  Backend records a stock movement or staff-custody movement.
7.  Staff dashboard shows the current carried-item list.

The QR must not silently change inventory. Require a confirmation step
before committing a stock movement. Prevent duplicate submissions with
idempotency protection.

### 3.6 Staff compartment-location QR

A compartment QR identifies a compartment. An authenticated staff member
scans it to report their current location.

Recommended flow:

1.  Staff signs in.
2.  Staff scans the compartment QR displayed for the compartment.
3.  Website validates the QR and service context.
4.  Staff confirms the location update.
5.  Backend records staff, service, compartment, and timestamp.
6.  Admin dashboard shows the latest reported location and the time it
    was updated.

This is a staff-reported location, not GPS tracking. Display it as "Last
reported location" with a timestamp. Do not claim continuous or live GPS
tracking unless a separate, consent-based location feature is designed
and implemented.

### 3.7 Admin operations dashboard

The admin dashboard should provide a useful operational summary, not
just decorative charts.

Suggested widgets:

-   Active service/train
-   Total requests
-   Requests awaiting assignment
-   Requests in progress
-   Completed requests
-   Low-stock products
-   Out-of-stock products
-   Active staff
-   Staff last-reported locations
-   Staff carried-item summaries
-   Compartment-wise demand
-   Recent stock movements

Every dashboard number must come from actual persisted data. Clearly
label demo/seed data in development environments.

------------------------------------------------------------------------

## 4. QR Code System --- Critical Requirement

QR generation and scanning are core product functionality. They must not
be placeholders.

### 4.1 QR code types

  ----------------------------------------------------------------------------
  QR type                Created/managed   Purpose           Expected website
                         by                                  action
  ---------------------- ----------------- ----------------- -----------------
  Passenger compartment  Admin             Identifies        Opens passenger
  QR                                       service and       catalogue for
                                           compartment       that compartment

  Staff                  Admin             Links a staff     Requires
  identity/onboarding                      member to a       authentication or
  QR, if used                              controlled        a one-time secure
                                           onboarding flow   claim process

  Item-carrying QR       Admin/system      Identifies an     Opens
                                           item, item batch, authenticated
                                           or authorised     item-carrying
                                           item workflow     workflow

  Compartment-location   Admin             Identifies a      Opens
  QR                                       compartment       authenticated
                                                             staff
                                                             location-update
                                                             workflow
  ----------------------------------------------------------------------------

The passenger compartment QR and staff compartment-location QR may
represent the same compartment record, but must open role-appropriate
workflows after authentication/role checks.

### 4.2 QR generation requirements

-   Generate QR codes inside the admin website using a maintained QR
    library.
-   Save the QR record and its relationship to the relevant service,
    compartment, item, or staff workflow in the database.
-   Display a preview and useful label before printing.
-   Support download/print for authorised admins.
-   Support revocation and regeneration.
-   Use opaque random tokens or signed identifiers; never encode
    passwords or private staff data.
-   Avoid sequential, guessable identifiers as the only security
    control.
-   Store only a hash of bearer tokens where practical; show the raw
    token only at creation time if the design requires it.
-   Apply expiry and revocation rules where appropriate.
-   Keep a QR audit trail: created by, created at, type, target, status,
    revoked at, and reason.
-   Regeneration must invalidate the previous token where appropriate.

### 4.3 QR scanning requirements

-   Scanning must happen inside the website using the device camera and
    a browser-compatible scanning library.
-   The browser must request camera permission transparently.
-   Camera scanning generally requires HTTPS in production (localhost is
    commonly permitted for development).
-   Provide a manual code-entry fallback if camera access is denied or
    unavailable.
-   Validate every scanned value through the backend. Never trust QR
    contents solely because the frontend decoded them.
-   Show scanning, validating, success, invalid, expired, revoked,
    wrong-role, wrong-service, and network-error states.
-   Stop the camera stream when leaving the scanner or after a
    successful scan.
-   Prevent repeated scan submissions and duplicate stock movements.
-   Test on real Android and iOS devices and their supported browsers.
-   Do not redirect to external QR generator/scanner services. The QR
    may open this product's own website route.

### 4.4 Suggested internal URL pattern

Use stable, versioned routes such as:

-   `/p/:publicQrToken` --- passenger compartment entry
-   `/staff/scan` --- authenticated staff scanner
-   `/admin/qr-codes` --- QR administration

These are examples, not a requirement to expose database IDs. Tokens
must be random, revocable, and validated server-side. Do not put
sensitive data in URL query parameters.

### 4.5 QR acceptance tests

-   Valid passenger QR opens the correct service and compartment.
-   Invalid, expired, and revoked QR codes are rejected safely.
-   Passenger cannot use a staff-only workflow.
-   Staff cannot use admin-only functions.
-   A compartment QR resolves to the correct compartment.
-   Item QR resolves to the correct item/workflow.
-   Duplicate scans do not duplicate stock movements.
-   Camera denial leads to a usable manual fallback.
-   Regeneration invalidates the old QR according to policy.
-   QR scanning works on real mobile browsers over HTTPS.

------------------------------------------------------------------------

## 5. Request and Fulfilment Workflow

Use explicit request statuses and permitted transitions. Do not let
clients submit arbitrary status strings.

Suggested statuses:

1.  `submitted`
2.  `confirmed` (if a confirmation step is needed)
3.  `assigned`
4.  `in_progress`
5.  `delivered`
6.  `cancelled`
7.  `unable_to_fulfil`

A request may move only through valid transitions. Record who made each
transition and when.

**Suggested operational sequence**

1.  Passenger submits request.
2.  Backend validates service, compartment, products, quantities, and
    stock policy.
3.  Request is persisted.
4.  Admin sees the request in the compartment-wise queue.
5.  Admin assigns it to an available staff member or groups work by
    compartment.
6.  Staff sees the assignment.
7.  Staff collects/carries the relevant products and confirms
    quantities.
8.  Staff visits the compartment and reports location using the
    compartment QR.
9.  Staff fulfils the request and records actual delivered quantities.
10. Backend commits stock/sales movement atomically.
11. Passenger and admin views show the updated status.

Do not assume a staff member is physically present just because an old
location report exists. Show the report timestamp.

------------------------------------------------------------------------

## 6. UI/UX and Visual Design Requirements

### 6.1 Overall visual direction

-   Professional railway operations identity.
-   Colourful, welcoming passenger experience.
-   Clear visual hierarchy and high contrast.
-   Consistent design tokens for colour, spacing, typography, radii, and
    shadows.
-   Use railway-inspired visual cues carefully; avoid clutter and
    excessive decorative graphics.
-   Use a distinct layout for each role while keeping the brand
    consistent.

### 6.2 Responsive behaviour

Design mobile-first, then scale up.

**Mobile** - Passenger flow must be excellent on small screens. - Use a
compact header and clear navigation. - Use bottom navigation where it
improves usability. - Use full-width primary actions and touch-friendly
controls. - Avoid wide tables; convert them to cards or horizontally
manageable layouts. - Scanner should fit the viewport and provide clear
camera guidance.

**Tablet** - Use adaptive grids and collapsible navigation. - Keep
admin/staff operational actions accessible.

**Desktop** - Use a sidebar for admin navigation. - Use data tables
where they improve operational efficiency. - Use dashboard cards and
split views for queues and detail panels.

### 6.3 Colour and animation

-   Use a vibrant but disciplined palette. Define semantic colours for
    success, warning, error, information, and neutral states.
-   Use hover states for mouse users and pressed/focus states for touch
    and keyboard users.
-   Add subtle transitions to cards, buttons, menus, status changes, and
    page navigation.
-   Use purposeful loading skeletons and scan feedback animations.
-   Avoid excessive motion, flashing, or animation that delays essential
    tasks.
-   Respect `prefers-reduced-motion`.
-   Never make hover the only way to reveal important information.

### 6.4 Accessibility

-   Use semantic HTML and accessible labels.
-   Ensure keyboard navigation and visible focus states.
-   Maintain sufficient text/background contrast.
-   Do not communicate status using colour alone; include text/icons.
-   Provide accessible validation and error messages.
-   Make touch targets comfortably large.
-   Test important flows with keyboard navigation and screen-reader
    basics.

### 6.5 Required interface areas

**Passenger** - QR landing/service context - Product catalogue -
Category filter - Product detail or quantity selector - Request
summary - Request confirmation/status

**Staff** - Sign-in - Staff home - Assigned requests - Carried items -
Item-carrying QR scanner/confirmation - Compartment-location QR
scanner/confirmation - Request fulfilment

**Admin** - Sign-in - Overview dashboard - Services/trains -
Compartments - Product catalogue/categories - Daily/service inventory -
Staff management - QR code management - Request queue and compartment
aggregation - Staff assignment/location/carrying status - Stock
movements and adjustments - Audit log - Settings

------------------------------------------------------------------------

## 7. Suggested Technical Architecture

The final stack may be selected before implementation, but use a
maintainable, typed, production-minded architecture.

### 7.1 Recommended stack

A practical JavaScript/TypeScript stack:

-   **Frontend:** React + TypeScript + Vite
-   **Styling:** Tailwind CSS with reusable design components
-   **Backend:** Node.js + TypeScript + Express
-   **Database:** PostgreSQL
-   **ORM:** Prisma
-   **Authentication:** Secure server-managed sessions or short-lived
    access tokens with a carefully designed refresh/session strategy
-   **QR generation:** Maintained QR-code generation package
-   **QR scanning:** Maintained browser camera QR-scanning package
-   **Validation:** Zod or an equivalent schema validator
-   **API documentation:** OpenAPI/Swagger
-   **Testing:** Vitest/Jest, React Testing Library, Supertest, and
    Playwright
-   **Deployment:** HTTPS-enabled hosting for frontend and backend,
    managed PostgreSQL, environment-based secrets

This is a recommendation, not a requirement to install every package
immediately. Verify current package maintenance and compatibility before
choosing dependencies. Avoid unnecessary microservices for the first
version.

### 7.2 High-level architecture

``` mermaid
flowchart TD
    P[Passenger Mobile Web] --> FE[Responsive React Web App]
    S[Staff Mobile Web] --> FE
    A[Admin Web Dashboard] --> FE
    FE --> API[Backend API and RBAC]
    API --> QR[QR Validation Service]
    API --> REQ[Request and Assignment Service]
    API --> INV[Inventory Transaction Service]
    API --> STAFF[Staff and Location Service]
    QR --> DB[(PostgreSQL Database)]
    REQ --> DB
    INV --> DB
    STAFF --> DB
    API --> AUDIT[Audit Log]
    AUDIT --> DB
    API --> MEM[Memory Node: operational context/history]
    API --> GUARD[Guardrails Node: validation, security, error handling]
```

**Architecture requirements**

-   Keep business rules in the backend, not only in React components.
-   Use database transactions for stock changes and request fulfilment.
-   Keep QR validation in a dedicated backend service/module.
-   Centralise authentication, authorisation, and input validation.
-   Maintain an audit log for sensitive operations.
-   The Memory Node represents persisted operational history and
    context, not an uncontrolled AI memory store.
-   The Guardrails Node represents validation, permission checks,
    business-rule enforcement, safe error handling, and audit controls.
    It must not be merely a decorative box.
-   Do not add AI features unless a clearly defined use case justifies
    them. The core workflow must work without AI.

### 7.3 Suggested repository structure

``` text
smart-railway-pantry/
├── client/
│   ├── public/
│   └── src/
│       ├── app/
│       ├── assets/
│       ├── components/
│       ├── features/
│       │   ├── passenger/
│       │   ├── staff/
│       │   ├── admin/
│       │   ├── products/
│       │   ├── requests/
│       │   ├── inventory/
│       │   └── qr/
│       ├── hooks/
│       ├── lib/
│       ├── routes/
│       ├── services/
│       ├── styles/
│       ├── types/
│       └── main.tsx
├── server/
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── migrations/
│   │   └── seed.ts
│   └── src/
│       ├── config/
│       ├── middleware/
│       ├── modules/
│       │   ├── auth/
│       │   ├── users/
│       │   ├── services/
│       │   ├── compartments/
│       │   ├── products/
│       │   ├── inventory/
│       │   ├── qr/
│       │   ├── requests/
│       │   ├── assignments/
│       │   ├── staff-location/
│       │   └── audit/
│       ├── shared/
│       ├── app.ts
│       └── server.ts
├── docs/
│   ├── API.md
│   ├── DATABASE.md
│   ├── SECURITY.md
│   └── TESTING.md
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

Adjust the structure if the chosen tooling requires it, but keep modules
separated by business responsibility.

------------------------------------------------------------------------

## 8. Database Design --- Initial Entity Blueprint

Use PostgreSQL foreign keys, constraints, indexes, and migrations. This
is an initial logical model; final columns and relationships must be
reviewed before migrations are committed.

  ------------------------------------------------------------------------
  Entity                   Purpose                 Important
                                                   fields/relationships
  ------------------------ ----------------------- -----------------------
  `User`                   Login identity          id, email/username,
                                                   password hash or
                                                   identity provider,
                                                   role, active status

  `StaffProfile`           Staff operational       user id, staff code,
                           profile                 display name, active
                                                   status

  `TrainService`           A train/service run     id, train/service
                                                   number, service date,
                                                   status

  `Compartment`            Compartment within a    id, train/service
                           service/train           reference, code/name

  `ProductCategory`        Product grouping        id, name, active status

  `Product`                Master product          id, category id, name,
                           catalogue               description, image,
                                                   price, active status

  `ServiceInventory`       Product stock for a     service id, product id,
                           service                 opening qty,
                                                   adjustments,
                                                   sold/reserved
                                                   quantities

  `QrCode`                 QR metadata and token   id, type, target
                           hash                    reference, token hash,
                                                   status, expiry, created
                                                   by

  `PassengerRequest`       Passenger request       id, service id,
                           header                  compartment id, public
                                                   reference, status,
                                                   created at

  `RequestItem`            Requested product lines request id, product id,
                                                   quantity, unit price
                                                   snapshot

  `StaffAssignment`        Staff-to-request/task   staff id, request/task
                           assignment              id, assigned by, status

  `StaffLocationReport`    Last and historical     staff id, service id,
                           reported location       compartment id,
                                                   reported at

  `StaffCarriedItem`       Items currently carried staff id, service id,
                           by staff                product id, quantity,
                                                   status

  `InventoryMovement`      Stock ledger            service id, product id,
                                                   movement type,
                                                   quantity, reference,
                                                   actor, timestamp

  `RequestStatusHistory`   Request transition      request id, old status,
                           history                 new status, actor,
                                                   timestamp

  `AuditLog`               Sensitive/admin         actor, action, entity,
                           activity                entity id, timestamp,
                                                   safe metadata
  ------------------------------------------------------------------------

### 8.1 Data integrity rules

-   Use integer quantities for countable products unless fractional
    quantities are a real requirement.
-   Store currency as integer minor units (for example, paise) or a
    suitable fixed-precision decimal; never use floating-point
    arithmetic for money.
-   Snapshot the agreed unit price on each request line so later
    catalogue price changes do not rewrite historical orders.
-   Use unique constraints for service/compartment codes where
    appropriate.
-   Use foreign keys and database constraints.
-   Use transactions for multi-record operations.
-   Add indexes for service, compartment, status, product, staff, and
    created-at queries.
-   Store timestamps consistently in UTC and display them in the
    appropriate local timezone.
-   Define data retention and deletion rules before using real passenger
    or staff data.

------------------------------------------------------------------------

## 9. API Design --- Initial Route Map

All routes below are illustrative. Use consistent response formats,
validation, pagination, and error codes. Protect each route with
authentication and role checks as appropriate.

### Authentication

-   `POST /api/auth/login`
-   `POST /api/auth/logout`
-   `GET /api/auth/me`
-   `POST /api/auth/refresh` (only if using refresh-token architecture)

### Passenger and QR entry

-   `GET /api/public/qr/:token`
-   `GET /api/public/services/:serviceId/catalogue`
-   `POST /api/public/requests`
-   `GET /api/public/requests/:publicReference`

Public endpoints must reveal only the minimum information required.
Apply rate limiting and abuse controls.

### Admin --- services and compartments

-   `GET /api/admin/services`
-   `POST /api/admin/services`
-   `PATCH /api/admin/services/:id`
-   `GET /api/admin/services/:id/compartments`
-   `POST /api/admin/services/:id/compartments`

### Admin --- products and inventory

-   `GET /api/admin/products`
-   `POST /api/admin/products`
-   `PATCH /api/admin/products/:id`
-   `GET /api/admin/inventory`
-   `POST /api/admin/inventory/opening-stock`
-   `POST /api/admin/inventory/adjustments`
-   `GET /api/admin/inventory/movements`

### Admin --- staff

-   `GET /api/admin/staff`
-   `POST /api/admin/staff`
-   `PATCH /api/admin/staff/:id`
-   `POST /api/admin/staff/:id/assignments`

### QR management and scanning

-   `POST /api/admin/qr-codes`
-   `GET /api/admin/qr-codes`
-   `POST /api/admin/qr-codes/:id/revoke`
-   `POST /api/admin/qr-codes/:id/regenerate`
-   `POST /api/qr/validate`

### Requests and assignments

-   `GET /api/admin/requests`
-   `GET /api/admin/requests/aggregation`
-   `PATCH /api/admin/requests/:id/status`
-   `POST /api/admin/requests/:id/assign`
-   `GET /api/staff/assignments`
-   `POST /api/staff/requests/:id/fulfil`

### Staff QR workflows

-   `GET /api/staff/carried-items`
-   `POST /api/staff/carried-items/confirm`
-   `POST /api/staff/location-reports`

Do not implement all routes at once. Build and test them in vertical
slices, beginning with authentication, services/compartments, catalogue,
passenger QR entry, and request creation.

------------------------------------------------------------------------

## 10. Security, Privacy, and Reliability

Security is part of the implementation, not a final polish task.

### Authentication and authorisation

-   Hash passwords using a modern password-hashing algorithm and safe
    parameters.
-   Never store plaintext passwords.
-   Use secure, HTTP-only, SameSite cookies if using cookie-based
    sessions.
-   Protect against CSRF where relevant.
-   Apply role and resource-level checks on every protected endpoint.
-   Rate-limit login, public QR lookup, and request creation endpoints.
-   Add account deactivation and session revocation.

### QR security

-   Use random, high-entropy tokens or signed tokens with appropriate
    expiry.
-   Store token hashes where feasible.
-   Support revocation and rotation.
-   Do not encode personal details, credentials, or sensitive data.
-   Validate token status, type, target, expiry, service, and actor
    permissions on the backend.
-   Do not treat possession of a compartment QR as permission to access
    staff/admin functions.

### Inventory and concurrency

-   Use atomic database transactions and suitable row locking or
    conditional updates.
-   Ensure two simultaneous requests cannot consume the same final stock
    unit.
-   Make fulfilment and stock movement idempotent.
-   Keep an append-only or carefully controlled inventory movement
    history.
-   Never trust quantities supplied by the browser without server
    validation.

### General application security

-   Validate and sanitise input on the server.
-   Use parameterised database access through the ORM.
-   Restrict file upload types and sizes; store uploads safely.
-   Keep secrets in environment variables or a secrets manager.
-   Do not commit `.env` files or credentials.
-   Use HTTPS in production.
-   Avoid returning stack traces or internal details to users.
-   Log security-relevant events without logging passwords, raw QR
    tokens, or unnecessary personal data.
-   Back up the database and document restore procedures.

------------------------------------------------------------------------

## 11. Error Handling and User Feedback

Every workflow must handle failure clearly.

Required states include:

-   Loading
-   Empty data
-   Success
-   Validation error
-   Unauthorised
-   Forbidden
-   Not found
-   QR invalid/expired/revoked
-   Camera unavailable/permission denied
-   Network unavailable
-   Product out of stock
-   Insufficient stock
-   Duplicate submission
-   Conflict caused by concurrent updates
-   Unexpected server error

Use friendly messages for users and structured diagnostic logs for
developers. Never show raw database errors or stack traces in the
interface.

------------------------------------------------------------------------

## 12. Testing Strategy and Definition of Done

A feature is not complete because its page renders. It is complete when
its business workflow works and is tested.

### 12.1 Unit tests

Test: - Role/permission rules - QR token validation - Request status
transitions - Quantity and price validation - Inventory calculation -
Stock adjustment rules - Aggregation logic - Idempotency behaviour

### 12.2 Integration tests

Test: - Login and role-protected routes - Admin product creation and
service stock setup - QR generation and backend validation - Passenger
request creation - Compartment-wise aggregation - Staff assignment -
Staff location report - Staff carried-item confirmation - Fulfilment and
stock ledger update - QR revocation/regeneration

### 12.3 End-to-end tests

Use a browser automation tool to test complete user journeys.

**Passenger journey** 1. Open a valid compartment QR URL. 2. Confirm the
correct compartment is shown. 3. Browse products. 4. Submit a request.
5. Confirm a request reference is displayed. 6. Confirm the admin queue
receives the request.

**Admin journey** 1. Sign in as admin. 2. Create a service and
compartments. 3. Add products and opening stock. 4. Register staff. 5.
Generate compartment and item QR codes. 6. View aggregated demand. 7.
Assign work to staff. 8. Review inventory and audit history.

**Staff journey** 1. Sign in as staff. 2. View assignments. 3. Confirm
carried items. 4. Scan a compartment QR and report location. 5. Fulfil a
request. 6. Confirm the correct stock movement and request status.

**Security and edge cases** - Passenger tries to access admin route. -
Staff tries to access another staff member's restricted data. -
Invalid/revoked/expired QR scan. - Repeated scan or repeated submit. -
Two users request the last available item simultaneously. - Camera
permission denied. - Network interruption during submission. - Product
is deactivated after being displayed. - Staff account is deactivated
while a session exists.

### 12.4 Acceptance criteria

The first release is not ready until:

-   [ ] Passenger pages work well on common mobile screen sizes.
-   [ ] Staff and admin pages are responsive on mobile, tablet, and
    desktop.
-   [ ] Admin can create products, categories, services, compartments,
    staff, and stock records.
-   [ ] Admin can generate, preview, print/download, revoke, and
    regenerate QR codes.
-   [ ] QR scanning works inside the website on supported mobile
    browsers over HTTPS.
-   [ ] Manual QR entry works when camera access is unavailable.
-   [ ] QR validation is performed by the backend.
-   [ ] Passenger QR resolves the correct service and compartment.
-   [ ] Passenger can submit a request from the predefined catalogue.
-   [ ] Requests are stored and aggregated by compartment without losing
    individual request records.
-   [ ] Admin can assign work to staff.
-   [ ] Staff can register carried items and report compartment
    location.
-   [ ] Staff can complete assigned work using authorised status
    transitions.
-   [ ] Inventory movements and remaining stock are accurate.
-   [ ] Concurrent requests cannot oversell stock.
-   [ ] Role-based access is enforced by the backend.
-   [ ] Audit history exists for sensitive operations.
-   [ ] Loading, empty, success, and error states are implemented.
-   [ ] Automated tests cover the critical workflows.
-   [ ] No critical secrets or credentials are committed to source
    control.

------------------------------------------------------------------------

## 13. Development Roadmap

Build in small, testable milestones. Do not ask an AI coding agent to
generate the entire system in one pass.

### Phase 0 --- Project foundation

-   Confirm final stack and deployment target.
-   Create repository and client/server structure.
-   Configure TypeScript, linting, formatting, environment variables,
    and error handling.
-   Set up PostgreSQL and Prisma migrations.
-   Create a useful README and development instructions.

**Exit condition:** Client and server start locally; database connection
and first migration work.

### Phase 1 --- Authentication and role foundations

-   Implement login/logout/session handling.
-   Create role model and protected routes.
-   Add secure initial admin creation.
-   Add backend permission middleware and tests.

**Exit condition:** Passenger, staff, and admin access boundaries are
verified.

### Phase 2 --- Services, compartments, products, and inventory

-   Admin creates services and compartments.
-   Admin manages categories and products.
-   Admin configures service-specific opening stock.
-   Implement inventory ledger and atomic stock operations.

**Exit condition:** Admin can set up a service and accurate opening
inventory.

### Phase 3 --- QR generation and passenger request journey

-   Implement QR records and token security.
-   Build admin QR management.
-   Build passenger QR landing route.
-   Build responsive catalogue and request flow.
-   Persist requests and display compartment aggregation.

**Exit condition:** A real generated QR can be scanned/opened and used
to create a database-backed request.

### Phase 4 --- Staff workflows

-   Implement staff management and assignments.
-   Implement item-carrying QR workflow.
-   Implement compartment-location QR workflow.
-   Implement request fulfilment and inventory movements.

**Exit condition:** Staff can complete a request and the system records
the correct stock and location events.

### Phase 5 --- Admin operations and reporting

-   Build operational dashboard.
-   Add request filters, staff status, stock alerts, audit history, and
    reports.
-   Add pagination and performance improvements.

**Exit condition:** Admin can coordinate a service using real persisted
data.

### Phase 6 --- Quality, security, and deployment

-   Complete automated tests.
-   Test mobile camera scanning on real devices.
-   Perform accessibility and responsive checks.
-   Review permissions, QR security, concurrency, backups, and logging.
-   Deploy with HTTPS and production environment configuration.

**Exit condition:** Critical acceptance criteria pass in a
production-like environment.

------------------------------------------------------------------------

## 14. Working with Codex --- Project Rules

Use this section as the standing instruction for an AI coding agent
working in this repository.

### 14.1 General rules

1.  Read this document and the existing repository before changing code.
2.  Inspect the current architecture and package versions; do not assume
    files or dependencies exist.
3.  Work on one milestone or vertical slice at a time.
4.  Before implementing, explain the intended files, data flow, and any
    schema/API changes.
5.  Prefer small, maintainable changes over large rewrites.
6.  Reuse existing components and patterns when they are sound.
7.  Do not replace working code merely to impose a personal preference.
8.  Do not invent successful API responses or use fake data in
    production paths.
9.  Clearly label seed/demo data and keep it out of production.
10. Do not leave placeholder buttons, fake QR scanners, hardcoded scan
    results, or nonfunctional interactions.
11. Do not silently skip validation, authorisation, tests, or error
    states.
12. Update documentation when routes, environment variables, database
    models, or workflows change.

### 14.2 Before marking a task complete

-   Run the relevant formatter and linter.
-   Run type checks.
-   Run relevant unit/integration tests.
-   Add tests for new business logic and bug fixes.
-   Review mobile responsiveness for changed screens.
-   Check loading, empty, success, and failure states.
-   Check backend permissions for new endpoints.
-   Check database transaction and concurrency behaviour for stock
    changes.
-   Summarise files changed, commands run, test results, and known
    limitations.

### 14.3 Never do these

-   Never hardcode production credentials, secrets, QR tokens, or
    personal information.
-   Never trust a role, price, quantity, status, or QR target supplied
    by the client without backend validation.
-   Never update inventory only in frontend state.
-   Never decrement stock twice for the same fulfilment.
-   Never expose private staff details through QR payloads or public
    APIs.
-   Never claim camera scanning works without testing the actual scanner
    flow.
-   Never claim a feature is complete when only its UI exists.
-   Never remove tests to make a build pass.
-   Never use an external QR-scanner website as a substitute for the
    in-app scanner.

### 14.4 Recommended task prompt format

For each Codex task, provide:

-   **Goal:** One clearly defined outcome.
-   **Current context:** Relevant files, modules, and existing
    behaviour.
-   **Requirements:** Exact user and business rules.
-   **Constraints:** Security, mobile, architecture, and compatibility
    requirements.
-   **Acceptance criteria:** Observable behaviours that must pass.
-   **Verification:** Tests and commands to run.

Ask Codex to inspect first, propose a plan, implement the smallest
complete slice, test it, and report what remains.

------------------------------------------------------------------------

## 15. First Task to Give Codex

Start with repository inspection and project setup only. Do not build
all screens and features in the first task.

**Suggested first prompt:**

> Read `PROJECT_SPEC.md` completely before making changes. Inspect the
> repository and report its current structure, existing code, installed
> tooling, and any issues. Do not overwrite existing work.
>
> Propose a practical implementation plan for Phase 0 of the Smart
> Railway Pantry project using a maintainable React + TypeScript
> frontend, Node.js + TypeScript + Express backend, PostgreSQL, and
> Prisma, unless the existing repository gives a strong reason to adjust
> the stack.
>
> After presenting the plan, implement only the Phase 0 foundation:
> client/server setup, environment configuration, database connection,
> Prisma initial setup, linting/formatting, health-check endpoint, and
> README development instructions.
>
> Add `.env.example` with placeholders only. Never create or commit real
> secrets. Do not build fake QR scanning, fake dashboards, or
> placeholder business features. Run the available checks and report the
> exact commands and results. Stop after Phase 0.

------------------------------------------------------------------------

## 16. Decisions to Confirm Before Production

These are product decisions that should be discussed with the project
guide/railway stakeholders. Use sensible development defaults, but do
not represent assumptions as confirmed railway policy.

1.  Is the application for a single train, a train operator, or multiple
    railway services?
2.  Who is authorised to create the first administrator?
3.  Will passengers submit a request only, or will online payment be
    required?
4.  Is payment collected by pantry staff, through a gateway, or through
    another approved process?
5.  Does a passenger request reserve stock immediately, or is stock
    committed when staff confirms/fulfils it?
6.  Can one request be split between multiple staff members?
7.  What is the approved process when an item is unavailable after a
    request is submitted?
8.  How long should passenger request references and staff location
    history be retained?
9.  What staff details are genuinely required for operations?
10. Who is authorised to print and place compartment QR codes, and how
    are damaged/replaced codes revoked?
11. What happens when internet connectivity is unavailable inside a
    train?
12. What operational rules, railway approvals, privacy requirements, and
    security policies apply to a real deployment?

### Offline connectivity note

The first release should be designed for reliable online operation.
Train connectivity can be intermittent. Do not claim offline request
submission or offline stock synchronisation unless it is deliberately
designed and tested. A future offline mode needs conflict handling,
secure local storage, retry queues, duplicate prevention, and
server-side reconciliation.

------------------------------------------------------------------------

## 17. Final Product Standard

The finished system should demonstrate all of the following:

-   A passenger can scan a real compartment QR using a phone and submit
    a request.
-   The admin can create the products, stock, staff, services,
    compartments, and QR codes needed for the operation.
-   The admin can see requests grouped by compartment while retaining
    each individual request.
-   Staff can authenticate, register carried items, report their
    compartment using a QR scan, and fulfil assigned requests.
-   The backend validates every important action and maintains accurate
    stock.
-   The application is attractive, colourful, accessible, and responsive
    without sacrificing clarity or performance.
-   The critical flows are covered by automated tests and verified on
    real mobile devices.
-   The codebase is documented, secure by design, and maintainable by
    another developer.

**Build the operational system first, then improve the visual polish.
Every screen must be connected to a real workflow, every important
action must be validated by the backend, and every stock change must be
traceable.**
