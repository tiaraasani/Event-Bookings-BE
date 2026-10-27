# Backend Test Scenarios

Integration tests for the Event Management Platform API. Every scenario below is implemented as an `it(...)` in the spec file named in the table, using the same convention the first specs introduced: one spec file per endpoint, scenario titles start with "should", and each test arranges its own data, calls the endpoint through `supertest`, then asserts the HTTP response and the database state.

- Runner: `npm run test:integration` (vitest, one worker).
- Database: a dedicated local PostgreSQL database set in `.env.test` (see `.env.test.example`). The global setup resets it with `prisma migrate reset`, and every test starts with all tables truncated.
- External services are mocked: Cloudinary (`src/lib/cloudinary`) and email (`src/lib/mail`).
- Totals: 36 spec files, 556 tests.

Scenario IDs use the pattern `<module>-<endpoint>-<n>`.

## Common scenarios

These scenarios repeat on every protected endpoint and are listed once here. Each spec file includes the ones that apply.

| ID | Scenario | Expected |
|---|---|---|
| COMMON-1 | should return 401 when no token is provided | 401 `Token not provided` |
| COMMON-2 | should return 401 for an invalid token | 401 `Invalid token` |
| COMMON-3 | should return 401 for an expired token | 401 `Token expired` |
| COMMON-4 | should return 401 when the authorization header lacks the Bearer scheme | 401 |
| COMMON-5 | should return 403 when the authenticated user has the wrong role | 403 `Forbidden` (voucher routes: `Only organizers can manage vouchers`) |
| COMMON-6 | should return 404 when the organizer has no organization | 404 `Organization not found` |
| COMMON-7 | should work with a token obtained from the login endpoint | 200 |
| COMMON-8 | should not expose credentials or private fields (password hash, organization owner data) | fields absent from the response |

## Auth

### POST /auth/register — `auth/register.spec.ts`

| ID | Scenario | Expected |
|---|---|---|
| AUTH-REG-1 | should register a customer successfully | 201, user saved with hashed password and a referral code |
| AUTH-REG-2 | should register an organizer with an organization | 201, organization row created |
| AUTH-REG-3 | should use the user name as organization name when not provided | organization name = user name |
| AUTH-REG-4 | should register with a valid referral code and reward the referrer | referrer gets 10,000 points, new user gets a coupon, both valid 3 months |
| AUTH-REG-5 | should return error when email is already registered | 400 `Email already exists` |
| AUTH-REG-6 | should return error when referral code is invalid | 400 `Invalid referral code` |
| AUTH-REG-7 | should return error when required fields are missing | 400 |
| AUTH-REG-8 | should return error when name is too short | 400 |
| AUTH-REG-9 | should return error when email format is invalid | 400 |
| AUTH-REG-10 | should return error when password is too short | 400 |
| AUTH-REG-11 | should return error when role is invalid | 400 |
| AUTH-REG-12 | should return error when organization name is too short | 400 |
| AUTH-REG-13 | should reject unknown fields | 400 |
| AUTH-REG-14 | should accept boundary values for name and password | 201 |

### POST /auth/login — `auth/login.spec.ts`

| ID | Scenario | Expected |
|---|---|---|
| AUTH-LOGIN-1 | should login successfully | 200, `accessToken` + user |
| AUTH-LOGIN-2 | should login an organizer and return their profile | 200 with organization |
| AUTH-LOGIN-3 | should return error when email does not exist | 400 `Invalid email or password` |
| AUTH-LOGIN-4 | should return error when password is wrong | 400 `Invalid email or password` |
| AUTH-LOGIN-5 | should treat the password as case-sensitive | 400 |
| AUTH-LOGIN-6 | should return error when email format is invalid | 400 |
| AUTH-LOGIN-7 | should return error when email is empty | 400 |
| AUTH-LOGIN-8 | should return error when password is empty | 400 |
| AUTH-LOGIN-9 | should return error when credentials are missing | 400 |
| AUTH-LOGIN-10 | should return error when email and password are not strings | 400 |
| AUTH-LOGIN-11 | should ignore extra fields such as role when logging in | 200, role unchanged |
| AUTH-LOGIN-12 | should return a JWT containing the user id and role | payload `{ id, role }` |
| AUTH-LOGIN-13 | should allow access to a protected route with the returned token | 200 |

### GET /auth/me — `auth/me.spec.ts`

| ID | Scenario | Expected |
|---|---|---|
| AUTH-ME-1 | should return the id and role stored in the token | `{ id, role }` |
| AUTH-ME-2 | should return the organizer role for an organizer token | role ORGANIZER |
| AUTH-ME-3 | should not expose the password or other profile fields | only token payload |
| AUTH-ME-4 | should return 401 for a token signed with the reset secret | 401 `Invalid token` |
| | COMMON-1, 2, 3, 4, 7 | |

### POST /auth/forgot-password — `auth/forgot-password.spec.ts`

