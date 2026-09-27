# Store privacy disclosures for 1.2.0 (Field reports)

What to enter in Google Play's Data safety form and Apple's App Privacy questionnaire once 1.2.0
adds Field reports. Only the changes from 1.1 are new; keep what was already declared for
in-app purchases (RevenueCat). Each answer follows from the privacy policy
(`privacy-policy.html`, §3 and §4); if the app changes, change both.

Google treats data a user deliberately publishes through a feature as collected, not shared, and
our servers are ours, not a third party. Apple and Google each disclose what their own sign-in,
App Attest and Play Integrity services collect, so those aren't declared here.

## Google Play: Policy and programs → App content → Data safety

**Data collection and security**

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | Yes |
| Is all of the user data collected by your app encrypted in transit? | Yes |
| Which of the following methods of account creation does your app support? | OAuth (Sign in with Google, Sign in with Apple) |
| Do you provide a way for users to request that their data is deleted? | Yes |
| Delete account URL | `https://sgss.ca/mobile-apps/minfinder/delete-account` |

**Data types**, each: Collected yes, Shared no, Processed ephemerally no, and **optional** (users
can use the app without it, since only Field reports need it).

| Category → type | Purposes |
|---|---|
| Location → Precise location | App functionality, Fraud prevention, security, and compliance (the on-site 75 m check and mock-location refusal) |
| Photos and videos → Photos | App functionality, Fraud prevention, security, and compliance (the fingerprint that catches reused photos) |
| Personal info → User IDs | App functionality, Account management, Fraud prevention, security, and compliance |
| App activity → Other user-generated content (field reports, comments, confirmations, Helpful marks, flags, blocks) | App functionality, Fraud prevention, security, and compliance |

Shared stays **no** even though policy §8 lets SGS pass field reports to MINFILE's maintainers:
they go without any identity, and Google exempts anonymized transfers. If that sharing ever
includes anything tied to the account, switch Location, Photos and Other UGC to Shared.

Leave Approximate location, Name, Email address, Device or other IDs, Crash logs and Diagnostics
undeclared: the app doesn't collect them. (Server access logs hold IP addresses for security only;
Google's form doesn't ask about those.)

## Apple: App Store Connect → the app → App Privacy

**Data used to track you:** none.

**Data linked to you:** add these, each for **App Functionality** only:

| Data type | Notes |
|---|---|
| Location → Precise Location | Where a working was marked, and where the user stood when reporting or confirming |
| User Content → Photos or Videos | Photos of the working or the searched ground |
| User Content → Other User Content | Field reports, comments, confirmations, Helpful marks, flags, blocks |
| Identifiers → User ID | The anonymous Sign in with Apple / Google identifier |

Keep whatever 1.1 declared for purchases.

**Account deletion (Guideline 5.1.1(v)):** in-app, at menu → My reports → Account → Delete account.

## App Review notes for 1.2.0

Paste into App Store Connect → App Review Information → Notes. Replace `<VIDEO_URL>` with the
on-site demo (see Before publishing). Leave "Sign-in required" unticked: Sign in with Apple works
with the reviewer's own Apple ID, so there is no demo account.

> 1.2.0 adds field reports on existing MINFILE mines. Signed-in users can mark where a mine's
> workings really are, from the site (with optional photos), report that they found nothing at the
> published spot, or leave a comment. Other visitors confirm or dispute reports, and only answers
> given on site count.
>
> Signing in: browsing needs no account. Adding a report, a comment, a confirmation, a Helpful or a
> flag asks you to sign in. Sign in with Apple works with any Apple ID, so no demo account is needed;
> Google is offered alongside it.
>
> To try it: tap any mine on the map → Details → the Reports and Comments tabs. KELOWNA (search
> "Kelowna") has a comment from another member, so you can mark it Helpful, flag it ("Flag")
> and block its author (Flag → "Block this member"). You can add your own comment from anywhere.
>
> Marking a location, "Couldn't find it" and Confirm/Dispute need a GPS fix within 75 m of a mine in
> British Columbia, so they can't be tried from outside BC. This video shows them on site:
> <VIDEO_URL>. The exact coordinates of reported points are part of MinFinder Pro; the sandbox
> purchase unlocks them.
>
> Moderation: a new account's first three reports, and any working marked in a park, protected area
> or First Nations reserve, are reviewed by staff before anyone else sees them. Any report or
> comment can be flagged, which hides it after two flags, and its author can be blocked. Users agree
> to the Terms of Use, which prohibit objectionable content, when signing in. Your first reports
> during review will show as "In review" for that reason.
>
> Account deletion: menu → My reports → Account → Delete account. Contact: support@sgss.ca.

### Google Play: App content → App access

Choose "All or some functionality is restricted", then add one set of instructions:

- **Name:** Field reports
- **Username:** the review Google account's address (see Before publishing)
- **Password:** its password
- **Any other information:**

> Tap "Sign in with Google" under menu → My reports and use the account above. Reports and comments are
> under a mine's Details → Reports / Comments; KELOWNA has a comment from another member to mark
> Helpful, flag, or block its author (Flag → "Block this member"). Marking a location and confirming others' reports need GPS within 75 m of a BC
> mine; this video shows them on site: <VIDEO_URL>. MinFinder Pro (exact coordinates of reported
> points): menu → About → Redeem a promo code, and enter <PROMO_CODE>. Account deletion: menu → My reports → Account → Delete account.

Tick "Sign in details in this declaration provide full access…". Strictly, Pro follows the Play
Store account, not the sign-in, so the promo code is what makes that literally true. It's optional:
earlier versions were approved without one. If you skip it, drop the Pro sentence above.

## Before publishing

- Publish the updated `privacy-policy.html` and `terms-of-use.html`, and the new
  `delete-account.html` at `https://sgss.ca/mobile-apps/minfinder/delete-account`, **before**
  1.2.0 goes to review. Both stores check the URLs.
- The policy promises off-server backup copies are kept no more than 30 days: delete older folders
  in `~/minfinder-backups/` (see `artifacts/minfinder-api/deploy/pull-backup.sh`).
- The terms promise flags are acted on "normally within 24 hours": check `/admin` daily.
- **Review Google account:** create one only for Play review (for example
  `minfinder.review@gmail.com`), with 2-step verification off so a sign-in from Google's review
  location isn't blocked. Put its details in Play Console only, never in this repo.
- **Optional, a Pro promo code for Play review:** Play Console → Monetize → Promo codes, for the lifetime
  product. Replace `<PROMO_CODE>` with it. It works whichever Play account the reviewer's phone uses.
- **A comment on KELOWNA from a staff account**, approved in `/admin`. Reviewers can't mark their
  own comment Helpful or flag it, so they need someone else's to try those.
- **The on-site video:** a screen recording at a real mine of marking an adit (including the "more
  than 300 m away" confirmation), a "Couldn't find it" search, and confirming another member's
  point. Upload it unlisted and put the link in both notes.
- After review, remove the reviewers' reports from `/admin`: as new accounts, they land in the queue.
