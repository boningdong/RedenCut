# Reporting a problem

Feature requests and bug reports are welcome through [Issues](https://github.com/boningdong/RedenCut/issues).

To report a problem:

1. Search [open and closed issues](https://github.com/boningdong/RedenCut/issues?q=is%3Aissue) using what you were doing, what went wrong, or the error shown (for example, “import audio hangs” or “export silent”). You do not need to know the feature name. Diagnostic IDs are unique to an occurrence, so use the error text or code when searching for similar problems.
2. If you can reproduce it, collect diagnostics soon afterward: open **Help → Collect diagnostics…** or **Settings → Diagnostics**, then choose **Collect diagnostics** at the bottom. Both entries open the same Settings page, and this also works without an error message.
3. Choose **Review files**, review them, then **Save bundle…** to save a ZIP. It contains retained application events, main/helper messages and environment details; older logs may have rotated away. Audio, transcripts and project files are not included. Common secrets and private paths are redacted, but third-party logs can still contain personal information: review before sharing. Nothing is uploaded automatically.
4. Open a new issue using **Bug report**. Give it a plain title describing the action and symptom, such as “Importing an MP3 stops at 50%”. Describe the steps, what happened, what you expected, and the app/OS versions.
5. Optionally drag the ZIP and relevant screenshots into the attachment field, wait for GitHub's upload to finish, then submit. If diagnostics are unavailable, report the problem without them. If a similar issue exists, add useful new steps or an attachment there instead of opening a duplicate.

If an audio sample is needed, use a short recording you have permission to share.