| ID | Scenario | Expected |
|---|---|---|
| AUTH-FORGOT-1 | should send a reset link to a registered user | `sendMail` called once with the reset link |
| AUTH-FORGOT-2 | should issue a reset token for the user that expires in 15 minutes | token signed with `JWT_SECRET_RESET`, exp = 15 min |
| AUTH-FORGOT-3 | should not send an email when the email is not registered | `sendMail` not called |
| AUTH-FORGOT-4 | should return an identical response whether or not the email is registered | same 200 body (no account enumeration) |
| AUTH-FORGOT-5 | should ignore extra fields and only email the requested recipient | one email to the given address |
| AUTH-FORGOT-6 | should reject a request with a missing / empty / malformed / non-string email | 400, no email sent |
| AUTH-FORGOT-7 | should allow the emailed token to reset the user's password | reset succeeds, login works with the new password |
| AUTH-FORGOT-8 | should not accept a reset token as a login token | 401 `Invalid token` |
| AUTH-FORGOT-9 | should not accept a login token for resetting the password | 401 `Invalid token`, password unchanged |

### POST /auth/reset-password — `auth/reset-password.spec.ts`

| ID | Scenario | Expected |
|---|---|---|
| AUTH-RESET-1 | should reset the password with a valid reset token | 200, new hash stored |
| AUTH-RESET-2 | should allow login with the new password and reject the old password | 200 then 400 |
| AUTH-RESET-3 | should only change the password and keep the rest of the profile intact | name, email, role unchanged |
| AUTH-RESET-4 | should reject a request without a token | 401 |
| AUTH-RESET-5 | should reject an authorization header without the Bearer scheme | 401 |
| AUTH-RESET-6 | should reject a malformed token | 401 |
| AUTH-RESET-7 | should reject an expired reset token | 401 `Token expired` |
| AUTH-RESET-8 | should reject a login token | 401 |
| AUTH-RESET-9 | should reject a token signed with the wrong secret | 401 |
| AUTH-RESET-10 | should return not found when the token belongs to a non-existent user | 404 |
| AUTH-RESET-11 | should only update the user referenced by the token | other users untouched |
| AUTH-RESET-12 | should accept a password with exactly six characters | 200 |
| AUTH-RESET-13 | should reject a missing / empty / too short / non-string password | 400, password unchanged |
| AUTH-RESET-14 | should check the token before validating the password | 401 even with an empty body |

## Event

### POST /events — `event/create-event.spec.ts`

| ID | Scenario | Expected |
|---|---|---|
| EVENT-CREATE-1 | should create an event with its tickets | 201, event + tickets saved |
| EVENT-CREATE-2 | should create the event for the authenticated organizer's organization | `organizationId` from the token |
| EVENT-CREATE-3 | should create a new category from customCategory | new category row |
| EVENT-CREATE-4 | should reuse an existing category when customCategory matches | no duplicate category |
| EVENT-CREATE-5 | should accept a multipart/form-data payload | 201 with image upload mocked |
| EVENT-CREATE-6 | should accept an ONLINE event without an image | 201 |
| EVENT-CREATE-7 | should set availableQuantity equal to the requested quantity | `availableQuantity === quantity` |
| EVENT-CREATE-8 | should return 400 when no category is provided | 400 |
| EVENT-CREATE-9 | should return 400 when the end date is not after the start date | 400 |
| EVENT-CREATE-10 | should return 400 when required fields are missing | 400 |
| EVENT-CREATE-11 | should return 400 for invalid tickets (empty list, negative price, zero quantity, …) | 400 |
| EVENT-CREATE-12 | should return 400 when the event name is too short | 400 |
| | COMMON-1, 2, 5, 6, 8 | |

### GET /events — `event/get-events.spec.ts`

| ID | Scenario | Expected |
|---|---|---|
| EVENT-LIST-1 | should return active events with their category, organization and tickets | 200 |
| EVENT-LIST-2 | should exclude soft-deleted events | deleted event absent |
| EVENT-LIST-3 | should order events by start date ascending | sorted |
| EVENT-LIST-4 | should return an empty list when there are no events | `[]` |
| EVENT-LIST-5 | should be publicly accessible without a token | 200 |
| | COMMON-8 | |

### GET /events/:id — `event/get-event-by-id.spec.ts`

| ID | Scenario | Expected |
|---|---|---|
| EVENT-GET-1 | should return the event with its category, organization and tickets | 200 |
| EVENT-GET-2 | should return only the requested event | no other event data |
| EVENT-GET-3 | should return 404 when the event is soft-deleted | 404 |
| EVENT-GET-4 | should return 404 when the event does not exist | 404 |
| EVENT-GET-5 | should be publicly accessible without a valid token | 200 |
| EVENT-GET-6 | should return 400 for a non-numeric / zero / negative event id | 400 `Invalid event ID` |
| | COMMON-8 | |

### GET /events/my — `event/get-my-events.spec.ts`

| ID | Scenario | Expected |
|---|---|---|
| EVENT-MY-1 | should return the organizer's events with their category, organization and tickets | 200 |
| EVENT-MY-2 | should only return events that belong to the authenticated organizer | other organizers' events absent |
| EVENT-MY-3 | should exclude soft-deleted events | deleted event absent |
| EVENT-MY-4 | should order events by start date ascending | sorted |
| EVENT-MY-5 | should return an empty list when the organizer has no events | `[]` |
| EVENT-MY-6 | should return an empty list when the organizer has no organization | `[]` |
| | COMMON-1, 2, 3, 4, 5, 7, 8 | |

### PATCH /events/:id — `event/update-event.spec.ts`

