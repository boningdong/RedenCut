# Localization Workflow

## User Goal

Choose English or Simplified Chinese, keep editing, and retain the choice after restarting RiffCut.
Run the [editing baseline](editing-workflow.md) and this scenario through the [agent-testing skill](../../.agents/skills/agent-testing/SKILL.md) against the same final source snapshot.
Use the prepared mandarin-short-female.wav fixture and a run-owned project.

## Mandatory Checkpoints

| ID | Required observable outcome | Evidence |
| --- | --- | --- |
| `language-selection` | English, Simplified Chinese, and Follow System are available; selecting Chinese updates visible application labels and tooltips. | Before/after full snapshots and screenshots. |
| `language-edit-state` | Switching language preserves the imported track, selected edit, visible gap and playback position; switching while playing does not stop playback. | Ordered screenshots and visible time/control observations. |
| `language-modal` | An open export dialog renders in the chosen language, and reopening it after a language change shows the new copy. | Dialog snapshots in both languages; live in-place updates also covered by component tests when the modal prevents header interaction. |
| `language-persistence` | Full application restart retains explicit Chinese preference and reopening the saved project retains its edited layout. | Preference/control observations and saved/reopened screenshots with run generations. |
| `language-recovery` | Selecting English restores English labels without changing the project; Follow System resolves to a supported language. | Full snapshots with selected preference and resulting labels. |
| `language-layout` | At the supported minimum window size, language controls and core editing actions remain usable in both languages. | Screenshots at 900×600 and semantic action observations. |

## Targeted Automated Coverage

Retained errors and progress retranslate after switching; preference read/write failures remain visible and do not overwrite committed state; native application-supplied dialog copy uses the selected language.
Record the corresponding focused test evidence separately from live UI observations.
System-owned native picker controls and real macOS font/window behavior require native manual checks and must not be described as verified by Linux Docker.
Speech recognition language and transcript data remain independent of UI preference; contract/component tests cover this when speech models are not provisioned.

## Exploration

Switch language repeatedly and try a keyboard action after returning focus to the waveform.
Inspect language selection without imported audio as well as the edited project.
