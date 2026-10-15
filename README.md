# AutoJudge Contest

Participate in active AutoJudge contests, view problem descriptions, export public testcases, submit solutions, and track live standings directly inside Visual Studio Code.

<p align="center">
  <img src="media/contest.gif" alt="AutoJudge Contest In action">
</p>

---

## 🚀 Overview

The **AutoJudge Contest** extension allows competitive programming teams to focus on coding without context switching. It interfaces directly with the AutoJudge API from the [autojudge.io](https://autojudge.io) platform, offering a fully integrated environment to compete, submit, and succeed.

> [!TIP]
> **Perfect Pairing:** This extension works seamlessly alongside the [AutoJudge Code Runner](https://marketplace.visualstudio.com/items?itemName=autojudge.autojudge-extension) extension. Code, execute your code, and run tests cases, without ever leaving your editor.

---

## ✨ Features

- **🔐 Simple Team Authentication**
  Log in through the AutoJudge website: VS Code opens your browser, you enter your team code and PIN (or confirm if you are already logged in there), and the browser sends you back to VS Code logged in. Both share the same team session, which stays valid for the whole contest and is restored when VS Code restarts. If the AutoJudge server cannot be reached (or does not answer within 20 seconds), the views show an offline notice with a **Retry** link, and your session is kept.

- **📖 Interactive Problem Browser**
  Problems are listed in letter order (**A.**, **B.**, …) with your solved state and attempt count. Open a problem to read its statement, with its public test cases, as clean, readable Markdown directly inside VS Code. No web browser required.

  ![Interactive Problem Browser](media/problems-tree.png)

- **🧪 Local Test Case Generation**
  Export public testcase input/output pairs as numbered `.in` and `.out` files (`<problem>-testcase-01.in`) for easy local debugging and validation. Files go to the active file's folder, or to your only workspace folder, or to a folder you choose. Existing files are replaced only after you confirm.

- **⚡ Instant Submission & Poll-to-Verdict**
  Submit your active source code file from a problem's row, the editor title bar, or the Command Palette. Supports `.c`, `.cpp`, `.java`, `.js`, `.php`, and `.py`. Pick the problem (the one you last submitted this file to is listed first), confirm the submission, and watch it show as **Judging** until the verdict arrives in a notification with **View Details** and **Compare Output** actions. A problem you have already solved is not submitted again, and a second submission is refused until the first one has been sent. Submissions still being judged are checked automatically, including after a restart: network errors only delay the next check, and a verdict still pending after 2 minutes is checked again 30 seconds later.

  ![Instant Submission](media/submissions-tree.png)

- **📊 Live Standings & Team Details**
  Follow the **Standings** view, where teams are ranked by solved problems and then by lowest total time, with your team highlighted. It refreshes every 15 seconds while the view is visible. Click a team to open its details page with its rank, solved count, total time, and solved problems.

- **🕒 Contest Clock & Status Bar**
  The contest header in the Contest Explorer shows the time left. The status bar shows the time left, your rank, and how many submissions are still being judged. Click either one to open the **Contest Overview** page.

- **🗂️ Submission History Tracking**
  Each problem lists its own submissions, newest first, with the verdict and how long ago each was made. Open a submission to see its verdict, time or penalty, judge hint, and expected versus received output. Submissions with both expected and received output can be compared side by side.

![Submission View](media/submissions-view.png)
---

## 🛠️ Getting Started

Get ready for the contest in just a few quick steps:

1. **Open the Activity Bar:** Click the **AutoJudge Contest** icon on the VS Code sidebar. It holds two views: **Contest Explorer** (problems and your submissions) and **Standings** (teams).
2. **Log In:** Click **Log In** in the sidebar, or run **AutoJudge Contest: Log In** from the Command Palette. Your browser opens the AutoJudge team login: enter the team code and PIN printed on your team card, then confirm the connection in the browser. A session ends when another login replaces it, when contest staff reset your PIN, or when the contest window closes; then log in again.

> [!NOTE]
> Browser login works best with one VS Code window open. The browser's `vscode://` callback goes to whichever window VS Code routes it to, which may not be the window that started the login. If you have several windows open, close the others while you log in. A callback that reaches a window with no login in progress shows "No login in progress. Run Log In again."

> [!NOTE]
> Before the contest starts, the explorer shows **Contest has not started yet** and keeps your session. The problems load on their own once the contest starts: within about 15 seconds while the **Standings** view is visible (about a minute while it is hidden), so no manual Refresh is needed.
3. **Explore Problems:** In the **Contest Explorer**, each problem shows its letter, title, and your progress. Hover over a problem and click the **book** icon (Open Problem Statement) to read its statement, which opens as a Markdown page. The problem's submissions are nested beneath it.
4. **Generate Testcases:** Hover over a problem and click the **beaker** icon (Export Public Test Cases) to write its public `.in` and `.out` files. They go into the folder of the active file when one is open, otherwise into your only workspace folder, otherwise into a folder you choose.
5. **Submit & Monitor:** Open your solution file and click the **cloud upload** icon (Submit Active File…) on a problem row, or on the same icon in the editor title bar. Confirm the submission. It appears under the problem with a **Judging** label, the status bar shows the pending count, and the verdict arrives as a notification. Click a submission row to view its details.

---

## 🌐 Custom & Self-Hosted Contests

Hosting your own contest? AutoJudge is completely open source. You can self-host your own AutoJudge contest server using the public repository:

👉 [**@werlang/autojudge**](https://github.com/werlang/autojudge)

To connect the extension to your self-hosted server, set `autojudgeContest.baseUrl` to your API address (defaults to `https://api.autojudge.io`) and `autojudgeContest.webUrl` to your website address, used for the browser login (defaults to `https://autojudge.io`). Both settings are read whenever they are used, so changes apply without reloading the window. Use `http://` or `https://` addresses: an invalid value shows an error with an **Open Settings** button as soon as the extension needs the server, including when you start **Log In** (before the browser opens).

---

## ⚙️ Configuration Settings

Customize the extension's behavior via your VS Code Settings:

| Setting Key | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `autojudgeContest.baseUrl` | `string` | `"https://api.autojudge.io"` | Full base API URL of the AutoJudge server. Supports subpaths (e.g. `https://example.com/api`). |
| `autojudgeContest.webUrl` | `string` | `"https://autojudge.io"` | Base URL of the AutoJudge website, opened for the browser login. |
| `autojudgeContest.pollIntervalMs` | `number` | `5000` | The polling interval (in milliseconds) used when waiting for a submission verdict. (Min: `1000`) |
| `autojudgeContest.confirmBeforeSubmit` | `boolean` | `true` | Ask for confirmation before submitting the active file, since a rejected attempt adds penalty time if you solve that problem later. Unsaved files are always confirmed before they are saved and submitted. |

*Note: The Standings view refreshes every 15 seconds while it is visible and every 60 seconds while it is hidden; these intervals are fixed. `autojudgeContest.baseUrl` and `autojudgeContest.webUrl` are application-scoped: set them in your user settings, since a workspace setting cannot change them.*

---

## ⌨️ Command Palette Contributions

All core functionality is easily accessible using the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`). Every command is in the **AutoJudge Contest** category:

- **AutoJudge Contest: Log In** (`autojudgeContest.loginTeam`) — Opens the browser login and connects VS Code to your team session. Shown while you are not logged in.
- **AutoJudge Contest: Log Out** (`autojudgeContest.logoutTeam`) — Forgets the stored session on this computer. It does not contact the server, so the team session stays active there. Also in the `…` menu of both sidebar views.
- **AutoJudge Contest: Refresh** (`autojudgeContest.refreshTree`) — Reloads the contest, problems, submissions, and standings.
- **AutoJudge Contest: Open Contest Overview** (`autojudgeContest.openContestDashboard`) — Opens the current contest's overview page: phase, schedule, rules, and your team's position.
- **AutoJudge Contest: Open Problem Statement** (`autojudgeContest.openProblem`) — Opens a problem's statement as a Markdown page. Without a selection, a quick pick asks which problem.
- **AutoJudge Contest: Submit Active File…** (`autojudgeContest.submitActiveFile`) — Submits the active source file to a problem picked from a quick pick, after the confirmation prompt (see `autojudgeContest.confirmBeforeSubmit`).
- **AutoJudge Contest: Export Public Test Cases** (`autojudgeContest.exportPublicCases`) — Exports the public test cases of a problem picked from a quick pick.
- **AutoJudge Contest: Open Submission** (`autojudgeContest.openSubmission`) — Opens the details of a submission. Offered from the Contest Explorer only.
- **AutoJudge Contest: Open Team Details** (`autojudgeContest.openTeamStanding`) — Opens a team's details page. Offered from the Standings view only.
- **AutoJudge Contest: Compare Expected and Received Output** (`autojudgeContest.compareSubmissionOutput`) — Opens a diff of a submission's expected and received output. Offered from the Contest Explorer for submissions that include output.

Submit Active File… remembers the problem you last submitted each file to and lists it first. The three sidebar-only commands (Open Submission, Open Team Details, and Compare Expected and Received Output) are hidden from the Command Palette.

---

## 💻 Local Development & Contributions

To set up a local development environment for this extension:

1. Clone this repository.
2. Spin up the development environment container:
   ```bash
   docker compose up -d --build
   ```
3. Install dependencies inside the container:
   ```bash
   docker compose exec extension npm install
   ```
4. Launch the Extension Development Host by opening the project in VS Code and pressing `F5`.
5. Pack the extension locally:
   ```bash
   docker compose exec extension npm run build
   ```

---

## 📄 License

This extension is licensed under the [MIT License](LICENSE).