| ID | Scenario | Expected |
|---|---|---|
| EVENT-UPDATE-1 | should update a single field and preserve the rest | only that field changes |
| EVENT-UPDATE-2 | should update multiple fields including the category | all applied |
| EVENT-UPDATE-3 | should update one date without changing the other date | other date intact |
| EVENT-UPDATE-4 | should not modify other events | other rows untouched |
| EVENT-UPDATE-5 | should ignore attempts to change the organization or tickets | fields ignored |
| EVENT-UPDATE-6 | should return 404 when the event does not exist | 404 |
| EVENT-UPDATE-7 | should return 404 when the event belongs to another organizer | 404 |
| EVENT-UPDATE-8 | should return 404 when the event is soft-deleted | 404 |
| EVENT-UPDATE-9 | should return 400 for a non-numeric / zero / negative event id | 400 `Invalid event ID` |
| EVENT-UPDATE-10 | should return 400 when no fields are provided | 400 `At least one field must be provided` |
| EVENT-UPDATE-11 | should return 400 when the event name is too short | 400 |
| EVENT-UPDATE-12 | should return 400 when the city is too short | 400 |
| EVENT-UPDATE-13 | should return 400 when the event type is invalid | 400 |
| EVENT-UPDATE-14 | should return 400 for a zero / negative / non-numeric category id | 400 |
| EVENT-UPDATE-15 | should return 400 for an invalid startDate / endDate value | 400 |
| EVENT-UPDATE-16 | should return 400 when both dates would create an invalid range | 400 `endDate: End date must be after start date` |
| EVENT-UPDATE-17 | should return 400 when a single date change would invert the range | 400 |
| | COMMON-1, 2, 5, 6, 8 | |

### DELETE /events/:id — `event/delete-event.spec.ts`

| ID | Scenario | Expected |
|---|---|---|
| EVENT-DELETE-1 | should soft-delete an event and return a success message | `deletedAt` set |
| EVENT-DELETE-2 | should only delete the requested event | other events untouched |
| EVENT-DELETE-3 | should exclude the deleted event from public and organizer listings | absent from GET /events and GET /events/my |
| EVENT-DELETE-4 | should return 404 when the event is already soft-deleted | 404 |
| EVENT-DELETE-5 | should return 404 when the event does not exist | 404 |
| EVENT-DELETE-6 | should return 404 when the event belongs to another organizer | 404 |
| | COMMON-1, 2, 5, 6 | |

## Transaction

### POST /transactions — `transaction/create-transaction.spec.ts`

| ID | Scenario | Expected |
|---|---|---|
| TRX-CREATE-1 | should create a transaction for an available ticket | 201, status WAITING_FOR_PAYMENT, `expiresAt` = +2h, stock decremented |
| TRX-CREATE-2 | should create the transaction for the authenticated customer | `userId` from token |
| TRX-CREATE-3 | should apply a voucher discount and normalize the voucher code | discount applied, lowercase code accepted |
| TRX-CREATE-4 | should redeem points in expiry order and record point usages | soonest-expiring points used first, `PointUsage` rows created |
| TRX-CREATE-5 | should combine a voucher discount with points | `finalPrice = total - discount - points` |
| TRX-CREATE-6 | should allow points equal to the amount due after the voucher discount | `finalPrice = 0` |
| TRX-CREATE-7 | should ignore expired points and points with no balance | not deducted |
| TRX-CREATE-8 | should reserve the last ticket only once when two transactions race | one 201, one 400, stock never negative |
| TRX-CREATE-9 | should return 404 when the ticket does not exist | 404 |
| TRX-CREATE-10 | should return 404 when the event has been deleted | 404 |
| TRX-CREATE-11 | should return 400 when the event has already ended | 400 |
| TRX-CREATE-12 | should return 400 when there are not enough tickets available | 400 |
| TRX-CREATE-13 | should return 400 for an invalid voucher code | 400 |
| TRX-CREATE-14 | should return 400 when the voucher belongs to another event | 400 |
| TRX-CREATE-15 | should return 400 when the voucher has not started / has expired | 400 `This voucher is not currently valid` |
| TRX-CREATE-16 | should return 400 when the voucher has reached its quota | 400 `This voucher has reached its quota` |
| TRX-CREATE-17 | should return 400 when points exceed the total after the voucher discount | 400, points and stock untouched |
| TRX-CREATE-18 | should return 400 when the points balance is insufficient | 400 `Insufficient points balance` |
| TRX-CREATE-19 | should return 400 when ticketId / quantity is missing, zero, above the maximum, or pointsToUse is negative | 400, no order created |
| | COMMON-1, 2, 5 | |

### POST /transactions/:id/payment-proof — `transaction/update-transaction.spec.ts`

| ID | Scenario | Expected |
|---|---|---|
| TRX-PROOF-1 | should upload the payment proof and move the transaction to waiting for confirmation | 200, `paymentProofUrl` saved, status WAITING_FOR_CONFIRMATION |
| TRX-PROOF-2 | should only update the requested transaction | other orders untouched |
| TRX-PROOF-3 | should return 404 when the transaction does not exist | 404 |
| TRX-PROOF-4 | should return 404 when the transaction belongs to another customer | 404 |
| TRX-PROOF-5 | should return 400 when the transaction status is not WAITING_FOR_PAYMENT (each other status) | 400, upload not called |
| TRX-PROOF-6 | should return 400 when the payment deadline has passed or is missing | 400 `Payment deadline has expired` |
| TRX-PROOF-7 | should return 500 when no image is attached | 500 `Payment proof image is required` |
| TRX-PROOF-8 | should return 500 when the attached file is not an image | 500 `Only image files are allowed` |
| | COMMON-1, 2, 3, 5 | |

