# Store privacy disclosures for 1.2.0 (Community Mines)

What to enter in Google Play's Data safety form and Apple's App Privacy questionnaire once 1.2.0
adds Community Mines. Only the changes from 1.1 are new; keep what was already declared for
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
can use the app without it, since only Community Mines needs it).

| Category → type | Purposes |
|---|---|
| Location → Precise location | App functionality |
| Photos and videos → Photos | App functionality |
| Personal info → User IDs | App functionality, Account management, Fraud prevention, security, and compliance |
| App activity → Other user-generated content (mine details, votes, reports) | App functionality, Fraud prevention, security, and compliance |

Leave Approximate location, Name, Email address, Device or other IDs, Crash logs and Diagnostics
undeclared: the app doesn't collect them. (Server access logs hold IP addresses for security only;
Google's form doesn't ask about those.)

## Apple: App Store Connect → the app → App Privacy

**Data used to track you:** none.

**Data linked to you:** add these, each for **App Functionality** only:

| Data type | Notes |
|---|---|
| Location → Precise Location | Where a mine was added, and where the user stood |
| User Content → Photos or Videos | Photos of the working |
| User Content → Other User Content | Mine details, votes, reports |
| Identifiers → User ID | The anonymous Sign in with Apple / Google identifier |

Keep whatever 1.1 declared for purchases.

**Account deletion (Guideline 5.1.1(v)):** in-app, at Submissions → Account → Delete account.

## App Review notes for 1.2.0

> 1.2.0 adds Community Mines: signed-in users can add old mine workings with photos. Sign in with
> Apple is offered alongside Google. Content is moderated: a new account's first three submissions
> and any submission in a park, protected area or First Nations reserve are reviewed by staff before
> anyone else sees them; any mine can be reported (flag icon, "Report or block" in its sheet), which
> hides it after two reports, and its author can be blocked. Users agree to the Terms of Use, which
> prohibit objectionable content, when signing in. Accounts can be deleted in the app under
> Submissions → Account → Delete account. Contact: support@sgss.ca.

## Before publishing

- Publish the updated `privacy-policy.html` and `terms-of-use.html`, and the new
  `delete-account.html` at `https://sgss.ca/mobile-apps/minfinder/delete-account`, **before**
  1.2.0 goes to review. Both stores check the URLs.
- The policy promises off-server backup copies are kept no more than 30 days: delete older folders
  in `~/minfinder-backups/` (see `artifacts/minfinder-api/deploy/pull-backup.sh`).
- The terms promise reports are acted on "normally within 24 hours": check `/admin` daily.