### GET /transactions/my — `transaction/get-transaction.spec.ts`

| ID | Scenario | Expected |
|---|---|---|
| TRX-MY-1 | should return the customer's transactions with their ticket, event, voucher and coupon details | 200 |
| TRX-MY-2 | should only return transactions that belong to the authenticated customer | others absent |
| TRX-MY-3 | should order transactions by creation date descending | newest first |
| TRX-MY-4 | should return the coupon attached to a transaction | coupon included |
| TRX-MY-5 | should return an empty list when the customer has no transactions | `[]` |
| | COMMON-1, 2, 3, 4, 5, 7 | |

### GET /transactions/my/points — `transaction/get-transaction.spec.ts`

| ID | Scenario | Expected |
|---|---|---|
| TRX-POINTS-1 | should return the total balance of usable points for the authenticated customer | sum of unexpired, positive points |
| TRX-POINTS-2 | should return a zero balance when the customer has no usable points | 0 |
| | COMMON-1, 2, 5 | |

### GET /transactions/:id — `transaction/get-transaction-by-id.spec.ts`

| ID | Scenario | Expected |
|---|---|---|
| TRX-GET-1 | should return the customer's transaction with its ticket, event, voucher, coupon and point usages | 200 |
| TRX-GET-2 | should return only the requested transaction | single object |
| TRX-GET-3 | should return 404 when the transaction belongs to another customer | 404 |
| TRX-GET-4 | should return 404 when the transaction does not exist | 404 |
| TRX-GET-5 | should still return the transaction when its event has been soft-deleted | 200 |
| TRX-GET-6 | should return 400 for a non-numeric / zero / negative transaction id | 400 `Invalid transaction ID` |
| | COMMON-1, 2, 3, 4, 5, 7, 8 | |

## Organizer

### Organizer creation — `organizer/create-organizer.spec.ts`

| ID | Scenario | Expected |
|---|---|---|
| ORG-CREATE-1 | should register an organizer with an organization and expose it through the organizer endpoint | register → GET /organizer/organization returns it |
| ORG-CREATE-2 | should use the organizer name when organizationName is not provided | organization name = user name |
| ORG-CREATE-3 | should not create an organization for a registered customer | no organization row |
| ORG-CREATE-4 | should not create an organizer when organizationName is too short | 400 |
| | COMMON-1, 2, 3, 5, 6 | |

### GET /organizer/organization — `organizer/get-organizer.spec.ts`

| ID | Scenario | Expected |
|---|---|---|
| ORG-GET-1 | should return the authenticated organizer's organization | `{ id, name }` |
| ORG-GET-2 | should only return the organization that belongs to the authenticated organizer | not another organizer's |
| | COMMON-1, 2, 3, 4, 5, 6, 7, 8 | |

### GET /organizer/transactions — `organizer/get-transactions.spec.ts`

| ID | Scenario | Expected |
|---|---|---|
| ORG-TRX-1 | should return the organizer's transactions with customer, ticket and event details, newest first | `{ data, meta }` |
| ORG-TRX-2 | should only return transactions of the authenticated organizer's events | others absent |
| ORG-TRX-3 | should paginate with page and take | `meta = { page, take, total }` |
| ORG-TRX-4 | should filter by payment status | only that status |
| ORG-TRX-5 | should ignore an unknown status value | unfiltered |
| ORG-TRX-6 | should filter by event id | only that event |
| ORG-TRX-7 | should search by customer name or email, case-insensitively | matching rows only |
| ORG-TRX-8 | should sort by the requested column and order | sorted |
| ORG-TRX-9 | should return an empty list when the organizer has no transactions | `[]`, total 0 |
| | COMMON-1, 2, 3, 5, 6, 8 | |

### PATCH /organizer/transactions/:id/accept — `organizer/accept-transaction.spec.ts`

| ID | Scenario | Expected |
|---|---|---|
| ORG-ACCEPT-1 | should mark the transaction as paid and email the customer | status PAID, `paidAt` set, `sendMail` called with the accepted template |
| ORG-ACCEPT-2 | should not touch the ticket stock when accepting | `availableQuantity` unchanged |
| ORG-ACCEPT-3 | should return 400 when the transaction status is not WAITING_FOR_CONFIRMATION (each other status) | 400, no email |
| ORG-ACCEPT-4 | should return 404 when the transaction belongs to another organizer's event | 404, status unchanged |
| ORG-ACCEPT-5 | should return 404 when the transaction does not exist | 404 |
| | COMMON-1, 2, 3, 5, 6 | |

### PATCH /organizer/transactions/:id/reject — `organizer/reject-transaction.spec.ts`

| ID | Scenario | Expected |
|---|---|---|
| ORG-REJECT-1 | should mark the transaction as rejected, restore the ticket stock and email the customer | status REJECTED, stock + quantity, rejected template sent |
| ORG-REJECT-2 | should give back the points used on the order and remove the usage records | point amounts restored, `PointUsage` deleted |
| ORG-REJECT-3 | should make the coupon usable again | `isUsed = false` |
| ORG-REJECT-4 | should give back the voucher quota | `quota + 1` |
| ORG-REJECT-5 | should return 400 when the transaction status is not WAITING_FOR_CONFIRMATION (each other status) | 400, nothing restored |
| ORG-REJECT-6 | should return 404 when the transaction belongs to another organizer's event | 404, nothing changed |
| ORG-REJECT-7 | should return 404 when the transaction does not exist | 404 |
| | COMMON-1, 2, 3, 5, 6 | |

### GET /organizer/statistics — `organizer/get-statistics.spec.ts`

| ID | Scenario | Expected |
|---|---|---|
| ORG-STATS-1 | should summarize paid orders and group them by year, month and day | `summary`, `byYear`, `byMonth` (12), `byDay` (days in month) |
| ORG-STATS-2 | should only count PAID orders | other statuses ignored |
| ORG-STATS-3 | should only count the authenticated organizer's events and orders | others ignored |
| ORG-STATS-4 | should not count deleted events in totalEvents | excluded |
| ORG-STATS-5 | should default to the current year and month | from `new Date()` |
| ORG-STATS-6 | should fall back to the defaults when year and month are not numbers | defaults |
| ORG-STATS-7 | should return the right number of days for February | 29 in a leap year, 28 otherwise |
| ORG-STATS-8 | should return zeroed statistics when the organizer has no orders | all zeros, `byYear = []` |
| | COMMON-1, 3, 5, 6 | |

### GET /organizer/events/:id/attendees — `organizer/get-event-attendees.spec.ts`

| ID | Scenario | Expected |
|---|---|---|
| ORG-ATT-1 | should return the paid attendees of the event with a summary, earliest payment first | `{ event, summary, attendees, meta }` |
| ORG-ATT-2 | should only include PAID orders | others excluded |
| ORG-ATT-3 | should only include orders of the requested event | others excluded |
| ORG-ATT-4 | should paginate the attendees while keeping the full summary | `meta` paged, `summary` total |
| ORG-ATT-5 | should return an empty attendee list when nobody has paid yet | `[]`, zero summary |
| ORG-ATT-6 | should return 404 when the event belongs to another organizer | 404 |
| ORG-ATT-7 | should return 404 when the event has been deleted | 404 |
| ORG-ATT-8 | should return 404 when the event does not exist | 404 |
| | COMMON-1, 3, 5, 6 | |

## Profile

### GET /profile — `profile/get-profile.spec.ts`

| ID | Scenario | Expected |
|---|---|---|
| PROFILE-GET-1 | should return the customer's profile with point balance and coupons | user fields + `pointBalance` + `coupons` |
| PROFILE-GET-2 | should include the organization for an organizer | `organization` present |
| PROFILE-GET-3 | should exclude expired points from the balance | only unexpired summed |
| PROFILE-GET-4 | should only list unused, unexpired coupons, soonest expiry first | filtered and sorted |
| PROFILE-GET-5 | should not include another user's points or coupons | zero / empty |
| PROFILE-GET-6 | should return a zero balance and no coupons for a new user | 0, `[]` |
| PROFILE-GET-7 | should return 404 when the user in the token no longer exists | 404 `User not found` |
| | COMMON-1, 2, 3, 8 | |

### PATCH /profile — `profile/update-profile.spec.ts`

| ID | Scenario | Expected |
|---|---|---|
| PROFILE-UPDATE-1 | should update the user's name | name saved, email intact |
| PROFILE-UPDATE-2 | should only update the authenticated user | other users untouched |
| PROFILE-UPDATE-3 | should return 400 when the name is shorter than 2 characters | 400 |
| PROFILE-UPDATE-4 | should return 400 when the name is missing | 400 |
| PROFILE-UPDATE-5 | should return 400 when unknown fields are sent (email, role) | 400, nothing changed |
| | COMMON-1, 2, 3 | |

### PATCH /profile/password — `profile/change-password.spec.ts`

| ID | Scenario | Expected |
|---|---|---|
| PROFILE-PWD-1 | should change the password when the current password is correct | new hash verifies, old one does not |
| PROFILE-PWD-2 | should allow logging in with the new password and reject the old one | 200 then 400 |
| PROFILE-PWD-3 | should return 400 when the current password is wrong | 400 `Current password is incorrect` |
| PROFILE-PWD-4 | should return 400 when the new password is shorter than 6 characters | 400 |
| PROFILE-PWD-5 | should return 400 when currentPassword / newPassword is missing or empty, or unknown fields are sent | 400, password unchanged |
| PROFILE-PWD-6 | should return 404 when the user in the token no longer exists | 404 |
| | COMMON-1, 2, 3 | |

### PATCH /profile/picture — `profile/update-picture.spec.ts`

| ID | Scenario | Expected |
|---|---|---|
| PROFILE-PIC-1 | should upload the picture and save its url | `uploadImage` called, `picture` saved |
| PROFILE-PIC-2 | should remove the previous picture from cloudinary when replacing it | `removeImageByUrl(oldUrl)` called |
| PROFILE-PIC-3 | should return 400 when no file is attached | 400 `Picture file is required` |
| PROFILE-PIC-4 | should return 400 when the file content is not a real image | 400 `File type is not allowed` (magic-byte check) |
| PROFILE-PIC-5 | should reject a file whose mimetype is not an image | 500 `Only image files are allowed` (multer filter) |
| PROFILE-PIC-6 | should not save anything when the cloudinary upload fails | 500, old picture kept |
| PROFILE-PIC-7 | should return 404 when the user in the token no longer exists | 404 |
| | COMMON-1, 2, 3 | |

## Review

### POST /reviews — `review/create-review.spec.ts`

| ID | Scenario | Expected |
|---|---|---|
| REVIEW-CREATE-1 | should create an event review for a paid order after the event ended | 201, review linked to the order, only review fields in the response |
| REVIEW-CREATE-2 | should create an organizer review for a paid order | 201, type ORGANIZER |
| REVIEW-CREATE-3 | should allow an organizer review on the same order as an event review | 201, two reviews on one order |
| REVIEW-CREATE-4 | should attach the review to the authenticated customer's own paid order | `orderId` = own order, not another customer's |
| REVIEW-CREATE-5 | should attach the review to the paid order when an unpaid order exists too | `orderId` = the PAID order |
| REVIEW-CREATE-6 | should accept a paid order for any ticket type of the event | 201 |
| REVIEW-CREATE-7 | should ignore extra fields such as a foreign orderId and userId | 201, review saved on the customer's own order |
| REVIEW-CREATE-8 | should trim the title and comment and coerce numeric strings | normalized values stored |
| REVIEW-CREATE-9 | should preserve unicode characters and internal line breaks | stored exactly as sent |
| REVIEW-CREATE-10 | should accept ratings 1, 3 and 5 | 201 |
| REVIEW-CREATE-11 | should accept the minimum (3/10) and maximum (100/1000) title and comment lengths | 201 |
| REVIEW-CREATE-12 | should return 409 when the same review type is submitted twice (EVENT or ORGANIZER) | 409, original review unchanged |
| REVIEW-CREATE-13 | should return 400 when the event has not started yet | 400 `You can only review an event after it has ended` |
| REVIEW-CREATE-14 | should return 400 when the event is still ongoing | 400 |
| REVIEW-CREATE-15 | should check that the event ended before checking the customer's order | 400 takes precedence over 403 |
| REVIEW-CREATE-16 | should return 404 when the event does not exist | 404 `Event not found` |
| REVIEW-CREATE-17 | should return 404 when the event has been deleted | 404, no review saved |
| REVIEW-CREATE-18 | should return 403 when the paid order is for another event | 403, no review saved |
| REVIEW-CREATE-19 | should return 403 for every order status other than PAID | 403, no review saved |
| REVIEW-CREATE-20 | should return 403 when the customer has no order at all | 403 |
| REVIEW-CREATE-21 | should return 403 when the paid order belongs to another customer | 403 |
| REVIEW-CREATE-22 | should return 400 when the body is empty | 400, no review saved |
| REVIEW-CREATE-23 | should return 400 for invalid eventId / type / rating / title / comment values | 400, no review saved |
| REVIEW-CREATE-24 | should check authentication before validating the body | 401 even with an invalid body |
| REVIEW-CREATE-25 | should return 403 when an organizer has not paid for the event | 403, no review saved |
| | COMMON-1, 2, 3, 4, 7 | |

The review route has no `authorize(Role.CUSTOMER)` guard: role enforcement comes from the paid-order rule, so an organizer who paid for a ticket could still submit a review.

### GET /reviews/event/:eventId — `review/get-event-reviews.spec.ts`

| ID | Scenario | Expected |
|---|---|---|
| REVIEW-EVENT-1 | should return the event reviews with the reviewer's name, newest first | sorted by `createdAt` desc, reviews from every ticket type, `order.user = { id, name }` |
| REVIEW-EVENT-2 | should return only the review fields and the reviewer's id and name | no password, email or order data |
| REVIEW-EVENT-3 | should only return EVENT reviews, not ORGANIZER reviews | filtered by type |
| REVIEW-EVENT-4 | should return an empty list when the event only has organizer reviews | `[]` |
| REVIEW-EVENT-5 | should return every review of the event, even from the same customer | not deduplicated per user |
| REVIEW-EVENT-6 | should only return reviews for the requested event | other events of the same organization absent |
| REVIEW-EVENT-7 | should not include reviews of another organization's events | others absent |
| REVIEW-EVENT-8 | should still return the reviews of a soft-deleted event | 200, reviews returned |
| REVIEW-EVENT-9 | should return an empty list when the event has no reviews | `[]` |
| REVIEW-EVENT-10 | should be accessible without a token | 200 |
| REVIEW-EVENT-11 | should ignore an invalid authorization header because the endpoint is public | 200 |
| REVIEW-EVENT-12 | should return 404 when the event does not exist | 404 `Event not found` |
| REVIEW-EVENT-13 | should return 400 for a non-numeric / zero / negative / decimal / infinite event id | 400 `Invalid event ID` |
| | COMMON-8 | |

### GET /reviews/organization/:organizationId — `review/get-organization-reviews.spec.ts`

| ID | Scenario | Expected |
|---|---|---|
| REVIEW-ORG-1 | should return organizer reviews across all the organization's events, newest first | sorted by `createdAt` desc, includes reviewer and event summary |
| REVIEW-ORG-2 | should return only the review fields, the reviewer and the event summary | no password, email or order data |
| REVIEW-ORG-3 | should only return ORGANIZER reviews, not EVENT reviews | filtered by type |
| REVIEW-ORG-4 | should return an empty list when the organization only has event reviews | `[]` |
| REVIEW-ORG-5 | should not include reviews of another organization's events | each organization only sees its own reviews |
| REVIEW-ORG-6 | should return every organizer review from the same customer across events | not deduplicated per user |
| REVIEW-ORG-7 | should still return the organizer reviews of a soft-deleted event | 200, reviews returned |
| REVIEW-ORG-8 | should return an empty list when the organization has no reviews | `[]` |
| REVIEW-ORG-9 | should return an empty list when the organization has no events yet | `[]` |
| REVIEW-ORG-10 | should be accessible without a token | 200 |
| REVIEW-ORG-11 | should ignore an invalid authorization header because the endpoint is public | 200 |
| REVIEW-ORG-12 | should return 404 when the organization does not exist (including the max int id) | 404 `Organization not found` |
| REVIEW-ORG-13 | should return 400 for a non-numeric / zero / negative / decimal / infinite organization id | 400 `Invalid organization ID` |
| | COMMON-8 | |

## Voucher

### POST /vouchers — `voucher/create-voucher.spec.ts`

| ID | Scenario | Expected |
|---|---|---|
| VOUCHER-CREATE-1 | should create a voucher for the organizer's own event | 201 with event summary |
| VOUCHER-CREATE-2 | should normalize the code to uppercase and trim it | `PROMO10` |
| VOUCHER-CREATE-3 | should return 409 when the code already exists, even in a different case | 409 |
| VOUCHER-CREATE-4 | should return 404 when the event belongs to another organizer | 404 |
| VOUCHER-CREATE-5 | should return 404 when the event has been deleted | 404 |
| VOUCHER-CREATE-6 | should return 400 when the end date is in the past | 400 |
| VOUCHER-CREATE-7 | should return 400 when the end date is before the start date | 400 |
| VOUCHER-CREATE-8 | should return 400 for code < 3 chars, discount 0 / > 100 / non-integer, quota 0, eventId as string, invalid date, missing code | 400, no voucher saved |
| | COMMON-1, 2, 3, 5, 6 | |

### GET /vouchers — `voucher/get-my-vouchers.spec.ts`

| ID | Scenario | Expected |
|---|---|---|
| VOUCHER-MY-1 | should return the organizer's vouchers with event details and usage count, newest first | `_count.orders` included |
| VOUCHER-MY-2 | should only return vouchers of the authenticated organizer's events | others absent |
| VOUCHER-MY-3 | should return an empty list when the organizer has no vouchers | `[]` |
| | COMMON-1, 2, 3, 5, 6 | |

### PATCH /vouchers/:id — `voucher/update-voucher.spec.ts`

| ID | Scenario | Expected |
|---|---|---|
| VOUCHER-UPDATE-1 | should update the given fields and leave the others unchanged | partial update |
| VOUCHER-UPDATE-2 | should normalize a new code to uppercase | uppercased |
| VOUCHER-UPDATE-3 | should accept the voucher's own code again without a conflict | 200 |
| VOUCHER-UPDATE-4 | should return 409 when the new code belongs to another voucher | 409 |
| VOUCHER-UPDATE-5 | should return 400 when the new end date is before the existing start date | 400 |
| VOUCHER-UPDATE-6 | should return 400 when the new start date is after the existing end date | 400 |
| VOUCHER-UPDATE-7 | should return 400 when both dates are sent and the end date is not after the start date | 400 |
| VOUCHER-UPDATE-8 | should return 400 when the quota is lowered below the number of orders using the voucher | 400 |
| VOUCHER-UPDATE-9 | should allow a quota equal to the number of orders using the voucher | 200 |
| VOUCHER-UPDATE-10 | should return 400 for discount 0 / > 100, quota 0, code < 3 chars, invalid date | 400, voucher unchanged |
| VOUCHER-UPDATE-11 | should return 404 when the voucher belongs to another organizer | 404, unchanged |
| VOUCHER-UPDATE-12 | should return 404 when the voucher does not exist | 404 |
| VOUCHER-UPDATE-13 | should return 400 for a non-numeric / zero / negative voucher id | 400 `Invalid voucher ID` |
| | COMMON-1, 3, 5 | |

### DELETE /vouchers/:id — `voucher/delete-voucher.spec.ts`

| ID | Scenario | Expected |
|---|---|---|
| VOUCHER-DELETE-1 | should delete an unused voucher | row removed |
| VOUCHER-DELETE-2 | should only delete the requested voucher | others kept |
| VOUCHER-DELETE-3 | should return 400 when the voucher has already been used by an order | 400, voucher kept |
| VOUCHER-DELETE-4 | should return 404 when the voucher belongs to another organizer | 404, voucher kept |
| VOUCHER-DELETE-5 | should return 404 when the voucher does not exist | 404 |
| VOUCHER-DELETE-6 | should return 400 for a non-numeric / zero / negative voucher id | 400 `Invalid voucher ID` |
| | COMMON-1, 3, 5 | |

### GET /vouchers/public — `voucher/get-public-promotions.spec.ts`

| ID | Scenario | Expected |
|---|---|---|
| VOUCHER-PUBLIC-1 | should return active vouchers with their event summary, ordered by the soonest end date | sorted by `endDate` asc |
| VOUCHER-PUBLIC-2 | should not return vouchers that have not started yet | excluded |
| VOUCHER-PUBLIC-3 | should not return vouchers that have already ended | excluded |
| VOUCHER-PUBLIC-4 | should not return vouchers whose quota has been used up | excluded |
| VOUCHER-PUBLIC-5 | should not return vouchers of deleted events | excluded |
| VOUCHER-PUBLIC-6 | should return an empty list when there are no vouchers | `[]` |
| VOUCHER-PUBLIC-7 | should be accessible without a token | 200 |

## Points

The points feature has no module of its own. It is exercised through the balance endpoint and the checkout/rejection flows that move the balance. The balance endpoint also has two basic cases in `transaction/get-transaction.spec.ts` (TRX-POINTS-1/2); the suite below covers it in depth.

### GET /transactions/my/points — `points/point.spec.ts`

| ID | Scenario | Expected |
|---|---|---|
| POINT-1 | should return the sum of the customer's usable points | unexpired, positive points of the caller only |
| POINT-2 | should return a zero balance when the customer has no point records | `{ message, data: { balance: 0 } }` |
| POINT-3 | should ignore expired points even when they still have a balance | only unexpired points counted |
| POINT-4 | should ignore point records whose remaining amount is zero | only positive amounts counted |
| POINT-5 | should count a partially used point at its remaining amount | balance = remaining `amount` |
| POINT-6 | should work with a token obtained from the login endpoint | 200, same balance |
| | COMMON-1, 2, 3, 4, 5, 7 | |

### Point balance lifecycle — `points/point.spec.ts`

| ID | Scenario | Expected |
|---|---|---|
| POINT-LIFECYCLE-1 | should credit the referrer with 10,000 points when a new customer registers with their referral code | referrer balance 10,000, new user 0, expiry ~3 months |
| POINT-LIFECYCLE-2 | should lower the balance by the points redeemed at checkout | balance reduced, `pointUsages` written, point row decremented |
| POINT-LIFECYCLE-3 | should report a zero balance after the customer spends every point | balance 0, point row 0 |
| POINT-LIFECYCLE-4 | should leave the balance untouched when checkout fails for insufficient points | 400 `Insufficient points balance`, no order/usage |
| POINT-LIFECYCLE-5 | should keep each customer's balance separate when only one of them spends points | spender reduced, other customer unchanged |
| POINT-LIFECYCLE-6 | should restore the redeemed points when the organizer rejects the payment | balance restored, point row restored, usages deleted |

### POST /auth/register — `points/referral.spec.ts`

The referral program is exercised through registration (which grants the rewards) plus the balance endpoint and checkout (which make them observable/usable). Generic auth validation stays in `auth/register.spec.ts`; this suite only covers referral behavior.

| ID | Scenario | Expected |
|---|---|---|
| REFERRAL-1 | should credit the referrer with 10,000 points and give the referred customer a REF coupon | point + REF coupon with the same 3-month expiry, `referredById` set |
| REFERRAL-2 | should make the referral points visible through the balance endpoint | referrer 10,000, referred customer 0 |
| REFERRAL-3 | should credit the referrer once for every customer they refer | two point rows, balance 20,000, one coupon per referred user |
| REFERRAL-4 | should not credit the referrer twice when the referred email is already registered | 400 `Email already exists`, one point row |
| REFERRAL-5 | should return 400 and create nothing for an unknown referral code | 400 `Invalid referral code`, no user/point/coupon |
| REFERRAL-6 | should return 400 for a lowercase referral code | 400 `Invalid referral code` (case-sensitive) |
| REFERRAL-7 | should return 400 for a whitespace-padded referral code | 400 `Invalid referral code` (no trimming) |
| REFERRAL-8 | should register without a referral reward when given no referral code or an empty one | 201, `referredById` null, no point/coupon |
| REFERRAL-9 | should still reward the referrer when the referred user registers as an organizer | organization created, referrer 10,000 points, organizer gets the coupon |
| REFERRAL-10 | should credit an organizer referrer even though organizers cannot view the point balance | point row created; balance endpoint 403 `Forbidden` |

### Referral rewards lifecycle — `points/referral.spec.ts`

| ID | Scenario | Expected |
|---|---|---|
| REFERRAL-LIFECYCLE-1 | should let a referred customer refer someone else and earn their own points | chain: first 10,000, second 10,000, third 0 |
| REFERRAL-LIFECYCLE-2 | should let the referred customer redeem the REF coupon at checkout | 10,000 discount, coupon marked used, referrer points unchanged |

## Not covered

- Transaction cancel: no cancel endpoint exists yet (`PaymentStatus.CANCELED` is unused).
- Auto-expire cron (`src/script/transaction.ts`): its logic runs inside `cron.schedule` and is not callable from a test. Extract it into a service function to test the rollback of stock, points and coupons on expiry.
- Transaction auto-cancel after 3 days without organizer action: not implemented.
